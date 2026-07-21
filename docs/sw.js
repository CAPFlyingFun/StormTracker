// Version: v6.38 (display) | cache-bust counter: 736 (used in ?v= query strings and SW cache name)
const CACHE_NAME = 'stormtracker-v736';
const STATIC_ASSETS = [
  '/StormTracker/',
  '/StormTracker/index.html',
  '/StormTracker/setup-guide.html',
  '/StormTracker/offline.html',
  '/StormTracker/manifest.json',
  '/StormTracker/icons/icon-192x192.png',
  '/StormTracker/icons/icon-512x512.png',
  '/StormTracker/js/radar-shared.js',
  '/StormTracker/js/core.js',
  '/StormTracker/js/gauges.js',
  '/StormTracker/js/icons.js',
  '/StormTracker/js/geo.js',
  '/StormTracker/js/settings.js',
  '/StormTracker/js/thresholds.js',
  '/StormTracker/js/weather.js',
  '/StormTracker/js/radar.js',
  '/StormTracker/js/tropical-model.js',
  '/StormTracker/js/storms.js',
  '/StormTracker/js/station.js',
  '/StormTracker/js/alerts.js',
  '/StormTracker/js/briefingEngine.js',
  '/StormTracker/js/ai.js',
  '/StormTracker/js/push.js',
  '/StormTracker/js/qrcode.js',
  '/StormTracker/js/devicelink.js',
  '/StormTracker/js/init.js',
  '/StormTracker/css/style.css',
  '/StormTracker/img/radar/scan-home.svg',
  '/StormTracker/img/radar/scan-view.svg',
  '/StormTracker/img/radar/scan-hires.svg',
  '/StormTracker/img/radar/source.svg',
  '/StormTracker/img/radar/source-nex.svg',
  '/StormTracker/img/radar/source-rv.svg',
  '/StormTracker/img/radar/units.svg',
  '/StormTracker/img/radar/units-km.svg',
  '/StormTracker/img/radar/airports.svg',
  '/StormTracker/img/radar/play.svg',
  '/StormTracker/img/radar/pause.svg',
  '/StormTracker/img/radar/stop.svg',
  '/StormTracker/img/radar/anim-loading.svg',
  '/StormTracker/img/radar/zones.svg',
  '/StormTracker/img/radar/path-arrows.svg',
  '/StormTracker/img/radar/points.svg',
  '/StormTracker/img/radar/points-12.svg',
  '/StormTracker/img/radar/tracks.svg',
  '/StormTracker/img/radar/tracks-12.svg',
  '/StormTracker/img/radar/radar-overlay.svg',
  '/StormTracker/img/radar/mping.svg',
  '/StormTracker/img/radar/alert-polys.svg',
  '/StormTracker/img/radar/hurricane.svg',
  '/StormTracker/img/radar/clear.svg',
  '/StormTracker/img/radar/terrain-3d.svg',
  '/StormTracker/img/radar/clutter.svg'
];

// v5.97: persist background PUSH notifications so the in-app 📢 panel can show
// them on next open. The service worker can't touch localStorage, so it writes
// to IndexedDB ('st-notif' → 'queue'); the app drains this into its notification
// log when it loads (see _drainPushNotifQueue in core.js).
function _stNotifDb(){return new Promise((res,rej)=>{try{const r=indexedDB.open('st-notif',1);r.onupgradeneeded=()=>{try{r.result.createObjectStore('queue',{keyPath:'id'})}catch(e){}};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);}catch(e){rej(e)}})}
async function _queuePushNotif(title,body){
  try{
    const db=await _stNotifDb();
    await new Promise(res=>{const tx=db.transaction('queue','readwrite');tx.objectStore('queue').put({id:Date.now()+'-'+Math.random().toString(36).slice(2,7),ts:Date.now(),title:title||'',body:body||''});tx.oncomplete=res;tx.onerror=res;tx.onabort=res;});
  }catch(e){}
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // v4.35: Never intercept non-GET requests. POST/PUT/PATCH/DELETE are not
  // cacheable and a SW that returns undefined from respondWith() surfaces
  // as "FetchEvent.respondWith received an error: Returned response is null"
  // — which was breaking the AI chat (OpenAI POST) and any other write API.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // v4.35: Never intercept cross-origin requests either. Every external data
  // source (OpenAI, Open-Meteo, OpenWeather, RainViewer, NEXRAD/IEM, NWS,
  // AviationWeather, tile servers, Nominatim, CheckWX, WeatherAPI, the
  // notification worker on workers.dev) handles its own caching / CORS /
  // errors and must reach the network directly.
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return;
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match('/StormTracker/offline.html')))
    );
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('sync', event => {
  if (event.tag === 'weather-sync') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SYNC_WEATHER' }));
      })
    );
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'weather-update') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'PERIODIC_WEATHER_UPDATE' }));
      })
    );
  }
});

// iOS treats ANY push event that doesn't end in a visible notification as a
// "silent push" and may revoke the subscription after a few. So this handler is
// bulletproof: every code path — even a non-JSON payload or a showNotification
// failure — still ends in a shown notification.
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch (e) {
      // Non-JSON payload — fall back to plain text so we STILL show something.
      try { data = { body: event.data ? event.data.text() : '' }; } catch (e2) { data = {}; }
    }
    if (!data || typeof data !== 'object') data = {}; // guard valid-JSON null/primitive
    const title = data.title || 'StormTracker Alert';
    const options = {
      body: data.body || 'Weather alert in your area',
      icon: '/StormTracker/icons/icon-192x192.png',
      badge: '/StormTracker/icons/icon-96x96.png',
      vibrate: [200, 100, 200],
      // Unique fallback tag so a payload without one can't silently coalesce.
      tag: data.tag || ('weather-alert-' + Date.now()),
      renotify: true,
      data: { url: data.url || '/StormTracker/' },
      actions: [
        { action: 'view', title: 'View Details' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    };
    // v5.97: record it for the in-app 📢 panel before showing.
    await _queuePushNotif(title, options.body);
    try {
      await self.registration.showNotification(title, options);
    } catch (e) {
      // Last resort — MUST show something or iOS may revoke the subscription.
      try { await self.registration.showNotification('StormTracker', { body: 'New weather update' }); } catch (e2) {}
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'WX_THRESHOLD_ALERT') {
    const isStorm = (event.data.title || '').toLowerCase().includes('storm');
    self.registration.showNotification(event.data.title || 'StormTracker Alert', {
      body: event.data.body || 'Weather threshold breached',
      icon: '/StormTracker/icons/icon-192x192.png',
      badge: '/StormTracker/icons/icon-96x96.png',
      vibrate: isStorm ? [300, 100, 300, 100, 300] : [200, 100, 200],
      tag: isStorm ? 'storm-cell-alert' : 'wx-threshold',
      renotify: true,
      requireInteraction: isStorm,
      data: { url: '/StormTracker/' },
      actions: [
        { action: 'view', title: 'View Details' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    });
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/StormTracker/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const client of clients) {
        if (client.url.includes('/StormTracker/') && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
