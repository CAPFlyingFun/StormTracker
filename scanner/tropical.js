// scanner/tropical.js — server-side parity for StormTracker's in-app NHC tropical
// tracking, so the background scanner can push a tropical system BEFORE any local
// NWS watch/warning is issued (the gap NWS-only alerts can't cover). Mirrors the
// in-app proximity + forecast-cone logic in docs/js/storms.js:
//   * within the user's proximity radius (default 200 mi)  -> "tracking"
//   * the user's location inside the storm's forecast cone -> "in cone"
// Keyless public source (works inside GitHub Actions): NHC's Active Hurricanes
// ArcGIS FeatureServer (layer 0 = current positions, layer 4 = forecast cone).

import { haversine, bearingDeg, degToDir } from './detect.js';

const ARC = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';
const Q = 'where=1%3D1&outFields=*&f=geojson&resultRecordCount=500';

function saffir(windMph) {
  if (!windMph) return 'Tropical system';
  if (windMph >= 157) return 'Cat 5';
  if (windMph >= 130) return 'Cat 4';
  if (windMph >= 111) return 'Cat 3';
  if (windMph >= 96) return 'Cat 2';
  if (windMph >= 74) return 'Cat 1';
  if (windMph >= 39) return 'Tropical Storm';
  return 'Tropical Depression';
}

// Ray-casting point-in-polygon. ring is GeoJSON [[lon,lat],...]; point is (lon,lat).
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// v5.92: GDACS (EU/UN, keyless) joins NHC so background push covers the SAME
// global cones the app shows (typhoons, Indian Ocean, Southern Hemisphere) —
// closing the "in cone in-app but no push" gap. GDACS storms are merged INTO
// the same systems list, so they inherit the existing per-location cooldowns,
// re-notify cadence and track→cone escalation — no new alert paths. Mirrors
// the client parse in docs/js/storms.js _fetchGDACSStorms (minimal subset).
const _normName = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function _parseGdacsMin(data) {
  const byEvent = {};
  for (const f of ((data && data.features) || [])) {
    const p = f.properties || {};
    if (String(p.iscurrent).toLowerCase() !== 'true') continue;
    const id = p.eventid;
    if (id == null) continue;
    const ev = byEvent[id] || (byEvent[id] = { eventid: id, props: null, lat: null, lon: null, cone: null });
    const cls = String(p.Class || p.class || '');
    const g = f.geometry || {};
    if (cls === 'Point_Centroid' && g.type === 'Point' && Array.isArray(g.coordinates)) {
      ev.lat = g.coordinates[1]; ev.lon = g.coordinates[0]; ev.props = p;
    } else if (cls === 'Poly_Cones' && g.type === 'Polygon' && g.coordinates && g.coordinates[0]) {
      ev.cone = g.coordinates[0]; // [[lon,lat],...] — same shape pointInRing expects
    }
    if (!ev.props) ev.props = p;
  }
  const out = [];
  for (const id in byEvent) {
    const ev = byEvent[id];
    if (ev.lat == null) continue;
    const p = ev.props || {};
    const rawName = String(p.eventname || '').replace(/-\d+$/, '').trim();
    const name = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase() : ('TC-' + id);
    const sev = p.severitydata || {};
    const maxWind = sev.severity ? Math.round(sev.severity * 0.621371) : null; // km/h → mph
    out.push({ eventid: id, name, lat: ev.lat, lon: ev.lon, cone: ev.cone, maxWind });
  }
  return out;
}

