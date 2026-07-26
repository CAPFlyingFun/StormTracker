// Background Storm Push Alerts (Task #308)
// Opt-in Web Push so subscribers get notified when a storm is inbound even with
// the app/browser closed. The PWA stores the subscription on the dedicated
// Cloudflare Worker (PUSH_API_DEFAULT below — separate from the settings-sync
// server); a GitHub Actions cron scanner does the radar detection server-side
// and sends the pushes.

// v5.33 one-time migration: the three separate min-dBZ controls (storm-track
// cones, in-app Storm Cell Alerts, Background Storm Alerts push) collapsed into
// ONE shared value at st_stormThresholds.stormDbz.val (read by getConeMinDbz()).
// If a user customized ONLY the old Background-Alerts "Min strength"
// (st_pushThresholds.dbz) while leaving the shared cone/alert value at its
// default, adopt their push value so it isn't silently lost. If the shared value
// was already customized, it wins (it already drove 2 of the 3 uses in v5.32).
(function _migrateSharedMinDbz_v533(){
  try{
    if(localStorage.getItem('st_minDbzMerged_v533'))return;
    const ptRaw=localStorage.getItem('st_pushThresholds');
    const pt=ptRaw?JSON.parse(ptRaw):null;
    const legacy=(pt&&typeof pt.dbz==='number')?pt.dbz:null;
    if(legacy!=null){
      const st=JSON.parse(localStorage.getItem('st_stormThresholds')||'{}');
      const curRaw=(st.stormDbz&&st.stormDbz.val!=null)?parseFloat(st.stormDbz.val):NaN;
      const cur=isNaN(curRaw)?null:curRaw;
      // Only adopt the legacy push value when the shared value is still default
      // (40) or unset — i.e. the user never customized cones/in-app intensity.
      if((cur==null||cur===40)&&legacy!==40){
        const snap=Math.max(20,Math.min(60,Math.round(legacy/5)*5));
        if(!st.stormDbz)st.stormDbz={on:false,val:snap};else st.stormDbz.val=snap;
        localStorage.setItem('st_stormThresholds',JSON.stringify(st));
      }
    }
    localStorage.setItem('st_minDbzMerged_v533','1');
  }catch(e){}
})();

// Persistent VAPID public key (private half lives only in the scanner secrets).
const PUSH_VAPID_PUBLIC_KEY = 'BEZD0oSMhA2lWQAlaR0sRl8hsmaRL6ioKRxNDCPwHxcKMQuvYGJeUxbyIxsazG3O2OfIgXTAma4TZevHcAe7VM4';

// Deployed Cloudflare Worker that stores push subscriptions in D1. The push API
// (/subscribe, /unsubscribe) lives ONLY on this worker, so push always targets it
// — independent of the settings-sync server URL. Override with st_pushApiUrl.
const PUSH_API_DEFAULT = 'https://stormtracker-proxy.joshua-622.workers.dev';

function _pushApiUrl() {
  // Priority: explicit push override -> baked worker default. We deliberately do
  // NOT fall back to st_syncApiUrl: a stale/other sync URL there returns 404
  // ("Not found") for /subscribe, which previously blocked enabling alerts.
  try {
    const override = localStorage.getItem('st_pushApiUrl');
    if (override) return override.replace(/\/+$/, '');
    return PUSH_API_DEFAULT;
  } catch (e) { return PUSH_API_DEFAULT; }
}
function _getPushSub() { try { return JSON.parse(localStorage.getItem('st_pushSub') || 'null'); } catch (e) { return null; } }
function _setPushSub(v) { try { v ? localStorage.setItem('st_pushSub', JSON.stringify(v)) : localStorage.removeItem('st_pushSub'); } catch (e) {} }
// Durable per-device manage code. Unlike st_pushSub (which Disable clears), this
// survives enable/disable cycles, so RE-enabling reclaims the SAME code instead of
// minting a new one each time. The worker reuses any code we send back as long as
// it's still free — and Disable deletes our D1 row, which frees the code — so the
// user's shareable manage code stays stable for the life of the install.
function _getPushCode() { try { return (localStorage.getItem('st_pushCode') || '').toUpperCase(); } catch (e) { return ''; } }
function _setPushCode(c) { try { if (c) localStorage.setItem('st_pushCode', String(c).toUpperCase()); } catch (e) {} }
// Private 128-bit RSS feed token (minted by the worker, mapped to this device's
// code). Kept separate from the manage code so a feed URL pasted into a reader
// can't be used to manage/unsubscribe. Cached so the copy button is instant.
// Bound to the manage code so a stale token (e.g. after a re-enable hands back a
// new code) is discarded and re-minted instead of pointing at the wrong feed.
function _getFeedToken(code) {
  try {
    const raw = localStorage.getItem('st_pushFeedToken') || '';
    if (!raw) return '';
    if (raw[0] === '{') { const o = JSON.parse(raw); return (o && (!code || o.code === code)) ? (o.t || '') : ''; }
    return code ? '' : raw; // legacy bare token: re-mint when we can verify the code
  } catch (e) { return ''; }
}
function _setFeedToken(t, code) { try { if (t) localStorage.setItem('st_pushFeedToken', JSON.stringify({ t: String(t), code: code || '' })); } catch (e) {} }
// Durable previous endpoint, also kept through Disable. If a flaky-network
// /unsubscribe failed and left our old D1 row alive, re-enable can hand the worker
// this endpoint + code so it MOVES that row (verified by endpoint+code) onto the
// fresh endpoint instead of minting a new code.
function _getPushEndpoint() { try { return localStorage.getItem('st_pushEndpoint') || ''; } catch (e) { return ''; } }
function _setPushEndpoint(ep) { try { if (ep) localStorage.setItem('st_pushEndpoint', String(ep)); } catch (e) {} }
function _getPushThresholds() {
  try { const s = JSON.parse(localStorage.getItem('st_pushThresholds') || 'null'); if (s) return s; } catch (e) {}
  return { dbz: 40, impact: 50, radius: 60, nws: true };
}
function _savePushThresholds(t) { try { localStorage.setItem('st_pushThresholds', JSON.stringify(t)); } catch (e) {} }

