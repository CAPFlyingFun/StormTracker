// scanner/alerts.js — server-side parity for StormTracker's non-storm alerts so
// the background scanner can push EVERYTHING the app would alert on, not just
// inbound storm cells. Two keyless data sources (work inside GitHub Actions):
//   * Open-Meteo  -> current conditions for the weather threshold alerts
//                    (mirrors docs/js/thresholds.js _WX_ALERT_DEFS)
//   * api.weather.gov -> active NWS warnings at a point (US only)
//
// The weather threshold comparisons are ported verbatim from the in-app defs so
// background pushes match exactly what the app shows. The user's threshold
// VALUES + unit prefs travel in the subscription, so we convert metric
// Open-Meteo data into the user's units before comparing, identical to the app.

const UA = { 'User-Agent': 'StormTracker/1.0 (push scanner; +https://capflyingfun.github.io/StormTracker/)' };

// ---- unit conversions (ported from docs/js/core.js) ----
const WIND_UNITS = ['mph', 'kts', 'km/h', 'm/s'];
const TEMP_UNITS = ['°F', '°C'];
function kmhTo(kmh, unit) {
  if (unit === 0) return +(kmh / 1.609).toFixed(1);
  if (unit === 1) return +(kmh / 1.852).toFixed(1);
  if (unit === 2) return +kmh.toFixed(1);
  return +(kmh / 3.6).toFixed(1);
}
function cToF(c) { return +(c * 9 / 5 + 32).toFixed(1); }

// ---- weather threshold defs (mirror docs/js/thresholds.js _WX_ALERT_DEFS) ----
// f(conditions, userThreshold, unitPrefs) -> { msg } when breached, else null.
const WX_DEFS = [
  { key: 'windMax', label: 'Wind Speed', icon: '💨', f: (d, th, u) => {
    const k = d.wind_speed_10m; if (k == null) return null;
    const v = kmhTo(k, u.wind); const un = WIND_UNITS[u.wind];
    return v >= th ? { msg: `💨 Wind speed at ${v} ${un} — above your ${th} ${un} threshold` } : null; } },
  { key: 'gustMax', label: 'Wind Gusts', icon: '🌬️', f: (d, th, u) => {
    const k = d.wind_gusts_10m; if (k == null) return null;
    const v = kmhTo(k, u.wind); const un = WIND_UNITS[u.wind];
    return v >= th ? { msg: `🌬️ Wind gusts at ${v} ${un} — above your ${th} ${un} threshold` } : null; } },
  { key: 'tempHigh', label: 'Temp High', icon: '🌡️', f: (d, th, u) => {
    const tc = d.temperature_2m; if (tc == null) return null;
    const v = u.temp === 0 ? cToF(tc) : +tc.toFixed(1); const un = TEMP_UNITS[u.temp];
    return v >= th ? { msg: `🌡️ Temperature reached ${v}${un} — above your ${th}${un} high threshold` } : null; } },
  { key: 'tempLow', label: 'Temp Low', icon: '🌡️', f: (d, th, u) => {
    const tc = d.temperature_2m; if (tc == null) return null;
    const v = u.temp === 0 ? cToF(tc) : +tc.toFixed(1); const un = TEMP_UNITS[u.temp];
    return v <= th ? { msg: `🌡️ Temperature dropped to ${v}${un} — below your ${th}${un} low threshold` } : null; } },
  { key: 'pressureDrop', label: 'Pressure Drop (3hr)', icon: '📉', f: (d, th, u) => {
    const drop = d._baroTrendMb != null ? -d._baroTrendMb : null;
    if (drop == null || drop <= 0) return null;
    const v = u.pres === 0 ? +(drop * 0.02953).toFixed(2) : +drop.toFixed(1);
    const un = u.pres === 0 ? 'inHg' : 'mb';
    return v >= th ? { msg: `📉 Falling pressure — dropped ${v} ${un} over the last 3 hours (threshold ${th} ${un})` } : null; } },
  { key: 'rainMax', label: 'Rainfall Rate', icon: '🌧️', f: (d, th, u) => {
    const mmh = d.precipitation; if (mmh == null || mmh <= 0) return null;
    let v, un;
    if (u.precip === 0) { v = +(mmh / 25.4).toFixed(2); un = 'in/hr'; }
    else if (u.precip === 2) { v = +(mmh / 10).toFixed(2); un = 'cm/hr'; }
    else { v = +mmh.toFixed(1); un = 'mm/hr'; }
    return v >= th ? { msg: `🌧️ Rainfall rate at ${v} ${un} — above your ${th} ${un} threshold` } : null; } },
  { key: 'humidHigh', label: 'Humidity High', icon: '💧', f: (d, th) => {
    const v = d.relative_humidity_2m; if (v == null) return null;
    return v >= th ? { msg: `💧 Humidity at ${v}% — above your ${th}% high threshold` } : null; } },
  { key: 'humidLow', label: 'Humidity Low', icon: '💧', f: (d, th) => {
    const v = d.relative_humidity_2m; if (v == null) return null;
    return v <= th ? { msg: `💧 Humidity at ${v}% — below your ${th}% low threshold` } : null; } },
  { key: 'visMin', label: 'Visibility Low', icon: '👁️', f: (d, th, u) => {
    const vm = d._visM; if (vm == null) return null;
    let v, un;
    if (u.vis === 0) { v = +(vm / 1609.34).toFixed(1); un = 'mi'; }
    else { v = +(vm / 1000).toFixed(1); un = 'km'; }
    return v <= th ? { msg: `👁️ Visibility dropped to ${v} ${un} — below your ${th} ${un} threshold` } : null; } },
  // NOTE: the in-app `uvMax` alert reads S._uvIndex, which the app never assigns,
  // so it is currently inert and never fires. To keep background pushes at exact
  // parity with the app we intentionally do NOT evaluate UV here.
];

