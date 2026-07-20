// StormTracker server-side detection — a framework-free port of the in-app
// radar pipeline (docs/js/core.js + storms.js) so the GitHub Actions scanner
// detects storms with the same dBZ palettes, tile math, winds-aloft steering,
// spacing filter, impact and ETA logic the browser uses. Node decodes PNG radar
// tiles with pngjs instead of a <canvas>.

import { PNG } from 'pngjs';
import { createRequire } from 'module';

// The radar pixel→dBZ converters, palettes and geo/tile math live in ONE shared
// module (docs/js/radar-shared.js): the browser app loads it as a global script
// and the scanner pulls it in here via createRequire (it's a CommonJS module, per
// docs/js/package.json). This keeps the GitHub Actions scanner decoding storms
// with the EXACT same code the PWA uses. The path is relative to this file; the
// scanner runs from a full repo checkout so ../docs/js/radar-shared.js resolves.
const require = createRequire(import.meta.url);
const shared = require('../docs/js/radar-shared.js');

// Re-export the shared symbols so scan.js / tropical.js (which import these from
// ./detect.js) keep working unchanged.
export const haversine = shared.haversine;
export const bearingDeg = shared.bearingDeg;
export const degToDir = shared.degToDir;
export const lonToTileX = shared.lonToTileX;
export const latToTileY = shared.latToTileY;
export const nexradToDbz = shared.nexradToDbz;
export const rvToDbz = shared.rvToDbz;

// Scanner-only helpers (not part of the shared radar module).
export const isUSLocation = (lat, lon) => lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66;
export const STORM_MIN_DBZ = 15;

// ---------------------------------------------------------------------------
// Tile fetch + decode (Node replacement for scanTileForPoints)
// ---------------------------------------------------------------------------
async function fetchPng(url) {
  // Never throw — a single tile timeout/network/decode error must not abort the
  // whole location scan. Callers treat null as "no data for this tile".
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await new Promise(resolve => {
      new PNG().parse(buf, (err, png) => resolve(err ? null : png));
    });
  } catch {
    return null;
  }
}

async function scanTile(url, tx, ty, zoom, colorFn, minDbz, scanRadius, origin, step = 2) {
  try {
    const png = await fetchPng(url);
    if (!png) return [];
    const { width: w, height: h, data } = png; // RGBA8
    const pts = [];
    for (let x = 0; x < w; x += step) {
      for (let y = 0; y < h; y += step) {
        const i = (y * w + x) * 4;
        if (data[i + 3] < 30) continue;
        const dbz = colorFn(data[i], data[i + 1], data[i + 2], data[i + 3]);
        if (dbz < minDbz) continue;
        const ptLon = (tx + x / w) * 360 / Math.pow(2, zoom) - 180;
        const ptLatRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + y / h) / Math.pow(2, zoom))));
        const ptLat = ptLatRad * 180 / Math.PI;
        const dist = haversine(origin.lat, origin.lon, ptLat, ptLon);
        if (dist <= scanRadius) pts.push({ lat: ptLat, lng: ptLon, dbz, dist });
      }
    }
    return pts;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Winds aloft -> steering vector (port of fetchWindsAloft + _applyAloftData)
// Returns { direction, speed(mph) } or null.
// ---------------------------------------------------------------------------
export async function fetchSteering(lat, lon) {
  let aloft = await openMeteoAloft(lat, lon);
  if ((!aloft || aloft.length < 2) && isUSLocation(lat, lon)) {
    try { aloft = await nomadsAloft(lat, lon); } catch { /* keep null */ }
  }
  if (!aloft || aloft.length < 2) return null;
  const steering = aloft.filter(a => a.p <= 850);
  if (!steering.length) return null;
  let tx = 0, ty = 0;
  steering.forEach(a => {
    const spdKt = a.rawMs * 1.944;
    const movDir = (a.dir + 180) % 360;
    const rad = movDir * Math.PI / 180;
    tx += Math.sin(rad) * spdKt;
    ty += Math.cos(rad) * spdKt;
  });
  const ax = tx / steering.length, ay = ty / steering.length;
  const spdKt = Math.sqrt(ax * ax + ay * ay);
  const dir = (Math.atan2(ax, ay) * 180 / Math.PI + 360) % 360;
  return { direction: Math.round(dir), speed: Math.round(spdKt * 1.151) };
}

