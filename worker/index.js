// StormTracker Cloudflare Worker
//   1. AWC METAR/TAF proxy (CORS-friendly aviation weather)
//   2. Push-subscription API (D1-backed) for multi-user background storm alerts
//
// D1 binding:   env.DB           (see schema.sql / wrangler.toml)
// Secret:       env.SCANNER_SECRET  (shared with the GitHub Actions scanner)
//
// Public endpoints (called by the static PWA):
//   POST /subscribe     { subscription, lat, lon, name, thresholds, code? } -> { ok, code }
//   POST /unsubscribe   { endpoint }  OR  { code }                          -> { ok }
// Scanner endpoints (require header  x-scanner-secret: <SCANNER_SECRET>):
//   GET  /subscriptions                                                     -> { subscribers:[...] }
//   POST /mark-alert    { endpoint, lastAlert }                             -> { ok }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-scanner-secret',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function genCode() {
  // Short, human-shareable, unambiguous alphabet.
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// `code` is UNIQUE in the schema, so a colliding code would make the INSERT
// throw. Return a code that is guaranteed free (ignoring this endpoint's own
// row), regenerating on the rare collision.
async function uniqueCode(env, candidate, selfEndpoint) {
  const taken = async (c) => {
    const row = await env.DB.prepare('SELECT endpoint FROM subscriptions WHERE code = ?').bind(c).first();
    return row && row.endpoint !== selfEndpoint;
  };
  if (candidate && !(await taken(candidate))) return candidate;
  for (let i = 0; i < 8; i++) {
    const c = genCode();
    if (!(await taken(c))) return c;
  }
  return genCode() + Date.now().toString(36).slice(-3).toUpperCase();
}

// --- Per-user OpenAI key encryption at rest -------------------------------
// AI-written push alerts use EACH user's own OpenAI key (never the developer's).
// The key MUST be stored server-side so background alerts can be written while
// the user's browser is closed. To avoid keeping it in plaintext, we AES-GCM
// encrypt it with a key derived from SCANNER_SECRET. The scanner never receives
// it (stripped from /subscriptions) and a D1 dump alone can't decrypt it.
async function _aiCryptoKey(env) {
  const seed = 'stormtracker-aikey:' + (env.SCANNER_SECRET || '');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return crypto.subtle.importKey('raw', h, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encAiKey(env, plain) {
  try {
    if (!plain) return null;
    const key = await _aiCryptoKey(env);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv); out.set(ct, iv.length);
    let bin = '';
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return 'enc:' + btoa(bin);
  } catch (e) { return null; }
}
async function decAiKey(env, blob) {
  try {
    if (typeof blob !== 'string' || !blob) return null;
    if (!blob.startsWith('enc:')) return blob; // tolerate a legacy/plaintext value
    const raw = Uint8Array.from(atob(blob.slice(4)), c => c.charCodeAt(0));
    const iv = raw.slice(0, 12), ct = raw.slice(12);
    const key = await _aiCryptoKey(env);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch (e) { return null; }
}

// Reliable scan scheduler. GitHub Actions' own cron is best-effort and skips
// runs constantly, so the dependable cadence comes from THIS Worker's Cloudflare
// Cron Trigger (configured every 5 min). On each tick we just poke the existing
// GitHub Actions scanner via workflow_dispatch — the scan itself still runs there
// (it has the VAPID + scanner secrets). Needs the `GH_DISPATCH_TOKEN` secret
// (a GitHub token with repo/actions:write). The GitHub-side cron stays as a
// flaky backup; the per-alert cooldown + workflow concurrency make overlap safe.
async function triggerScan(env) {
  if (!env.GH_DISPATCH_TOKEN) { console.warn('GH_DISPATCH_TOKEN not set — skipping scan dispatch'); return; }
  const url = 'https://api.github.com/repos/CAPFlyingFun/StormTracker/actions/workflows/storm-scan.yml/dispatches';
  const opts = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GH_DISPATCH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'stormtracker-cron',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main' }),
  };
  // Retry transient failures (network blip / 5xx / rate limit) so a single
  // hiccup doesn't silently drop a 5-min tick. A 4xx (bad token/ref) is fatal
  // and won't self-heal — log and bail rather than hammer the API.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, opts);
      if (r.status === 204) { console.log(`scan dispatched (attempt ${attempt})`); return; }
      const body = (await r.text()).slice(0, 200);
      if (r.status >= 400 && r.status < 500 && r.status !== 429) {
        console.warn(`scan dispatch fatal: HTTP ${r.status} ${body}`); return;
      }
      console.warn(`scan dispatch attempt ${attempt} failed: HTTP ${r.status} ${body}`);
    } catch (e) {
      console.warn(`scan dispatch attempt ${attempt} error: ${e.message}`);
    }
    if (attempt < 3) await new Promise(res => setTimeout(res, 1500 * attempt));
  }
  console.warn('scan dispatch gave up after 3 attempts');
}