// The user's in-app weather threshold settings (Alerts tab) — sent with the
// subscription so the server-side scan evaluates them identically.
function _pushWxCfg() {
  try { const s = JSON.parse(localStorage.getItem('st_wxThresholds') || 'null'); return (s && typeof s === 'object') ? s : {}; }
  catch (e) { return {}; }
}
// Unit prefs travel too, so the scanner converts metric data into the same
// units the thresholds were set in.
function _pushUnits() {
  try { return { temp: S.tempUnit || 0, wind: S.windUnit || 0, pres: S.presUnit || 0, vis: S.visUnit || 0, precip: S.precipUnit || 0 }; }
  catch (e) { return { temp: 0, wind: 0, pres: 0, vis: 0, precip: 0 }; }
}
// Tropical proximity radius mirrors the in-app NHC tracking setting so background
// tropical pushes use the same "within X mi / in the cone" rule as the live map.
function _pushTropRadius() {
  try { const v = parseInt(localStorage.getItem('st_nhc_prox_radius'), 10); return v > 0 ? v : 200; }
  catch (e) { return 200; }
}
// NWS re-notify cadence per severity tier (minutes). Mirrors nwsCfgOf() in
// scanner/scan.js. Backward compatible: a legacy boolean `nws` (or missing) means
// on-with-defaults; `false` means off. advMin === 0 turns advisories off.
const _NWS_DEF = { warnMin: 30, watchMin: 120, advMin: 360 };
function _nwsCfg(th) {
  const n = th && th.nws;
  if (n === false) return { on: false, ..._NWS_DEF };
  if (n && typeof n === 'object') return {
    on: n.on !== false,
    warnMin: parseInt(n.warnMin, 10) || _NWS_DEF.warnMin,
    watchMin: parseInt(n.watchMin, 10) || _NWS_DEF.watchMin,
    advMin: (n.advMin === 0 ? 0 : (parseInt(n.advMin, 10) || _NWS_DEF.advMin)),
  };
  return { on: true, ..._NWS_DEF };
}
function _tropOn(th) { const t = th && th.tropical; return t === false ? false : ((t && typeof t === 'object') ? t.on !== false : true); }
function _tropEveryH(th) { const t = th && th.tropical; return (t && typeof t === 'object' && parseInt(t.everyH, 10) > 0) ? parseInt(t.everyH, 10) : 6; }
// v6.55: storms the user archived/deleted/purged in the 📢 panel. Sent with the
// push config so the background scanner stops pushing a system the user has
// explicitly dismissed — previously the archive was in-app only, so a deleted
// storm kept firing phone notifications (the scanner runs server-side and never
// saw the decision). Re-sent on every config sync, so it stays current.
function _mutedStormIds() {
  try {
    const lc = JSON.parse(localStorage.getItem('st_stormLifecycle') || '{}') || {};
    return Object.keys(lc).filter(id => { const st = lc[id] && lc[id].state; return st === 'archived' || st === 'deleted' || st === 'purged'; }).slice(0, 60);
  } catch (e) { return []; }
}
// Awareness toggle (strong storms nearby but NOT heading at you). Mirrors
// areaCfgOf() in scanner/scan.js: absent/legacy => ON, `false` => off, `{on}` obj.
function _areaCfg(th) {
  const a = th && th.area;
  if (a === false) return { on: false };
  if (a && typeof a === 'object') return { on: a.on !== false };
  return { on: true };
}
// AI-written alert wording (opt-in, default OFF). Mirrors aiCfgOf() in
// scanner/scan.js: only `{on:true}` enables it; absent/false/legacy => off.
// AI-written background alerts use the user's OWN OpenAI key (never the
// developer's), so the key travels in the subscribe payload and is stored
// encrypted server-side. `_aiCfg` reports both the on flag and whether a key is
// present on this device.
function _aiCfg(th) {
  const a = th && th.ai;
  if (a && typeof a === 'object' && a.on === true) return { on: true, hasKey: !!_getPushAiKey() };
  return { on: false, hasKey: !!_getPushAiKey() };
}
function _aiTone() { try { return (typeof getAITone === 'function') ? getAITone() : 'professional'; } catch (e) { return 'professional'; } }
// The user's personal OpenAI key for AI-written background alerts. Stored ONLY on
// this device (localStorage); it is also sent to the alert server (over HTTPS,
// stored encrypted) so notifications can be written while the app is closed.
// Push alerts reuse your AI Assistant key by default so you only manage ONE
// OpenAI key. _getPushAiKeyOwn() is the key explicitly typed into the push box
// (what the input field shows). _getPushAiKey() is the EFFECTIVE key used to
// write background alerts: the push-specific key if you set one, otherwise the
// AI Assistant key (st_aiKey). Paste a separate key in the push box only if you
// want background alerts billed to a different key than the in-app assistant.
function _getPushAiKeyOwn() { try { return (localStorage.getItem('st_pushAiKey') || '').trim(); } catch (e) { return ''; } }
function _getPushAiKey() { try { return _getPushAiKeyOwn() || ((typeof getActiveAIKey === 'function') ? getActiveAIKey().trim() : ''); } catch (e) { return ''; } }
// Which provider the background alert server should use to write this device's
// digests. Mirrors the in-app AI provider selection (OpenAI default). There is
// ONE push key override (st_pushAiKey); if set, it MUST match this provider.
function _pushAiProvider() { try { return (typeof getAIProvider === 'function') ? getAIProvider() : 'openai'; } catch (e) { return 'openai'; } }
function _pushAiProviderLabel() { return _pushAiProvider() === 'anthropic' ? 'Claude' : 'OpenAI'; }
// "Only notify on changes" (edge-triggered cadence), opt-in, default OFF. Mirrors
// changesCfgOf() in scanner/scan.js — it only affects the background scanner's
// SEND TIMING (notify when the situation changes; severe/warnings/lightning still
// break through), so there is no in-app runtime equivalent; the flag just rides
// along in the subscription thresholds.
function _changesCfg(th) {
  const c = th && th.changes;
  return { on: !!(c && typeof c === 'object' && c.on === true) };
}
// Intensity bands + rain-overhead toggle (st_alertBands) travel with the
// subscription so the scanner gates inbound storm pushes and the "rain over you"
// push by the same on/off + per-band cadence the app uses. Null when never set —
// the scanner then falls back to its own defaults (all bands on, rovOn true).
function _pushBands() {
  try { const s = JSON.parse(localStorage.getItem('st_alertBands') || 'null'); return (s && typeof s === 'object') ? s : null; }
  catch (e) { return null; }
}