// Fetch active tropical systems (current position + forecast cone) once globally.
// Returns [{ id, name, type, maxWind(mph), lat, lon, cone:[[lon,lat],...] }].
async function fetchTropical() {
  const opts = { signal: AbortSignal.timeout(12000) };
  const [posR, coneR, gdacsR] = await Promise.allSettled([
    fetch(`${ARC}/0/query?${Q}`, opts).then(r => r.ok ? r.json() : null),
    fetch(`${ARC}/4/query?${Q}`, opts).then(r => r.ok ? r.json() : null),
    fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC', opts).then(r => r.ok ? r.json() : null),
  ]);
  const posData = posR.status === 'fulfilled' ? posR.value : null;
  const coneData = coneR.status === 'fulfilled' ? coneR.value : null;
  const gdacsData = gdacsR.status === 'fulfilled' ? gdacsR.value : null;

  // Parse forecast cones, keyed by storm id + lowercased name for matching.
  const cones = [];
  if (coneData && coneData.features) {
    for (const f of coneData.features) {
      const p = f.properties || {};
      const geom = f.geometry;
      if (!geom || !geom.coordinates) continue;
      const ring = geom.type === 'MultiPolygon' ? geom.coordinates[0][0]
        : (geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates);
      cones.push({ id: p.STORMID || p.ATCFID || '', name: (p.STORMNAME || '').toLowerCase(), ring });
    }
  }

  const systems = [];
  if (posData && posData.features) {
    const seen = new Set();
    for (const f of posData.features) {
      const p = f.properties || {};
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) continue;
      const name = p.STORMNAME || p.NAME || 'Unknown';
      const id = p.STORMID || p.ATCFID || '';
      const key = name + '_' + id;
      if (seen.has(key)) continue;
      seen.add(key);
      const windKt = p.MAXWIND || p.INTENSITY || null;
      const maxWind = windKt ? Math.round(windKt * 1.15078) : null;
      const type = p.STORMTYPE || (maxWind >= 74 ? 'Hurricane' : maxWind >= 39 ? 'Tropical Storm' : 'Tropical Depression');
      const cone = cones.find(c => (id && c.id === id) || (c.name && c.name === name.toLowerCase()));
      systems.push({ id, name, type, maxWind, lat: coords[1], lon: coords[0], cone: cone ? cone.ring : null });
    }
  }
  // ── GDACS merge (same matching rules as the client: normalized name, then a
  // tight <150 mi proximity fallback so twin storms can't cross-match) ──
  try {
    for (const gd of _parseGdacsMin(gdacsData)) {
      let match = systems.find(s => _normName(s.name) === _normName(gd.name));
      if (!match) match = systems.find(s => s.lat != null && haversine(s.lat, s.lon, gd.lat, gd.lon) < 150);
      if (match) {
        // NHC/known storm: GDACS only FILLS GAPS (a cone where NHC has none) —
        // it never overrides NHC data, and no duplicate alert entry is created.
        if (!match.cone && gd.cone && gd.cone.length >= 3) match.cone = gd.cone;
        if (!match.maxWind && gd.maxWind) match.maxWind = gd.maxWind;
      } else {
        // Storm outside NHC coverage (typhoon / SH cyclone): now push-eligible
        // with the exact same evalTropical semantics as NHC storms.
        const type = gd.maxWind >= 74 ? 'Hurricane' : gd.maxWind >= 39 ? 'Tropical Storm' : 'Tropical Depression';
        systems.push({ id: 'GDACS_' + gd.eventid, name: gd.name, type, maxWind: gd.maxWind, lat: gd.lat, lon: gd.lon, cone: gd.cone });
      }
    }
  } catch (e) { console.log('[tropical] GDACS merge skipped:', e && e.message); }
  return systems;
}

// For one location, return the tropical systems within radius or inside the cone.
// Each item: { ck, urgency, msg } — ck encodes the state so a track->cone
// escalation re-notifies even within the dedupe window.
function evalTropical(systems, lat, lon, radius) {
  const out = [];
  for (const s of systems) {
    if (s.lat == null || s.lon == null) continue;
    const dist = haversine(lat, lon, s.lat, s.lon);
    const inCone = s.cone && s.cone.length >= 3 ? pointInRing(lon, lat, s.cone) : false;
    const near = dist <= radius;
    if (!inCone && !near) continue;
    const cat = saffir(s.maxWind);
    const dir = degToDir(bearingDeg(lat, lon, s.lat, s.lon));
    const reason = inCone ? 'you are inside the forecast cone' : `${Math.round(dist)} mi to the ${dir}`;
    out.push({
      ck: `${s.id || s.name}_${inCone ? 'cone' : 'near'}`,
      urgency: inCone ? 'high' : 'normal',
      msg: `🌀 ${s.type} ${s.name} (${cat}) — ${reason}`,
    });
  }
  return out;
}

export { fetchTropical, evalTropical };
