# StormTracker data-flow audit

**Scope & method.** Six inventory passes over the live code — boot flow (`docs/js/init.js`/`geo.js`), per-tab activation (`core.js` dispatcher), every client fetch site in `docs/js/*.js`, the settings/threshold plumbing client → subscription → `scanner/scan.js`, the scanner parity ports (`scanner/detect.js`, `rainclock.js`, `tropical.js`, `alerts.js` vs their client twins), and persistent storage. Each pass was adversarially re-verified against the code; refuted claims were dropped and corrections applied. Every claim below cites file:line as read. Where a fix would change behavior, it says so.

---

## 1. First-launch flow

### 1.1 Script load & parse-time side effects

`docs/index.html` loads one inline script (index.html:742-756 — only registers a `window load` listener that registers `sw.js`, index.html:749-755) plus deferred classic scripts executing in tag order **before DOMContentLoaded**: leaflet (index.html:25) → **radar-shared** (723) → core → gauges → icons → geo → settings → thresholds → weather → radar → tropical-model → storms → station → alerts → briefingEngine → ai → push → qrcode → devicelink → **init** (741). `docs/sw.js` STATIC_ASSETS (sw.js:3-57) mirrors that order (radar-shared first at sw.js:11, init.js last at sw.js:29). The SW is network-first with cache fallback for same-origin JS/CSS/navigation (sw.js:107-134) and **never intercepts cross-origin requests** (sw.js:100-106).

Notable parse-time effects: `S` + `st_scanRadius`/`st_timeFormat` reads (core.js:14, 55); threshold/cooldown/history loads + the `stormDbz` normalizer IIFE (thresholds.js:14-191); the 60-s rain-clock tick timer starts at parse (weather.js:2853-2872); radar defaults/reset keyed `st_defaults_v230e` (radar.js:2496-2506); the v5.33 min-dBZ migration IIFE (push.js:15-35); **`refreshPushOnOpen` is armed +3 s at script evaluation** — document.readyState is `'interactive'` when deferred push.js runs, so the push.js:794-795 branch fires, not the window-load fallback at 796-797; init.js calls `init()` synchronously (init.js:354-355).

### 1.2 Boot timeline (returning user, `st_loc` present)

