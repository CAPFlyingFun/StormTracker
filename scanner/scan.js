// StormTracker background scanner — runs on a GitHub Actions cron (~every 10
// min). Pulls subscribers from the Cloudflare Worker, then for each location
// runs a FULL "fresh open" scan and pushes every alert type the app would show,
// even with the app/browser closed:
//   * Inbound storm cells  (ported radar detection, detect.js)
//   * Weather thresholds   (Open-Meteo conditions vs the user's in-app alert
//                           settings — wind/gust/temp/pressure/rain/humidity/
//                           visibility, alerts.js)
//   * NWS active warnings  (api.weather.gov at the point; US only, alerts.js)
//   * Tropical systems     (NHC cone / proximity, ahead of any local NWS watch;
//                           tropical.js)
// Every active alert for a subscriber is merged into ONE digest notification
// that lists them all, rather than separate pushes per type. Each item is
// deduped independently in the per-subscriber `last_alert` map (namespaced keys
// sc_/wx_/nws_/trop_) so a sustained system doesn't re-notify every run; the
// digest sends whenever at least one item is fresh and shows the full picture.
//
// Required env (set as GitHub Actions secrets):
//   WORKER_URL          e.g. https://stormtracker-proxy.<acct>.workers.dev
//   SCANNER_SECRET      shared secret with the Worker
//   VAPID_PUBLIC_KEY    public VAPID key (also embedded in the PWA)
//   VAPID_PRIVATE_KEY   private VAPID key (secret)
//   VAPID_SUBJECT       optional, defaults to mailto:alerts@stormtracker

import webpush from 'web-push';
import {
  scanLocation, dbzAtPoint, haversine, bearingDeg, calcImpact, calcETA, crossTrackMi, degToDir, watchDirHint,
} from './detect.js';
import { fetchConditions, evalWx, fetchNws, nwsIcon, nwsWindow } from './alerts.js';
import { fetchTropical, evalTropical } from './tropical.js';
import { buildRainClock, formatRainClockPush, rainClockSignature, rainClockKeys } from './rainclock.js';
import { isClutterCells, ALERT_BAND_DEFS, BAND_CADENCE_OPTS, bandForDbz, XTRK_DIRECT_MI } from './detect.js';   // v6.56 clutter screen; v6.58 shared bands + X-TRK

const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');
const SCANNER_SECRET = process.env.SCANNER_SECRET || '';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:alerts@stormtracker.app';

const SITE_URL = 'https://capflyingfun.github.io/StormTracker/';

// Per-alert-type dedupe (re-notify) and prune (forget) windows, keyed by the
// prefix of each dedupe key. Storm cells move fast (short window); a standing
// NWS warning or weather condition shouldn't re-buzz for hours.
const COOLDOWN = { rc: 30 * 60 * 1000, sc: 30 * 60 * 1000, ltg: 30 * 60 * 1000, rov: 5 * 60 * 1000, driz: 15 * 60 * 1000, area: 2 * 60 * 60 * 1000, wx: 3 * 60 * 60 * 1000, nws: 12 * 60 * 60 * 1000, trop: 12 * 60 * 60 * 1000 };
const PRUNE = { rc: 2 * 60 * 60 * 1000, sc: 2 * 60 * 60 * 1000, ltg: 2 * 60 * 60 * 1000, rov: 2 * 60 * 60 * 1000, driz: 2 * 60 * 60 * 1000, area: 4 * 60 * 60 * 1000, wx: 12 * 60 * 60 * 1000, nws: 24 * 60 * 60 * 1000, trop: 24 * 60 * 60 * 1000 };
function keyKind(k) { const s = String(k); const base = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s; const p = base.split('_')[0]; return (p === 'rc' || p === 'wx' || p === 'nws' || p === 'trop' || p === 'ltg' || p === 'rov' || p === 'driz' || p === 'area') ? p : 'sc'; }

// Per-user "AI-written alerts" opt-in. Default OFF. When a user turns it on AND
// supplies their OWN OpenAI key, the Worker uses THAT key to rewrite the digest;
// the developer's key is never used. `tone` mirrors the in-app assistant's voice.
// Legacy/missing payloads stay deterministic.
function aiCfgOf(th) {
  const a = th && th.ai;
  if (a && typeof a === 'object' && a.on === true) {
    // The Worker strips the raw key from /subscriptions and exposes hasKey. AI
    // wording is only available for users who supplied their OWN OpenAI key.
    const hasKey = a.hasKey === true || (typeof a.key === 'string' && a.key.length > 0);
    return { on: true, tone: String(a.tone || 'professional'), hasKey };
  }
  return { on: false, hasKey: false };
}

