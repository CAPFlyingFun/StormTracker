// StormTracker server-side Rain Clock — a framework-free port of the in-app
// rain-timeline projection (docs/js/weather.js _rainClockProject /
// renderRainClock) so the background scanner can NARRATE the rain timeline in a
// push ("rain overhead ending in a few minutes; strong storm inbound with heavy
// rain starting around 1948 lasting until 2030 with ⚡️") instead of the old,
// confusing storm-count line ("138 storms approaching, ETA 1902").
//
// PARITY: the math mirrors the app dial exactly — same cell radius, same
// pass-duration model (cell DIAMETER / storm speed), same per-minute dBZ paint,
// same contiguous-window builder, same overhead-now merge. The app and scanner
// don't share modules, so porting the math is the parity mechanism.
//
// DIFFERENCE vs the app dial: the scanner is fed only the cells the user opted
// into (gated by their storm-alert thresholds + intensity bands) plus rain
// overhead when their rain-overhead toggle is on — so the push respects each
// user's alert settings instead of narrating every drizzle the dial would draw.
// The forecast-fallback path (Open-Meteo hourly) is intentionally NOT ported:
// the scanner doesn't fetch hourly precip and a push should never invent
// forecast rain when radar shows nothing.

// v6.56: shared constants come from the ONE source of truth the client also
// loads (radar-shared.js) — no more per-side drifted copies.
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { STORM_MIN_DBZ, MOTION_MIN_MPH } = _require('../docs/js/radar-shared.js');

// 3-hour default horizon + dynamic span buckets — verbatim from the app so a
// cell lands at the same dial minute. The rain FLOOR is no longer a local
// constant: buildRainClock takes the user's rainFloor (from the subscription)
// and falls back to the shared STORM_MIN_DBZ (25). The old hardcoded 15 sat in
// noise/clutter territory and could claim "rain now" on a dry morning.
const RC_TOTAL_MIN = 180;
const RC_SPAN_BUCKETS = [60, 120, 180, 240, 360, 480, 720];

// Intensity-scaled cell radius (mi): clamp((dbz-20)/15, 0.2, 3). Mirrors the
// Storms-tab cone base width with a 0.2 mi floor.
function rcCellRadiusMi(dbz) { return Math.max(0.2, Math.min(3, (dbz - 20) / 15)); }

// Plain-language intensity word for the RAIN (matches the app dial wording).
function rcIntensityWord(dbz) {
  if (dbz < 30) return 'Light';
  if (dbz < 40) return 'Moderate';
  if (dbz < 50) return 'Heavy';
  return 'Intense';
}

// Strength word for the STORM noun, aligned to the scanner intensity BANDS
// (light 20-29 / moderate 30-44 / heavy 45-54 / severe 55+).
function stormStrengthWord(dbz) {
  if (dbz >= 55) return 'Severe storm';
  if (dbz >= 45) return 'Strong storm';
  if (dbz >= 35) return 'Storm';
  return 'Showers';
}

// Coarse band token for the change-signature / dedupe keys (matches BAND_DEFS).
function rcBand(dbz) {
  if (dbz >= 55) return 'sev';
  if (dbz >= 45) return 'hvy';
  if (dbz >= 30) return 'mod';
  if (dbz >= 20) return 'lgt';
  return 'none';
}

// Smallest "nice" span (1h–12h) that still contains the furthest inbound ETA,
// so every inbound cell is placed at its real arrival minute (no edge pinning).
function rcPickSpan(maxEtaMin) {
  if (!(maxEtaMin > 0)) return RC_TOTAL_MIN;
  for (const b of RC_SPAN_BUCKETS) if (maxEtaMin <= b) return b;
  return 720;
}

// Wall-clock for an offset (minutes from now) in the subscriber's time zone.
// h24=true -> "19:48"; else "07:48 PM". Empty when tz is unknown.
function fmtClock(offMin, tz, h24, nowMs) {
  if (offMin == null || !tz) return '';
  try {
    const d = new Date(nowMs + offMin * 60000);
    if (h24) {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      const hh = (p.find(x => x.type === 'hour') || {}).value || '';
      const mm = (p.find(x => x.type === 'minute') || {}).value || '';
      return hh && mm ? `${hh}:${mm}` : '';
    }
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
  } catch (e) { return ''; }
}