// Great-circle distance in miles (units irrelevant — only used to pick the
// nearest METAR station).
import { haversine, dedupeNwsAlerts } from './detect.js';   // v6.57 (QW6): was a local duplicate of the shared implementation (radar-shared.js)

// Nearest NWS station latest observation (US only; null elsewhere or on error).
// Mirrors fetchNWSCurrent() in docs/js/weather.js. NWS returns SI units already
// (windSpeed/windGust in km/h, temperature in °C, visibility in meters), so the
// fields drop straight into the blend.
async function fetchNwsStation(lat, lon) {
  const pt = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: UA, signal: AbortSignal.timeout(7000) });
  if (!pt.ok) return null;
  const pj = await pt.json();
  const stUrl = pj.properties && pj.properties.observationStations;
  if (!stUrl) return null;
  const st = await fetch(stUrl, { headers: UA, signal: AbortSignal.timeout(7000) });
  if (!st.ok) return null;
  const sj = await st.json();
  const nearest = sj.features && sj.features[0];
  const icao = nearest && nearest.properties && nearest.properties.stationIdentifier;
  if (!icao) return null;
  const ob = await fetch(`https://api.weather.gov/stations/${icao}/observations/latest`, { headers: UA, signal: AbortSignal.timeout(7000) });
  if (!ob.ok) return null;
  const oj = await ob.json();
  const p = oj.properties || {};
  if (!p.temperature || p.temperature.value == null) return null;
  return {
    temp: p.temperature.value,
    dewp: p.dewpoint ? p.dewpoint.value : null,
    windKmh: p.windSpeed ? p.windSpeed.value : null,
    gustKmh: p.windGust ? p.windGust.value : null,
    visMeter: p.visibility ? p.visibility.value : null,
  };
}

// Nearest AWC METAR (keyless, global). Mirrors _fetchAWCOnce()/fetchAWCNearest()
// in docs/js/weather.js — knots → km/h, statute miles → meters.
async function fetchAwcNearest(lat, lon) {
  let data = [];
  for (const deg of [1.0, 2.0, 3.5]) {
    try {
      const url = `https://aviationweather.gov/api/data/metar?ids=&format=json&taf=false&hours=3&bbox=${(lat - deg).toFixed(2)},${(lon - deg).toFixed(2)},${(lat + deg).toFixed(2)},${(lon + deg).toFixed(2)}`;
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      data = await r.json();
      if (Array.isArray(data) && data.length) break;
    } catch (e) { /* try next bbox */ }
  }
  if (!Array.isArray(data) || !data.length) return null;
  let nearest = null, bd = Infinity;
  for (const m of data) {
    if (m.lat == null || m.lon == null) continue;
    const d = haversine(lat, lon, m.lat, m.lon);
    if (d < bd) { bd = d; nearest = m; }
  }
  if (!nearest) return null;
  const visMeter = nearest.visib != null
    ? (String(nearest.visib).includes('+') ? 16093 : (Number(nearest.visib) > 100 ? Number(nearest.visib) : Number(nearest.visib) * 1609.34))
    : null;
  return {
    temp: nearest.temp,
    dewp: nearest.dewp != null ? nearest.dewp : null,
    windKmh: nearest.wspd != null ? nearest.wspd * 1.852 : null,
    gustKmh: nearest.wgst != null ? nearest.wgst * 1.852 : null,
    visMeter,
  };
}