async function openMeteoAloft(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    current: ['wind_speed_10m', 'wind_direction_10m',
      'wind_speed_925hPa', 'wind_direction_925hPa',
      'wind_speed_850hPa', 'wind_direction_850hPa',
      'wind_speed_700hPa', 'wind_direction_700hPa',
      'wind_speed_500hPa', 'wind_direction_500hPa'].join(','),
    wind_speed_unit: 'ms', forecast_days: '1', timezone: 'auto',
  });
  const hosts = ['api.open-meteo.com', 'customer-api.open-meteo.com'];
  for (let i = 0; i < hosts.length; i++) {
    try {
      const r = await fetch(`https://${hosts[i]}/v1/forecast?${params}`, { signal: AbortSignal.timeout(7000) });
      if (!r.ok) { if (r.status >= 500 && i < hosts.length - 1) continue; break; }
      const d = await r.json();
      const c = d.current || {};
      const levels = [
        { p: 1013, sk: 'wind_speed_10m', dk: 'wind_direction_10m' },
        { p: 925, sk: 'wind_speed_925hPa', dk: 'wind_direction_925hPa' },
        { p: 850, sk: 'wind_speed_850hPa', dk: 'wind_direction_850hPa' },
        { p: 700, sk: 'wind_speed_700hPa', dk: 'wind_direction_700hPa' },
        { p: 500, sk: 'wind_speed_500hPa', dk: 'wind_direction_500hPa' },
      ];
      const out = [];
      levels.forEach(l => {
        const spd = c[l.sk], dir = c[l.dk];
        if (spd == null || dir == null) return;
        out.push({ p: l.p, dir, rawMs: spd });
      });
      if (out.length >= 2) return out;
    } catch { /* try next host */ }
  }
  return null;
}

async function nomadsAloft(lat, lon) {
  const url = 'https://rucsoundings.noaa.gov/get_soundings.cgi?'
    + 'data_source=GFS&latest=latest&n_hrs=1&fcst_len=shortest'
    + '&airport=' + lat.toFixed(4) + ',' + lon.toFixed(4)
    + '&start=latest&text=Ascii%20text%20%28GSL%20format%29&hydrometeors=false';
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = await r.text();
  if (!txt || txt.length < 100) throw new Error('empty');
  const wanted = [1000, 925, 850, 700, 500];
  const hits = {}; let sfc = null;
  for (const ln of txt.split(/\r?\n/)) {
    const parts = ln.trim().split(/\s+/);
    if (parts.length < 7) continue;
    const t = parseInt(parts[0], 10);
    if (t !== 4 && t !== 5 && t !== 9) continue;
    let p = parseFloat(parts[1]);
    if (isNaN(p) || p <= 0) continue;
    if (p > 1100) p = p / 10;
    const dir = parseFloat(parts[5]); const spdKt = parseFloat(parts[6]);
    if (isNaN(dir) || isNaN(spdKt) || dir >= 9999 || spdKt >= 9999) continue;
    if (t === 9 && !sfc) sfc = { dir, spdKt };
    for (const tp of wanted) { if (!hits[tp] && Math.abs(p - tp) <= 5) { hits[tp] = { dir, spdKt }; break; } }
  }
  const out = [];
  if (sfc) out.push({ p: 1013, dir: sfc.dir, rawMs: sfc.spdKt * 0.5144 });
  for (const p of wanted) { const w = hits[p]; if (w) out.push({ p, dir: w.dir, rawMs: w.spdKt * 0.5144 }); }
  if (out.length < 2) throw new Error('insufficient levels');
  return out;
}