// Relative phrase used when the subscriber's tz is unknown (no wall clock).
function relPhrase(m) {
  if (m < 1) return 'now';
  if (m < 60) return `in about ${Math.round(m)} min`;
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return `in about ${h}h${mm ? ` ${mm}m` : ''}`;
}

// ---------------------------------------------------------------------------
// buildRainClock — radar-only projection of the next few hours of rain over the
// user, from the gated inbound cells + (optional) rain overhead now.
//
// cells: [{ dbz, etaMin, distance, bearing, closingSpeed? }]  (already gated)
// mv:    { speed, direction } steering vector (mph / deg-from)
// overheadDbz: rounded dBZ on the user's exact spot, or null when not raining /
//              the user's rain-overhead toggle is off.
// Returns: { ready, windows:[{startMin,endMin,peakDbz,lightning}], rainingNow,
//            nowDbz, peakDbz, anySevere, span, motionUnknown }
// ---------------------------------------------------------------------------
export function buildRainClock({ cells = [], mv = null, overheadDbz = null, nowMs = Date.now(), radarAgeMin = 0, rainFloor = null } = {}) {
  const out = {
    ready: false, windows: [], rainingNow: false, nowDbz: 0,
    peakDbz: 0, anySevere: false, span: RC_TOTAL_MIN, motionUnknown: true,
  };

  // v6.56: the floor for the "rain now" claim AND window continuity is the
  // user's rain-floor setting (5-40), defaulting to the shared app floor (25).
  const FLOOR = (typeof rainFloor === 'number' && rainFloor >= 5 && rainFloor <= 40) ? rainFloor : STORM_MIN_DBZ;

  let vx = 0, vy = 0, haveMv = false;
  // v6.56: below MOTION_MIN_MPH (2, shared) motion is UNCERTAIN — the old >1
  // gate accepted 1-2 mph vectors whose diameter/speed pass-time stretched a
  // weak echo into an hour-long "rain now, ends HH:MM" window.
  if (mv && mv.speed >= MOTION_MIN_MPH && mv.direction != null) {
    const th = mv.direction * Math.PI / 180;
    vx = mv.speed * Math.sin(th);
    vy = mv.speed * Math.cos(th);
    haveMv = true;
  }
  const vMag = Math.sqrt(vx * vx + vy * vy);
  out.motionUnknown = !haveMv;

  // Dynamic span from the furthest inbound ETA (pre-pass), then size the paint.
  let maxEta = 0;
  for (const c of cells) { if (c.etaMin == null) continue; if (c.etaMin > maxEta) maxEta = c.etaMin; }
  const span = rcPickSpan(maxEta);
  out.span = span;
  const minutes = new Array(span + 1).fill(0);

  // Per-cell paint: arrival minute = ETA (minus radar age), duration over the
  // user = cell DIAMETER / storm speed centered on arrival.
  const cellMeta = [];
  for (const c of cells) {
    if (c.etaMin == null) continue;
    let centerMin = c.etaMin - radarAgeMin;
    if (centerMin < 0) centerMin = 0;
    if (centerMin > span) centerMin = span;
    const baseR = rcCellRadiusMi(c.dbz);
    const spd = vMag > 0.1 ? vMag : ((c.closingSpeed && c.closingSpeed >= MOTION_MIN_MPH) ? c.closingSpeed : 0);   // v6.56: sub-2 mph closing = uncertain -> 6-min fallback
    const passMin = spd > 0.1 ? Math.max(2, (2 * baseR) / spd * 60) : 6;
    let tIn, tOut;
    if (centerMin <= 0) { tIn = 0; tOut = Math.min(span, Math.max(1, Math.ceil(passMin))); }
    else { tIn = Math.max(0, Math.floor(centerMin - passMin / 2)); tOut = Math.min(span, Math.ceil(centerMin + passMin / 2)); }
    if (tOut < tIn) tOut = tIn;
    for (let t = tIn; t <= tOut; t++) if (c.dbz > minutes[t]) minutes[t] = c.dbz;
    cellMeta.push({ dbz: c.dbz, centerMin });
  }

  // Rain right over the user now anchors a cell + window at minute 0.
  const nowDbz = (overheadDbz != null && overheadDbz >= FLOOR) ? Math.round(overheadDbz) : 0;
  out.rainingNow = nowDbz > 0;
  out.nowDbz = nowDbz;
  if (nowDbz > 0) {
    const baseR = rcCellRadiusMi(nowDbz);
    const spd = vMag > 0.1 ? vMag : 0;
    const passMin = spd > 0.1 ? Math.max(2, (2 * baseR) / spd * 60) : 6;
    const tOut = Math.min(span, Math.max(1, Math.ceil(passMin)));
    for (let t = 0; t <= tOut; t++) if (nowDbz > minutes[t]) minutes[t] = nowDbz;
  }

  // Contiguous windows of minutes at/above the radar-noise floor.
  const windows = [];
  let cur = null;
  for (let t = 0; t <= span; t++) {
    const v = minutes[t];
    if (v >= FLOOR) { if (!cur) cur = { startMin: t, endMin: t, peakDbz: v }; else { cur.endMin = t; if (v > cur.peakDbz) cur.peakDbz = v; } }
    else if (cur) { windows.push(cur); cur = null; }
  }
  if (cur) windows.push(cur);

  // Merge any overlapping windows so one continuous rain period stays a single
  // window with the correct end time.
  if (windows.length > 1) {
    windows.sort((a, b) => a.startMin - b.startMin);
    const merged = [windows[0]];
    for (let i = 1; i < windows.length; i++) {
      const w = windows[i], last = merged[merged.length - 1];
      if (w.startMin <= last.endMin) { if (w.endMin > last.endMin) last.endMin = w.endMin; if (w.peakDbz > last.peakDbz) last.peakDbz = w.peakDbz; }
      else merged.push(w);
    }
    windows.length = 0; windows.push(...merged);
  }
  windows.sort((a, b) => a.startMin - b.startMin);

  // Lightning flag per window: estimated from reflectivity (>=45 dBZ) — the same
  // bar the scanner's lightning advisory uses.
  for (const w of windows) w.lightning = w.peakDbz >= 45;

  let peak = nowDbz;
  for (const w of windows) if (w.peakDbz > peak) peak = w.peakDbz;
  out.peakDbz = peak;
  out.anySevere = peak >= 55;
  out.windows = windows;
  out.ready = windows.length > 0;
  return out;
}