1. Shell paints from HTML + render-blocking CSS. **Caveat:** the "app shell from cache" story has a hole — Leaflet JS/CSS come from unpkg.com and fonts from fonts.googleapis.com (index.html:23-25), all cross-origin, which sw.js never caches (sw.js:105) and STATIC_ASSETS omits (sw.js:3-57). A cold offline launch has no `L` global: the radar map breaks on top of the missing data.
2. `await _autoCheckUpdate()` (init.js:254 → settings.js:268-293): network fetch of `index.html?_=…`, 3-s abort. **Everything else serializes behind this (≤~3 s).** The non-awaited speed test two lines later (init.js:264) proves the concurrent pattern exists.
3. Housekeeping: alert-expiry prune (thresholds.js:15-18), IndexedDB notif-queue drain (core.js:198-201), badge, icons, `loadUnits()` (core.js:563-591).
4. Speed test: fetch RainViewer `weather-maps.json` no-store, **body discarded** (init.js:182-185); sets `S._netSpeed`; `_netMonitorStart()` then re-runs the same discarded download every 60 s while visible, on each return to visibility, and on every `online` event (init.js:247-250 — the visibilitychange handler is `!document.hidden`-guarded).
5. `st_loc` parsed (init.js:266); optional silent GPS (`st_autoGps`, geo.js:358-377 → `reverseGeo` geo.js:528-541).
6. **`setLoc()` (geo.js:648-709) — the master fan-out:** writes `st_loc`, resets per-location state (geo.js:662-669), fires `fetchAlerts()` in parallel (geo.js:696), then the awaited chain `fetchWeather()` → `scanRadarForStorms()` → `fetchHazards()` + `fetchTerrainGrid()` (geo.js:697-704), then arms timers (geo.js:705-707).
7. `fetchWeather()` (weather.js:154-174): `Promise.allSettled` of Open-Meteo (GFS+HRRR, api→customer-api fallback, weather.js:94-128) ∥ AWC METAR bbox (weather.js:359) ∥ NWS current/forecast/QPF — **three parallel identical `/points` fetches** (weather.js:489, 516, 570).
8. `scanRadarForStorms()` (storms.js:1462): winds-aloft gate (30-min/100-mi cache storms.js:468-476) ∥ `fetchAFD()` (storms.js:685-699 — a **fourth** boot `/points` fetch; 60-min cache empty on first launch) → `runRadarScan` (radar.js:731; RainViewer catalog via the 60-s TTL `_fetchRvScanFrames`, radar.js:710-729; ≤48 tiles, radar.js:753) → `commitScanResults` (radar.js:812-863).
9. `fetchHazards()` (alerts.js:401-428, 5-min+locKey TTL at 405-409) also calls `fetchSPCData`/`fetchNHCData` — which `fetchAlerts` already chained (alerts.js:121-122). Only the SPC 5-min (storms.js:1875-1876) and NHC 15-min (storms.js:2234-2238) guards — `_lastFetch` stamped **before** the fetch, so concurrent callers dedupe — prevent a double network hit. **This dedupe is load-bearing; do not remove it.**
10. **Desktop (≥1024 px) boot does more:** `renderWeather` schedules `initDesktopMode` (weather.js:687) → `initRadar` (core.js:939 — triggering initRadarMap's *uncached* weather-maps.json fetch, radar.js:146-153) and `fetchStation` (core.js:941 → station.js:37-62, incl. a **fifth** `/points` fetch at station.js:43). Boot `/points` worst case: 4 (5 desktop, ~6 with the 1.5-s retries at weather.js:539-546, 603-610).

### 1.3 First launch (no `st_loc`)

Nav hidden, welcome screen injected (init.js:281-305) with GPS / debounced search / map-pick. Network before a location is chosen: update check + speed test only. First `setLoc` writes `st_home_location` (geo.js:551-556, 652). Tutorial prompt via `checkFirstLaunch` (settings.js:417-431). Notification-permission modal only appears on the first in-app alert send (thresholds.js:115 → init.js:77).

**No weather/forecast/radar/alert data is ever persisted** — offline fallback is in-memory `S._lastWeatherData` only (weather.js:157, 292-296); sw.js never caches cross-origin (sw.js:105); yet the offline banner says "showing cached data" (init.js:50-52). Cold offline boot = error state + broken map.

### 1.4 Timers armed at/after boot

| Timer | Interval | Armed at | Re-fires |
|---|---|---|---|
| Rain-clock tick | 60 s | parse time (weather.js:2872) | dial wall-clock labels |
| Net monitor | 60 s visible + visibility/online events | init.js:247-250 | **full weather-maps.json download, body discarded** (init.js:182-185) |
| Auto-refresh | `autoRefreshMin` (default 60 min, geo.js:896) | geo.js:907-915 | weather+alerts+hazards+terrain+**full scan**; paused in travel mode (geo.js:908) |
| Adaptive auto-scan | 10 min (≥4 storms) / 15 (≥1) / 30 (0) (core.js:818-823) | core.js:824-835, re-armed each scan (storms.js:1518) | **full `scanRadarForStorms`** — on a stormy day the tile pipeline re-runs every 10-15 min, not hourly |
| Overhead poll | 90 s (180/300 slow-net, radar.js:2201-2215); `document.hidden`-gated (radar.js:2223) | geo.js:707 → radar.js:2280-2295 | 3-mi splice scan, minDbz 5 (radar.js:2232-2245) |
| Aloft watchdog | 10 min | geo.js:926-947 | winds refetch if missing or >30 min stale (geo.js:932-934) — also the between-refresh freshness maintainer |
| ETA countdown | 1 s | core.js:846-885 | expiry prunes storms, can trigger rescan (core.js:861-884) |
| Wind sim | 120-s AWC refetch + 100-ms sim | weather.js:1391-1406, 1413-1481 | **no `document.hidden` gate** (unlike the overhead poll) and never paused by switchPage (core.js:1072 gates only the sonar) |
| Push open-sync | one-shot +3 s + visibilitychange (≥60 s apart, push.js:770) | push.js:794-795 (script eval) | network only if subscription unhealthy (push.js:762-784) |
| Travel mode | `gpsInterval` (default 300 s, geo.js:992) | geo.js:1159-1207 | GPS fix → reverseGeocode → **full `setLoc` fan-out** (geo.js:1205 → 696-704) — the heaviest recurring loop; auto-refresh and watchdog correctly skip while it runs (geo.js:908, 929) |

Winds-aloft recovery is **four** mechanisms plus one cache gate: the blocking `ensureWindsAloft` loop (30-s budget/3-s pauses, storms.js:633-634, 662-675 — cancels the background timer mid-loop at storms.js:666); the staged 6/15/30/60-s `_scheduleWindsAloftRetry` chain (storms.js:578-597, armed on every failed fetch at storms.js:567, 571); the **conditional** post-scan 4-s retry (only when `S._windCache` is missing or >32 min stale, storms.js:1521-1530 — verified); and the 10-min watchdog (geo.js:926-947). The 30-min cache check (storms.js:468-476) is an anti-refetch gate, not a retry.

---

## 2. What each tab reads

All tab activation funnels through `switchPage()` (core.js:1052-1078; desktop scroll-mode 1053-1063, mobile 1065-1077). The app is reuse-oriented: tabs re-render from `S` filled at boot. The refetch exceptions and recompute waste:

### 2.1 Tab × data-source matrix

**F** fetches on activation · **F¹** fetch-once memoized · **R** reuses shared S state · **C** recomputes a derived view per switch

| Data source | Weather | Radar | Storms | 3D | Alerts | Station | AI brief | Ticker |
|---|---|---|---|---|---|---|---|---|
| Forecast blend (`S.weather`/`S._hourlyData`) | R | — | — | R | — | — | R | R |
| Scan points (`S._rawScanPts`/`S.storms`) | R+C | R+C | R+C | R+C ×2 | R | — | R | R+C |
| RainViewer catalog | — | **F** (init, radar.js:147, uncached) | — | — | — | — | — | — |
| NWS active alerts | — | R (polygons) | — | — | **F every switch** (core.js:1074 → alerts.js:113, no TTL) | — | R | R |
| SPC / NHC / hazards | — | R | R | — | F¹ (5-min storms.js:1875 / 15-min storms.js:2234 / 5-min alerts.js:406) | — | R | — |
| METAR station | R (blend) | — | — | — | R | **F¹ per location** (core.js:1073, `S._stationLocKey` guard — good) | R | — |
| Winds aloft | R | R | R | R | — | — | R | R |
| WarPulse lightning | R | **F every switch, force=true bypasses 60-s throttle** (core.js:1059/1069 → storms.js:211, 219) | R | — | — | — | R | — |
| Terrain / 3D tiles | — | — | — | F¹ per location (`_v3dLocKey`, view3d.js:1594-1603) + terrarium DEM (view3d.js:518) | — | — | — | — |
| LLM API | — | — | — | — | — | — | F on user send only (ai.js:1152, 1165) | — |

The 3D tab is fully lazy: view3d.js is absent from index.html and STATIC_ASSETS; first open injects three.js from cdn.jsdelivr.net + view3d.js (core.js:1039-1046). The CDN files can never be SW-cached (sw.js:105) — the 3D tab needs network on every cold cache.

### 2.2 Redundant recompute (verified)

1. **Per-frame `hexGridBin`:** `drawMiniSonar` re-bins all raw scan points every RAF frame at the default 80-mi sonar zoom (weather.js:925-926; RAF loop 1273-1284; default zoom gauges.js:89) — inputs change once per scan. The ≤40-mi branch already has the fix (`_clusterSonarPoints`/`S._sonarClusteredPts`, gauges.js:104-130). **Desktop amplifier:** `_initDesktopSonarKeepAlive` restarts the sonar every 2 s (core.js:952-957) and `stopSonarSweep` is mobile-only (core.js:1072), so this hot loop runs permanently on desktop.
2. Per-frame haversine+bearing per sonar point (weather.js:914-917) vs the repo's own lightning precompute precedent (storms.js:251-257).
3. **Per scan commit:** Rain Clock rebuilt 3× and badges 2× — gauges.js:130, then renderStorms' finally block (storms.js:4792-4801), then explicit repeats at radar.js:845-847. The radar.js:845/847 duplicates are pure deletions; same duplicate `updateStormBadges()` calls at geo.js:941, core.js:867/874, storms.js:1492.
4. `hexGridBin` fan-out — five call sites on identical per-scan inputs: weather.js:926, radar.js:1632 (zones), radar.js:1997 (ticker, only in non-alert phases — early return at radar.js:1964), storms.js:4694, view3d.js:1148 (`hexGridBin3D`). **Caution:** the 3D port deliberately uses a 2× hex size (view3d.js:1072 `6/√3` vs radar.js:1546 `3/√3`) — consolidate by parameterizing cell size, not naive deletion, or 3D mesh count quadruples.
5. `sonarZones3D()` runs twice per 3D activation (view3d.js:1254 + 1398, both from activate3DView 1605-1609).
6. Per Radar switch: full zone/arrow/lightning marker rebuilds on unchanged data (core.js:1059/1069 → radar.js:1621-1632, 2574-2634, 942-978); `buildPathArrows` actually runs **twice** per switch when zones+arrows are on (buildStormZones itself calls it at radar.js:1760, then switchPage again).
7. **Not** redundant (verified): `calcStormETA` and `calcStormETAForBriefing` already memoize per scan id (storms.js:1154-1156; 1284, 1376; id bumped at radar.js:832 before computeTopStorms at radar.js:840) — the later loops at storms.js:4419/4613 are cache-hit walks. Residual cleanup only: the forEach at storms.js:4419 is a no-op re-store.
8. Dead per-render work: the first `inboundCapped` computation at storms.js:4618-4634 is unconditionally overwritten at storms.js:4665-4666; `S._arrowCells` is filled then immediately wiped with no other consumer (radar.js:1754-1758).
9. `renderStorms()` full innerHTML rebuild runs into the hidden `#page-storms` on every scan commit / watchdog / ETA expiry / winds refresh (radar.js:845; geo.js:940; core.js:867, 874; storms.js:613) — it is not page-gated, unlike `renderHazards` (alerts.js:427), which is the in-repo precedent. This is also why `S._inboundShown` (written at storms.js:4666, read by the header pill core.js:1084 and Rain Clock dial weather.js:2170) exists without ever visiting the Storms tab — a layering smell (data derived inside a DOM render), not a first-visit race.

---

## 3. Network inventory

~20 external hosts from 12 client files. Caching is wildly uneven — existing good patterns: `_nhcData` 15-min + recompute-on-hit (storms.js:2232-2238), `_spcData` 5-min (storms.js:1875), `_hazardData` 5-min+locKey (alerts.js:405-409), `_rvScanFramesCache` 60-s (radar.js:710-729), `S._windCache` 30-min+100-mi (storms.js:468-476), `S._afdCache` 60-min (storms.js:688-689), lightning 60-s gap + 401/429 backoff (storms.js:211-238), station loc-key guard (core.js:1073), `_globalAirports` memo (station.js:18-20), push on-open 60-s gap (push.js:770).

### 3.1 Master table (condensed by source)

| Source | Callers | Trigger | Cache |
|---|---|---|---|
| api.rainviewer.com weather-maps.json | init.js:182 (body discarded 185); radar.js:147; radar.js:375; radar.js:712-729 | boot + **60-s monitor** (init.js:247-250) / radar init / anim stop / every scan | only radar.js:712 (60-s TTL) |
| RainViewer/IEM radar tiles | scan engine (storms.js:20-33, 104; radar.js:775-783), Leaflet display layers (radar.js:336, 396, 417, 427) | every scan / radar display | per-scan; display cache-busted |
| api.weather.gov /points | weather.js:489, 516, 570; storms.js:691 (AFD); station.js:43; radar.js:536 (airport-markers toggle) | 4× per boot (5 desktop, ~6 with retries weather.js:539-546, 603-610); station tab; user toggle | **none anywhere** |
| NWS stations / obs / gridpoints / alerts / AFD products | weather.js:494-575; station.js:48-62, 405, 453; radar.js:541-602; alerts.js:113; storms.js:699-708 | boot, tabs, every Alerts switch | none except AFD wrapper (60-min) |
| aviationweather.gov METAR/stationinfo | weather.js:359; station.js:93-642; radar.js:558-613 | boot + **120-s wind-sim interval, no hidden gate** (weather.js:1391-1406 vs radar.js:2223) | none |
| Open-Meteo forecast / pressure winds / elevation / precip | weather.js:94-128; storms.js:509-512, 1066; station.js:13; alerts.js:385-386 | boot, refresh, online event (init.js:42), scans | winds 30-min; terrain 0.05° guard; forecast none |
| SPC bundle | storms.js:1881 (ActiveWW), 1918-1919 (reports CSV), 1965-1990 (MD index + ≤10 detail pages) | fetchAlerts + fetchHazards | 5-min TTL |
| NHC bundle | 8 ArcGIS layer queries (storms.js:2432-2440), index-at/ep.xml (2593-2596), CurrentSurges (2243), GDACS (2736), **JTWC RSS via api.allorigins.win third-party proxy** (storms.js:2650-2651) | same | 15-min TTL |
| Hazard feeds (USGS, EONET ×2, NIFC, drought WMS, river gauges) | alerts.js:432-533 | boot, alerts tab, refresh | 5-min+locKey |
| Geocoders (nominatim/photon/OM/census) | geo.js:240-255, 528-541, 852-868, 1222-1234, 159 | user / GPS / travel | none (user-triggered) |
| Push worker (`_pushApiUrl`, push.js:45-54) + lightning proxy (storms.js:227-232) + devicelink (devicelink.js:275, 295 via push base, :127) | — | throttled per-caller | by design |
| Sync worker (`_syncApiUrl` — `st_syncApiUrl` override → `location.origin` on workers.dev hosting → `''`, init.js:1226-1231) | init.js:1233-1242 | user | separate config **by design** (push.js:46-48 refuses fallback) |
| CDN: three.js (core.js:1039-1046), cartocdn basemaps (radar.js:79; view3d.js:600-611), **terrarium DEM s3.amazonaws.com/elevation-tiles-prod** (view3d.js:518) | 3D/map | lazy, loc-key guarded | browser only; never SW-cached |
| AI APIs (ai.js:1152, 1165), MyMemory translate (init.js:427, persistent `_tCache`) | user | — | — |

### 3.2 Duplicate/overlapping fetch list (ranked)

1. **`/points` ×6 uncached call sites** — one response serves all consumers. Memoized `getNwsPointMeta(lat,lon)` removes 3-5 boot requests + one per feature use.
2. **weather-maps.json ×4 fetchers, 1 cache** — and the 60-s net monitor permanently re-downloads and discards it. Route everything through `_fetchRvScanFrames` (the cache already exists; don't add a fifth stash) and let the ping double as cache fill.
3. **AWC METAR ×3 consumers, no shared cache**, plus the ungated 120-s interval.
4. **NWS station discovery ×3** (weather.js:487-513; station.js:37-84; radar.js:534-552) — all rebuild what station.js already stores in `S.nearbyStations`.
5. **fetchAlerts unguarded** on every Alerts switch (core.js:1074, alerts.js:108-117) while every sibling has a TTL.
6. **Forced lightning fetch per Radar switch** (core.js:1059/1069). The scan path is already correctly unforced (radar.js:859-861); keep `force` only for the key-save user action (storms.js:196).
7. **Reverse-geocode ×3 in geo.js**: two full nominatim→photon chains (geo.js:528-541, 1222-1234, both 5-s timeouts) plus a nominatim-only variant with **no fallback and no timeout** (geo.js:852-868). Consolidating adds photon+timeout to resolveAddr — a desirable behavior change, note it.
8. **Winds-aloft ×4 retry mechanisms** (§1.4) — single owner: keep the gate + `_scheduleWindsAloftRetry` (preserving the mutual exclusion at storms.js:666); delete the post-scan 4-s retry; fold the watchdog's 30-min staleness role into the owner.
9. Elevation ×2 (storms.js:1066 grid; station.js:13 point) — same API, no shared helper.

**Dormant, do not count as live traffic:** all tropical-model.js fetches (`_nhcOpt` hard-overrides `st`/`fronts`/`flow`/`wind` to `'off'`, storms.js:2163-2170, v6.0 comment; sole caller gated at storms.js:3903); `maybeRunOuterScan` is dead (unconditional `_clearOuterScan(); return;` at radar.js:880-881, superseded per the v6.26 comment) yet still kicked from radar.js:157 and storms.js:1513.

**Deliberate duplication (leave):** scan-tile decode vs Leaflet display (different consumers); NHC/SPC/hazards double invocation absorbed by TTLs; `_pushApiUrl`/`_syncApiUrl` split.

---

## 4. Settings & thresholds

### 4.1 The shared min-dBZ: `st_stormThresholds.stormDbz.val` / `getConeMinDbz()`

Stored under `st_stormThresholds` (`_STORM_ALERT_DEFS.stormDbz`, defVal 40, thresholds.js:164); one-time normalizer snaps to 20-60/step-5 (thresholds.js:180-191). Canonical reader `getConeMinDbz()` (core.js:785-793, clamps 20-60 on read). v5.33 migration adopts legacy `st_pushThresholds.dbz` (push.js:15-35).

**One editable control:** Settings → Background Storm Alerts → Min strength (push.js:654-660) → `setPushThreshold('dbz')` (push.js:515-524) → `setConeMinDbz()` (settings.js:628-648) → `enablePushAlerts(true)` re-syncs the subscription. The Storm Cell Alerts panel shows it read-only (thresholds.js:285-294). Legacy writer `setStormAlertVal('stormDbz')` (thresholds.js:321-344) is UI-unreachable and does **not** sync push — delete or route through the live path.

```
Settings select (push.js:656)
  └─ setConeMinDbz()  settings.js:628 → st_stormThresholds.stormDbz.val
  └─ enablePushAlerts(true)  push.js:522
       └─ body.thresholds.dbz = getConeMinDbz()  push.js:400
            └─ POST /subscribe (D1) → scanner thresholdsFor(sub)  scan.js:340-348
                 └─ hit gate: c.dbz >= th.dbz  scan.js:713
```

**Consumers:** cones on map (radar.js:2756-2758); "in N cones" count (storms.js:4426, 4434); cone-focus filter (storms.js:4213-4215); in-app intensity gate (thresholds.js:164-165); subscription body (push.js:400); settings display (push.js:654); scanner gate (scan.js:713). **Bypasses/duplicates:** the vestigial `st_pushThresholds.dbz` default (push.js:86) survives as silent fallbacks at push.js:400 **and** push.js:654 — remove both so the value has one home. The wire also sends `dist: th.radius, radius: th.radius` (push.js:400) while the scanner keeps two gates with mismatched defaults `{dist:60, radius:80}` (scan.js:220, 713) — a dead distinction, but legacy D1 rows could carry a distinct `dist`, so collapse with `min(dist,radius)` or a migration.

### 4.2 Band toggles, drizzle, and the seed question

`st_alertBands` normalized by `_normAlertBands` (thresholds.js:364-372; defaults rovOn true/rovMin 5/**drizOn false**/drizMin 15); band defs light 20-29/10-min, moderate 30-44/5, heavy 45-54/5, severe 55+/5; cadences [0,5,10,15,30,45,60] (thresholds.js:357-363). Every toggle change calls `syncPushAlerts()`. Scanner `bandsFor()` applies identical defaults (scan.js:183-199); `BAND_DEFS`/`bandForDbz` are verbatim twins (scan.js:168-179 ≡ thresholds.js:357-383) under a "must match exactly" comment — in sync today by discipline only.

**Does an enabled drizzle toggle admit 15-19 dBZ to the "rain now" push? NO — verified.** `ovDbz = Math.round(overheadDbz)` (scan.js:775); `rovDbz` — the *only* overhead input to `buildRainClock` (scan.js:809-811) — is assigned solely inside `bands.rovOn && ovDbz >= 20` plus an enabled-band check (scan.js:777-781). The drizzle branch (`ovDbz >= 10 && < 20`, scan.js:792-797) emits a separate `driz` item that never touches `rovDbz` or `buildRainClock`. The dial's "rain now" anchor sees only null or ≥20 (rainclock.js:143-152, 217-226); inbound `rcHits` cells are floored at 20 **by the band gate** (`bandForDbz` returns null <20, scan.js:176, applied at 714 — `thresholdsFor` itself never clamps `th.dbz`; only the client clamps on read, core.js:789).

**Therefore the false "🌧️ rain now, ends 08:48" push is a clutter-QC/parity problem, not a threshold or drizzle problem.** Mechanism: **both sides decode low-dBZ echo** — scanner `dbzAtPoint` max-pools every pixel ≥1 dBZ over a 2-mi radius with zero clutter QC (detect.js:265, 294-301; no 'clutter' match anywhere in scanner/); the client's 90-s overhead poll likewise decodes to 5 dBZ over 3 mi (radar.js:2232, 2241) and splices it into `S._rawScanPts`. The client then *classifies it away*: `_heroBandFromZone` rejects <25 (weather.js:412-413), the dial floors at `getRainFloorDbz()` (weather.js:2142), and `isClutterOnly()` hides clutter-only scans (radar.js:1207-1214). The scanner admits the same echo at rounded ≥20 (a 19.5 dBZ pixel rounds up, scan.js:773-775) with no equivalent gates. The fix must not touch the `driz` path.

### 4.3 Hardcoded-vs-setting conflicts

| Value | Hardcoded at | Should defer to | Conflict |
|---|---|---|---|
| Scanner scan floor 15 | detect.js:31, 336 | client `STORM_MIN_DBZ=25` (core.js:764, v5.54) | **YES** — stale port |
| Scanner rain-clock floor 15 | rainclock.js:24, 143, 159 | user `st_rainFloorDbz` via `getRainFloorDbz()` (core.js:772-775) — **never in the subscription** (push.js:396-411 has no rainFloor) | **YES** — setting never travels; 15 is currently dead (all inputs pre-gated ≥20) but takes over if the gate is ever loosened |
| 2-mi overhead max-pool, floor 1 | detect.js:265, 294 | `OVERHEAD_MI=1.5` (radar.js:2177) + shared floor | **YES** — sampling path of the false push |
| Clutter rule 31/22/12/8 | radar.js:1207-1214, three branches: any ≥31 → not clutter; all <22 && n≤12 → clutter; **else n≤8 → clutter** | shared predicate; scanner has none | **YES** — port all three branches |
| **Client minute-0 floor** | weather.js:412 reads fixed `STORM_MIN_DBZ`, not `getRainFloorDbz()` — though `setRainFloorDbz` calls `refreshHeroFromZone` expecting a reaction (weather.js:2968) | user rain floor | **YES — intra-client**: lowering the floor to 10 revives the dial but not the hero/in-app rov+driz alerts (thresholds.js:399-427 read `rainOverUserNow()`) |
| In-app drizzle + 20-24 rov alerts | dead: `rainOverUserNow` nulls <25 (weather.js:412-413) so thresholds.js:419's `dbz<20` branch never fires | — | drizzle honored **only** by the scanner. Fix by reading unfloored `dbzAtLocation()` — but that is fresh only while `st_overheadPoll` is on (radar.js:2198-2200) and recent |
| X-TRK direct 1.5 mi | scan.js:712 re-encodes the number | `XTRK_TIERS` "THE single source of truth" (core.js:721-741); client gate reads the tier key (thresholds.js:236) | parity dup |
| Lightning 40 vs 45 | client ⚡ marker ≥40 (radar.js:1356) vs scanner ≥45 (scan.js:440; rainclock.js:180, 258) | one `LTG_DBZ` | drift (ai.js:737/1021's 45s are strong/urgent bars, not lightning) |
| Strength wording ladders | rainclock.js:41-46 (55/45/35) vs storms.js:3433 (65/60/52/41) vs ticker 46/52/61 (radar.js:2035, 2091-2092) | band edges | same storm, different noun per surface |
| Scanner cadence bars | scan.js:634-636 (inbound ≤45 mi & ≥30; rainNear ≥25) + scan.js:667 (overhead ≥20) | shared consts | three unshared floors in one feature |
| Storm-alert gating semantics | scanner enforces dbz+impact+dist unconditionally (scan.js:711-714) — client sends them regardless of in-app toggle state; in-app gate enforces only enabled defs (thresholds.js:204-225); in-app "Projected Miss" (`stormDist`, 6 mi, thresholds.js:162-163) **never rides the subscription** | — | one visible setting silently ignored server-side |
| Lightning push cadence | no user toggle at all — pushed whenever corridor cells exist, 30-min `COOLDOWN.ltg` (scan.js:44, 748-749) | — | settings-coverage gap |
| rov cadence | in-app honors rovMin as-is (thresholds.js:408); scanner floors non-severe to 10-min `PUSH_FLOOR_MS` (scan.js:782) | documented iOS-delivery intent (scan.js:201-217) | ok-by-design, document |

Weather thresholds: scanner `WX_DEFS` (alerts.js:26-73) is a faithful port of `_WX_ALERT_DEFS` (thresholds.js:2-13), deliberately skipping `uvMax` (alerts.js:70-73) — which is dead client-side too (`S._uvIndex` never assigned anywhere in docs/js).

### 4.4 How the rain-now gate should read the user's settings

Keep the architecture (rovOn + enabled-band gate feeding buildRainClock's minute-0 anchor); replace every number with a setting or shared constant: (1) `dbzAtPoint` samples at a shared `OVERHEAD_MI=1.5` and decodes at the shared 25 floor instead of 1 (exported from radar-shared.js, which detect.js already `createRequire`s, detect.js:16-27); (2) apply a ported three-branch `isClutterOnly` (or persistence-across-two-scans) screen before rounding and band-testing; (3) add `thresholds.rainFloor = getRainFloorDbz()` to the subscription (push.js:399-411) and pass it into `buildRainClock` to replace the stale `RC_MIN_DBZ=15`. Untouched: the `driz` item (scan.js:792-797) keeps working for opted-in users. Client-side, resolve the intra-client conflict at weather.js:412 (fixed 25 vs user floor) *before* baking a shared constant, and fix the dead in-app drizzle path via unfloored `dbzAtLocation()` — noting its freshness depends on `st_overheadPoll`.

---

## 5. Scanner/client parity drift

### 5.1 The one working single-source mechanism

`docs/js/radar-shared.js` (pure — header comment forbids DOM/localStorage, radar-shared.js:8-13) shares `haversine`/`bearingDeg`/`degToDir`, tile math, `DBZ_SCALE`, `nexradToDbz`, `rvToDbz`. Browser: loaded first (index.html:723, sw.js:11). Node: `createRequire('../docs/js/radar-shared.js')` in detect.js:16-17, re-exported at detect.js:21-27 (verified), enabled by the guarded CommonJS export (radar-shared.js:178-186). Enforced by `scanner/test-shared-parity.mjs` — **but the test covers only palette/geo/tile re-exports (test-shared-parity.mjs:20-113); the comment at detect.js:229-234 claiming crossTrackMi "stays honest via test-shared-parity.mjs" is false — no such case exists.** Every consolidation below should extend this test.

### 5.2 Drift table

| Item | Client | Scanner | Verdict |
|---|---|---|---|
| Pixel→dBZ, geo, tile math | radar-shared globals | createRequire re-export | **shared by construction** |
| Cell scan floor | 25 (core.js:764; storms.js:1489) | 15 (detect.js:31, 336) | **drifted** — stale pre-v5.54 port; scanner clusters echoes the app no longer scans for |
| Overhead radius/floor | 1.5 mi direct test (radar.js:2177-2192, v5.49 replaced hex-bins for exactly this bug class) | 2-mi max-pool, floor 1, comment still cites the old hex-bin (detect.js:262-265, 294) | **drifted** — the false-push sampler |
| Clutter QC | isClutterOnly 3-branch (radar.js:1207-1214) | none | **drifted** |
| Rain-clock floor | windows honor `getRainFloorDbz()` (weather.js:2142, 2276); **minute-0 pinned at fixed 25** (weather.js:412) | RC_MIN_DBZ=15, unreachable (inputs pre-gated ≥20 at scan.js:714, 777) | **drifted + dead**, and the client itself has two rain-now floors |
| Radar-age ETA correction | subtracts radarAgeMin (weather.js:2204; core.js:34-46) | param exists (rainclock.js:128) but scan.js:809-812 never passes it → scanner minutes run ~5 min late | drifted (low) |
| Idle span | 720 (weather.js:2074-2079) | 180 (rainclock.js:60) | drifted, harmless (scanner never narrates an empty dial) |
| Span buckets, cell radius `(dbz-20)/15` clamp, pass duration, intensity words, window merge, boundary rounding | weather.js:2040-2342, thresholds.js:403 | rainclock.js:23-37, 133-175; scan.js:773-775 | in sync (parity dup) |
| BAND_DEFS/cadences/bandForDbz/normalizer | thresholds.js:357-383 | scan.js:160-199 | in sync, by discipline |
| Impact model | cone-angle model **deleted v5.99** (thresholds.js:196-198); real impact = X-TRK stormMaster (storms.js:3385-3398); one inline legacy copy in the hex popup (radar.js:1672-1687) | `calcImpact` = full port of the deleted model (detect.js:209-224), feeding `th.impact` at scan.js:713 | **drifted** — scanner ports an abandoned model |
| ETA | calcStormETA w/ terrain/NWS boosts (storms.js:1153-1219) | calcETA geometry core (detect.js:243-255), identical constants | deliberate simplification |
| X-TRK direct | 1.5 via XTRK_TIERS (core.js:734-741) | literal 1.5 (scan.js:712) | same value, re-encoded |
| Scan geometry (zoom pick, 48-tile guard, tile URLs, spacingFilter non-hiRes) | radar.js:745-779; storms.js:1644-1677 | detect.js:313-342, 172-203 | value-identical textual dup — prime shared-file candidate |
| Steering math | storms.js:409-422 | detect.js:86-99 identical; provider set smaller by design | in sync |
| Scan radius | user 80-200 mi (core.js:13-14) | clamped ≤80 (scan.js:346, verified) + fixed 80-mi lightning corridor (scan.js:618) | probably deliberate (tile budget) — undocumented |
| Tropical constants (Saffir 39/74/96/111/130/157, 1.15078, 0.621371, GDACS 150 mi, 12-h stale) | storms.js:2379-2382, 2452-2467, 2771, 2990-2998, 3056 | tropical.js:22-47, 92, 141, 155-156 | in sync; the two 12-h stale *mechanisms* differ by design (fingerprint vs advisory age) |
| WX defs / station blend | thresholds.js:2-13; weather.js:450+ | alerts.js:26-73, 193-217 | in sync (deliberate ports) |
| haversine | shared (radar-shared.js:21, R=3959/atan2) | alerts.js:77-82 defines its **own** (R=3958.8/asin) despite detect.js:21 re-exporting the shared one | accidental dup inside the scanner — delete |
| Lightning signal | real observed strikes ≤10 mi (storms.js:263-279); ⚡ marker ≥40 (radar.js:1356) | reflectivity estimate ≥45 (scan.js:440) | different signals by design; the 40/45 marker drift is accidental |

### 5.3 Shared-constants proposal (reuse the radar-shared.js mechanism; extend test-shared-parity.mjs for each)

Move into radar-shared.js (or a sibling built identically): **STORM_MIN_DBZ (25)** · **OVERHEAD_MI (1.5) + rain-floor default/clamps** · **BAND_DEFS/BAND_CADENCE_OPTS/bandForDbz + drizzle band (10-19)** · **cone/ETA geometry constants** (`(dbz-20)/15` cap 3, cone half-angle 15°, closing cap 60°, X-TRK tiers incl. direct 1.5) · **scan geometry** (zoom pick, 48-tile guard, tile-URL builders, `spacingFilter(points, origin, hiRes)`, `isUSLocation`) · **`isClutterOnly(cells)` all-three-branches** · **LTG_DBZ (45)** · **tropical constant block**. Leave duplicated (documented): full calcStormETA vs calcETA; the two stale-gate mechanisms; station blending; scanner-only push wording; hiRes mode; Skylink provider. Delete outright: scanner/alerts.js haversine; RC_MIN_DBZ; client uvMax (or wire `S._uvIndex` — the scanner already fetches uv_index, alerts.js:153); scanner `calcImpact` **if** the owner confirms X-TRK-direct as the sole push criterion (open question — it currently feeds `th.impact` at scan.js:713).

---

## 6. Storage inventory

The client persists ~100 localStorage keys (one exhaustive extraction pass over docs/js + sw.js; plus the dynamic `st_grid_*` family), 2 sessionStorage keys (`st_autoUpd`, settings.js:270), 2 IndexedDB databases (custom-icons, icons.js:47-48; `st-notif`/queue — the SW→app push mailbox, core.js:198-201), and one Cache API cache (stormtracker-v753). Histories are capped (30-100 entries, e.g. thresholds.js:482-484) and cooldown maps TTL-pruned on load. Full key lists live in the parse-time/boot tables of §1; flags below.

### 6.1 Dead / duplicate / unbounded

| Key | Problem | Evidence | Fix |
|---|---|---|---|
| `st_locAsked` | written once, never read (only other mention: skip list) | geo.js:458; devicelink.js:23 (verified — sole matches) | delete both |
| `st_rainAlertCooldown` | read into a variable never consulted — checkRainAlert uses the history entry's ts | thresholds.js:473-474 vs 496-498 (verified) | delete thresholds.js:473-474 |
| `st_pushThresholds.dbz` | vestigial duplicate of the one shared min-dBZ; survives as fallbacks at push.js:400 **and** push.js:654 | push.js:86, 400, 654 (verified) | drop the field + both fallbacks |
| `st_tcache` | translation cache grows without bound | init.js:432-435, 491, 512, 546 | cap per-language. Quota exhaustion is worse than "silent": many setItem calls are **unwrapped** and would throw (init.js:395, 1289-1290, 1414; ai.js:14-55; gauges.js:18, 92-93; settings.js:593-622; storms.js:4094; weather.js:2125; core.js:618, 635-636, 697-698) |
| `st_stRuns` | prunes only the storm key being saved; dead-storm arrays persist forever | tropical-model.js:241-250 | drop keys older than the 6-day cut in `_stSaveRun` |
| `st_nhcLayers` | 4 of 6 stored options hard-overridden to 'off' (v6.0), yet still written and transferred | storms.js:2161-2178 (verified — "Persisted; read live" is true only for tracks/dots) | document or trim the payload |
| `st_arrowStyle` | valid key easily missed in audits — read radar.js:2506, written radar.js:2563 (verified); transfers via device link, absent from email sync | — | include in the shared manifest |
| `st_installDismissed` | 7-day snooze, not permanent (comparison at init.js:10-11) | — | label correctly |

### 6.2 Two settings-transfer mechanisms, independently drifted

Email sync collects an explicit 15-field list (init.js:1246-1259); device link prefix-scans all `st_*` minus DL_SKIP_KEYS/DL_SECRET_KEYS (devicelink.js:20-26, 51-63 — verified). Consequences: `st_alertBands`, `st_rainFloorDbz`, `st_nhc_prox_radius` etc. transfer via device link but never reach the sync server; unprefixed keys (`eqRadius` alerts.js:365-367, `autoRefreshMin` geo.js:896, `gpsInterval` geo.js:1069, `v3d_labels`/`v3d_tiers` view3d.js:36-62) are silently lost by the prefix scan; `st_spc_reports` (a real preference, alerts.js:637/storms.js:2056) sits wrongly in the skip list; `st_syncEmail` transfers by default while its paired `st_syncToken` is opt-in-secret (half-signed-in import); `st_stormFreeze` transfers (not in skip list) — benign in practice (an imported `since` survives only when the receiver's own feed returns the identical fingerprint, storms.js:3117; fingerprint-identical ≥12 h *is* the dead-feed criterion, and any change self-heals, storms.js:3133-3135) but belongs in the skip list as transient-cache hygiene.

**`st_pushCode`/`st_pushFeedToken` in DL_SECRET_KEYS (devicelink.js:20): not a subscription takeover.** The worker moves a row only on old-endpoint+code together (worker/index.js:344-346, verified SELECT at 350-352), `st_pushEndpoint` is skipped, `uniqueCode` treats a code held by another endpoint as taken (worker/index.js:40-51), and the client overwrites the imported code with the server's response (push.js:425-426). Residual defect: if the sender is currently unsubscribed (Disable frees the code), the importer adopts the sender's durable manage code. Still move both keys to DL_SKIP_KEYS.

**Deliberate duplication — leave, and document:** `st_pushSub` ↔ `st_pushCode`/`st_pushEndpoint` (durability across Disable, push.js:57-63); `st_units` ↔ `st_customUnits` (preset memory, core.js:633-644); `st_stormLifecycle` ↔ `st_stormFreeze` (history vs self-pruning cache, storms.js:3117-3151). `st_stormThresholds` is accessed raw in four files bypassing its accessors (init.js:1249, 1269; settings.js:638-640; push.js:22-30; core.js:788) — route through `_loadStormThresholds`/`_saveStormThresholds`; add `st_defaults_v230e` (radar.js:2496-2503) to DL_SKIP alongside `st_minDbzMerged_v533`.

---

## 7. Ranked consolidation plan

Ranked by payoff. LOC deltas are estimates; every item is net-negative code.

### Quick wins (safe, mechanical)

| # | What | Files | Risk | LOC |
|---|---|---|---|---|
| 1 | Memoized `getNwsPointMeta(lat,lon)` (rounded-key, ~1-h TTL, `_nhcData`-style) for all 6 `/points` sites | weather.js:489/516/570, storms.js:691, station.js:43, radar.js:536 | low | ~-30, −3-5 requests/boot |
| 2 | Route all weather-maps.json reads through `_fetchRvScanFrames` (radar.js:712); boot/60-s speed test seeds the cache instead of discarding the body | init.js:182-185, radar.js:147, 375 | low | ~-25, kills a perpetual 1-req/min download |
| 3 | 5-min/locKey TTL guard on `fetchAlerts` (copy alerts.js:405-409) | alerts.js:108 | low | +5, −1 fetch per Alerts switch |
| 4 | Drop `force` from `refreshLightningStrikes` at tab-switch sites only (scan path already unforced, radar.js:861; keep force at storms.js:196) | core.js:1059, 1069 | low | 0, saves paid quota |
| 5 | `document.hidden` gate + page-gating on the wind sim (both the 120-s AWC fetch and the 100-ms interval), mirroring radar.js:2223 / core.js:1072 | weather.js:1391-1481 | low | +4 |
| 6 | Delete dead code: storms.js:4618-4634 (overwritten inboundCapped), radar.js:1754-1758 (`S._arrowCells`), maybeRunOuterScan + its two callers (radar.js:875-904, 157; storms.js:1513), thresholds.js:473-474, geo.js:458 (`st_locAsked`), the `setStormAlertVal('stormDbz')` branch (thresholds.js:321-344), scanner/alerts.js:77-82 haversine, mPING dead cache (honor the TTL or delete `S._mpingCache`, radar.js:138, 2388, 2477, 2490) | 5 files | low | ~-120 |
| 7 | Delete duplicate post-render calls: `updateStormBadges`/`refreshRainClock` at radar.js:845-847, geo.js:941, core.js:867/874, storms.js:1492 (renderStorms' finally block guarantees both, storms.js:4792-4801); delete the no-op forEach at storms.js:4419 | 4 files | low | ~-10, −2 dial rebuilds/scan |
| 8 | Drop `st_pushThresholds.dbz` + both fallbacks (push.js:86, 400, 654); collapse `dist` into `radius` — server-side `min(dist,radius)` for legacy D1 rows | push.js, scan.js:220/343-346/713 | low-med (legacy rows) | ~-10 |
| 9 | Clear `S._airportDataCache` in setLoc's reset block (stale-city bug, radar.js:512/579 vs geo.js:662-669) | geo.js | low | +1 |

### Structural (needs care)

| # | What | Files | Risk | Notes |
|---|---|---|---|---|
| 10 | **The rain-now fix (approved pending):** shared `OVERHEAD_MI` + 25 floor + 3-branch clutter screen in `dbzAtPoint`; ship `thresholds.rainFloor` in the subscription; replace `RC_MIN_DBZ`. Driz path untouched. | radar-shared.js, detect.js, scan.js, rainclock.js, push.js | med | must first answer open question 1 (which floor); extend test-shared-parity.mjs |
| 11 | Shared constants block per §5.3 (STORM_MIN_DBZ, band defs, XTRK tiers, LTG_DBZ, cone/ETA geometry, scan geometry, isClutterOnly, tropical block) + parity-test cases; fix the false coverage comment at detect.js:229-234 | radar-shared.js + 8 consumers | med | deletes ~6 hand-synced twin tables; parity dups consolidate here, never by deleting one side |
| 12 | Scan-id-keyed hex-bin cache serving all 5 `hexGridBin` sites; **parameterize cell size first** (radar.js:1546 `3/√3` vs view3d.js:1072 `6/√3`), then delete `hexGridBin3D` (view3d.js:1073-1118); compute `sonarZones3D` once per 3D activation; precompute sonar polar coords per the storms.js:251-257 precedent | radar.js, weather.js, storms.js, view3d.js | med | biggest CPU win (per-frame bin at default zoom; permanent on desktop via core.js:952-957) |
| 13 | One scan scheduler owning "next scan due" (merge 60-min auto-refresh's scan call + 10/15/30-min adaptive auto-scan); keep the 3-mi overhead poll separate (different purpose) | geo.js:907-915, core.js:818-837 | med | preserves travel-mode skip (geo.js:908) |
| 14 | Winds-aloft: delete the post-scan 4-s retry (storms.js:1521-1530); keep gate + `_scheduleWindsAloftRetry` with their mutual exclusion (storms.js:666); fold the watchdog's 30-min staleness role into the owner or keep the watchdog as-is | storms.js, geo.js | med | the 6-s background chain, not the watchdog, is what makes the 4-s retry redundant |
| 15 | One station-discovery function filling `S.nearbyStations` for weather.js:487-513, station.js:37-84, radar.js:534-552; one `reverseGeoLookup` for geo.js:528-541/852-868/1222-1234 (adds photon+timeout to resolveAddr — behavior change, desirable) | 4 files | med | ~-80 |
| 16 | One settings-transfer manifest (include/skip/secret) consumed by both `DL_collect` and `_collectSyncedSettings`; move `st_pushCode`/`st_pushFeedToken`/`st_syncEmail`→skip-or-secret-pair, `st_stormFreeze`/`st_defaults_v230e`→skip, `st_spc_reports`→include; rename unprefixed keys to `st_*` with legacy-read migration | devicelink.js, init.js + key owners | med | fixes both drifted lists at once |
| 17 | Move the inbound-set derivation out of `_renderStormsCore` into `computeTopStorms` (data layer); then page-gate `renderStorms` like `renderHazards` (alerts.js:427) | storms.js, radar.js | med | removes the hidden coupling on `S._inboundShown` (core.js:1084, weather.js:2170) |
| 18 | Offline honesty: persist last `fetchWeather` payload (`st_lastWeather`+ts) or fix the banner (init.js:52); decide on self-hosting Leaflet/fonts (index.html:23-25) so the shell is actually cacheable | weather.js, init.js, index.html, sw.js | med | — |
| 19 | Resolve the intra-client rain-now floor: make `_heroBandFromZone` read `getRainFloorDbz()` (weather.js:412) or document the fixed 25; then fix or delete the dead in-app drizzle/20-24 alerts (thresholds.js:399-427) — noting the unfloored-oracle fix depends on `st_overheadPoll` | weather.js, thresholds.js | med | prerequisite for #10's shared floor |

### Deliberately leave alone (with why)

- **Parity ports that must stay separate:** full `calcStormETA` vs `calcETA` (terrain/NWS state absent server-side); the two 12-h tropical stale mechanisms; station blending implementations; scanner-only push wording; observed-strike vs reflectivity lightning signals (device-local key can't ship, storms.js:263-264). Consolidate their *constants* (item 11), never the logic.
- **NHC/SPC/hazards double invocation** — absorbed by TTLs stamped-before-fetch; working as designed.
- **`_pushApiUrl` vs `_syncApiUrl`** — documented intent (push.js:46-48).
- **`st_pushSub`/code/endpoint, `st_units`/`st_customUnits`, lifecycle/freeze pairs** — durability/preset semantics (§6.2); annotate so a future cleanup doesn't break Disable/re-enable.
- **`PUSH_FLOOR_MS`/`DIGEST_FLOOR_MS`, LTG_RADIUS/LTG_NEAR** — documented iOS-delivery and safety-corridor policy (scan.js:201-228).
- **The awaited boot update check** (init.js:254) — documented intent; only revisit if boot latency becomes a complaint (race against a shorter timeout).

Rough total: ~-600 to -900 LOC net, with the scanner and client reading every shared number from one file.

---

## 8. Open questions for the owner

1. **Which floor does the shared overhead path adopt** — the fixed 25 (weather.js:412) or the user's `st_rainFloorDbz` (core.js:772-775)? The client currently disagrees with itself; item 10 bakes whichever you pick into the single source of truth.
2. **Is the in-app drizzle alert supposed to work**, or is drizzle push-only by design? (Dead since the 25-floor at weather.js:412-413; the scanner path works.)
3. **Is the impact gate still wanted?** The client deleted the cone-angle model in v5.99 (thresholds.js:196-198), but the scanner still computes `calcImpact` and filters on `th.impact` (scan.js:713). If X-TRK-direct is the sole criterion, `calcImpact`, the `impact` wire field, and the radar.js:1672-1687 inline copy all delete.
4. **Legacy D1 rows with a distinct `dist`** — migrate, or collapse with `min(dist,radius)`? (Every current client sends them equal, push.js:400.)
5. **Scanner radius clamp ≤80 mi** (scan.js:346) vs the client's 80-200-mi scan setting (core.js:13-14) — deliberate tile-budget cap? If yes, document; if no, it's a parity gap.
6. **Lightning pushes have no user toggle** (scan.js:748-749, fixed 30-min cooldown) — intended life-safety default, or a settings gap?
7. **Dormant code:** revive or delete tropical-model.js's dark fetchers (storms.js:2163-2170) and `maybeRunOuterScan` (radar.js:875-904)?
8. **`uvMax`** — wire `S._uvIndex` (scanner already fetches uv_index, alerts.js:153) or delete the def (thresholds.js:12)?
9. **Settings-transfer policy:** should email sync and device link carry the *same* key set (item 16), and should the five unprefixed keys be renamed `st_*`?
10. **Offline story:** persist last weather for honest stale rendering, and self-host Leaflet/fonts — or accept that offline means shell-only and fix the banner wording (init.js:52)?