function _urlB64ToUint8(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// True only if an existing PushSubscription was created with the SAME VAPID key
// we use now. After a key rotation a stale subscription keeps the old key and can
// never receive our pushes — so we must detect and replace it.
function _subKeyMatches(sub, wantBytes) {
  try {
    const cur = sub && sub.options && sub.options.applicationServerKey;
    if (!cur) return false;
    const a = new Uint8Array(cur);
    if (a.length !== wantBytes.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== wantBytes[i]) return false;
    return true;
  } catch (e) { return false; }
}

// Get a push subscription that is guaranteed to use the CURRENT VAPID key,
// re-subscribing if a stale-key subscription exists. Handles iOS throwing
// InvalidStateError when a subscription with a different key is still present.
async function _ensureFreshSubscription(reg) {
  const wantKey = _urlB64ToUint8(PUSH_VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !_subKeyMatches(sub, wantKey)) {
    try { await sub.unsubscribe(); } catch (e) {}
    sub = null;
  }
  if (sub) return sub;
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wantKey });
  } catch (e) {
    // A subscription with a different key may still linger — drop it and retry once.
    const stale = await reg.pushManager.getSubscription();
    if (stale) { try { await stale.unsubscribe(); } catch (_) {} }
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wantKey });
  }
}

function _pushLoc() {
  let home = null;
  try { home = (typeof getHomeLocation === 'function') ? getHomeLocation() : null; } catch (e) {}
  if (home && typeof home.lat === 'number') return { lat: home.lat, lon: home.lon, name: home.name || 'Home' };
  if (S && typeof S.lat === 'number') return { lat: S.lat, lon: S.lon, name: S.locName || 'Current location' };
  return null;
}

// --- Per-location (saved favorites) background alerts ---------------------
// Each saved location gets its own 🔔/🔕 toggle. The enabled ones travel with
// the subscription (thresholds.locs) so the background scanner sends a separate,
// location-headed notification for each. State is a simple { locId: true } map.
function pushLocId(lat, lon) { return `${(+lat).toFixed(3)},${(+lon).toFixed(3)}`; }
function _pushLocState() {
  try { const o = JSON.parse(localStorage.getItem('st_pushLocs') || '{}'); return (o && typeof o === 'object') ? o : {}; }
  catch (e) { return {}; }
}
function _setPushLocEnabled(id, on) {
  const o = _pushLocState();
  if (on) o[id] = true; else delete o[id];
  try { localStorage.setItem('st_pushLocs', JSON.stringify(o)); } catch (e) {}
}
function isPushLocOn(lat, lon) { return !!_pushLocState()[pushLocId(lat, lon)]; }
// Saved locations (favorites) the user switched alerts ON for, capped at 5.
function _enabledPushLocs() {
  const state = _pushLocState();
  let favs = [];
  try { favs = (typeof getFavorites === 'function') ? getFavorites() : []; } catch (e) {}
  const out = [];
  for (const f of favs) {
    if (typeof f.lat !== 'number' || typeof f.lon !== 'number') continue;
    const id = pushLocId(f.lat, f.lon);
    if (state[id]) out.push({ id, lat: f.lat, lon: f.lon, name: f.name || 'Saved location' });
    if (out.length >= 5) break;
  }
  return out;
}
// The full watch set: the bell-enabled favorites, or — for backward
// compatibility when none are chosen — the single Home/current location.
function _watchedPushLocs() {
  const locs = _enabledPushLocs();
  if (locs.length) return locs;
  const home = _pushLoc();
  return home ? [{ id: pushLocId(home.lat, home.lon), lat: home.lat, lon: home.lon, name: home.name }] : [];
}

// Full-screen "please wait" overlay with a live count-up timer, shown while a
// foreground enable/disable/update is in flight. A 30s safety timeout clears it
// and refreshes the panel if the operation stalls (e.g. permission prompt hangs).
let _pushBusyTimer = null, _pushBusySafety = null, _pushBusyStart = 0, _pushOpInFlight = false;
function _showPushBusy(label) {
  _hidePushBusy();
  _pushOpInFlight = true;
  _pushBusyStart = Date.now();
  let el = document.getElementById('pushBusyOverlay');
  if (!el) {
    if (!document.getElementById('pushBusyStyle')) {
      const s = document.createElement('style'); s.id = 'pushBusyStyle';
      s.textContent = '@keyframes pushBusySpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    el = document.createElement('div');
    el.id = 'pushBusyOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)';
    el.innerHTML = `
      <div style="background:var(--bg-card,#15171c);border:1px solid var(--border,#2a2d34);border-radius:14px;padding:22px 26px;max-width:280px;text-align:center;box-shadow:0 10px 34px rgba(0,0,0,0.55)">
        <div style="width:34px;height:34px;margin:0 auto 12px;border:3px solid var(--border,#2a2d34);border-top-color:var(--accent-green,#39d98a);border-radius:50%;animation:pushBusySpin 0.8s linear infinite"></div>
        <div id="pushBusyLabel" style="font-weight:700;color:var(--text,#e8eaed);font-size:0.95em;line-height:1.3">Updating…</div>
        <div id="pushBusyTimer" style="margin-top:7px;font-family:var(--font-mono,monospace);color:var(--text-muted,#9aa0a6);font-size:0.85em">0s</div>
      </div>`;
    document.body.appendChild(el);
  }
  el.querySelector('#pushBusyLabel').textContent = label || 'Updating your notification settings, please wait…';
  const timerEl = el.querySelector('#pushBusyTimer');
  el.style.display = 'flex';
  const tick = () => { timerEl.textContent = Math.floor((Date.now() - _pushBusyStart) / 1000) + 's'; };
  tick();
  _pushBusyTimer = setInterval(tick, 250);
  _pushBusySafety = setTimeout(() => {
    _hidePushBusy();
    try { syncSettingsPanel(); } catch (e) {}
    toast('⏱️ Still working… settings refreshed — please try again if needed.');
  }, 30000);
}
function _hidePushBusy() {
  _pushOpInFlight = false;
  if (_pushBusyTimer) { clearInterval(_pushBusyTimer); _pushBusyTimer = null; }
  if (_pushBusySafety) { clearTimeout(_pushBusySafety); _pushBusySafety = null; }
  const el = document.getElementById('pushBusyOverlay');
  if (el) el.style.display = 'none';
}

// POST to the push worker with a generous timeout and one automatic retry.
// Weak / handoff-prone LTE can make the first TLS connection to the worker exceed
// a tight timeout (Safari surfaces that as "Fetch is aborted"); a retry plus a
// longer budget makes enabling alerts reliable on mobile data.
async function _pushPost(url, body, { timeout = 20000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      lastErr = e;
      const transient = e && (e.name === 'AbortError' || e.name === 'TypeError' || /abort|network|load failed/i.test(e.message || ''));
      if (attempt < retries && transient) continue;
      throw e;
    }
  }
  throw lastErr;
}