// Push wording from a projection. Returns { display, body } or null when there
// is nothing to narrate. `display` is the compact one-liner used in a
// multi-alert digest; `body` is the friendly 1–3 sentence narrative.
export function formatRainClockPush(data, { tz, h24, nowMs = Date.now() } = {}) {
  if (!data || !data.ready || !data.windows.length) return null;
  const W = data.windows;
  const nowWin = W.find(w => w.startMin === 0);
  const future = W.filter(w => w.startMin > 0);
  const next = future[0];
  const next2 = future[1];
  if (!nowWin && !next) return null;

  // "around 1948" when the tz gives a wall clock, else "in about 48 min".
  const startAt = (m) => { const c = fmtClock(m, tz, h24, nowMs); return c ? `around ${c}` : relPhrase(m); };
  // Prefer the exact wall clock ("around 2030") whenever the subscriber's tz is
  // known — users asked for a real ETA, not a vague "soon". Only fall back to
  // "in a few minutes" / a relative phrase when there's no clock to show.
  const endAt = (m) => { const c = fmtClock(m, tz, h24, nowMs); if (c) return `around ${c}`; return m <= 8 ? 'in a few minutes' : relPhrase(m); };
  // "until 2030" with a wall clock, else a plain duration ("about 22 min").
  const untilAt = (start, end) => { const c = fmtClock(end, tz, h24, nowMs); return c ? `until ${c}` : `about ${Math.max(1, Math.round(end - start))} min`; };
  // Compact token for the short digest line.
  const shortClk = (m) => fmtClock(m, tz, h24, nowMs) || relPhrase(m);

  const sentences = [];
  const short = [];

  if (nowWin) {
    const nowWord = rcIntensityWord(data.nowDbz || nowWin.peakDbz);
    const peakWord = rcIntensityWord(nowWin.peakDbz);
    const rangeWord = nowWord !== peakWord ? `${nowWord} to ${peakWord}` : nowWord;
    sentences.push(`${rangeWord} rain overhead, ending ${endAt(nowWin.endMin)}.`);
    // Compact digest token. The old "rain now → soon" read like "rain now, THEN
    // soon" (a second, future event) — confusing, and vague. Show the real end
    // time instead: "rain now, ends 20:31" (or "~4 min left" when tz unknown).
    const endClk = fmtClock(nowWin.endMin, tz, h24, nowMs);
    short.push(`rain now, ${endClk ? 'ends ' + endClk : (nowWin.endMin <= 1 ? 'ending' : '~' + Math.max(1, Math.round(nowWin.endMin)) + ' min left')}`);
  }

  if (next) {
    const strength = stormStrengthWord(next.peakDbz);
    const rainWord = rcIntensityWord(next.peakDbz).toLowerCase();
    const ltg = next.lightning ? ' with ⚡️' : '';
    sentences.push(`${strength} inbound with ${rainWord} rain starting ${startAt(next.startMin)}, lasting ${untilAt(next.startMin, next.endMin)}${ltg}.`);
    short.push(`${rainWord} rain ${shortClk(next.startMin)}–${shortClk(next.endMin)}${next.lightning ? ' ⚡' : ''}`);
  }

  if (next2) sentences.push(`Then more rain ${startAt(next2.startMin)}.`);

  return { display: '🌧️ ' + short.join('; '), body: sentences.join(' ') };
}