// Ask the Worker to rewrite a digest's deterministic lines into one short, natural
// push body. The OpenAI call uses THAT user's own key, which lives ONLY in
// Cloudflare D1 — we pass the device `endpoint` so the Worker can look it up and
// decrypt it. Best-effort: any error / timeout / missing-key returns null and the
// caller keeps its own deterministic text.
async function aiDigestBody(lines, place, tone, endpoint) {
  if (!WORKER_URL || !endpoint || !Array.isArray(lines) || !lines.length) return null;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 11000);
    const r = await fetch(`${WORKER_URL}/ai-digest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scanner-secret': SCANNER_SECRET },
      body: JSON.stringify({ lines, place, tone, endpoint }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) { console.warn(`  ai-digest HTTP ${r.status}`); return null; }
    const d = await r.json();
    const text = (d && typeof d.text === 'string') ? d.text.trim() : '';
    return text || null;
  } catch (e) { console.warn('  ai-digest failed:', e.message); return null; }
}

// Per-user "changes-only" (edge-triggered) cadence opt-in. Default OFF — legacy
// behavior (re-notify on each item's own cooldown). When ON, routine alerts fire
// only when their signature CHANGES; life-safety alerts keep their cadence.
function changesCfgOf(th) {
  const c = th && th.changes;
  return { on: !!(c && typeof c === 'object' && c.on === true) };
}
// Life-safety = always allowed to re-buzz on its own cadence even in changes-only
// mode: active NWS warnings, lightning, a SEVERE storm core, and high-urgency
// tropical (in-cone / within radius). Everything else is "routine" and is gated
// by signature change.
function isLifeSafety(it) {
  return it.cat === 'nws-warn' || it.cat === 'ltg' || (it.cat === 'sc' && it.severe) || (it.cat === 'rc' && it.severe) || (it.cat === 'trop' && it.urgency === 'high');
}
// Stable identity of a routine alert for edge detection: category + coarse
// signature + sorted dedupe keys. A new threat, a moved/closer cell (new ck
// bucket), or an intensity change (sig carries the band) all yield a NEW token
// and thus a fresh notification; an unchanged situation yields the same token
// and is suppressed.
function routineToken(it) {
  return `${it.cat}|${it.sig || ''}|${(it.cks || []).slice().sort().join(',')}`;
}

// --- NWS / Tropical re-notify cadence ---------------------------------------
// Each NWS severity tier has its OWN re-notify cadence (minutes). Warnings and
// watches additionally TIGHTEN as the alert nears its expiry — the effective
// cooldown is min(base, remaining/2) with a 5-min floor — so the closer the
// deadline, the more often we re-buzz. advMin === 0 turns advisories off.
const NWS_DEF = { warnMin: 30, watchMin: 120, advMin: 360 };
const TROP_DEF_H = 6;
function nwsTierOf(ev) { const s = String(ev || ''); return /warning/i.test(s) ? 'warn' : /watch/i.test(s) ? 'watch' : 'adv'; }
// Normalize the subscription's NWS config. Backward compatible: a legacy boolean
// (or missing) `nws` means on-with-defaults; `false` means off.
function nwsCfgOf(th) {
  const n = th && th.nws;
  if (n === false) return { on: false };
  if (n && typeof n === 'object') return {
    on: n.on !== false,
    warnMin: num(n.warnMin, NWS_DEF.warnMin),
    watchMin: num(n.watchMin, NWS_DEF.watchMin),
    advMin: (n.advMin === 0 ? 0 : num(n.advMin, NWS_DEF.advMin)),
  };
  return { on: true, ...NWS_DEF };
}
// Normalize tropical config. Legacy: boolean, or {on,radius} without everyH.
function tropCfgOf(th) {
  const t = th && th.tropical;
  if (t === false) return { on: false };
  if (t && typeof t === 'object') return { on: t.on !== false, radius: num(t.radius, 0) || 200, everyH: num(t.everyH, TROP_DEF_H), muted: Array.isArray(t.muted) ? t.muted : [] };
  return { on: true, radius: 200, everyH: TROP_DEF_H };
}
// Awareness alert config: strong storms NEARBY but not heading at the user
// (parallel / passing / receding). Legacy/absent => ON, so it works for existing
// subscribers without a re-subscribe; `false` => off; `{on}` object respected.
function areaCfgOf(th) {
  const a = th && th.area;
  if (a === false) return { on: false };
  if (a && typeof a === 'object') return { on: a.on !== false };
  return { on: true };
}
// Effective NWS cooldown (ms) for one alert: base by tier, tightened near expiry
// for warnings/watches. Returns null when the tier is disabled (advisories off).
function nwsCooldownMs(tier, cfg, endsIso) {
  const base = tier === 'warn' ? cfg.warnMin : tier === 'watch' ? cfg.watchMin : cfg.advMin;
  if (!base) return null;
  let ms = base * 60000;
  if ((tier === 'warn' || tier === 'watch') && endsIso) {
    const rem = new Date(endsIso).getTime() - Date.now();
    if (rem > 0) ms = Math.max(5 * 60000, Math.min(ms, rem / 2));
  }
  return ms;
}

// Intensity bands — must match docs/js/thresholds.js _ALERT_BAND_DEFS exactly so
// the background scanner gates and re-notifies identically to the in-app alerts.
// Each band carries an on/off toggle (gates inbound storm pushes AND the
// rain-overhead push at that intensity) and a per-band cadence (minutes) that
// becomes the dedupe cooldown for items in that band. A master rovOn enables the
// "rain right over you" push. When a subscription predates this feature (no
// bands), default to ALL bands on + rovOn true so existing users keep getting
// pushes at their old behavior.
// v6.58: band table + bandForDbz come from radar-shared.js via detect.js — the
// hand-synced twin of the client's _ALERT_BAND_DEFS is gone.
const BAND_DEFS = ALERT_BAND_DEFS;
function bandLabel(key) { const b = BAND_DEFS.find(x => x.key === key); return b ? b.label : ''; }
// Normalize a subscription's bands config, falling back to defaults for any
// missing field so partial/legacy payloads behave like the in-app defaults.
function bandsFor(sub) {
  const raw = (sub.thresholds && sub.thresholds.bands) || null;
  const out = {
    rovOn: raw ? raw.rovOn !== false : true,
    rovMin: (raw && BAND_CADENCE_OPTS.includes(raw.rovMin)) ? raw.rovMin : 5,
    drizOn: raw ? raw.drizOn === true : false,
    drizMin: (raw && BAND_CADENCE_OPTS.includes(raw.drizMin)) ? raw.drizMin : 15,
  };
  for (const b of BAND_DEFS) {
    const c = (raw && raw[b.key]) || {};
    out[b.key] = {
      on: c.on !== undefined ? !!c.on : b.defOn,
      min: BAND_CADENCE_OPTS.includes(c.min) ? c.min : b.defMin,
    };
  }
  return out;
}

// Apple/iOS silently throttle a frequent web-push stream to a Home-Screen PWA
// and drop it, so a user's "every time" (0 min) would deliver NOTHING. Floor the
// re-notify gap for ROUTINE (non-severe) rain/storm pushes; severe rain, top-band
// storm cells, lightning and NWS warnings keep their own faster cadence.
const PUSH_FLOOR_MS = 10 * 60 * 1000;

// Per-ITEM floors above aren't enough: each item's cooldown phase-shifts, so on a
// busy day SOMETHING is due on nearly every 5-min scan and the coalesced digest
// still goes out ~12x/hr — which re-trips Apple's per-PWA delivery throttle (it
// returns 2xx but stops DELIVERING after the first handful). DIGEST_FLOOR_MS caps
// each location to one push per this window for ROUTINE alerts. True emergencies
// (NWS warnings, tropical, a severe storm core, lightning) bypass it — see the
// send gate. Apple's per-PWA budget is small and depletes as un-tapped pushes
// pile up, then it silently suppresses delivery; spending fewer pushes on routine
// weather keeps budget in reserve for the alerts that actually matter, so this
// floor is deliberately generous (45 min, not 15).
const DIGEST_FLOOR_MS = 45 * 60 * 1000;

// Storm-cell defaults mirror the app's intent: inbound + reasonably strong.
const DEF = { dbz: 40, impact: 50, dist: 60, radius: 80 };
// Lightning corridor is a FIXED 80 mi (the system max), independent of each
// user's personal storm-alert radius — a strong cell 70 mi out still warrants a
// heads-up even if the user only wants storm pushes inside 30 mi.
const LTG_RADIUS = 80;
// Awareness radius: the nearest strong cell within 15 mi is ALWAYS surfaced for
// safety, even if it isn't approaching — a close strike shouldn't be hidden just
// because it isn't heading straight at the user.
const LTG_NEAR = 15;
// Awareness ("nearby strong storms not heading at you") thresholds. A cell counts
// as STRONG at the Heavy band floor (>=45 dBZ, matching the lightning corridor).
// The alert covers strong cells inside the user's radius that are NOT inbound and
// beyond the 15 mi near-lightning ring, so it never double-fires with sc/ltg.
const AREA_DBZ = 45;
const AREA_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// Adaptive scan cadence: the Cloudflare cron ticks every 5 min, but the Worker
// only dispatches a scan when it's due. After each run we report the strongest
// weather tier seen (see reportCadence) and the Worker times the next scan —
// red 5 / yellow 10 / green 15 min — so calm weather scans a third as often
// while an active storm keeps the fast cadence. Every dispatched tick still runs
// a full scan here.

function fail(msg) { console.error('FATAL:', msg); process.exit(1); }

// A scan runs every ~5 min against several upstream APIs (the Worker, Open-Meteo,
// api.weather.gov, NHC). A single slow/unavailable cycle is EXPECTED and self-
// heals on the next run — it should NOT red-fail the job (that just emails noise).
// Only a genuinely-broken, persistent problem is worth a failure notification:
// missing/rotated secrets (config) or the Worker rejecting our secret (auth).
// Everything else — upstream 5xx, network errors, timeouts — is transient.
function isRealFailure(err) {
  const m = String((err && (err.message || err)) || '');
  return /\/subscriptions HTTP (401|403)/.test(m); // Worker auth rejected
}

// Adaptive-cadence report. After each scan we tell the Worker the strongest
// weather tier seen anywhere across all watched locations; the Worker uses it to
// pick when to run the NEXT scan (red=5, yellow=10, green=15 min) instead of a
// fixed 5-min cadence. Best-effort — a failed report just leaves the Worker on
// its previous cadence, so it never breaks the scan.
async function reportCadence(tier) {
  if (!WORKER_URL || !SCANNER_SECRET) return;
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${WORKER_URL}/scan-cadence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scanner-secret': SCANNER_SECRET },
      body: JSON.stringify({ tier }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const d = await r.json().catch(() => ({}));
    console.log(`Adaptive cadence: tier=${tier} → next scan in ${d.cadenceMin || '?'} min`);
  } catch (e) {
    console.warn(`cadence report failed: ${e && e.message}`);
  }
}

async function getSubscribers() {
  const r = await fetch(`${WORKER_URL}/subscriptions`, { headers: { 'x-scanner-secret': SCANNER_SECRET } });
  if (!r.ok) throw new Error(`/subscriptions HTTP ${r.status}`);
  const d = await r.json();
  return d.subscribers || [];
}

async function markAlert(endpoint, lastAlert) {
  try {
    const r = await fetch(`${WORKER_URL}/mark-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scanner-secret': SCANNER_SECRET },
      body: JSON.stringify({ endpoint, lastAlert }),
    });
    // A failed state write means dedupe drifts -> the same alert re-notifies
    // next run. Surface it loudly so it isn't silently lost.
    if (!r.ok) console.warn(`  mark-alert HTTP ${r.status} for ${endpoint.slice(-12)}`);
  } catch (e) { console.warn('mark-alert failed:', e.message); }
}

async function pruneDead(endpoint) {
  try {
    const r = await fetch(`${WORKER_URL}/mark-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scanner-secret': SCANNER_SECRET },
      body: JSON.stringify({ endpoint, delete: true }),
    });
    if (!r.ok) console.warn(`  prune HTTP ${r.status}`);
    else console.log('  pruned dead subscription');
  } catch (e) { console.warn('prune failed:', e.message); }
}

// Clear a one-shot "test notification" flag after we've delivered (or pruned) it,
// so it fires exactly once.
async function clearTest(endpoint) {
  try {
    const r = await fetch(`${WORKER_URL}/mark-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scanner-secret': SCANNER_SECRET },
      body: JSON.stringify({ endpoint, clearTest: true }),
    });
    if (!r.ok) console.warn(`  clearTest HTTP ${r.status}`);
  } catch (e) { console.warn('clearTest failed:', e.message); }
}