// Copy this device's private RSS feed URL. Fetches+caches the feed token on first
// use (endpoint-only proof, same safe path as the test push), then copies the
// /feed?token=... URL so it can be pasted into any RSS reader as a pull-based
// backup for the (flaky on iOS) push notifications.
async function copyRssFeed(btn) {
  const sub = _getPushSub();
  if (!sub || !sub.endpoint) { toast('⚠️ Turn on background alerts first'); return; }
  const orig = btn && btn.textContent;
  try {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Getting link…'; }
    let token = _getFeedToken(sub.code);
    if (!token) {
      const r = await _pushPost(_pushApiUrl() + '/feed-token', { endpoint: sub.endpoint });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) throw new Error(d.error || ('HTTP ' + r.status));
      token = d.token; _setFeedToken(token, sub.code);
    }
    const url = _pushApiUrl() + '/feed?token=' + encodeURIComponent(token);
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (e) {}
    if (!copied) { try { window.prompt('Copy your RSS feed link:', url); copied = true; } catch (e) {} }
    toast(copied ? '📡 RSS link copied — paste it into your RSS reader' : '⚠️ Could not copy link');
  } catch (e) {
    toast('⚠️ Could not get RSS link: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; if (orig) btn.textContent = orig; }
  }
}

async function enablePushAlerts(silent, opts) {
  const base = _pushApiUrl();
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { if (!silent) toast('⚠️ Push not supported on this device'); return; }
  const watch = _watchedPushLocs();
  if (!watch.length) { if (!silent) toast('📍 Set a home location or turn on 🔔 for a saved location first'); return; }
  const loc = watch[0];
  if (!silent) {
    if (_pushOpInFlight) return; // ignore double-clicks while one action is running
    _showPushBusy('Updating your notification settings, please wait…');
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { if (!silent) toast('🔕 Notification permission denied'); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await _ensureFreshSubscription(reg);
    const th = _getPushThresholds();
    const existing = _getPushSub();
    const prevEndpoint = (existing && existing.endpoint) || _getPushEndpoint();
    const body = {
      subscription: sub.toJSON(),
      lat: loc.lat, lon: loc.lon, name: loc.name,
      thresholds: {
        dbz: (typeof getConeMinDbz === 'function') ? getConeMinDbz() : th.dbz, impact: th.impact, dist: th.radius, radius: th.radius,
        wx: _pushWxCfg(), units: _pushUnits(),
        nws: (() => { const c = _nwsCfg(th); return c.on ? { on: true, warnMin: c.warnMin, watchMin: c.watchMin, advMin: c.advMin } : false; })(),
        bands: _pushBands(),
        tropical: { on: _tropOn(th), radius: _pushTropRadius(), everyH: _tropEveryH(th), muted: _mutedStormIds() },
        area: { on: _areaCfg(th).on },
        ai: _aiCfg(th).on ? { on: true, tone: _aiTone(), provider: _pushAiProvider(), key: _getPushAiKey() || undefined } : false,
        changes: _changesCfg(th).on ? { on: true } : false,
        tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; } })(),
        h24: (typeof _is24h === 'function') ? _is24h() : false,
        locs: watch,
      },
      code: (existing && existing.code) ? existing.code : (_getPushCode() || undefined),
      // If the browser minted a fresh endpoint (key change / reinstall), tell the
      // worker our previous endpoint so it MOVES that row here instead of leaving
      // a stale duplicate that splits delivery and trips Apple's push throttle.
      oldEndpoint: (prevEndpoint && prevEndpoint !== sub.endpoint) ? prevEndpoint : undefined,
      // On a manual reset / on-open refresh, ask the worker to clear the routine
      // digest cooldown so the next scan re-confirms delivery within minutes
      // instead of waiting out the ~45-minute floor.
      reset: (opts && opts.reset) ? true : undefined,
    };
    const res = await _pushPost(base + '/subscribe', body, { timeout: 14000, retries: 1 });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'subscribe failed');
    _setPushSub({ endpoint: sub.endpoint, code: data.code, lat: loc.lat, lon: loc.lon, name: loc.name, locs: watch });
    _setPushCode(data.code);
    _setPushEndpoint(sub.endpoint);
    if (!silent) toast((opts && opts.okMsg) || '🔔 Background storm alerts enabled');
  } catch (e) {
    console.log('[push] enable failed:', e.message);
    if (!silent) {
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
      toast(aborted
        ? '⚠️ Couldn’t reach the alert server — connection too slow. Please try again, ideally on Wi-Fi.'
        : '⚠️ Could not enable alerts: ' + e.message);
    }
  } finally {
    if (!silent) _hidePushBusy();
    syncSettingsPanel();
  }
}

async function disablePushAlerts() {
  const base = _pushApiUrl();
  const cur = _getPushSub();
  if (_pushOpInFlight) return; // ignore double-clicks while one action is running
  _showPushBusy('Turning off notifications, please wait…');
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    if (base && (cur || sub)) {
      await _pushPost(base + '/unsubscribe', { endpoint: (sub && sub.endpoint) || (cur && cur.endpoint) }, { timeout: 12000, retries: 1 });
    }
  } catch (e) { console.log('[push] disable:', e.message); }
  finally { _hidePushBusy(); }
  _setPushSub(null);
  toast('🔕 Background alerts disabled');
  syncSettingsPanel();
}