async function proxyAWC(kind, url) {
  const params = new URLSearchParams(url.search);
  const awcUrl = `https://aviationweather.gov/api/data/${kind}?${params.toString()}`;
  try {
    const resp = await fetch(awcUrl, { headers: { 'User-Agent': 'StormTracker/1.0' } });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'text/plain',
        'Cache-Control': 'public, max-age=60',
        ...CORS,
      },
    });
  } catch (e) {
    return new Response('Upstream error: ' + e.message, { status: 502, headers: CORS });
  }
}

export default {
  // Cloudflare Cron Trigger (every 5 min) — the reliable heartbeat that kicks
  // off each background storm scan. See triggerScan() above.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerScan(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // ---- AWC proxy (unchanged) ----
    if (path === '/metar') return proxyAWC('metar', url);
    if (path === '/taf') return proxyAWC('taf', url);

    // ---- Push subscription API ----
    if (path === '/subscribe' && request.method === 'POST') {
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const sub = b.subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
        return json({ error: 'invalid subscription' }, 400);
      }
      if (typeof b.lat !== 'number' || typeof b.lon !== 'number') {
        return json({ error: 'lat/lon required' }, 400);
      }
      // AI-written alerts: the client sends its OWN provider key (OpenAI or
      // Anthropic, plaintext over HTTPS) inside thresholds.ai.key. Encrypt it at
      // rest before storing, and never let it leave this Worker (it is stripped
      // from /subscriptions and only ever decrypted here in /ai-digest). If AI is
      // off or no key was supplied, no key is stored.
      const thObj = (b.thresholds && typeof b.thresholds === 'object') ? b.thresholds : {};
      if (thObj.ai && typeof thObj.ai === 'object') {
        const tone = String(thObj.ai.tone || 'professional');
        // Which AI provider writes this user's digests. Whitelisted; anything
        // unknown (or a legacy sub with no provider) falls back to OpenAI.
        const provider = thObj.ai.provider === 'anthropic' ? 'anthropic' : 'openai';
        const rawKey = (typeof thObj.ai.key === 'string') ? thObj.ai.key.trim().slice(0, 500) : '';
        if (thObj.ai.on && rawKey) {
          const enc = await encAiKey(env, rawKey);
          thObj.ai = enc ? { on: true, tone, provider, key: enc } : { on: true, tone, provider };
        } else {
          // AI on without a key, or AI off: keep the flag/tone/provider but store no key.
          thObj.ai = thObj.ai.on ? { on: true, tone, provider } : { on: false };
        }
      }
      const thresholds = JSON.stringify(thObj || {});
      const name = (b.name || '').slice(0, 120);
      // Same-device endpoint migration. Browsers/iOS mint a NEW push endpoint when
      // a subscription is recreated (VAPID-key change, re-enable, reinstall), so
      // without this each new endpoint INSERTs a fresh row and stale duplicates
      // pile up — the scanner then fans the same alert out to several endpoints
      // for one device, burning its push budget so Apple throttles delivery. The
      // client proves it owns the prior row by sending BOTH its old endpoint and
      // its code; we MOVE that row onto the new endpoint (keeping its code +
      // last_alert) instead of duplicating. Old endpoint AND code are required
      // together — code alone is a short, semi-public token and must never let a
      // caller overwrite someone else's subscription.
      const oldEndpoint = typeof b.oldEndpoint === 'string' ? b.oldEndpoint : '';
      const claimedCode = (b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      let finalCode = null;
      if (oldEndpoint && claimedCode && oldEndpoint !== sub.endpoint) {
        const prior = await env.DB.prepare('SELECT code FROM subscriptions WHERE endpoint = ? AND code = ?')
          .bind(oldEndpoint, claimedCode).first();
        if (prior) {
          // Clear any row already sitting on the NEW endpoint so the move can't
          // collide with the endpoint PRIMARY KEY, then repoint the verified row.
          await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
          await env.DB.prepare(
            `UPDATE subscriptions SET endpoint = ?, p256dh = ?, auth = ?, lat = ?, lon = ?, name = ?, thresholds = ?
             WHERE endpoint = ? AND code = ?`
          ).bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth, b.lat, b.lon, name, thresholds, oldEndpoint, claimedCode).run();
          finalCode = claimedCode;
        }
      }
      if (finalCode === null) {
        // Preserve an existing code/last_alert for this endpoint if present.
        let code = (b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
        const existing = await env.DB.prepare('SELECT code FROM subscriptions WHERE endpoint = ?')
          .bind(sub.endpoint).first();
        if (existing && existing.code) code = existing.code;
        code = await uniqueCode(env, code, sub.endpoint);
        await env.DB.prepare(
          `INSERT INTO subscriptions (endpoint, p256dh, auth, lat, lon, name, thresholds, code, created)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET
             p256dh=excluded.p256dh, auth=excluded.auth, lat=excluded.lat, lon=excluded.lon,
             name=excluded.name, thresholds=excluded.thresholds`
        ).bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth, b.lat, b.lon, name, thresholds, code, Date.now())
         .run();
        finalCode = code;
      }
      // Manual reset (client sends reset:true): clear the routine digest cooldown
      // so the very NEXT scan re-sends current conditions promptly — confirming the
      // freshly-minted push budget actually shows — instead of waiting out the
      // ~45-minute digest floor. Only the per-location "#__digest" keys are wiped;
      // per-storm and NWS alert dedupe is preserved so we never re-fire an
      // already-seen official warning.
      if (b.reset === true) {
        try {
          const row = await env.DB.prepare('SELECT last_alert FROM subscriptions WHERE endpoint = ?')
            .bind(sub.endpoint).first();
          let la = {};
          try { la = JSON.parse((row && row.last_alert) || '{}'); } catch (e) { la = {}; }
          let changed = false;
          for (const k of Object.keys(la)) {
            if (k.endsWith('#__digest')) { delete la[k]; changed = true; }
          }
          if (changed) {
            await env.DB.prepare('UPDATE subscriptions SET last_alert = ? WHERE endpoint = ?')
              .bind(JSON.stringify(la), sub.endpoint).run();
          }
        } catch (e) { /* non-fatal: cooldown clear is best-effort */ }
      }
      return json({ ok: true, code: finalCode });
    }

    if (path === '/unsubscribe' && request.method === 'POST') {
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (b.endpoint) {
        await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(b.endpoint).run();
        return json({ ok: true });
      }
      if (b.code) {
        await env.DB.prepare('DELETE FROM subscriptions WHERE code = ?')
          .bind(String(b.code).toUpperCase()).run();
        return json({ ok: true });
      }
      return json({ error: 'endpoint or code required' }, 400);
    }

    // ---- AI digest wording (scanner-gated) ----
    // The GitHub Actions scanner can't read THIS Worker's D1, so it POSTs the
    // deterministic alert lines here (plus the device endpoint) and we do the
    // OpenAI call on its behalf using THAT user's own OpenAI key. The key is
    // looked up from D1 by endpoint and decrypted here — it never leaves
    // Cloudflare and the developer's key is NEVER used for another user. Returns
    // one short, natural push body. The scanner falls back to its own
    // deterministic text on ANY failure, so this is best-effort cosmetic polish
    // and never load-bearing.
    if (path === '/ai-digest' && request.method === 'POST') {
      if (request.headers.get('x-scanner-secret') !== env.SCANNER_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
      if (!endpoint) return json({ error: 'endpoint required' }, 400);
      // Resolve THIS user's OpenAI key. No env-key fallback — if a user hasn't
      // supplied their own key, AI wording simply isn't available for them.
      const row = await env.DB.prepare('SELECT thresholds FROM subscriptions WHERE endpoint = ?').bind(endpoint).first();
      if (!row) return json({ error: 'unknown endpoint' }, 404);
      const thAi = safeParse(row.thresholds, {}).ai;
      // Require BOTH a stored key AND that the user still has AI turned ON, so a
      // scanner bug or a stale key can never bill a user who disabled AI.
      const aiOn = !!(thAi && typeof thAi === 'object' && thAi.on === true);
      const userKey = (aiOn && typeof thAi.key === 'string') ? await decAiKey(env, thAi.key) : null;
      if (!userKey) return json({ error: 'no user key' }, 503);
      // Which provider this user picked. Legacy subs (no provider) => OpenAI.
      const provider = (thAi && thAi.provider === 'anthropic') ? 'anthropic' : 'openai';
      const lines = Array.isArray(b.lines) ? b.lines.filter(x => typeof x === 'string' && x.trim()).slice(0, 12) : [];
      if (!lines.length) return json({ error: 'no lines' }, 400);
      const place = String(b.place || '').slice(0, 80);
      const tone = ({ professional: 'professional', friendly: 'warm and friendly', humorous: 'lightly humorous but still clear' })[String(b.tone || '').toLowerCase()] || 'professional';
      const facts = lines.join('\n').slice(0, 1200);
      const sys = `You write ONE weather push-notification body for a storm-tracking app. Rewrite the FACTS below into a single ${tone} message a person reads at a glance on a phone lock screen.
Rules:
- Plain text only. No markdown, no surrounding quotes. You may keep emoji that appear in the facts if they help.
- Keep it SHORT: at most 240 characters, ideally 2-3 short lines.
- Lead with the most dangerous/urgent item (tornado or severe warning, lightning, inbound storm) first.
- NEVER invent facts, numbers, distances, directions, or times that are not in the facts. Never drop a life-safety warning.
- No greeting and no sign-off. Skip generic "stay safe" filler unless the tone clearly calls for a brief nudge.`;
      const userMsg = `Location: ${place || 'your area'}\nFacts:\n${facts}`;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 9000);
        let text = '';
        if (provider === 'anthropic') {
          // Anthropic Messages API: system is a TOP-LEVEL param (not a message),
          // max_tokens is required, and the reply is content[].text blocks.
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': userKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            signal: ctrl.signal,
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 160,
              temperature: 0.5,
              system: sys,
              messages: [{ role: 'user', content: userMsg }],
            }),
          });
          clearTimeout(to);
          if (!r.ok) { const t = (await r.text()).slice(0, 160); return json({ error: 'anthropic ' + r.status, detail: t }, 502); }
          const d = await r.json();
          const block = (d && Array.isArray(d.content)) ? d.content.find(x => x && x.type === 'text') : null;
          text = ((block && block.text) || '').trim();
        } else {
          const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${userKey}`, 'Content-Type': 'application/json' },
            signal: ctrl.signal,
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              temperature: 0.5,
              max_tokens: 160,
              messages: [
                { role: 'system', content: sys },
                { role: 'user', content: userMsg },
              ],
            }),
          });
          clearTimeout(to);
          if (!r.ok) { const t = (await r.text()).slice(0, 160); return json({ error: 'openai ' + r.status, detail: t }, 502); }
          const d = await r.json();
          text = ((d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
        }
        text = text.replace(/^["']+|["']+$/g, '').slice(0, 300).trim();
        if (!text) return json({ error: 'empty' }, 502);
        return json({ text });
      } catch (e) {
        return json({ error: 'fetch ' + ((e && e.message) || 'err') }, 502);
      }
    }

    // ---- One-shot test push ----
    // A user tapped "Send test notification" in Settings. We just FLAG the test
    // in D1 `meta` (private — never exposed publicly) and nudge the scanner; the
    // scanner delivers it through the SAME web-push pipeline as real alerts (so a
    // success genuinely proves end-to-end delivery) and then clears the flag.
    if (path === '/test' && request.method === 'POST') {
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      // Endpoint only — the client always has its own. (No `code` lookup here, to
      // avoid an enumeration / spam-someone-else's-device vector.)
      const endpoint = b.endpoint || '';
      if (!endpoint) return json({ error: 'endpoint required' }, 400);
      const sub = await env.DB.prepare('SELECT endpoint FROM subscriptions WHERE endpoint = ?')
        .bind(endpoint).first();
      if (!sub) return json({ error: 'not subscribed' }, 404);
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)').run();
      const now = Date.now();
      // Per-endpoint cooldown: if a test is already pending (flagged in the last
      // 60s) it's still in flight — don't re-flag or re-dispatch. Stops tap-spam
      // (or a known endpoint) from hammering the scanner; the pending test still
      // gets delivered on the next scan, so the user loses nothing.
      const pendingRow = await env.DB.prepare('SELECT value FROM meta WHERE key = ?')
        .bind('test:' + endpoint).first();
      const pendingTs = pendingRow ? (Number(pendingRow.value) || 0) : 0;
      if (pendingTs && now - pendingTs < 60000) {
        return json({ ok: true, queued: true, throttled: true });
      }
      await env.DB.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind('test:' + endpoint, String(now)).run();
      // Global dispatch debounce: at most one scanner nudge per 45s no matter how
      // many distinct endpoints ask, so a botnet of subscriptions can't fan out
      // into a flood of GitHub workflow_dispatch calls. The flag is already set,
      // so the regular ~5-min scan still delivers anything we skip dispatching for.
      const dRow = await env.DB.prepare('SELECT value FROM meta WHERE key = ?')
        .bind('last_test_dispatch').first();
      const lastDispatch = dRow ? (Number(dRow.value) || 0) : 0;
      if (now - lastDispatch >= 45000) {
        await env.DB.prepare(
          "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).bind('last_test_dispatch', String(now)).run();
        ctx.waitUntil(triggerScan(env));
      }
      return json({ ok: true, queued: true });
    }

    if (path === '/subscriptions' && request.method === 'GET') {
      if (!env.SCANNER_SECRET || request.headers.get('x-scanner-secret') !== env.SCANNER_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      const { results } = await env.DB.prepare('SELECT * FROM subscriptions').all();
      // Pending one-shot test pushes (set by POST /test). Only honor recent ones
      // so a stale flag can never cause a surprise notification later.
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)').run();
      const tRows = await env.DB.prepare("SELECT key, value FROM meta WHERE key LIKE 'test:%'").all();
      const TEST_TTL = 15 * 60 * 1000;
      const nowT = Date.now();
      const tests = new Map();
      for (const r of (tRows.results || [])) {
        const ep = r.key.slice(5), ts = Number(r.value) || 0;
        if (ts && nowT - ts < TEST_TTL) tests.set(ep, ts);
      }
      const subscribers = (results || []).map(r => {
        const th = safeParse(r.thresholds, {});
        // NEVER expose a user's stored OpenAI key to the scanner. Replace it with
        // a boolean so the scanner can still gate AI on whether a key exists; the
        // key itself only ever leaves D1 inside /ai-digest, here in this Worker.
        if (th && th.ai && typeof th.ai === 'object') {
          const hasKey = typeof th.ai.key === 'string' && th.ai.key.length > 0;
          const provider = th.ai.provider === 'anthropic' ? 'anthropic' : 'openai';
          th.ai = { on: th.ai.on === true, tone: th.ai.tone || 'professional', provider, hasKey };
        }
        return {
          endpoint: r.endpoint,
          keys: { p256dh: r.p256dh, auth: r.auth },
          lat: r.lat, lon: r.lon, name: r.name,
          thresholds: th,
          code: r.code,
          lastAlert: safeParse(r.last_alert, {}),
          testRequested: tests.get(r.endpoint) || 0,
        };
      });
      return json({ subscribers });
    }

    if (path === '/mark-alert' && request.method === 'POST') {
      if (!env.SCANNER_SECRET || request.headers.get('x-scanner-secret') !== env.SCANNER_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!b.endpoint) return json({ error: 'endpoint required' }, 400);
      if (b.clearTest) {
        // Scanner delivered (or pruned) a one-shot test — drop the flag so it
        // doesn't fire again.
        await env.DB.prepare('DELETE FROM meta WHERE key = ?').bind('test:' + b.endpoint).run();
        return json({ ok: true, testCleared: true });
      }
      if (b.delete) {
        // The scanner reports a dead/expired subscription (410/404) — prune it.
        await env.DB.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(b.endpoint).run();
        return json({ ok: true, deleted: true });
      }
      await env.DB.prepare('UPDATE subscriptions SET last_alert = ? WHERE endpoint = ?')
        .bind(JSON.stringify(b.lastAlert || {}), b.endpoint).run();
      return json({ ok: true });
    }

    // ---- RSS feed: scanner pushes a per-CODE snapshot here ----
    // The scanner aggregates EVERY active alert across a code's watched
    // locations into one comprehensive snapshot and POSTs it each scan. We keep
    // the live snapshot (`cur`) always fresh for reading, but only EMIT a new
    // RSS <item> (the thing a reader notifies on) when the coarse signature
    // changes OR a 30-min "briefing" heartbeat is due — a timer that is wholly
    // independent of the push cooldowns. A min-change gap + degraded-scan guard
    // stop band-flapping or a transient radar outage from spamming new items.
    if (path === '/feed-update' && request.method === 'POST') {
      if (!env.SCANNER_SECRET || request.headers.get('x-scanner-secret') !== env.SCANNER_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const code = (b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!code) return json({ error: 'code required' }, 400);
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)').run();
      const k = 'feed:' + code;
      const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(k).first();
      const state = safeParse(row && row.value, null) || { items: [], cur: null, sig: '', lastEmit: 0 };
      const now = Date.now();
      const MIN_GAP = 10 * 60 * 1000;   // throttle routine change-pings
      const BRIEF = 30 * 60 * 1000;     // guaranteed briefing heartbeat
      const title = String(b.title || 'StormTracker update').slice(0, 200);
      const body = String(b.body || '').slice(0, 4000);
      const sig = String(b.sig || 'clear').slice(0, 2000);
      const name = String(b.name || '').slice(0, 120);
      const urgent = !!b.urgent;     // escalation (NWS warning / tropical / severe core) — ping now
      const degraded = !!b.degraded; // a radar fetch failed — never treat as a real change
      state.cur = { time: now, title, body, name };
      const sinceEmit = now - (state.lastEmit || 0);
      const changed = (sig !== state.sig) && !degraded;
      const emitChange = changed && (urgent || sinceEmit >= MIN_GAP);
      // Degraded scans (a radar fetch failed) never publish — not even the 30-min
      // heartbeat — so they can't post a misleading all-clear briefing, shift the
      // heartbeat timer, or suppress the next real change for the throttle window.
      const emitBeat = !degraded && sinceEmit >= BRIEF;
      if (emitChange || emitBeat) {
        state.items.unshift({ id: now, time: now, title, body, kind: emitChange ? 'change' : 'briefing' });
        state.items = state.items.slice(0, 25);
        state.lastEmit = now;
      }
      // Only adopt the new signature once we've actually PUBLISHED something that
      // reflects it — so a throttled (non-urgent, <10 min) change still fires on a
      // later scan instead of being silently swallowed. Degraded scans never adopt.
      if (!degraded && (emitChange || emitBeat)) state.sig = sig;
      await env.DB.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind(k, JSON.stringify(state)).run();
      return json({ ok: true, emitted: emitChange || emitBeat, kind: emitChange ? 'change' : (emitBeat ? 'briefing' : 'none') });
    }

    // Mint (or fetch) the private feed token for the caller's code. Endpoint-only
    // proof of ownership (the client always has its own endpoint) — same safe
    // pattern as /test, with no `code` lookup to avoid an enumeration vector.
    if (path === '/feed-token' && request.method === 'POST') {
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      let b;
      try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      const endpoint = b.endpoint || '';
      if (!endpoint) return json({ error: 'endpoint required' }, 400);
      const sub = await env.DB.prepare('SELECT code FROM subscriptions WHERE endpoint = ?').bind(endpoint).first();
      if (!sub || !sub.code) return json({ error: 'not subscribed' }, 404);
      const token = await feedTokenForCode(env, sub.code, true);
      return json({ ok: true, token });
    }

    // Public RSS feed. Authorized ONLY by the private 128-bit feed token (NOT the
    // short manage code), so a feed URL pasted into a reader can't be used to
    // unsubscribe or manage the subscription. Read-only; renders the emitted
    // briefing/change history as RSS 2.0.
    if ((path === '/feed' || path === '/feed.xml') && request.method === 'GET') {
      if (!env.DB) return new Response('feed unavailable', { status: 503, headers: { 'Content-Type': 'text/plain', ...CORS } });
      const token = (url.searchParams.get('token') || '').toLowerCase();
      const notFound = () => new Response('Feed not found', { status: 404, headers: { 'Content-Type': 'text/plain', ...CORS } });
      if (!/^[a-f0-9]{16,64}$/.test(token)) return notFound();
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)').run();
      const tokRow = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('feedtok:' + token).first();
      if (!tokRow || !tokRow.value) return notFound();
      const code = tokRow.value;
      const fRow = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('feed:' + code).first();
      const state = safeParse(fRow && fRow.value, null);
      const link = 'https://capflyingfun.github.io/StormTracker/';
      const name = (state && state.cur && state.cur.name) || 'your locations';
      const channelTitle = `StormTracker — ${name}`;
      const curBody = (state && state.cur && state.cur.body) || '';
      const desc = curBody ? curBody.replace(/\s*\n\s*/g, ' · ').slice(0, 500) : 'Waiting for the next storm scan…';
      const lastBuild = (state && state.cur && state.cur.time) || Date.now();
      // Opaque, stable GUID namespace derived from the feed TOKEN (which the reader
      // already holds) — NEVER the manage code. Putting the code in GUIDs would leak
      // it to any reader/service and let them /unsubscribe or manage the device.
      const _th = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const ns = [...new Uint8Array(_th)].slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
      let items = (state && Array.isArray(state.items) ? state.items : []).map(it => ({
        title: it.title || 'StormTracker update',
        body: it.body || '',
        time: it.time || it.id || Date.now(),
        guid: `st-${ns}-${it.id || it.time}`,
      }));
      if (!items.length) items = [{
        title: '📡 StormTracker feed is live',
        body: 'Your storm briefings will appear here. A fresh briefing is posted at least every 30 minutes, and immediately when conditions change.',
        time: lastBuild,
        guid: `st-${ns}-welcome`,
      }];
      const xml = rssDoc({ channelTitle, link, description: desc, lastBuild, items });
      return new Response(xml, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=90', ...CORS },
      });
    }

    // Shared scheduler state for the randomized scan cadence. The scanner reads
    // the "next due" timestamp on each cron tick and writes the next one after
    // it scans. Guarded by the same scanner secret as /subscriptions.
    if (path === '/scan-due') {
      if (!env.SCANNER_SECRET || request.headers.get('x-scanner-secret') !== env.SCANNER_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
      if (!env.DB) return json({ error: 'D1 not configured' }, 500);
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)').run();
      if (request.method === 'GET') {
        const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'scan_due'").first();
        return json({ due: row ? Number(row.value) || 0 : 0 });
      }
      if (request.method === 'POST') {
        let b;
        try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
        const due = Number(b.due) || 0;
        await env.DB.prepare(
          "INSERT INTO meta (key, value) VALUES ('scan_due', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).bind(String(due)).run();
        return json({ ok: true, due });
      }
      return json({ error: 'method not allowed' }, 405);
    }

    return new Response(
      'StormTracker Worker\n\nProxy:\n  /metar?ids=KPNS&format=raw\n  /taf?ids=KPNS&format=raw\n\nPush API:\n  POST /subscribe\n  POST /unsubscribe\n  POST /feed-token    { endpoint } -> { token }\n  GET  /feed?token=...  (public RSS 2.0)\n  GET  /subscriptions (scanner)\n  POST /mark-alert    (scanner)\n  POST /feed-update   (scanner)\n  GET/POST /scan-due  (scanner)\n',
      { headers: { 'Content-Type': 'text/plain', ...CORS } }
    );
  },
};

function safeParse(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

// ---- RSS feed helpers ----

// 128-bit hex feed token. Unguessable bearer that maps to a code, kept separate
// from the short manage code so a shared feed URL never exposes account control.
function mintToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Get the existing feed token for a code, or mint+persist a new one. Stored as a
// bidirectional pair in `meta`: feedcode:<code> -> token and feedtok:<token> -> code.
async function feedTokenForCode(env, code, create) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)').run();
  const k = 'feedcode:' + code;
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(k).first();
  if (row && row.value) return row.value;
  if (!create) return null;
  const tok = mintToken();
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, tok).run();
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind('feedtok:' + tok, code).run();
  return tok;
}

function xmlEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Wrap rich body text in CDATA so HTML line breaks render; neutralise any ]]>.
function cdata(s) {
  return '<![CDATA[' + String(s == null ? '' : s).replace(/]]>/g, ']]&gt;') + ']]>';
}

function rssDoc({ channelTitle, link, description, lastBuild, items }) {
  const head =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>' +
    `<title>${xmlEsc(channelTitle)}</title>` +
    `<link>${xmlEsc(link)}</link>` +
    `<description>${xmlEsc(description)}</description>` +
    `<lastBuildDate>${new Date(lastBuild).toUTCString()}</lastBuildDate>` +
    '<ttl>5</ttl>';
  const body = items.map(it =>
    '<item>' +
    `<title>${xmlEsc(it.title)}</title>` +
    `<description>${cdata(String(it.body || '').replace(/\n/g, '<br/>'))}</description>` +
    `<pubDate>${new Date(it.time).toUTCString()}</pubDate>` +
    `<guid isPermaLink="false">${xmlEsc(it.guid)}</guid>` +
    `<link>${xmlEsc(link)}</link>` +
    '</item>'
  ).join('');
  return head + body + '</channel></rss>';
}