// Publish the per-CODE RSS snapshot. Independent of push: this fires every scan
// for every code (active OR all-clear) so the feed's live snapshot stays fresh
// and the worker can run its own change/30-min-briefing emit logic. Non-fatal.
async function feedUpdate(code, payload) {
  try {
    const r = await fetch(`${WORKER_URL}/feed-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-scanner-secret': SCANNER_SECRET },
      body: JSON.stringify({ code, ...payload }),
    });
    if (!r.ok) console.warn(`  feed-update HTTP ${r.status} for ${code}`);
  } catch (e) { console.warn('feed-update failed:', e.message); }
}

function thresholdsFor(sub) {
  const t = sub.thresholds || {};
  return {
    dbz: num(t.dbz, DEF.dbz),
    impact: num(t.impact, DEF.impact),
    // v6.57 (QW8): dist collapsed into radius. Current clients send them equal
    // (push.js); legacy D1 rows with a distinct smaller dist keep the stricter
    // of the two so nobody's alerts silently widen.
    dist: Math.min(num(t.dist, num(t.radius, DEF.radius)), Math.min(80, num(t.radius, DEF.radius))),
    radius: Math.min(80, num(t.radius, DEF.radius)),
    // v6.56: the user's rain-floor DISPLAY setting (st_rainFloorDbz) now rides
    // the subscription; the Rain Clock push honors it instead of a hardcoded 15.
    rainFloor: Math.max(5, Math.min(40, num(t.rainFloor, 25))),
  };
}

// Arrival wall-clock for a storm ETA, in the subscriber's own time zone.
// h24=true -> "0809" (military); otherwise "08:09 AM". Empty if tz unknown.
function fmtArrivalClock(etaMin, tz, h24) {
  if (etaMin == null || !tz) return '';
  try {
    const d = new Date(Date.now() + etaMin * 60000);
    if (h24) {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      const hh = (p.find(x => x.type === 'hour') || {}).value || '';
      const mm = (p.find(x => x.type === 'minute') || {}).value || '';
      return hh && mm ? `${hh}${mm}` : '';
    }
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true }).format(d);
  } catch (e) { return ''; }
}

function fmtStormBody(best, count, mv, tz, h24) {
  const distStr = best.distance.toFixed(1) + ' mi away';
  let etaStr = '';
  if (best.etaMin != null) {
    const clock = fmtArrivalClock(best.etaMin, tz, h24);
    // Show the concrete arrival clock time (e.g. "ETA 1058") to save characters;
    // fall back to "N min" only when a clock time can't be computed (no tz).
    etaStr = clock ? ` · ETA ${clock}` : ` · ETA ${best.etaMin} min`;
  }
  let moveStr = '';
  if (mv && mv.speed >= 2) moveStr = ` · moving ${degToDir(mv.direction)} ~${Math.round(mv.speed)} mph`;
  // Always highlight a SINGLE storm — the strongest + soonest inbound. With a lot
  // of cells (12+) keep the line short and point to the app instead of implying a
  // long list, so the phone doesn't truncate the notification.
  let lead, tail = '';
  if (count >= 12) { lead = `Strongest of ${count} storms inbound — `; tail = ' · more inbound, open for details'; }
  else if (count > 1) { lead = `${count} storms inbound — strongest `; }
  else { lead = 'Storm cell inbound — '; }
  // v5.99: every pushed cell is now a DIRECT hit (X-TRK ≤ 1.5 mi), so show that
  // instead of the old cone "% impact" number the app no longer uses.
  const directStr = (best.xtrkMi != null && isFinite(best.xtrkMi)) ? ` · 🎯 direct (X-TRK ${best.xtrkMi.toFixed(1)} mi)` : '';
  return `${lead}${best.dbz} dBZ · ${distStr}${directStr}${etaStr}${moveStr}${tail}`;
}

// Compact one-liner for the multi-alert DIGEST (a single-storm notification
// keeps the fuller fmtStormBody). Drops "% impact" and the "more inbound" tail,
// tightens units (2.8mi / 43mph), so a busy digest doesn't truncate on the lock
// screen and every alert line stays visible.
function fmtStormShort(best, count, mv, tz, h24) {
  const parts = [`${best.dbz} dBZ`, `${best.distance.toFixed(1)}mi`];
  if (best.etaMin != null) {
    const clock = fmtArrivalClock(best.etaMin, tz, h24);
    parts.push(clock ? `ETA ${clock}` : `ETA ${best.etaMin}min`);
  }
  if (mv && mv.speed >= 2) parts.push(`${degToDir(mv.direction)} ${Math.round(mv.speed)}mph`);
  const lead = count > 1 ? `${count} storms inbound` : 'Storm inbound';
  return `${lead} · ${parts.join(' · ')}`;
}

// Awareness summary for STRONG storms nearby that are NOT heading at the user
// (parallel / passing / receding). Leads with the nearest strong cell's direction
// + distance, the fleet movement, and a "stay aware" note. Caller guarantees valid
// steering (mv.speed >= 2) so "not heading your way" is grounded in real motion.
function fmtArea(area, mv, th, tz, h24) {
  const best = area.slice().sort((a, b) => a.distance - b.distance)[0];
  const peak = area.reduce((m, c) => Math.max(m, c.dbz), 0);
  const move = `moving ${degToDir(mv.direction)} ~${Math.round(mv.speed)} mph`;
  // v6.61: close with the watch direction — the reciprocal of the steering
  // heading — so "stay aware" tells the user WHERE to look. Shared wording
  // with the in-app Rain Clock / System Briefing via watchDirHint.
  const _wd = watchDirHint(mv);
  const watchStr = _wd ? ` Keep an eye to the ${_wd.from} — that's the side new development would arrive from.` : '';
  const body = `Strong storms ~${Math.round(best.distance)} mi to the ${dirLong(best.bearing)} (within your ${th.radius} mi range), ${move} — not heading your way, but stay aware. Peak ${peak} dBZ.${watchStr}`;
  const display = `🌩️ Strong storms ${degToDir(best.bearing)} @ ${Math.round(best.distance)}mi, moving ${degToDir(mv.direction)} @ ${Math.round(mv.speed)}mph — not inbound (${peak}dBZ)`;
  // Single aggregate dedupe key from the LEAD cell's sector (45°) + distance (15mi)
  // bucket: a standing line won't re-buzz, but activity that relocates to a new
  // sector/distance does. Per-cell keys were rejected — radar flicker churns them.
  const cks = [`area_${Math.round(best.bearing / 45) % 8}_${Math.round(best.distance / 15)}`];
  return { body, display, cks };
}

// Full compass words for the friendlier lightning advisory ("southwest" reads
// better than "SW" in a safety sentence).
const DIR_LONG = {
  N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast',
  E: 'east', ESE: 'east-southeast', SE: 'southeast', SSE: 'south-southeast',
  S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest',
  W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest',
};
function dirLong(deg) { const a = degToDir(deg); return DIR_LONG[a] || a; }

// Smart lightning advisory from radar-derived strong cells. Lightning is
// estimated (not observed) from reflectivity ≥45 dBZ — the app's "strong storm"
// tier. AWARENESS RULE: always surface the NEAREST strong cell within 15 mi,
// approaching or not, so a close strike is never hidden just because it isn't in
// the user's cone. If nothing is within 15 mi, fall back to the nearest
// approaching cell in the 80 mi corridor so distant inbound lightning still
// warns. Cells arriving within 15 min are flagged as the urgent set to act on.
function fmtLightning(personal, tz, h24) {
  const strong = personal.filter(c => c.dbz >= 45);
  if (!strong.length) return null;
  // Nearest strong cell within 15 mi (any direction) — pure awareness.
  const near = strong.filter(c => c.distance <= LTG_NEAR).sort((a, b) => a.distance - b.distance);
  // Approaching strong cells bearing down out to the 80 mi corridor.
  const corridor = strong.filter(c => c.approaching && c.distance <= LTG_RADIUS).sort((a, b) => a.distance - b.distance);
  if (!near.length && !corridor.length) return null;

  // Lead with the closest cell overall: an in-range (≤15 mi) awareness cell if
  // present, otherwise the nearest approaching corridor cell.
  const lead = near[0] || corridor[0];
  const dist = Math.round(lead.distance);
  let etaStr = '';
  if (lead.approaching && lead.etaMin != null) {
    const clock = fmtArrivalClock(lead.etaMin, tz, h24);
    etaStr = clock ? ` · ETA ${clock}` : ` · ETA ~${lead.etaMin} min`;
  }
  const strength = lead.dbz >= 55 ? 'Severe storm' : 'Strong storm';
  const leadSentence = `${strength} with lightning detected ${degToDir(lead.bearing)} @ ${dist} mi${etaStr}.`;

  // Urgent set: approaching cells estimated to reach the user within 15 minutes.
  const soon = corridor.filter(c => c.etaMin != null && c.etaMin <= 15);
  const leadSoon = lead.approaching && lead.etaMin != null && lead.etaMin <= 15;
  let extra = '';
  if (soon.length > 1) {
    const spread = [...new Set(soon.slice(0, 3).map(c => degToDir(c.bearing)))].join('/');
    extra = ` ${soon.length} cells could reach you within 15 min (${spread}).`;
  } else if (soon.length === 1 && !leadSoon) {
    extra = ` A cell to the ${degToDir(soon[0].bearing)} could reach you within 15 min.`;
  }
  if (corridor.length > 1) extra += ` ${corridor.length} strong cells approaching within ${LTG_RADIUS} mi.`;

  const advice = (near.length || soon.length)
    ? ' Move indoors or to a safe location now.'
    : ' Keep an eye on the sky and be ready to move indoors or to a safe location.';

  // Dedupe by coarse direction (45° sectors) + 10 mi distance buckets across the
  // cells we lead on (the nearest awareness cell + the urgent/corridor set), so
  // new activity in a fresh sector/distance retriggers the digest instead of
  // being masked by an unchanged cell still inside its cooldown.
  const keySrc = [...near.slice(0, 1), ...(soon.length ? soon : corridor)];
  const cks = [...new Set(keySrc.map(c => 'ltg_' + Math.round(c.bearing / 45) + '_' + Math.round(c.distance / 10)))];
  return {
    cks,
    display: `⚡ ${strength} with lightning detected ${degToDir(lead.bearing)} @ ${dist} mi`,
    body: `${leadSentence}${extra}${advice}`,
  };
}

// --- Real observed lightning via the GOES GLM snapshot (v6.64) ---
// The glm-lightning job keeps a fresh flash snapshot in the worker; this pulls
// the strikes around a scan group's location so the ⚡ push can lead with REAL
// observed lightning instead of the radar estimate. Keyless — it's our own
// endpoint — and any failure just means the estimate path runs as before.
const LTG_OBS_MI = 10;         // observed-strike alert ring (matches the in-app alert)
const LTG_OBS_FRESH_MS = 10 * 60 * 1000; // stale snapshot = ignore, fall back to estimate
function _obsBbox(lat, lon) {
  const padMi = 30; // covers the 10 mi ring + the 25 mi context count
  const latPad = padMi / 69;
  const lonPad = padMi / (69 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  return `&min_lat=${(lat - latPad).toFixed(3)}&max_lat=${(lat + latPad).toFixed(3)}`
    + `&min_lon=${(lon - lonPad).toFixed(3)}&max_lon=${(lon + lonPad).toFixed(3)}`;
}
// v6.73: WarPulse ground network via the worker's SHARED key (arrangement
// approved by WarPulse — Niall, Aug 2026, explicitly including scanner use:
// "you can put the background scanner on the shared key too"). The scanner
// authenticates with x-scanner-secret, which exempts it from the per-IP rate
// limit. 503 = shared key not provisioned yet → GLM fallback takes over.
async function fetchWarPulseStrikes(lat, lon) {
  const u = `${WORKER_URL}/lightning?since_minutes=15&limit=500` + _obsBbox(lat, lon);
  const r = await fetch(u, {
    headers: { 'x-scanner-secret': SCANNER_SECRET },
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 503) return null; // shared key not configured yet
  if (!r.ok) throw new Error(`warpulse HTTP ${r.status}`);
  const j = await r.json();
  const strikes = [];
  for (const f of (j.flashes || [])) {
    if (typeof f.lat !== 'number' || typeof f.lon !== 'number') continue;
    strikes.push({ lat: f.lat, lon: f.lon });
  }
  return { src: 'warpulse', sat: null, updated: Date.now(), strikes };
}
async function fetchGlmStrikes(lat, lon) {
  const u = `${WORKER_URL}/glm?since_minutes=15&limit=500` + _obsBbox(lat, lon);
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  if (r.status === 404) return null; // no snapshot yet (pipeline just deployed)
  if (!r.ok) throw new Error(`glm HTTP ${r.status}`);
  const j = await r.json();
  const snapTs = (j && typeof j.updated === 'number') ? j.updated * 1000 : 0;
  if (!snapTs || Date.now() - snapTs > LTG_OBS_FRESH_MS) return null; // stale — estimate wins
  const strikes = [];
  for (const f of (j.flashes || [])) {
    if (typeof f.lat !== 'number' || typeof f.lon !== 'number') continue;
    strikes.push({ lat: f.lat, lon: f.lon });
  }
  return { src: 'glm', sat: j.sat || 'GOES', updated: snapTs, strikes };
}
// Observed-strike source chain for pushes: WarPulse ground network (shared key)
// first — better precision for the alert use case — GLM satellite as fallback.
// Any failure in one source falls through to the next; both failing means the
// radar-estimated ⚡ path runs exactly as before.
async function fetchObservedStrikes(lat, lon) {
  try {
    const wp = await fetchWarPulseStrikes(lat, lon);
    if (wp) return wp;
  } catch (e) { console.warn(`  warpulse strikes failed: ${e.message}`); }
  return fetchGlmStrikes(lat, lon);
}
// Observed-strike push body for one subscriber. Fires when a real strike landed
// within LTG_OBS_MI in the last 15 min. GLM geolocates from orbit at ~8–14 km,
// so distances are worded as approximate. Dedupe keys use 45° sectors + 5 mi
// buckets over the in-ring strikes; the 'ltg_' prefix keeps keyKind() = 'ltg'
// so the existing 30-min ltg cooldown and severe-escalation rules apply.
function fmtLightningObserved(obs, lat, lon) {
  const withDist = obs.strikes.map(s => ({
    distance: haversine(lat, lon, s.lat, s.lon),
    bearing: bearingDeg(lat, lon, s.lat, s.lon),
  }));
  const near = withDist.filter(s => s.distance <= LTG_OBS_MI).sort((a, b) => a.distance - b.distance);
  if (!near.length) return null;
  const lead = near[0];
  const dist = Math.max(1, Math.round(lead.distance));
  const w25 = withDist.filter(s => s.distance <= 25).length;
  const cks = [...new Set(near.map(s => `ltg_o${Math.round(s.bearing / 45)}_${Math.round(s.distance / 5)}`))];
  const context = w25 > near.length ? ` (${w25} within 25 mi)` : '';
  // Wording tracks the source's precision: WarPulse's ground network resolves
  // ~1 km (state distances plainly); GLM sees optically from orbit at ~8–14 km
  // (distances stay "~approximate").
  const sat = obs.src === 'glm';
  const approx = sat ? '~' : '';
  const srcTag = sat ? ' (satellite)' : '';
  const srcSentence = sat
    ? `Detected by the ${obs.sat} satellite (locations approximate).`
    : 'Detected by the WarPulse ground network.';
  return {
    cks,
    display: `⚡ Lightning OBSERVED ${approx}${dist} mi ${degToDir(lead.bearing)}${srcTag}`,
    body: `Real lightning observed ${approx}${dist} mi to the ${dirLong(lead.bearing)} — ${near.length} strike${near.length !== 1 ? 's' : ''} within ${LTG_OBS_MI} mi in the last 15 min${context}. ${srcSentence} Move indoors now and wait 30 min after the last strike.`,
  };
}

// Returns 'ok' | 'dead' | 'err'. 'dead' means the push endpoint is gone (404/410).
async function trySend(sub, payload, opts) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, opts);
    return 'ok';
  } catch (e) {
    const code = e.statusCode || e.status;
    let host = '';
    try { host = new URL(sub.endpoint).host; } catch (_) {}
    const body = (e.body || e.message || '').toString().slice(0, 300).replace(/\s+/g, ' ');
    console.warn(`  ✗ push failed (${code || e.message}) host=${host} bytes=${Buffer.byteLength(payload)} body=${body}`);
    return (code === 404 || code === 410) ? 'dead' : 'err';
  }
}

async function run() {
  if (!WORKER_URL) fail('WORKER_URL not set');
  if (!SCANNER_SECRET) fail('SCANNER_SECRET not set');
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) fail('VAPID keys not set');
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // Fixed cadence: the GitHub cron is the schedule, so every tick scans. Manual
  // (workflow_dispatch) runs scan immediately too.
  const manual = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
  console.log(manual ? 'Manual run — scanning now.' : 'Scheduled run — scanning now.');

  const subs = await getSubscribers();
  console.log(`Subscribers: ${subs.length}`);
  if (!subs.length) return 'green';

  const now = Date.now();
  let sent = 0;

  // Each device (push endpoint) can watch up to 5 saved locations. Fan every
  // subscriber out into one virtual entry PER watched location so the existing
  // per-location scan + grouping handles them all; the device's single endpoint
  // then receives a SEPARATE notification per location (distinct tag), each
  // headed with that location's name. Falls back to the legacy single
  // lat/lon/name for older subscriptions that have no `locs` array.
  const entries = [];
  for (const s of subs) {
    const rawLocs = (s.thresholds && Array.isArray(s.thresholds.locs) && s.thresholds.locs.length)
      ? s.thresholds.locs
      : [{ id: 'home', lat: s.lat, lon: s.lon, name: s.name }];
    // Harden against malformed client payloads: drop invalid coords, de-dupe by
    // locId, and cap at 5 (the saved-location max) per device.
    const seen = new Set();
    for (const L of rawLocs) {
      if (!L || typeof L.lat !== 'number' || typeof L.lon !== 'number') continue;
      const locId = String(L.id || `${L.lat.toFixed(3)},${L.lon.toFixed(3)}`).replace(/#/g, '');
      if (seen.has(locId)) continue;
      seen.add(locId);
      entries.push({ ...s, lat: L.lat, lon: L.lon, name: L.name || s.name, _locId: locId });
      if (seen.size >= 5) break;
    }
  }
  console.log(`Watched locations: ${entries.length}`);
  if (!entries.length) return 'green';

  // Per-ENDPOINT dedupe state. All of a device's locations share one last_alert
  // map (keys namespaced by locId) that we merge across locations and flush
  // ONCE at the end, so locations never clobber each other's cooldowns.
  const epState = new Map();
  for (const s of subs) {
    if (epState.has(s.endpoint)) continue;
    const la = { ...(s.lastAlert || {}) };
    // Only numeric timestamp keys age out; meta keys like `<loc>#__edge` hold a
    // JSON string (the last-sent routine signature set) and must never be pruned.
    Object.keys(la).forEach(k => { const v = la[k]; if (typeof v !== 'number') return; if (now - v > (PRUNE[keyKind(k)] || PRUNE.sc)) delete la[k]; });
    epState.set(s.endpoint, { la, dirty: false, dead: false });
  }

  // Per-CODE RSS feed aggregation. Each code's snapshot lists EVERY active alert
  // across its watched locations (deduped by code|locId so multi-device codes
  // don't double-list). Fed to the worker every scan, push-independent.
  const feedByCode = new Map();
  const feedSeen = new Set();

  // One-shot test pushes: a user tapped "Send test notification" in Settings.
  // The worker flagged it; we deliver through the SAME web-push path as real
  // alerts (so a success genuinely proves delivery works), then clear the flag so
  // it fires exactly once. Sent up-front, independent of any weather conditions.
  for (const s of subs) {
    if (!s.testRequested) continue;
    const st = epState.get(s.endpoint);
    if (st && st.dead) continue;
    const payload = JSON.stringify({
      title: '✅ StormTracker test',
      body: 'Notifications are working. Real storm alerts arrive automatically when weather warrants. 🌩️',
      // UNIQUE tag per test (like real digests) — a fixed tag let iOS silently
      // coalesce repeated tests, so a 2nd/3rd "Send test" replaced the banner
      // WITHOUT re-alerting and looked like delivery had stopped.
      tag: 'stormtracker-test-' + Date.now(),
      url: SITE_URL,
    });
    const r = await trySend(s, payload, { TTL: 600, urgency: 'high' });
    await clearTest(s.endpoint);
    if (r === 'dead') { if (st) st.dead = true; await pruneDead(s.endpoint); }
    if (r === 'ok') sent++;
    console.log(`  ${r === 'ok' ? '✓' : '✗'} test push (${r}) -> ${s.name || s.endpoint.slice(-12)}`);
  }

  // Group watched locations by coarse location (~0.7 mi) so co-located entries
  // share one radar / conditions / NWS fetch.
  // Strongest weather tier seen this scan, for the adaptive cadence (reported to
  // the Worker at the end): 0 green, 1 yellow (rain in radius), 2 red (inbound).
  let maxThreat = 0;

  const groups = new Map();
  for (const e of entries) {
    const key = `${e.lat.toFixed(2)},${e.lon.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  console.log(`Scan groups: ${groups.size}`);

  // Tropical systems are global, not per-location — fetch once and reuse.
  let tropical = [];
  const wantTrop = subs.some(s => { const t = s.thresholds && s.thresholds.tropical; return !t || t.on !== false; });
  if (wantTrop) {
    try { tropical = await fetchTropical(); console.log(`Tropical systems active: ${tropical.length}`); }
    catch (e) { console.warn(`tropical fetch failed: ${e.message}`); }
  }

  for (const [key, members] of groups) {
    const o = members[0];
    // Scan the full system-max radar (covers the fixed 80 mi lightning corridor)
    // so lightning always has data; per-subscriber storm pushes still filter to
    // each user's own radius/dist below.
    const radius = LTG_RADIUS;

    // 1. Radar storm cells.
    let cells = [], mv = null, groupDegraded = false;
    try {
      const scan = await scanLocation(o.lat, o.lon, radius);
      cells = scan.cells || [];
      // v6.56: clutter screen (shared 3-branch predicate — parity with the
      // app's isClutterOnly). A scan of nothing but weak scattered echoes is
      // ground clutter/AP, not rain; it must not feed alerts or the rain clock.
      if (isClutterCells(cells)) { console.log(`  clutter-only scan (${cells.length} weak echoes) — suppressed`); cells = []; }
      mv = scan.mv || null;
      console.log(`[${key}] ${scan.source}: ${cells.length} cells (raw ${scan.rawCount || 0}), steering ${mv ? mv.speed + 'mph@' + mv.direction : 'n/a'}`);
    } catch (e) { groupDegraded = true; console.warn(`  radar ${key} failed: ${e.message}`); }

    // Adaptive scan cadence (lenient, group-level — err toward scanning MORE when
    // weather is near): an inbound cell → red (5 min); any real echo inside the
    // scanned radius → yellow (10 min). The per-user band gate below still
    // decides actual alerts; this only sets how soon the NEXT scan runs.
    if (cells.length) {
      const inbound = cells.some(c => c.approaching && c.distance <= 45 && c.dbz >= 30);
      const rainNear = cells.some(c => c.dbz >= 25 && c.distance <= radius);
      maxThreat = Math.max(maxThreat, inbound ? 2 : (rainNear ? 1 : 0));
    }

    // 2. Open-Meteo conditions — only if someone here has an enabled wx alert.
    let conditions = null;
    const wantWx = members.some(m => m.thresholds && m.thresholds.wx &&
      Object.values(m.thresholds.wx).some(c => c && c.on));
    if (wantWx) {
      try { conditions = await fetchConditions(o.lat, o.lon); }
      catch (e) { console.warn(`  conditions ${key} failed: ${e.message}`); }
    }

    // 3. NWS active warnings — unless everyone here opted out.
    let nwsAlerts = [];
    const wantNws = members.some(m => nwsCfgOf(m.thresholds).on);
    if (wantNws) {
      try { nwsAlerts = await fetchNws(o.lat, o.lon); console.log(`  NWS: ${nwsAlerts.length} active`); }
      catch (e) { console.warn(`  nws ${key} failed: ${e.message}`); }
    }

    // 4. Rain right over the user — radar dBZ on the exact spot, only if someone
    // here has the rain-overhead OR drizzle toggle on (both read the overhead
    // value). One decode per group (members share a coarse location); each sub
    // still applies its own band gate below.
    let overheadDbz = null;
    const wantRov = members.some(m => { const b = bandsFor(m); return b.rovOn || b.drizOn; });
    if (wantRov) {
      try { overheadDbz = await dbzAtPoint(o.lat, o.lon); console.log(`  overhead: ${overheadDbz} dBZ`); }
      catch (e) { console.warn(`  overhead ${key} failed: ${e.message}`); }
    }
    // Rain directly overhead also warrants at least the yellow (mid) cadence.
    if (overheadDbz != null && overheadDbz >= 20) maxThreat = Math.max(maxThreat, 1);

    // 5. Real observed lightning, one fetch per group (v6.73): WarPulse ground
    // network via the shared key first, GLM satellite as fallback. null (both
    // unavailable) means the radar-estimated ⚡ path below runs as before.
    let glm = null;
    try {
      glm = await fetchObservedStrikes(o.lat, o.lon);
      if (glm) console.log(`  strikes (${glm.src}): ${glm.strikes.length} in range${glm.src === 'glm' ? ` (snapshot ${Math.round((Date.now() - glm.updated) / 60000)} min old)` : ''}`);
    } catch (e) { console.warn(`  observed strikes ${key} failed: ${e.message}`); }
    // Observed lightning near the group location = red (fast) scan cadence.
    if (glm && glm.strikes.some(s => haversine(o.lat, o.lon, s.lat, s.lon) <= LTG_OBS_MI)) {
      maxThreat = Math.max(maxThreat, 2);
    }

    for (const sub of members) {
      const st = epState.get(sub.endpoint);
      if (!st || st.dead) continue; // endpoint already dead/pruned this run
      const lastAlert = st.la;      // shared per-endpoint map (all locations)
      const ns = sub._locId + '#';  // namespace this location's dedupe keys
      const th = thresholdsFor(sub);
      const bands = bandsFor(sub);  // intensity-band gates + rain-overhead toggle

      // Collect EVERY currently-active alert for this subscriber across all
      // sources into one list. We send a single digest notification listing them
      // all; each item carries its own dedupe key(s). The digest fires whenever
      // at least one item is "fresh" (past its per-type cooldown), but shows the
      // full active picture and resets every listed item's cooldown.
      const items = [];

      const tz = sub.thresholds && sub.thresholds.tz;
      const h24 = sub.thresholds && sub.thresholds.h24;

      // The inbound storm picture + rain overhead are folded into ONE narrated
      // "Rain Clock" digest item below (replacing the old storm-count 'sc' line
      // and the 'rov' line). These hold the legacy items as a no-regression
      // fallback in case the projection can't build a timeline.
      let scItem = null, rovItem = null, rcHits = [];

      // --- ⚡ Lightning: observed strikes first, radar estimate as fallback ---
      // v6.64: when the GLM snapshot is fresh and a REAL strike landed within
      // ~10 mi, that leads the ⚡ push (worded as observed, satellite-sourced).
      // Otherwise the long-standing radar-derived corridor estimate (inside the
      // cells block below) fires exactly as before — GLM detection efficiency
      // isn't 100%, so the estimate is never suppressed, only outranked.
      let ltgItem = null;
      if (glm && glm.strikes.length) {
        const obs = fmtLightningObserved(glm, sub.lat, sub.lon);
        if (obs) ltgItem = { kind: 'ltg', cat: 'ltg', urgency: 'high', cks: obs.cks, sig: 'ltg:obs', display: obs.display, titleSingle: '⚡ Lightning Nearby', body: obs.body };
      }

      // --- Storm cells + estimated lightning ---
      if (cells.length) {
        const personal = cells.map(c => {
          const distance = haversine(sub.lat, sub.lon, c.lat, c.lng);
          const bearing = bearingDeg(sub.lat, sub.lon, c.lat, c.lng);
          const cc = { lat: c.lat, lng: c.lng, dbz: c.dbz, distance, bearing };
          const imp = calcImpact(cc, mv); cc.impactPct = imp.impactPct; cc.impactTier = imp.impactTier;
          const eta = calcETA(cc, mv); cc.etaMin = eta.etaMin; cc.approaching = eta.approaching; cc.closingSpeed = eta.closingSpeed;
          cc.xtrkMi = crossTrackMi(cc, mv); // v5.99: cross-track (X-TRK) miss for the direct-only gate
          return cc;
        });
        // Inbound cells passing the user's radius/impact/distance filter, then
        // GATED by the intensity bands: a cell only counts if its dBZ falls in a
        // band the user left on. This mirrors the in-app band gate exactly.
        // v5.99: DIRECT-only — only a cell whose projected path passes within
        // 1.5 mi (X-TRK) pushes, matching the in-app gate. Nearby/passing cells
        // still show on the radar + Storms tab (and their cones are still drawn),
        // they just don't ping. Cones stay a visual-only awareness layer.
        const hits = personal.filter(c =>
          c.distance <= th.radius && c.approaching && c.xtrkMi <= XTRK_DIRECT_MI &&
          c.dbz >= th.dbz && c.impactPct >= th.impact && c.distance <= th.dist &&
          (() => { const bk = bandForDbz(c.dbz); return bk && bands[bk] && bands[bk].on; })()
        );
        if (hits.length) {
          // Strongest + soonest: bucket ETA into ~10-min bands (soonest first),
          // then prefer the strongest (dBZ), then highest impact — so an imminent
          // cell leads, but among similarly-timed cells the strongest wins.
          const best = hits.slice().sort((a, b) => {
            const ea = a.etaMin == null ? 1e9 : a.etaMin;
            const eb = b.etaMin == null ? 1e9 : b.etaMin;
            return (Math.floor(ea / 10) - Math.floor(eb / 10)) || (b.dbz - a.dbz) || (b.impactPct - a.impactPct);
          })[0];
          const body = fmtStormBody(best, hits.length, mv, tz, h24);
          const shortBody = fmtStormShort(best, hits.length, mv, tz, h24);
          const cks = hits.map(c => `sc_${Math.round(c.bearing / 10)}_${Math.round(c.distance / 3)}`);
          // Re-notify cadence follows the strongest hit's band (the cell that
          // leads the notification), matching the in-app per-cell band cooldown.
          const bestBand = bandForDbz(best.dbz);
          // Floor non-severe storm-cell re-notifies for delivery; severe stays
          // fast. Keep the fast cadence whenever ANY hit cell is severe (not just
          // the lead cell), so a severe cell behind a nearer-but-weaker one isn't
          // throttled to the 10-min floor.
          const anySevere = hits.some(c => bandForDbz(c.dbz) === 'severe');
          const cooldownMs = bestBand
            ? (anySevere ? bands.severe.min * 60000 : Math.max(bands[bestBand].min * 60000, PUSH_FLOOR_MS))
            : COOLDOWN.sc;
          // Build but DON'T push: the Rain Clock item below subsumes this. Kept
          // as a fallback if the timeline projection can't build (no regression).
          scItem = { kind: 'sc', cat: 'sc', urgency: 'high', severe: anySevere, cks, cooldownMs, sig: 'sc:' + (anySevere ? 'severe' : (bestBand || 'cell')), display: `🌩️ ${shortBody}`, titleSingle: '🌩️ StormTracker Alert', body };
          rcHits = hits;
        }

        // Lightning estimate runs off the full corridor (approaching strong
        // cells out to 80 mi), independent of the user's dBZ/impact filter, so
        // a strong cell bearing down can warn even if it hasn't met the
        // storm-alert bar yet. Skipped when an OBSERVED strike already leads.
        if (!ltgItem) {
          const ltg = fmtLightning(personal, tz, h24);
          if (ltg) ltgItem = { kind: 'ltg', cat: 'ltg', urgency: 'high', cks: ltg.cks, sig: 'ltg', display: ltg.display, titleSingle: '⚡ Lightning Nearby', body: ltg.body };
        }

        // --- Awareness: strong storms nearby that are NOT heading at the user ---
        // Strong cells inside the user's radius that are parallel/passing/receding
        // (not approaching) and beyond the 15 mi near-lightning ring — so this never
        // overlaps the inbound 'sc' alert or the 'ltg' corridor. Low urgency. Needs
        // valid steering so "not heading your way" reflects real motion (calcETA
        // also reports approaching=false when steering is missing, which we must not
        // mistake for "safely parallel").
        if (areaCfgOf(sub.thresholds).on && mv && mv.speed >= 2) {
          const area = personal.filter(c =>
            c.dbz >= AREA_DBZ && c.distance <= th.radius &&
            c.distance > LTG_NEAR && !c.approaching
          );
          if (area.length) {
            const a = fmtArea(area, mv, th, tz, h24);
            items.push({ kind: 'area', cat: 'area', urgency: 'normal', cks: a.cks, cooldownMs: AREA_COOLDOWN_MS, sig: 'area', display: a.display, titleSingle: '🌩️ Strong Storms Nearby', body: a.body });
          }
        }
      }
      // One ⚡ item per digest, whichever source produced it (observed strikes
      // fire even on a cell-less radar scan — GLM sees what radar hasn't yet).
      if (ltgItem) items.push(ltgItem);

      // --- Rain right over you (radar dBZ on the exact spot, no inbound needed) ---
      // Fires whenever the overhead radar value lands in an enabled band, even
      // with nothing approaching. Independent of the storm-cell filter above.
      // Round once (matches the app's checkRainOverheadAlert) so app + scanner
      // classify boundary values (e.g. 19.6 → 20) into the SAME category.
      const ovDbz = overheadDbz != null ? Math.round(overheadDbz) : null;
      let rovDbz = null;
      if (bands.rovOn && ovDbz != null && ovDbz >= 20) {
        const dbz = ovDbz;
        const bk = bandForDbz(dbz);
        if (bk && bands[bk] && bands[bk].on) {
          rovDbz = dbz; // feed the Rain Clock "raining now" anchor below
          const cooldownMs = bk === 'severe' ? bands.rovMin * 60000 : Math.max(bands.rovMin * 60000, PUSH_FLOOR_MS);
          const body = `🌧️ Rain right over you — ${bandLabel(bk)} (${dbz} dBZ)`;
          // Build but DON'T push: folded into the Rain Clock narrative below.
          rovItem = { kind: 'rov', cat: 'rov', urgency: bk === 'severe' ? 'high' : 'normal', cks: ['rov'], cooldownMs, sig: 'rov:' + bk, display: body, titleSingle: '🌧️ Rain Overhead', body };
        }
      }

      // --- Drizzle / very light right over you (opt-in, sub-band 10–19 dBZ) ---
      // Below the Light band floor (20 dBZ); its own toggle + cadence so users can
      // opt into pings on barely-there rain without changing the band system.
      if (bands.drizOn && ovDbz != null && ovDbz >= 10 && ovDbz < 20) {
        const dbz = ovDbz;
        const cooldownMs = Math.max(bands.drizMin * 60000, PUSH_FLOOR_MS);
        const body = `🌦️ Drizzle right over you — very light (${dbz} dBZ)`;
        items.push({ kind: 'driz', cat: 'driz', urgency: 'normal', cks: ['driz'], cooldownMs, sig: 'driz', display: body, titleSingle: '🌦️ Drizzle Overhead', body });
      }

      // --- Rain Clock: narrate the rain TIMELINE instead of a storm count ---
      // One sentence covering rain overhead now + the next inbound rain window
      // ("Moderate rain overhead, ending in a few minutes. Strong storm inbound
      // with heavy rain starting around 1948 lasting until 2030 with ⚡️"),
      // replacing the old "138 storms approaching, ETA 1902" line. Fed only the
      // user-gated inbound cells (rcHits) + rain overhead when their toggle is on
      // (rovDbz), so it respects each user's alert settings. Lightning stays its
      // own life-safety item; the narrative just flags ⚡️ on a stormy window.
      let rcPushed = false;
      if (rcHits.length || rovDbz != null) {
        const rcData = buildRainClock({
          cells: rcHits.map(c => ({ dbz: c.dbz, etaMin: c.etaMin, distance: c.distance, bearing: c.bearing, closingSpeed: c.closingSpeed })),
          mv, overheadDbz: rovDbz, nowMs: now,
          rainFloor: th.rainFloor,   // v6.56: user's rain floor, from the subscription
        });
        if (rcData.ready) {
          const phrase = formatRainClockPush(rcData, { tz, h24, nowMs: now });
          if (phrase) {
            const bk = bandForDbz(rcData.peakDbz);
            const cooldownMs = bk
              ? (rcData.anySevere ? bands.severe.min * 60000 : Math.max(bands[bk].min * 60000, PUSH_FLOOR_MS))
              : COOLDOWN.rc;
            items.push({
              kind: 'rc', cat: 'rc', urgency: rcData.anySevere ? 'high' : 'normal', severe: rcData.anySevere,
              cks: rainClockKeys(rcData), cooldownMs, sig: 'rc:' + rainClockSignature(rcData),
              display: phrase.display, titleSingle: '🌧️ Rain Forecast', body: phrase.body,
            });
            rcPushed = true;
          }
        }
      }
      // No-regression fallback: if the timeline couldn't build, fall back to the
      // original storm-cell + rain-overhead lines so we never go silent.
      if (!rcPushed) {
        if (scItem) items.push(scItem);
        if (rovItem) items.push(rovItem);
      }

      // --- Weather thresholds (mirror the app's in-app alert settings) ---
      if (conditions && sub.thresholds && sub.thresholds.wx) {
        const breaches = evalWx(conditions, sub.thresholds.wx, sub.thresholds.units || {});
        for (const b of breaches) {
          items.push({ kind: 'wx', cat: 'wx', urgency: 'normal', cks: ['wx_' + b.key], sig: 'wx:' + b.key, display: b.msg, titleSingle: '⚠️ StormTracker Weather Alert', body: b.msg });
        }
      }

      // --- NWS active warnings / watches / advisories (US) ---
      // Each severity tier carries its OWN re-notify cadence (warnings fast,
      // watches medium + tighten near expiry, advisories slow or off) via a
      // per-item cooldownMs, and rides its own notification category.
      const nwsCfg = nwsCfgOf(sub.thresholds);
      if (nwsCfg.on && nwsAlerts.length) {
        for (const a of nwsAlerts) {
          const tier = nwsTierOf(a.event);
          const cd = nwsCooldownMs(tier, nwsCfg, a.ends);
          if (cd == null) continue; // tier disabled (e.g. advisories off)
          const ic = nwsIcon(a.event);
          const shortWin = nwsWindow(a, true, tz, h24);
          const fullWin = nwsWindow(a, false, tz, h24);
          const display = `${ic} ${a.event}${shortWin ? ` · ${shortWin}` : ''}`;
          const body = [a.headline || a.area || a.event, fullWin ? `🕐 ${fullWin}` : ''].filter(Boolean).join('\n');
          items.push({ kind: 'nws', cat: 'nws-' + tier, urgency: tier === 'adv' ? 'normal' : 'high', cooldownMs: cd, cks: ['nws_' + a.id], sig: 'nws:' + a.id, display, label: a.event, icon: ic, win: shortWin, titleSingle: `${ic} ${a.event}`, body });
        }
      }

      // --- Tropical systems (NHC cone / proximity, ahead of any local NWS watch) ---
      const tropCfg = tropCfgOf(sub.thresholds);
      if (tropCfg.on && tropical.length) {
        const baseTropMs = tropCfg.everyH * 3600000;
        for (const t of evalTropical(tropical, sub.lat, sub.lon, tropCfg.radius, tropCfg.muted)) {
          // Step up frequency for the most serious systems (you're in the cone):
          // halve the base cadence, floored at 3h.
          const cd = t.urgency === 'high' ? Math.min(baseTropMs, 3 * 3600000) : baseTropMs;
          items.push({ kind: 'trop', cat: 'trop', urgency: t.urgency, cooldownMs: cd, cks: ['trop_' + t.ck], sig: 'trop:' + t.ck, display: t.msg, label: 'Tropical Cyclone', icon: '🌀', titleSingle: '🌀 Tropical Cyclone Alert', body: t.msg });
        }
      }

      // --- RSS feed snapshot (push-independent; captured BEFORE push gating) ---
      // Record this location's full active picture (or all-clear) into its code's
      // aggregate. Deduped by code|locId so a multi-device code lists each place
      // once. Distance/ETA are deliberately left out of `sig` so minor drift
      // doesn't register as a "change".
      if (sub.code) {
        const fkey = sub.code + '|' + sub._locId;
        if (!feedSeen.has(fkey)) {
          feedSeen.add(fkey);
          let fc = feedByCode.get(sub.code);
          if (!fc) { fc = { name: sub.name || '', sections: [], sigParts: [], urgent: false, degraded: false }; feedByCode.set(sub.code, fc); }
          if (!fc.name) fc.name = sub.name || '';
          const FORD = ['trop', 'nws-warn', 'rc', 'sc', 'ltg', 'rov', 'driz', 'area', 'nws-watch', 'wx', 'nws-adv'];
          const fp = it => { const i = FORD.indexOf(it.cat || it.kind); return i < 0 ? 99 : i; };
          const act = items.slice().sort((a, b) => fp(a) - fp(b));
          const locName = sub.name || 'Location';
          if (act.length) {
            fc.sections.push(`📍 ${locName}\n` + act.map(it => '  ' + it.display).join('\n'));
            for (const it of act) if (it.sig) fc.sigParts.push(sub._locId + '|' + it.sig);
            if (act.some(it => it.cat === 'nws-warn' || it.cat === 'trop' || (it.cat === 'sc' && it.severe) || (it.cat === 'rc' && it.severe))) fc.urgent = true;
          } else {
            fc.sections.push(`📍 ${locName}: ✅ All clear — nothing within ${th.radius} mi`);
          }
          if (groupDegraded) fc.degraded = true;
        }
      }

      // --- Per-category notifications (one push per type) ---
      // Hoisted so the edge-state ("changes-only") bookkeeping below runs even
      // when there are zero active items (a fully-cleared location must forget its
      // routine signature set so a later return re-fires).
      const changesOn = changesCfgOf(sub.thresholds).on;
      let didSend = false, curRoutine = [], routineAdded = [];
      if (items.length) {
        // An item is "due" when one of its dedupe keys has passed THAT item's own
        // cooldown (its band cadence for storm/rain-overhead, the per-tier NWS /
        // tropical cadence, else the per-kind default). On send we reset the
        // cooldown ONLY for the items that were actually due — so a fast-cadence
        // alert (e.g. a 30-min warning) never keeps resetting a slower sibling
        // (a 6h advisory), keeping each cadence intact instead of collapsing to
        // the fastest.
        const isDue = it => { const cd = it.cooldownMs != null ? it.cooldownMs : COOLDOWN[it.kind]; return it.cks.some(ck => now - (lastAlert[ns + ck] || 0) >= cd); };
        // ONE coalesced digest push per location per scan. iOS/Apple throttle a
        // steady stream of separate web-push messages to a Home-Screen PWA and
        // silently drop them, so instead of one push per category we send a single
        // notification listing every currently-active alert. It fires whenever at
        // least one item is past its own cooldown, rides high urgency if ANY item
        // is high, and resets the cooldown only for the items that were due.
        const CAT_ORDER = ['trop', 'nws-warn', 'rc', 'sc', 'ltg', 'rov', 'driz', 'area', 'nws-watch', 'wx', 'nws-adv'];
        const pri = it => { const i = CAT_ORDER.indexOf(it.cat || it.kind); return i < 0 ? 99 : i; };
        const ordered = items.slice().sort((a, b) => pri(a) - pri(b));
        // Routine signature set this scan + what's NEW vs. the last sent set.
        const routineItems = ordered.filter(it => !isLifeSafety(it));
        curRoutine = [...new Set(routineItems.map(routineToken))];
        let prevRoutine = new Set();
        if (changesOn) { try { const raw = lastAlert[ns + '__edge']; if (typeof raw === 'string') prevRoutine = new Set(JSON.parse(raw)); } catch (e) {} }
        routineAdded = changesOn ? routineItems.filter(it => !prevRoutine.has(routineToken(it))) : [];
        // In changes-only mode a send is triggered by a due life-safety item OR a
        // brand-new routine signature; otherwise by any item past its cooldown.
        const dueItems = changesOn
          ? ordered.filter(isLifeSafety).filter(isDue).concat(routineAdded)
          : ordered.filter(isDue);
        if (dueItems.length) {
          let title, body;
          const nameTail = sub.name ? ' · ' + sub.name : '';
          // Surface the single most serious "named" alert in the TITLE, leading
          // with it (+ its end time) so the worst threat — and when it expires —
          // survives even when iOS truncates the collapsed banner to ~one line.
          // Only NWS warnings/watches and tropical systems carry a real event name
          // (and, for NWS, an "until" time); storm-cell / lightning / rain alerts
          // have no fixed end and stay in the body. Severity: warning > watch >
          // tropical.
          const HEAD_ORDER = ['nws-warn', 'nws-watch', 'trop'];
          let headline = null;
          for (const c of HEAD_ORDER) { headline = ordered.find(i => i.cat === c); if (headline) break; }
          if (ordered.length === 1) {
            const only = ordered[0];
            // A lone NWS alert leads with its event + end time
            // (e.g. "🌪️ Tornado Watch until 8:00 PM · Home").
            if ((only.cat === 'nws-warn' || only.cat === 'nws-watch') && only.label) {
              title = `${only.icon || '⚠️'} ${only.label}${only.win ? ' ' + only.win : ''}${nameTail}`;
            } else {
              title = only.titleSingle + nameTail;
            }
            body = only.body;
          } else {
            // Multi-alert digest. When a serious named alert is present, lead the
            // title with it + its end time, then the total count
            // (e.g. "🌪️ Tornado Watch until 8:00 PM · 8 alerts · Home"); otherwise
            // fall back to the plain count.
            if (headline && headline.label) {
              const win = headline.win ? ' ' + headline.win : '';
              title = `${headline.icon || '🌩️'} ${headline.label}${win} · ${ordered.length} alerts${nameTail}`;
            } else {
              title = `🌩️ ${ordered.length} weather alerts${nameTail}`;
            }
            // iOS banners truncate by HEIGHT, so keep the body short. Show each
            // live / serious threat (storms, lightning, rain, NWS warnings) on its
            // own line, but when several long-lived NWS watches/advisories pile up
            // (each valid for hours/days, lowest priority) fold them into ONE
            // names-only line so they never push the live threats off the bottom.
            const MINOR = new Set(['nws-watch', 'nws-adv']);
            // The headline alert is already spelled out in the title (name + end
            // time), so leave it out of the body — otherwise the most serious
            // alert is the one item printed twice in every digest. The "N alerts"
            // count stays the true total.
            const titled = (headline && headline.label) ? headline : null;
            const rest = titled ? ordered.filter(i => i !== titled) : ordered;
            const primary = rest.filter(i => !MINOR.has(i.cat));
            const minor = rest.filter(i => MINOR.has(i.cat));
            const MAX_PRIMARY = 5;
            const shown = primary.slice(0, MAX_PRIMARY).map(i => i.display);
            let hidden = Math.max(0, primary.length - MAX_PRIMARY);
            if (minor.length >= 2) shown.push('⚠️ ' + minor.map(i => i.label || i.display).join(' · '));
            else if (minor.length === 1) shown.push(minor[0].display);
            if (hidden > 0) shown.push(`⚠️ +${hidden} more · open for details`);
            body = shown.join('\n');
          }
          // DIGEST-LEVEL rate limit so we never out-pace Apple's throttle. Pick the
          // minimum gap since this location's LAST push by how urgent the due items
          // are: NWS warnings / tropical fire immediately (rare + life-safety);
          // a severe storm core is held to PUSH_FLOOR_MS so a persistent core can't
          // become a 5-min firehose; everything routine waits the full digest floor.
          const digestKey = ns + '__digest';
          const sinceDigest = now - (lastAlert[digestKey] || 0);
          const hardEsc = dueItems.some(i => i.cat === 'nws-warn' || i.cat === 'trop');
          const severeEsc = dueItems.some(i => (i.cat === 'sc' && i.severe) || (i.cat === 'rc' && i.severe) || i.cat === 'ltg');
          const minGap = hardEsc ? 0 : (severeEsc ? PUSH_FLOOR_MS : DIGEST_FLOOR_MS);
          if (sinceDigest < minGap) {
            console.log(`  ⏸ ${sub.name || key}: digest floor (${Math.round(sinceDigest / 60000)}m < ${Math.round(minGap / 60000)}m), ${dueItems.length} due held`);
          } else {
            const urgency = ordered.some(i => i.urgency === 'high') ? 'high' : 'normal';
            // Optional per-user AI wording: ONLY when opted in, the user supplied
            // their own key (hasKey), AND we're actually about to send (past the
            // floor) so we never spend a call on a held digest. The Worker looks
            // up that user's key and makes the call; on any failure the
            // deterministic `body` is left untouched.
            const aiCfg = aiCfgOf(sub.thresholds);
            if (aiCfg.on && aiCfg.hasKey) {
              const aiText = await aiDigestBody(ordered.map(i => i.display).filter(Boolean), sub.name || '', aiCfg.tone, sub.endpoint);
              if (aiText) body = aiText;
            }
            // UNIQUE tag per send. A fixed per-location tag let iOS silently COALESCE:
            // on a home-screen PWA, renotify:true is unreliable, so the 2nd+ push to
            // the same tag just replaced the existing notification WITHOUT re-alerting.
            // A 12h audit showed 22 pushes accepted (2xx) but only the first ~3-6 ever
            // appeared. The 15-min digest floor already prevents flooding, so giving
            // each accepted digest a distinct tag makes every alert a fresh banner.
            const payload = JSON.stringify({ title, body, tag: 'stormtracker-' + sub._locId + '-' + now, url: SITE_URL });
            const r = await trySend(sub, payload, { TTL: 1800, urgency });
            if (r === 'ok') {
              sent++; st.dirty = true; didSend = true;
              lastAlert[digestKey] = now;
              dueItems.forEach(i => i.cks.forEach(ck => { lastAlert[ns + ck] = now; }));
              console.log(`  ✓ ${sub.name || key}: digest ${ordered.length} item(s)${hardEsc || severeEsc ? ' [esc]' : ''}, reset ${dueItems.length} due`);
            } else if (r === 'dead') { st.dead = true; }
          }
        }
      }
      // Edge-state bookkeeping for changes-only mode. Adopt the CURRENT routine
      // signature set when we actually sent (the digest showed the full picture),
      // or when there were no new routine signatures to communicate (so cleared
      // threats are forgotten and unchanged ones stay quiet). If a routine change
      // was held by the digest floor, keep the previous set so it retries.
      if (changesOn && (didSend || routineAdded.length === 0)) {
        const enc = JSON.stringify(curRoutine);
        if (lastAlert[ns + '__edge'] !== enc) { lastAlert[ns + '__edge'] = enc; st.dirty = true; }
      }
    }
  }

  // Publish one RSS snapshot per code (active OR all-clear). The worker keeps the
  // live snapshot fresh and decides whether to EMIT a new item (change-ping or
  // 30-min briefing). Non-fatal — a feed failure never blocks push.
  for (const [code, fc] of feedByCode) {
    const active = fc.sigParts.length > 0;
    const title = active
      ? `🌩️ Storm update${fc.name ? ' · ' + fc.name : ''}`
      : `✅ All clear${fc.name ? ' · ' + fc.name : ''}`;
    const body = fc.sections.join('\n\n');
    const sig = active ? Array.from(new Set(fc.sigParts)).sort().join('\n') : 'clear';
    await feedUpdate(code, { title, body, sig, urgent: fc.urgent, degraded: fc.degraded, name: fc.name });
  }
  console.log(`Feed snapshots published: ${feedByCode.size}`);

  // Flush each device ONCE: prune a dead endpoint, else persist its merged
  // (all-locations) last_alert map a single time so locations don't overwrite
  // each other's cooldowns.
  for (const [endpoint, st] of epState) {
    if (st.dead) { await pruneDead(endpoint); continue; }
    if (st.dirty) await markAlert(endpoint, st.la);
  }
  console.log(`Done. Notifications sent: ${sent}`);
  return maxThreat >= 2 ? 'red' : maxThreat === 1 ? 'yellow' : 'green';
}

// Watchdog: exit CLEANLY before the workflow's 5-min job timeout so a stuck
// upstream call (or a lingering keep-alive socket holding the event loop open)
// can never let the run burn a whole slot and get killed as a red "failure".
// A timed-out cycle is transient — the next 5-min run picks up where this left.
const WATCHDOG_MS = 4 * 60 * 1000;
const watchdog = setTimeout(() => {
  console.warn(`WATCHDOG: scan exceeded ${WATCHDOG_MS / 1000}s — exiting cleanly; next run retries.`);
  process.exit(0);
}, WATCHDOG_MS);
watchdog.unref();

run()
  .then(async (tier) => {
    // Tell the Worker the strongest tier seen so it can time the next scan.
    await reportCadence(tier || 'green');
    clearTimeout(watchdog);
    // Exit explicitly so leftover keep-alive sockets can't hold the process open
    // (which would otherwise idle until the job timeout and look like a hang).
    process.exit(0);
  })
  .catch(e => {
    clearTimeout(watchdog);
    if (isRealFailure(e)) {
      fail(e.stack || e.message); // real breakage → red run → notify you
      return;
    }
    // Transient (upstream/network/timeout): log it and exit 0 so a one-off
    // hiccup doesn't cry wolf. It's still visible in the run log if you look.
    console.warn('TRANSIENT (exiting 0, next run retries):', e && (e.message || e));
    process.exit(0);
  });