// "Send test notification" — delivers a REAL push through the same server-side
// scanner pipeline as live alerts (not a fake local popup), so it genuinely
// confirms end-to-end delivery. The worker flags the test and nudges the scanner;
// it arrives within ~1 min.
async function sendTestPush() {
  const sub = _getPushSub();
  if (!sub || !sub.endpoint) { toast('🔕 Turn on background alerts first'); return; }
  const base = _pushApiUrl();
  const btn = document.getElementById('push-test-btn');
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = '📨 Sending…'; }
  try {
    const res = await _pushPost(base + '/test', { endpoint: sub.endpoint }, { timeout: 12000, retries: 1 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'test failed');
    toast('✅ Test sent — watch for the notification (up to ~1 min). If nothing arrives, check that notifications are allowed in your device settings.', 6500);
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
    toast(aborted
      ? '⚠️ Couldn’t reach the alert server — connection too slow. Please try again, ideally on Wi-Fi.'
      : '⚠️ Could not send test: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔔 Send test notification'; }
  }
}

// Manual "Re-subscribe / reset" — drops the current browser subscription so the
// next subscribe mints a BRAND-NEW endpoint. On iOS this resets Apple's per-PWA
// delivery budget (the throttle that silently stops SHOWING notifications even
// though the subscription stays alive). The previous endpoint is still in storage,
// so enablePushAlerts() sends it as oldEndpoint and the worker MOVES the row —
// manage code, thresholds & watched locations are all preserved.
async function resubscribePushAlerts() {
  if (_pushOpInFlight) return; // an enable/disable/reset is already running
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('⚠️ Push not supported on this device'); return; }
  if (!_getPushSub()) { toast('🔕 Turn on background alerts first'); return; }
  const btn = document.getElementById('push-reset-btn');
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = '🔄 Resetting…'; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const old = await reg.pushManager.getSubscription();
    if (old) { try { await old.unsubscribe(); } catch (e) {} }
  } catch (e) { console.log('[push] reset unsubscribe:', e.message); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🔄 Re-subscribe'; } }
  await enablePushAlerts(false, { okMsg: '🔄 Notifications reset — re-subscribed with a fresh connection', reset: true });
}

// Single slide-toggle handler: flipping ON enables (subscribes), OFF disables.
function togglePushAlerts(want) {
  if (_pushOpInFlight) return; // a tap is already being processed
  if (want) enablePushAlerts();
  else disablePushAlerts();
}

function setPushThreshold(key, val) {
  if (key === 'dbz') {
    // Shared min-strength dBZ: one number drives background push, the storm-track
    // cone floor and the in-app storm-cell intensity gate. Write it through the
    // shared setter (clamps 20-60/step-5, re-renders cones + storms + the storm-
    // cell panel), then sync the subscription so the scanner uses the same value.
    if (typeof setConeMinDbz === 'function') setConeMinDbz(val);
    if (_getPushSub()) enablePushAlerts(true);
    else syncSettingsPanel();
    return;
  }
  const th = _getPushThresholds();
  th[key] = parseInt(val, 10);
  _savePushThresholds(th);
  // If already subscribed, push the new thresholds to the server.
  if (_getPushSub()) enablePushAlerts(true);
  else syncSettingsPanel();
}

function _afterPushCfg() { if (_getPushSub()) enablePushAlerts(true); else syncSettingsPanel(); }

function setPushNws(on) {
  const th = _getPushThresholds();
  const c = _nwsCfg(th); c.on = !!on;
  th.nws = { on: c.on, warnMin: c.warnMin, watchMin: c.watchMin, advMin: c.advMin };
  _savePushThresholds(th); _afterPushCfg();
}
function setPushNwsCad(tier, val) {
  const th = _getPushThresholds();
  const c = _nwsCfg(th); const v = parseInt(val, 10);
  if (tier === 'warn') c.warnMin = v; else if (tier === 'watch') c.watchMin = v; else c.advMin = v;
  th.nws = { on: c.on, warnMin: c.warnMin, watchMin: c.watchMin, advMin: c.advMin };
  _savePushThresholds(th); _afterPushCfg();
}
function setPushTropical(on) {
  const th = _getPushThresholds();
  th.tropical = { on: !!on, everyH: _tropEveryH(th) };
  _savePushThresholds(th); _afterPushCfg();
}
function setPushTropEvery(val) {
  const th = _getPushThresholds();
  th.tropical = { on: _tropOn(th), everyH: parseInt(val, 10) };
  _savePushThresholds(th); _afterPushCfg();
}
function setPushArea(on) {
  const th = _getPushThresholds();
  th.area = { on: !!on };
  _savePushThresholds(th); _afterPushCfg();
}
function setPushAi(on) {
  const th = _getPushThresholds();
  th.ai = { on: !!on };
  _savePushThresholds(th);
  if (on && !_getPushAiKey()) toast('🔑 Add a ' + _pushAiProviderLabel() + ' key (here or in AI Assistant) to activate AI alerts');
  _afterPushCfg();
}
// Save (or clear) the user's personal OpenAI key. Fires on blur of the key field.
// Re-pushes the subscription so the alert server stores the new key, then
// re-renders the panel so the "add your key" hint and Test status reflect it.
function setPushAiKey(v) {
  const k = (v || '').trim();
  try { if (k) localStorage.setItem('st_pushAiKey', k); else localStorage.removeItem('st_pushAiKey'); } catch (e) {}
  toast(k ? '🔑 ' + _pushAiProviderLabel() + ' key saved on this device' : '🔑 ' + _pushAiProviderLabel() + ' key removed');
  _afterPushCfg();
}
function togglePushAiKeyVis() {
  const el = document.getElementById('push-ai-key');
  if (el) el.type = (el.type === 'password') ? 'text' : 'password';
}
// Validate a key straight from the browser with a cheap GET /v1/models call, so
// the user gets instant confirmation it works before relying on it for alerts.
async function testPushAiKey() {
  const el = document.getElementById('push-ai-key');
  const status = document.getElementById('push-ai-key-status');
  const setMsg = (msg, color) => { if (status) { status.textContent = msg; status.style.color = color; } };
  const k = (((el && el.value) || _getPushAiKey()) || '').trim();
  if (!k) { setMsg('Enter a key first', 'var(--accent-yellow)'); return; }
  setMsg('Testing…', 'var(--text-muted)');
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const prov = _pushAiProvider();
    let r;
    if (prov === 'anthropic') {
      r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, signal: ctrl.signal });
    } else {
      r = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': 'Bearer ' + k }, signal: ctrl.signal });
    }
    clearTimeout(to);
    if (r.ok) setMsg('✓ Key works', 'var(--accent-green)');
    else if (r.status === 401) setMsg('✗ Key was rejected — check it', 'var(--accent-red)');
    else if (r.status === 429) setMsg('✗ No credit / rate-limited — add billing', 'var(--accent-red)');
    else setMsg('✗ ' + _pushAiProviderLabel() + ' error ' + r.status, 'var(--accent-red)');
  } catch (e) {
    setMsg('✗ Could not reach ' + _pushAiProviderLabel(), 'var(--accent-red)');
  }
}
function setPushChangesOnly(on) {
  const th = _getPushThresholds();
  th.changes = { on: !!on };
  _savePushThresholds(th); _afterPushCfg();
}