// Fetch current conditions + 3hr pressure trend + visibility from Open-Meteo,
// then blend nearby station obs (NWS + AWC METAR) on top — exactly like the app.
// Returns the field names the WX_DEFS expect, in metric units (km/h, °C, mm, %,
// meters, mb) — the same source/units the app's threshold checks consume.
async function fetchConditions(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_gusts_10m,uv_index`
    + `&hourly=pressure_msl,visibility&past_hours=4&forecast_hours=1`
    + `&wind_speed_unit=kmh&temperature_unit=celsius&precipitation_unit=mm&timezone=UTC`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`open-meteo HTTP ${r.status}`);
  const j = await r.json();
  const c = j.current || {};
  const h = j.hourly || {};
  const out = {
    temperature_2m: c.temperature_2m,
    relative_humidity_2m: c.relative_humidity_2m,
    precipitation: c.precipitation,
    wind_speed_10m: c.wind_speed_10m,
    wind_gusts_10m: c.wind_gusts_10m,
    uv_index: c.uv_index,
    _visM: null,
    _baroTrendMb: null,
  };
  // 3hr pressure trend: latest non-null minus the value 3 hours earlier.
  const pres = h.pressure_msl || [];
  let nowIdx = -1;
  for (let i = pres.length - 1; i >= 0; i--) { if (pres[i] != null) { nowIdx = i; break; } }
  if (nowIdx >= 3 && pres[nowIdx - 3] != null) {
    out._baroTrendMb = +(pres[nowIdx] - pres[nowIdx - 3]).toFixed(2);
  }

  // Blend nearby station obs (NWS + AWC METAR) on top of the Open-Meteo model,
  // mirroring blendSources() in docs/js/weather.js. The app overwrites
  // temp/wind/gust/visibility with this blend AND recomputes humidity from the
  // station dewpoint BEFORE its threshold checks run, so a model-only scanner
  // diverges from what the app shows (most importantly it under-reports gusts —
  // real station gusts run higher than the model — and silently misses wind-gust
  // alerts). We blend the same fields the same way:
  //   - temp / wind = avg of present sources;  gust = max(avg gusts, avg winds)
  //   - humidity    = recomputed from station dewpoint (Magnus) when present,
  //                   otherwise the Open-Meteo model value
  //   - visibility  = station only (matches the app's S._nwsVisM — no station
  //                   means no visibility alert, exactly like the app)
  // Pressure-trend and rain stay Open-Meteo (the app sources those the same way).
  // Best-effort: any station failure falls back to model-only.
  try {
    const [nws, awc] = await Promise.all([
      fetchNwsStation(lat, lon).catch(() => null),
      fetchAwcNearest(lat, lon).catch(() => null),
    ]);
    const srcs = [{ temp: out.temperature_2m, dewp: null, windKmh: out.wind_speed_10m, gustKmh: out.wind_gusts_10m, visMeter: null }];
    if (nws) srcs.push(nws);
    if (awc) srcs.push(awc);
    if (srcs.length > 1) {
      const avg = f => { const v = srcs.map(s => s[f]).filter(x => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      const first = f => { for (const s of srcs) if (s[f] != null) return s[f]; return null; };
      const tA = avg('temp'); if (tA != null) out.temperature_2m = tA;
      const wA = avg('windKmh'); if (wA != null) out.wind_speed_10m = wA;
      const gA = avg('gustKmh'); const g = Math.max(gA || 0, wA || 0) || null; if (g != null) out.wind_gusts_10m = g;
      out._visM = first('visMeter'); // station-only, mirrors S._nwsVisM
      const dew = first('dewp');
      if (dew != null) {
        const tFor = out.temperature_2m != null ? out.temperature_2m : dew;
        const rh = Math.round(100 * Math.exp((17.27 * dew) / (237.7 + dew)) / Math.exp((17.27 * tFor) / (237.7 + tFor)));
        out.relative_humidity_2m = Math.min(100, Math.max(0, rh));
      }
      const lbl = [nws && 'NWS', awc && 'AWC'].filter(Boolean).join('+');
      if (lbl) console.log(`  conditions blended w/ ${lbl}: gust ${out.wind_gusts_10m != null ? out.wind_gusts_10m.toFixed(0) : '--'} km/h, wind ${out.wind_speed_10m != null ? out.wind_speed_10m.toFixed(0) : '--'} km/h, RH ${out.relative_humidity_2m != null ? out.relative_humidity_2m + '%' : '--'}`);
    }
  } catch (e) { /* station blend best-effort */ }

  return out;
}

// Evaluate a subscriber's enabled weather thresholds against conditions.
function evalWx(conditions, wxCfg, units) {
  const u = {
    temp: units.temp || 0, wind: units.wind || 0, pres: units.pres || 0,
    vis: units.vis || 0, precip: units.precip || 0,
  };
  const out = [];
  for (const def of WX_DEFS) {
    const cfg = wxCfg[def.key];
    if (!cfg || !cfg.on || cfg.val == null) continue;
    const res = def.f(conditions, cfg.val, u);
    if (res) out.push({ key: def.key, label: def.label, icon: def.icon, msg: res.msg });
  }
  return out;
}

// Active NWS alerts at a point (US only; returns [] elsewhere or on error upstream).
async function fetchNws(lat, lon) {
  const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`nws HTTP ${r.status}`);
  const j = await r.json();
  const mapped = (j.features || []).map(f => {
    const p = f.properties || {};
    return {
      id: p.id || f.id,
      event: p.event || 'Weather Alert',
      severity: (p.severity || '').toLowerCase(),
      headline: p.headline || '',
      area: p.areaDesc || '',
      onset: p.onset || p.effective || null,
      ends: p.ends || p.expires || null,
    };
  }).filter(a => a.id);
  // Collapse same-event products to one (shared with the app — radar-shared.js)
  // so a pair of consecutive-day warnings is ONE digest line, not two.
  return dedupeNwsAlerts(mapped);
}

// Format an NWS ISO timestamp into a short human local time. When the
// subscriber's IANA zone (`tz`) is known we render in THEIR zone and honor their
// 12h/24h preference (`h24` -> "20:00" vs "8:00 PM"); otherwise we fall back to
// the alert area's own UTC offset (carried in the ISO string). The weekday is
// shown only when the time isn't today in the rendering zone, so a same-day
// window stays compact ("until 8:00 PM") and a later one is unambiguous
// ("until Fri 6:00 PM").
function fmtAlertTime(iso, tz, h24) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let zone = tz || null;
  if (zone) { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch (e) { zone = null; } }
  if (zone) {
    const partsOf = dt => {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(h24 ? { hourCycle: 'h23' } : { hour12: true }) }).formatToParts(dt);
      const g = t => (p.find(x => x.type === t) || {}).value || '';
      return { wd: g('weekday'), md: g('month') + '/' + g('day'), hour: g('hour'), minute: g('minute'), ap: g('dayPeriod') };
    };
    const tp = partsOf(d), np = partsOf(new Date());
    const time = h24 ? `${tp.hour}:${tp.minute}` : `${tp.hour}:${tp.minute}${tp.ap ? ' ' + tp.ap : ''}`;
    return tp.md === np.md ? time : `${tp.wd} ${time}`;
  }
  // No usable subscriber zone: render in the alert area's own UTC offset.
  const m = String(iso).match(/([+-])(\d{2}):?(\d{2})$/);
  const offMin = m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0;
  const local = new Date(d.getTime() + offMin * 60000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let h = local.getUTCHours();
  const mn = local.getUTCMinutes();
  if (h24) return `${days[local.getUTCDay()]} ${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${days[local.getUTCDay()]} ${h}:${String(mn).padStart(2, '0')} ${ap}`;
}

// Human "in effect" window for an NWS alert, in the subscriber's zone + format.
// short=true -> "until Wed 8:00 PM" for compact digest lines; short=false -> a
// fuller phrase for a single alert.
function nwsWindow(a, short, tz, h24) {
  const end = fmtAlertTime(a && a.ends, tz, h24);
  const start = fmtAlertTime(a && a.onset, tz, h24);
  const future = a && a.onset && new Date(a.onset).getTime() > Date.now();
  if (short) return end ? `until ${end}` : '';
  if (future && start && end) return `Begins ${start} · until ${end}`;
  if (future && start) return `Begins ${start}`;
  if (end) return `In effect until ${end}`;
  return '';
}

function nwsIcon(event) {
  const e = (event || '').toLowerCase();
  if (e.includes('tornado')) return '🌪️';
  if (e.includes('hurricane')) return '🌀';
  if (e.includes('tropical storm')) return '🌀';
  if (e.includes('severe thunderstorm')) return '⛈️';
  if (e.includes('flood')) return '🌊';
  if (e.includes('fire') || e.includes('red flag')) return '🔥';
  if (e.includes('winter') || e.includes('snow') || e.includes('blizzard') || e.includes('ice')) return '❄️';
  if (e.includes('heat')) return '🥵';
  if (e.includes('wind')) return '💨';
  return '⚠️';
}

export { fetchConditions, evalWx, fetchNws, nwsIcon, nwsWindow };