// ---------------------------------------------------------------------------
// Cell clustering (port of spacingFilter)
// ---------------------------------------------------------------------------
export function spacingFilter(points, origin) {
  const validPoints = points.filter(p => {
    if (p.dbz >= 30) return true;
    const radius = p.dbz >= 25 ? 5 : 8;
    let nearby = 0;
    for (const q of points) {
      if (q === p) continue;
      const dx = (p.lat - q.lat) * 69, dy = (p.lng - q.lng) * 69 * Math.cos(p.lat * Math.PI / 180);
      if (Math.sqrt(dx * dx + dy * dy) < radius) { nearby++; if (nearby >= 1) return true; }
    }
    return false;
  });
  validPoints.sort((a, b) => b.dbz - a.dbz);
  const out = [];
  for (const p of validPoints) {
    const minSpacing = p.dbz >= 45 ? 0.8 : p.dbz >= 35 ? 1.2 : 1.8;
    let merged = false;
    for (const e of out) {
      if (haversine(p.lat, p.lng, e.lat, e.lng) < minSpacing) {
        e.pixels++; if (p.dbz > e.dbz) e.dbz = p.dbz; merged = true; break;
      }
    }
    if (!merged) {
      out.push({
        lat: p.lat, lng: p.lng, dbz: p.dbz,
        distance: haversine(origin.lat, origin.lon, p.lat, p.lng),
        bearing: bearingDeg(origin.lat, origin.lon, p.lat, p.lng), pixels: 1,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Impact (port of _calcStormImpact) + ETA (core of calcStormETA, sans
// terrain/NWS-polygon boosts which aren't available server-side).
// ---------------------------------------------------------------------------
export function calcImpact(storm, mv) {
  if (!mv || mv.speed < 2) return { impactPct: 0, impactTier: 'none' };
  const midBear = storm.bearing || 0;
  const midDist = storm.distance || 0;
  const bearToUser = (midBear + 180) % 360;
  const diff = Math.abs(((mv.direction - bearToUser + 180) % 360) - 180);
  const closing = mv.speed * Math.cos(Math.min(diff, 60) * Math.PI / 180);
  const baseWidthMi = Math.max(0, Math.min(3, (storm.dbz - 20) / 15));
  const widthAngle = midDist > 0.5 ? Math.atan2(baseWidthMi, midDist) * 180 / Math.PI : 15;
  const coneHalf = 15 + widthAngle;
  let impactPct = 0, impactTier = 'none';
  if (diff <= coneHalf * 0.6 && closing > 1) { impactTier = 'high'; impactPct = 80 + Math.round(((coneHalf * 0.6) - diff) / (coneHalf * 0.6) * 20); }
  else if (diff <= coneHalf && closing > 0.5) { impactTier = 'medium'; impactPct = 31 + Math.round((coneHalf - diff) / (coneHalf * 0.4) * 49); }
  else if (diff <= coneHalf + 10) { impactTier = 'low'; impactPct = Math.max(5, Math.round((coneHalf + 10 - diff) / 10 * 30)); }
  return { impactPct, impactTier };
}

// v5.99: straight-line cross-track (perpendicular miss) of the storm's projected
// path from the user, in miles — the scanner's equivalent of the app's X-TRK
// distance. Geometry: with the storm at (distance, bearing) from the user and
// moving along mv.direction, the miss is distance·sin(diff), where diff is the
// angle between the motion and the storm→user direction (diff = 0 → heading
// straight at you). A cell whose closest approach is BEHIND it (diff ≥ 90°, i.e.
// moving away) returns Infinity, so it can never read as a direct hit.
// Approximates the app's BAM-integrated perpMiss well enough to gate a 1.5-mi
// "Direct" push; both stay honest via scanner/test-shared-parity.mjs.
export function crossTrackMi(storm, mv) {
  if (!mv || mv.speed < 2) return Infinity;
  const bearToUser = ((storm.bearing || 0) + 180) % 360;
  const diff = Math.abs(((mv.direction - bearToUser + 180) % 360) - 180);
  if (diff >= 90) return Infinity;
  return (storm.distance || 0) * Math.sin(diff * Math.PI / 180);
}

export function calcETA(storm, mv) {
  if (!mv || mv.speed < 2) return { etaMin: null, approaching: false, closingSpeed: 0 };
  const baseWidthMi = Math.max(0, Math.min(3, (storm.dbz - 20) / 15));
  const widthAngle = storm.distance > 0.5 ? Math.atan2(baseWidthMi, storm.distance) * 180 / Math.PI : 15;
  const coneHalf = 15 + widthAngle;
  const bearingToUser = (storm.bearing + 180) % 360;
  const diff = Math.abs(((mv.direction - bearingToUser + 180) % 360) - 180);
  const inCone = diff <= coneHalf;
  const closingSpeed = mv.speed * Math.cos(Math.min(diff, 60) * Math.PI / 180);
  if (!inCone || closingSpeed <= 1) return { etaMin: null, approaching: false, closingSpeed: Math.max(0, closingSpeed) };
  const etaMin = Math.round(storm.distance / closingSpeed * 60);
  return { etaMin, approaching: true, closingSpeed };
}

// ---------------------------------------------------------------------------
// Radar dBZ directly over a point (for the "rain right over you" alert). Mirrors
// the app's rainOverUserNow(): the radar value on the user's exact spot. We
// decode the tile(s) covering a tiny bbox (~sampleRadiusMi) around the point at
// fine step and return the MAX dBZ within that radius — a single pixel is too
// noisy, so a small neighborhood matches the app's hex-bin-over-user reading.
// Returns 0 when nothing is overhead (or on any fetch/decode failure).
// ---------------------------------------------------------------------------
export async function dbzAtPoint(lat, lon, sampleRadiusMi = 2) {
  const origin = { lat, lon };
  const useNexrad = isUSLocation(lat, lon);
  const zoom = useNexrad ? 11 : 8;
  const colorFn = useNexrad ? nexradToDbz : rvToDbz;

  let rvPath = null;
  if (!useNexrad) {
    try {
      const rv = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(6000) }).then(r => r.json());
      const frames = (rv.radar?.past || []).concat(rv.radar?.nowcast || []);
      rvPath = frames.length ? frames[frames.length - 1].path : null;
    } catch { rvPath = null; }
    if (!rvPath) return 0;
  }

  const radiusDeg = sampleRadiusMi / 69.0;
  const north = lat + radiusDeg, south = lat - radiusDeg;
  const east = lon + radiusDeg / Math.cos(lat * Math.PI / 180);
  const west = lon - radiusDeg / Math.cos(lat * Math.PI / 180);
  const minTX = lonToTileX(west, zoom), maxTX = lonToTileX(east, zoom);
  const minTY = latToTileY(north, zoom), maxTY = latToTileY(south, zoom);

  const tasks = [];
  for (let tx = minTX; tx <= maxTX; tx++) {
    for (let ty = minTY; ty <= maxTY; ty++) {
      const url = useNexrad
        ? `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${zoom}/${tx}/${ty}.png`
        : `https://tilecache.rainviewer.com${rvPath}/256/${zoom}/${tx}/${ty}/2/1_1.png`;
      tasks.push(scanTile(url, tx, ty, zoom, colorFn, 1, sampleRadiusMi, origin, 1));
    }
  }
  const settled = await Promise.allSettled(tasks);
  const pts = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));
  let max = 0;
  for (const p of pts) if (p.dbz > max) max = p.dbz;
  return max;
}

// ---------------------------------------------------------------------------
// Full scan for one location. Returns { cells, mv, source }.
// thresholds.radius (mi) defaults to 80; clamps tile count like the app.
// ---------------------------------------------------------------------------
export async function scanLocation(lat, lon, radius = 80) {
  const origin = { lat, lon };
  const useNexrad = isUSLocation(lat, lon);
  const mv = await fetchSteering(lat, lon);

  let zoom = useNexrad ? (radius <= 15 ? 11 : radius <= 30 ? 10 : radius <= 50 ? 9 : 8) : (radius <= 30 ? 8 : 7);
  const radiusDeg = radius / 69.0;
  const northLat = lat + radiusDeg, southLat = lat - radiusDeg;
  const eastLon = lon + radiusDeg / Math.cos(lat * Math.PI / 180);
  const westLon = lon - radiusDeg / Math.cos(lat * Math.PI / 180);
  let minTX = lonToTileX(westLon, zoom), maxTX = lonToTileX(eastLon, zoom);
  let minTY = latToTileY(northLat, zoom), maxTY = latToTileY(southLat, zoom);
  while ((maxTX - minTX + 1) * (maxTY - minTY + 1) > 48 && zoom > (useNexrad ? 8 : 7)) {
    zoom--; minTX = lonToTileX(westLon, zoom); maxTX = lonToTileX(eastLon, zoom);
    minTY = latToTileY(northLat, zoom); maxTY = latToTileY(southLat, zoom);
  }

  let rvPath = null;
  if (!useNexrad) {
    try {
      const rv = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: AbortSignal.timeout(6000) }).then(r => r.json());
      const frames = (rv.radar?.past || []).concat(rv.radar?.nowcast || []);
      rvPath = frames.length ? frames[frames.length - 1].path : null;
    } catch { rvPath = null; }
    if (!rvPath) return { cells: [], mv, source: 'rainviewer', error: 'no radar frames' };
  }

  const colorFn = useNexrad ? nexradToDbz : rvToDbz;
  const minDbz = STORM_MIN_DBZ;
  const tasks = [];
  for (let tx = minTX; tx <= maxTX; tx++) {
    for (let ty = minTY; ty <= maxTY; ty++) {
      const url = useNexrad
        ? `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${zoom}/${tx}/${ty}.png`
        : `https://tilecache.rainviewer.com${rvPath}/256/${zoom}/${tx}/${ty}/2/1_1.png`;
      tasks.push(scanTile(url, tx, ty, zoom, colorFn, minDbz, radius, origin));
    }
  }
  // Promise.allSettled so a rejected tile (should be impossible now, but be
  // defensive) degrades to "no points" rather than failing the whole scan.
  const settled = await Promise.allSettled(tasks);
  const raw = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : []));
  const cells = spacingFilter(raw, origin).sort((a, b) => a.distance - b.distance);
  for (const c of cells) {
    const imp = calcImpact(c, mv);
    c.impactPct = imp.impactPct; c.impactTier = imp.impactTier;
    const eta = calcETA(c, mv);
    c.etaMin = eta.etaMin; c.approaching = eta.approaching; c.closingSpeed = eta.closingSpeed;
  }
  return { cells, mv, source: useNexrad ? 'NEXRAD' : 'RainViewer', rawCount: raw.length };
}