let _pushSyncTimer = null;
// Called from in-app Alerts/unit changes: silently re-push the subscription
// (debounced) so the background scanner always evaluates the user's CURRENT
// weather thresholds + unit prefs. No-op when not subscribed.
function syncPushAlerts() {
  try {
    if (!_getPushSub()) return;
    clearTimeout(_pushSyncTimer);
    _pushSyncTimer = setTimeout(() => { enablePushAlerts(true); }, 1500);
  } catch (e) {}
}

function renderPushAlertSettings() {
  const sub = _getPushSub();
  const th = _getPushThresholds();
  const loc = _pushLoc();
  const opt = (v, sel) => `<option value="${v}"${v === sel ? ' selected' : ''}>`;
  const nc = _nwsCfg(th);
  const tropOn = _tropOn(th);
  const tropH = _tropEveryH(th);
  const areaOn = _areaCfg(th).on;
  const aiOn = _aiCfg(th).on;
  const changesOnly = _changesCfg(th).on;
  const on = !!sub;
  const toggle = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:7px;font-weight:700;color:${on ? 'var(--accent-green)' : 'var(--text-muted)'}">
        <span style="width:10px;height:10px;border-radius:50%;flex:0 0 auto;background:${on ? 'var(--accent-green)' : 'var(--text-muted)'};${on ? 'box-shadow:0 0 7px var(--accent-green)' : ''}"></span>
        Background alerts ${on ? 'ON' : 'OFF'}
      </div>
      <button role="switch" aria-checked="${on}" aria-label="Toggle background storm alerts" onclick="togglePushAlerts(${!on})" style="position:relative;width:52px;height:30px;border-radius:15px;border:1px solid ${on ? 'var(--accent-green)' : 'var(--border-subtle)'};background:${on ? 'rgba(57,217,138,0.22)' : 'rgba(255,255,255,0.06)'};cursor:pointer;flex:0 0 auto;transition:background .2s,border-color .2s;padding:0">
        <span style="position:absolute;top:2px;left:${on ? '24px' : '2px'};width:24px;height:24px;border-radius:50%;background:${on ? 'var(--accent-green)' : 'var(--text-muted)'};transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,0.45)"></span>
      </button>
    </div>`;
  // Shared min-strength dBZ — one number drives background push, the storm-track
  // cone floor and the in-app storm-cell intensity gate (getConeMinDbz()).
  const _smd = (typeof getConeMinDbz === 'function') ? getConeMinDbz() : (th.dbz || 40);
  const controls = `
    <div class="setting-row-6"><span class="text-xxs-muted">Min strength (dBZ)</span>
      <select class="small-btn" onchange="setPushThreshold('dbz',this.value)">
        ${opt(20, _smd)}20</option>${opt(25, _smd)}25</option>${opt(30, _smd)}30</option>${opt(35, _smd)}35</option>${opt(40, _smd)}40</option>${opt(45, _smd)}45</option>${opt(50, _smd)}50</option>${opt(55, _smd)}55</option>${opt(60, _smd)}60</option>
      </select></div>
    <div class="setting-hint" style="font-size:0.7em;margin-top:2px">This <b>Min strength</b> is shared — it also sets the 🎯 storm-track cone floor and the 🌩️ Storm Cell Alerts intensity. 20–60 dBZ in steps of 5.</div>
    <div class="setting-row-6"><span class="text-xxs-muted">Min impact</span>
      <select class="small-btn" onchange="setPushThreshold('impact',this.value)">
        ${opt(30, th.impact)}30%</option>${opt(50, th.impact)}50%</option>${opt(70, th.impact)}70%</option>
      </select></div>
    <div class="setting-row-6"><span class="text-xxs-muted">Watch radius</span>
      <select class="small-btn" onchange="setPushThreshold('radius',this.value)">
        ${opt(30, th.radius)}30 mi</option>${opt(50, th.radius)}50 mi</option>${opt(60, th.radius)}60 mi</option>${opt(80, th.radius)}80 mi</option>
      </select></div>
    <div class="setting-row-6"><span class="text-xxs-muted">NWS alerts</span>
      <button class="small-btn" onclick="setPushNws(${!nc.on})" style="${nc.on ? 'color:var(--accent-green);border-color:var(--accent-green)' : 'color:var(--text-muted)'}">${nc.on ? 'ON' : 'OFF'}</button>
    </div>
    ${nc.on ? `
    <div class="setting-row-6"><span class="text-xxs-muted" style="padding-left:10px">↳ Warnings repeat</span>
      <select class="small-btn" onchange="setPushNwsCad('warn',this.value)">
        ${opt(15, nc.warnMin)}every 15 min</option>${opt(30, nc.warnMin)}every 30 min</option>${opt(60, nc.warnMin)}every 1 h</option>${opt(120, nc.warnMin)}every 2 h</option>
      </select></div>
    <div class="setting-row-6"><span class="text-xxs-muted" style="padding-left:10px">↳ Watches repeat</span>
      <select class="small-btn" onchange="setPushNwsCad('watch',this.value)">
        ${opt(30, nc.watchMin)}every 30 min</option>${opt(60, nc.watchMin)}every 1 h</option>${opt(120, nc.watchMin)}every 2 h</option>${opt(240, nc.watchMin)}every 4 h</option>${opt(360, nc.watchMin)}every 6 h</option>
      </select></div>
    <div class="setting-row-6"><span class="text-xxs-muted" style="padding-left:10px">↳ Advisories repeat</span>
      <select class="small-btn" onchange="setPushNwsCad('adv',this.value)">
        ${opt(0, nc.advMin)}off</option>${opt(60, nc.advMin)}every 1 h</option>${opt(180, nc.advMin)}every 3 h</option>${opt(360, nc.advMin)}every 6 h</option>${opt(720, nc.advMin)}every 12 h</option>
      </select></div>` : ''}
    <div class="setting-row-6"><span class="text-xxs-muted">Tropical systems</span>
      <button class="small-btn" onclick="setPushTropical(${!tropOn})" style="${tropOn ? 'color:var(--accent-green);border-color:var(--accent-green)' : 'color:var(--text-muted)'}">${tropOn ? 'ON' : 'OFF'}</button>
    </div>
    ${tropOn ? `
    <div class="setting-row-6"><span class="text-xxs-muted" style="padding-left:10px">↳ Tropical repeat</span>
      <select class="small-btn" onchange="setPushTropEvery(this.value)">
        ${opt(3, tropH)}every 3 h</option>${opt(6, tropH)}every 6 h</option>${opt(9, tropH)}every 9 h</option>${opt(12, tropH)}every 12 h</option>
      </select></div>` : ''}
    <div class="setting-row-6"><span class="text-xxs-muted">Nearby strong storms</span>
      <button class="small-btn" onclick="setPushArea(${!areaOn})" style="${areaOn ? 'color:var(--accent-green);border-color:var(--accent-green)' : 'color:var(--text-muted)'}">${areaOn ? 'ON' : 'OFF'}</button>
    </div>
    <div class="setting-row-6"><span class="text-xxs-muted">AI-written alerts</span>
      <button class="small-btn" onclick="setPushAi(${!aiOn})" style="${aiOn ? 'color:var(--accent-green);border-color:var(--accent-green)' : 'color:var(--text-muted)'}">${aiOn ? 'ON' : 'OFF'}</button>
    </div>
    <div class="setting-hint" style="font-size:0.7em;margin-top:2px"><b>AI-written alerts</b> rephrases each notification into one short, natural sentence. It uses <b>your own</b> ${_pushAiProviderLabel()} key — the same one as the AI Assistant by default — so it's billed to your account, not shared. Off by default; the most urgent threat always stays first, and if the AI is ever unavailable you still get the normal wording.</div>
    ${aiOn ? `
    <div class="setting-row-6" style="align-items:center"><span class="text-xxs-muted">Your ${_pushAiProviderLabel()} key</span>
      <span style="display:flex;gap:4px;align-items:center;flex:1;justify-content:flex-end">
        <input id="push-ai-key" type="password" value="${escHtml(_getPushAiKeyOwn())}" placeholder="${_pushAiProvider()==='anthropic'?'sk-ant-… (optional — reuses AI Assistant key)':'sk-… (optional — reuses AI Assistant key)'}" autocomplete="off" autocapitalize="off" spellcheck="false" onchange="setPushAiKey(this.value)" style="flex:1;max-width:170px;background:var(--bg-input,#10151f);border:1px solid var(--border-subtle,#2a3343);color:var(--text-main,#e6edf3);border-radius:6px;padding:3px 7px;font-size:0.82em;font-family:var(--font-mono)">
        <button class="small-btn" onclick="togglePushAiKeyVis()" title="Show/hide" style="padding:2px 7px">👁</button>
      </span>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:3px;flex-wrap:wrap">
      <button class="small-btn" onclick="testPushAiKey()" style="padding:2px 9px;font-size:0.82em">Test key</button>
      <a href="${_pushAiProvider()==='anthropic'?'https://console.anthropic.com/settings/keys':'setup-guide.html?v=629'}" target="_blank" rel="noopener" style="font-size:0.78em;color:var(--accent-cyan)">How to get a key →</a>
      <span id="push-ai-key-status" style="font-size:0.76em;color:var(--text-muted)"></span>
    </div>
    <div class="setting-hint" style="font-size:0.7em;margin-top:3px">${_getPushAiKeyOwn() ? 'Using the key above for background alerts. ' : ((typeof getActiveAIKey==='function'&&getActiveAIKey().trim()) ? '✓ Leave this blank to reuse your <b>AI Assistant</b> key automatically, or paste a different key to bill background alerts separately. ' : '')}Your key is stored on this device and on the alert server (encrypted) only so it can write your notifications while the app is closed, and you're billed on your own ${_pushAiProviderLabel()} account. ${_getPushAiKey() ? '' : '<b style="color:var(--accent-yellow)">Add a key here or in AI Assistant to activate AI alerts.</b>'}</div>` : ''}
    <div class="setting-row-6"><span class="text-xxs-muted">Only notify on changes</span>
      <button class="small-btn" onclick="setPushChangesOnly(${!changesOnly})" style="${changesOnly ? 'color:var(--accent-green);border-color:var(--accent-green)' : 'color:var(--text-muted)'}">${changesOnly ? 'ON' : 'OFF'}</button>
    </div>
    <div class="setting-hint" style="font-size:0.7em;margin-top:2px"><b>Only notify on changes</b> stops repeat buzzes when nothing's changed — you get a notification when something <b>new</b> develops or a storm shifts, not the same alert over and over. Severe storms, lightning, and official <b>warnings</b> still repeat as usual so you never miss the serious stuff. Off by default.</div>
    <div class="setting-hint" style="font-size:0.7em;margin-top:2px">Each type now sends its <b>own</b> notification (warnings, watches, advisories, storms, tropical…) so they stack separately instead of one bundle. <b>Warnings</b> repeat fast and <b>watches</b> automatically speed up as they near expiry; advisories and tropical repeat slower (set above). <b>NWS</b> covers hurricane, tornado, severe, flood, fire. <b>Tropical</b> pushes when a storm comes within your tracking radius (${_pushTropRadius()} mi, set on the map) or your location enters its forecast cone. <b>Nearby strong storms</b> sends a low-key heads-up when strong cells (45+ dBZ) sit inside your watch radius but aren't heading at you — like a line passing parallel to the north — so you stay aware even when nothing's inbound (at most once every couple hours per area). Weather alerts (wind, temp, rain…) mirror your <b>Alerts</b> tab.</div>`;
  // Locations currently watched: the chosen saved-location bells, else the
  // single Home/current fallback (legacy single-location mode).
  const watched = _watchedPushLocs();
  const enabledFavs = _enabledPushLocs();
  const legacy = enabledFavs.length === 0; // watching Home only, no per-location bells
  const locList = watched.length
    ? watched.map(l => `<span style="display:inline-block;background:rgba(57,217,138,0.14);border:1px solid rgba(57,217,138,0.35);color:var(--accent-green);border-radius:11px;padding:1px 9px;margin:2px 4px 2px 0;font-size:0.92em">🔔 ${escHtml(l.name || 'Saved location')}</span>`).join('')
    : '';
  const bellHint = `<div class="setting-hint" style="font-size:0.7em;margin-top:2px">Turn the 🔔 on any saved location (Location menu → Saved) to watch it too — up to 5, each with its own notification headed by the location's name.</div>`;
  if (sub) {
    const moved = legacy && loc && (Math.abs(loc.lat - sub.lat) > 0.05 || Math.abs(loc.lon - sub.lon) > 0.05);
    return `
      ${toggle}
      <div class="setting-hint" style="color:var(--accent-green)">Watching ${watched.length} location${watched.length === 1 ? '' : 's'} — a push fires when an inbound storm matches your thresholds, even with the app closed:</div>
      <div style="margin:2px 0 4px">${locList || `<b>${escHtml(sub.name || 'your location')}</b>`}</div>
      ${bellHint}
      ${moved ? `<div class="setting-hint" style="color:var(--accent-yellow);display:flex;align-items:center;gap:8px;flex-wrap:wrap">Your location changed.<button class="small-btn" onclick="enablePushAlerts()" style="padding:1px 8px">↻ Update to ${escHtml(loc.name || 'here')}</button></div>` : ''}
      ${sub.code ? `<div class="setting-row-6"><span class="text-xxs-muted">Manage code</span><span style="font-family:var(--font-mono);font-weight:700;letter-spacing:1px;color:var(--accent-cyan)">${escHtml(sub.code)}</span></div>` : ''}
      ${controls}
      <div style="margin-top:11px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
        <button id="push-test-btn" class="small-btn" onclick="sendTestPush()" style="padding:6px 14px;font-size:0.85em;border-color:var(--accent-green);color:var(--accent-green)">🔔 Send test notification</button>
        <button id="push-reset-btn" class="small-btn" onclick="resubscribePushAlerts()" style="padding:6px 14px;font-size:0.85em;border-color:var(--accent-cyan);color:var(--accent-cyan)">🔄 Re-subscribe</button>
      </div>
      <div class="setting-hint" style="font-size:0.7em;text-align:center;margin-top:3px">Send a test to confirm delivery (arrives within ~1 min). If alerts have stopped showing, tap <b>Re-subscribe</b> to reset the connection — your code and settings are kept.</div>`;
  }
  return `
    ${toggle}
    <div class="setting-hint">Get a push notification when a storm is inbound — works even when StormTracker is closed. Scanned server-side every ~5 min for <b>${watched.length ? watched.map(l => escHtml(l.name)).join(', ') : 'your saved Home location'}</b>. Flip the switch above to turn it on.</div>
    ${bellHint}
    ${controls}`;
}