// Coarse change-signature: a push re-fires (in changes-only mode) only when the
// rain SITUATION meaningfully changes — rain starts/ends, a new inbound window
// appears, an intensity band steps, or lightning appears — NOT every 5-min tick
// just because the wall-clock times shifted by a minute. Start times are
// bucketed to 15 min so a steadily-approaching cell doesn't churn the signature.
export function rainClockSignature(data) {
  if (!data || !data.ready) return 'clear';
  const W = data.windows;
  const nowWin = W.find(w => w.startMin === 0);
  const future = W.filter(w => w.startMin > 0);
  const next = future[0], next2 = future[1];
  const b15 = (m) => Math.round(m / 15);
  return [
    'now:' + (nowWin ? rcBand(data.nowDbz || nowWin.peakDbz) : '0'),
    'nx:' + (next ? `${b15(next.startMin)}_${rcBand(next.peakDbz)}` : '0'),
    'nx2:' + (next2 ? rcBand(next2.peakDbz) : '0'),
    'ltg:' + (W.some(w => w.peakDbz >= 45) ? '1' : '0'),
  ].join('|');
}

// Dedupe keys for the per-item cooldown. Coarse on purpose (no per-cell keys —
// radar flicker would churn them): one key for "rain now" and one for the next
// inbound window bucketed by start (15 min) + band.
export function rainClockKeys(data) {
  if (!data || !data.ready) return ['rc'];
  const W = data.windows;
  const nowWin = W.find(w => w.startMin === 0);
  const next = W.filter(w => w.startMin > 0)[0];
  const b15 = (m) => Math.round(m / 15);
  const keys = [];
  if (nowWin) keys.push('rc_now_' + rcBand(data.nowDbz || nowWin.peakDbz));
  if (next) keys.push('rc_next_' + b15(next.startMin) + '_' + rcBand(next.peakDbz));
  return keys.length ? keys : ['rc'];
}