// --- Subscription sync on app open ----------------------------------------
// iOS can silently drop or rotate a Home-Screen PWA's push subscription with no
// event firing, leaving the worker holding a dead endpoint while alerts quietly
// stop. On open (and when the tab becomes visible) we run a gentle health check:
// compare the live browser PushSubscription against what we have stored and
// re-subscribe ONLY when something is actually wrong — the browser has no
// subscription, the endpoint rotated, or it carries a stale VAPID key. A healthy
// connection is left untouched: needless endpoint churn itself burns Apple's
// delivery budget, so we never re-subscribe "just because" the app opened.
// User intent is respected for free — disabling alerts clears st_pushSub, so
// this no-ops until the user turns alerts back on.
let _pushOpenBusy = false, _pushOpenLast = 0;
async function refreshPushOnOpen() {
  try {
    if (_pushOpenBusy || _pushOpInFlight) return;
    const stored = _getPushSub();
    if (!stored) return; // user hasn't enabled background alerts (or disabled them)
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') return;
    const now = Date.now();
    if (now - _pushOpenLast < 60000) return; // at most once a minute — avoids tab-flick churn
    _pushOpenLast = now;
    _pushOpenBusy = true;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    let why = '';
    if (!sub) why = 'browser subscription missing';
    else if (stored.endpoint && sub.endpoint !== stored.endpoint) why = 'endpoint changed';
    else if (!_subKeyMatches(sub, _urlB64ToUint8(PUSH_VAPID_PUBLIC_KEY))) why = 'VAPID key mismatch';
    if (why) {
      console.log('[push] re-syncing subscription on open:', why);
      // Silent heal — _ensureFreshSubscription inside enablePushAlerts drops any
      // stale sub and the worker MOVES the row (code/thresholds/locations kept).
      await enablePushAlerts(true);
    }
  } catch (e) {
    console.log('[push] open-sync failed:', e && e.message);
  } finally {
    _pushOpenBusy = false;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshPushOnOpen();
});
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(refreshPushOnOpen, 3000);
} else {
  window.addEventListener('load', () => setTimeout(refreshPushOnOpen, 3000));
}
