# StormTracker Changelog

This file tracks per-version changes for the static site under `docs/`.
Newest first. Service-worker cache name follows the version (e.g., `stormtracker-v542` for v4.46).

  ## v6.64

  **GOES GLM satellite lightning — free, keyless observed strikes + source picker.**

  - **New pipeline: NOAA GOES GLM → worker → app.** `scanner/glm_fetch.py`
    (new `glm-lightning` job in `storm-scan.yml`, riding the same ~5-min
    workflow_dispatch heartbeat as the push scan) downloads the last
    ~16 minutes of GLM L2 LCFA granules from the public `noaa-goes19` S3
    bucket (public domain, keyless, quota-less), parses them with netCDF4
    (downloads parallel, parsing sequential — the HDF5 C library is not
    thread-safe), keeps `flash_quality_flag == 0` flashes inside a CONUS bbox
    (env-tunable: `GOES_BUCKET`, `GLM_WINDOW_MIN`, `GLM_BBOX`), and POSTs a
    compact snapshot (~8000-flash cap) to the worker's new `POST /glm-ingest`
    (auth: existing `x-scanner-secret`; stored as one blob in D1 `meta`).
    `GET /glm` serves it back with the same query params and response shape as
    the WarPulse `/lightning` proxy (`flash_timestamp_utc` string included) so
    the client parses both with one code path. Measured end-to-end: 46
    granules fetched+parsed in ~4 s; newest flash 28 s old at ingest time.
  - **Client source chain + picker.** `refreshLightningStrikes()` is now an
    orchestrator over `_ltgFetchWarPulse()` / `_ltgFetchGLM()` with shared
    `_ltgApplyFlashes()` (parse, plot, sonar, proximity alert). New setting
    `st_ltgSource`: auto (key → satellite → estimate, default) / warpulse /
    glm / radar, with a dropdown in Settings → ⚡ Lightning. GLM freshness is
    anchored to the snapshot's build time, so a stalled pipeline ages out via
    the existing `ltgLive()` 10-min window and the radar estimate takes over.
    `S._ltgStrikes.src`/`sat` tag the active source; the Storms-tab footnote,
    Settings status line, and AI context all name it (with the ~8–14 km GLM
    geolocation caveat; satellite proximity alerts show "~" distances).
    Clearing the WarPulse key now hands over to GLM instead of going dark.
  - **Deploy notes:** worker redeploy required (`wrangler deploy` in
    `worker/`); no new secrets (reuses `WORKER_URL`/`SCANNER_SECRET` already
    set for the scanner). See `GLM_LIGHTNING_SETUP.md`.
  - Cache: `?v=762`, SW `stormtracker-v762`.

  ## v6.63

  **Lightning quota vs bad-key diagnosis · Rain Clock refresh after late winds aloft.**

  - **Lightning (WarPulse) errors are now diagnosed, not lumped together.** The
    `/lightning` proxy passes WarPulse's status through verbatim, and WarPulse can
    answer 403 both for an invalid key AND when the plan's monthly units run out —
    the client treated any 401/403 as "key rejected". `refreshLightningStrikes()`
    now reads the error BODY: any 429, or a detail mentioning quota/limit/usage,
    is classified as quota exhaustion (distinct toast, 60-min backoff) instead of
    a rejected key (30-min backoff). The last real outcome (live strike count /
    quota reached / key rejected, with the provider's own error text and time) is
    stored in `S._ltgLastErr` and rendered into a new status line under
    Settings → ⚡ Lightning (`#lightning-key-status`, populated by
    `_ltgSetStatus()` on settings-open and after every fetch). A later successful
    call clears the verdict and re-arms the one-shot warnings.
  - **Rain Clock no longer stays on "No rain expected" after winds aloft lands
    late.** Every per-storm motion product (`_eta`, `_brief`, `_m`, cone stats) is
    cached under `S._stormScanId`, which only a radar scan bumps. When winds aloft
    arrived after the scan had rendered (slow link: the 30 s gate fell through),
    `refreshStormViewsForWinds()` re-ran `renderStorms()` but every ETA call hit
    its same-scan cache and returned the pre-winds `eta:null` — so the dial kept
    "No rain expected" while its own footer showed live steering. The refresh now
    calls `bumpStormScanId()` first so ETAs/tiers genuinely recompute. Also,
    `_applyAloftData()` now queues that refresh itself (dedup'd, deferred one
    tick) whenever steering first resolves while storms are already rendered —
    previously only the 4-attempt background retry path refreshed, so winds
    arriving via the next scan's own fetch (or any other route) left the dial
    stale until a full new scan.
  - **Honest dial when timing is unresolved.** If `S._inboundShown` has cells but
    none produced a paintable arrival window (ETAs unresolved), the dial center
    now reads "N inbound · timing pending" instead of "No rain expected",
    which flatly contradicted the "N inbound" badge above it.
  - Cache: `?v=761`, SW `stormtracker-v761`.

  ## v6.62

  **Briefing accuracy pass — real bulk shear, calibrated certainty, honest aviation/marine wording.**

  - **Wind shear fixed at the source.** The briefing's "bulk shear" was a scalar speed difference (|upper − surface|) in km/h, mislabeled as mph — in weak-flow directional regimes it read an impossible "0.1 mph". It's now the true 0–6 km VECTOR shear (same math as the storm cards' `computeShearProfile()`), shown with correct units plus knots everywhere (Thunderstorm Potential popup, structured briefing, AI context). If the wind profile is degenerate, shear is omitted rather than shown as a near-zero artifact. The Thunderstorm Potential lift score also converted km/h→mph before scoring (it was silently scoring km/h against mph bands).
  - **Rain chances now reach the AI.** Hourly precipitation probability (PoP) was never requested from Open-Meteo, so the briefing could say "today stays dry" while the official forecast carried a 30% storm chance. The hourly request now includes `precipitation_probability`, and the AI context gets a RAIN CHANCES block (peak % next 12 h and 12–48 h, with timing) plus a rule: ≥20% is never "dry", and storm timing must match when the probability peaks.
  - **Certainty calibration.** 48-h rain totals are now labeled as model-grid estimates ("could locally drop around X"), never promised amounts. Radar motion verdicts softened ("receding — not projected to affect your location" instead of "no threat"), and a new prompt rule stops flat "no rain is coming" claims when the environment can still pop new cells, plus bans categorical "not a flash-flood scenario" wording when downpours are possible.
  - **Aviation/marine honesty.** Icing dropped from the standing convective-hazard lists (only mentioned when the data supports it); ceilings must come from actual METAR BKN/OVC layers (FEW/SCT = no ceiling); turbulence claims attributed to the data rather than asserted. Marine sea state / over-water visibility must be labeled as wind-derived estimates — the data contains no wave or marine-visibility observations to quote as fact.

  ## v6.61

  **Watch-direction hint from steering winds — "Keep an eye to the NW."**

  - New shared helper `watchDirHint(mv)` in `docs/js/radar-shared.js` (exported to the
    scanner via `scanner/detect.js`): reciprocal of the steering heading = the side new
    development arrives from. Gated on the same `speed >= 2 mph` floor every other
    steering consumer uses.
  - Surfaced in three places, one wording: Rain Clock footer (only when the dial has no
    arcs — otherwise the dial already shows it), System Briefing quiet branch, and the
    scanner's "Strong storms nearby" awareness push body.
  - Cache: `?v=759`, SW `stormtracker-v759`.

  ## v5.86

  **GDACS tropical source: movement direction/speed + past-track history for every storm, global cones.**

  - New `_fetchGDACSStorms()` (storms.js): one CORS-open, no-key call to `gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC` returns every current tropical cyclone worldwide with geometry embedded per event. Features are grouped by `eventid` (filtered to `iscurrent === "true"`) and classified by `properties.Class`: `Point_Centroid` (position + props), `Poly_Cones` (uncertainty cone), `Line_Line_N` (track segments), `Point_Polygon_Point_N` (timestamped position fixes — small circle polygons reduced to centroids, label like `"20/07 03:00 UTC"`). The per-event `geteventdata` detail endpoint is NOT JSON — never fetched.
  - Movement derived from the two most recent PAST fixes (`haversine`/`bearingDeg`, guarded ≥0.5 h and >0.5 mi): fills `moveDir`/`moveSpeed` for any storm missing them (JTWC RSS and NHC ArcGIS often omit these) — `_moveSrc:'gdacs'`.
  - History vs forecast split at "now" using `_parseGdacsPtTime()` (day/month labels resolved to the year landing closest to now, handles New Year): past fixes → `_nhcData.history` polylines (solid muted trail in storm color), future fixes → forecast. Position dots render for the SELECTED storm only (grey = past, cyan = future; popup shows the fix time).
  - Merge in `fetchNHCData` (5th `Promise.allSettled` entry): match by normalized name (`FAUSTO-26` → `Fausto`) or <300 mi proximity; attaches `_gdacs{alertlevel,eventid,reportUrl,countries}`, gap-fills `maxWind`, cone + forecast track ONLY for storms lacking NHC/JTWC graphics (strict non-empty id/name match, mirroring `_isUserInCone`) — so in-cone detection and "Tap for forecast track" now work in JTWC basins (W. Pacific, Indian Ocean, S. Hemisphere). Unmatched GDACS events become new storms (`id: GDACS_<eventid>`, `_source:'gdacs'`).
  - UI: GDACS alert-level badge (Green/Orange/Red) on tropical cards + popups; `(GDACS)` source tag; footers now read "NHC + JTWC + GDACS".
  - Known parity gap: the push scanner (`scanner/tropical.js`) still only knows NHC cones — a W. Pacific in-app IN CONE won't have a matching push. Possible follow-up.
  - Sources evaluated and rejected: xweather (paid key), tidetech (key required), pocketworld (CORS header absent despite docs, thin data), weather-mcp (AI wrapper of weather.gov, not a feed), cyclocane (website, no API).
  - Cache: `?v=683`, SW `stormtracker-v683`.

  ## v5.69

  **Real lightning strikes (WarPulse) — live observed data on map + sonar.**

  - New Cloudflare worker route `GET /lightning` (worker/index.js): pure pass-through to `api.warpulse.com/v1/flashes`. WarPulse sends no CORS headers, so browsers can't call it directly; the worker adds CORS, forwards the user's key from the `X-API-Key` request header (never stored/logged server-side), whitelists the bbox/since_minutes/limit params, and relays the `x-quota-cost` response header (exposed via `Access-Control-Expose-Headers`).
  - Client fetch (`refreshLightningStrikes()` in storms.js): rides the scan pipeline via `commitScanResults` (non-blocking), throttled to ≥60 s between calls, `since_minutes=15`, `limit=500` (free-plan cap). Bbox = scan radius (min 60 mi) around the user's location. Quota math: free plan 50 k units/month, cost = ceil(flashes/100) min 1 → worst case ~5 units/scan, well within budget.
  - Error handling: 401/403 → 30-min backoff + one-time "key rejected" toast (cleared when the key is re-saved); 429 → 10-min backoff; timestamps arrive as `"YYYY-MM-DD HH:MM:SS.ffffff"` UTC with no zone marker — normalized to ISO+Z before `Date.parse`.
  - Map rendering (`plotLightningStrikes()` in radar.js): up to 400 age-faded circle markers — bright yellow <5 min, orange 5-10, dim 10-15; redrawn on every scan commit and fetch.
  - Live data suppresses the radar-derived estimates while fresh (<10 min, `ltgLive()`): the ≥40 dBZ ⚡ map markers and the sonar's ≥48 dBZ flash dots are gated off, and the sonar instead plots real strikes through the same flash-cluster animation. Storms-tab footnote switches to "N live strikes (last 15 min) · Observed via WarPulse". Everything falls back to estimates automatically when data goes stale or no key is set.
  - Settings hint, tutorial (⚡ Lightning Indicators), and changelog updated to explain the live-vs-estimated distinction.
  - Cache: `?v=666`, SW `stormtracker-v666`.

  ## v5.55

  **Smarter address search: messy/redundant addresses, retry ladder, wrong-area rejection.**

  - New parse step (`_addrParse` in geo.js): splits on commas, de-dupes repeated segments ("Sevierville, TN, Sevierville, TN" → once), and strips junk partial postcodes ("TN 3" when "37876" appears later; "ON K1M" when "K1M 1M4" appears) — locality segments only, so European trailing house numbers ("Marienplatz 8") survive. Extracts street/house number/city/state/zip for retries and labeling.
  - Progressive retry ladder (`smartGeoSearch`): up to 6 candidate queries from most specific to broadest (full → street+zip → street+city+state → road+locality → road+zip → locality-only), each through the existing Nominatim → Photon → Open-Meteo chain, 600 ms between rungs, 12 s overall budget. First house-level match wins immediately; best road-level hit is kept otherwise.
  - Sanity guards: results must agree with the typed locality (zip OR state OR city — `_addrLocMatch`, with US state abbreviation↔full-name mapping) and the typed street (`_roadMatch`, longest word must appear). Fuzzy matches in the wrong state (e.g. Photon returning McKinney TX for a Sevierville TN zip) or on the wrong road are skipped — wrong location is worse than "not found" for storm alerts.
  - US Census Bureau geocoder added as a house-level rescue (JSONP — no CORS on that API) when the input looks like a US street address (state + 5-digit zip) and OSM only got road-level.
  - Label preservation: when only the road/area is matched, the location name keeps the user's typed street + city + state + zip (e.g. "1509 Bald Eagle Drive, Sevierville, TN 37876") instead of the geocoder's county ("Sevier County, Tennessee").
  - Autocomplete suggestions reuse the same normalization (canonical query + street+zip retry).
  - Guaranteed locality fallback: if the whole ladder strikes out (e.g. primary geocoder unreachable), the typed locality is resolved on its own and demoted to a city-level pin (street fields stripped so the label keeps the user's typed street) — better than "Location not found".
  - Search diagnostics: every search records a `[geo trace]` (console) of each rung — query, per-provider outcome (hits/errors), and rejection reason. On failure, a troubleshooter panel (`#loc-search-debug` in the location overlay, `#welcome-search-debug` on the welcome screen) shows the cleaned query, each attempt, and a tip. `searchLoc` gained a re-entrancy guard (`S._searching`).
  - Welcome-screen search unified: `_welcomeSearch` (init.js) now uses the same `smartGeoSearch` ladder + label logic (`_geoLabelFor`) as the location overlay, instead of its old single-shot lookup.
  - Bug fix: `saveUnits()` was called in six places (unit auto-switching, presets, individual unit changes) but never defined — a `ReferenceError` crashed any search that triggered a region-based unit switch (e.g. picking a Canadian address while on US units). Now defined in core.js (persists to `st_units`).
  - Cache: `?v=654`, SW `stormtracker-v654`.

  ## v5.54

  **Unified 25 dBZ rain floor for the Rain Clock + 36h graph (was 15 / 12 / none).**

  - `STORM_MIN_DBZ` raised 15 → 25 — the shared rain-detection floor used by the radar scan and the Rain Clock's radar dial (`_RC_MIN_DBZ` reads it).
  - The Rain Clock forecast-ring floor now reads the same constant (`_RC_FC_MIN_DBZ = STORM_MIN_DBZ`, was a separate 12), so both rings filter identically at 25.
  - The "Total Precipitation Next 36 hrs" graph now filters each hour below 25 dBZ (≈0.05 in/hr via Marshall-Palmer) to match the Rain Clock — it previously plotted any measurable mm with no dBZ floor.
  - The storm/alert "Min strength" (`getConeMinDbz`, default 40, Settings → Background Storm Alerts) is deliberately separate and unchanged — it governs storm cones + alerts, not the rain floor.
  - Note: because the raised floor is the radar SCAN floor, sub-25 dBZ echoes are no longer captured, so "Nearest Precipitation" / "raining now" also reflect the 25 dBZ floor.
  - Cache: `?v=653`, SW `stormtracker-v653`.

  ## v5.53

  **Adaptive network: a live speed monitor that actually adjusts loading.**

  - The boot connection speed test computed `_netSpeed` but nothing ever read it — the "adjust based on speed" was scaffolded, never wired. It now drives real behavior.
  - New adaptive monitor (`init.js`): measures at boot and re-checks every 60 s (paused while the tab is hidden; also re-checks on focus and on online/offline events). Maintains `netTier()` with `netIsSlow()` / `netIsVerySlow()` gates for future trims.
  - Adaptations: the background overhead-radar poll cadence scales with the tier (90 s normal → 180 s slow → 300 s very-slow/offline, on top of the existing Network-Info / Data-Saver checks). A live connection-mode chip appears in the header on slow / very-slow / offline (hidden when fast, so no clutter), and a toast fires on meaningful slow↔normal transitions.
  - Honest detection: a slow-but-online link that times out now reads as "slow" (`verySlow` tier + chip), not the alarming "Connection check failed" / offline. Give-up timeout raised 8 s → 12 s.
  - Cache: `?v=652`, SW `stormtracker-v652`.

  ## v5.52

  **Perf: faster first paint — defer Leaflet, add preconnect hints.**

  - Leaflet (`unpkg.com/leaflet@1.9.4`) was a synchronous, render-blocking `<script>` in `<head>`, but the map only initializes when the Radar tab is opened (`initRadar()`) — so first paint of the Weather tab stalled on a ~150 KB external download. Added `defer`: Leaflet still executes before the app's own deferred scripts (document order preserved, so `L` is available before any app code runs and long before the map inits), it just no longer blocks parsing.
  - Added `preconnect` for fonts.googleapis.com / fonts.gstatic.com / unpkg.com and `dns-prefetch` for cdn.jsdelivr.net / basemaps.cartocdn.com / tilecache.rainviewer.com to cut DNS+TLS latency off the external critical-path requests.
  - No behavior change — the map, fonts, and tiles still load the same way, just not render-blocking.
  - Cache: `?v=651`, SW `stormtracker-v651`.

  ## v5.51

  **Rain Clock: forecast stays on the inner ring (radar always outer); header tidy-up.**

  - The dual-ring dial kept the forecast on an INNER dashed ring while radar was present, but the radar-empty fallback promoted the forecast to a SOLID OUTER ring (and hid the inner ring) — so the forecast appeared to jump between rings as radar loaded/cleared. Now the layout is always the same: OUTER = live radar (solid), INNER = forecast (dashed), on separate rings so they never overlap/conflict at the same time slot.
  - `_rainClockProject()`: the forecast fallback no longer paints into `out.minutes` (the radar/outer layer) — it builds the center-summary windows from a local array and leaves `out.minutes` empty. `out.fcMinutes` is now always computed (dropped the `!out.forecast` gate) so the inner forecast ring renders in the fallback too. `renderRainClock()` draws the two rings accordingly.
  - Removed the RADAR/FORECAST source tag and the TEXT/DIAL toggle from the card header (the legend already distinguishes the rings; tapping the dial centre still switches to the text summary).
  - Cache: `?v=650`, SW `stormtracker-v650`.

  ## v5.50

  **Fix: Rain Clock forecast (inner) ring now shows light forecast rain.**

  - The dashed inner forecast ring (v5.48) was gated at `_RC_FC_MIN_DBZ = 28` (~0.09 in/hr, moderate). Typical light rain (~0.01 in/hr ≈ 13.5 dBZ) never cleared it, so the ring — and its legend — stayed hidden while the independent "Total Precipitation Next 36 Hrs" bar chart plotted the same rain. It read as the dual-ring feature not working.
  - Lowered `_RC_FC_MIN_DBZ` to 12 (~0.008 in/hr, light rain). The `_rcForecastHours()` helper still pre-filters at `FC_FLOOR_MM = 0.1` (measurable), so pure trace is excluded, but the ring now appears whenever measurable rain is in the forecast — consistent with the bar chart. Also lightens the radar-empty forecast-fallback dial the same way.
  - Cache: `?v=649`, SW `stormtracker-v649`.

  ## v5.49

  **Fix: "raining now over you" no longer counts rain in the neighbouring hex.**

  - `dbzAtLocation()` — the canonical "what dBZ is at this spot right now" oracle behind the hero card, Rain Clock minute-0, overhead/drizzle alerts, and the Storms-tab zone banner — previously hex-binned the scan and, when the user's own 3-mi hex was empty, fell back to the 6 neighbour hexes whose centres were ≤5 mi. Rain sitting entirely in the next hex over (nearest echo up to ~4.7 mi away) registered as overhead, so a user with a clear hex and rain filling the hex to the north saw "Rain until …".
  - Replaced with a direct proximity test: max dBZ among raw scan echoes within `OVERHEAD_MI` (1.5 mi). Rain in the 1.5–6 mi band is "nearby" (already surfaced by the "Nearest Precipitation" line), not overhead. Reuses each echo's precomputed `p.dist` on the user-centred path, so it stays O(n) with no haversine.
  - Consistent across every "now" surface, since they all read this one oracle.
  - Cache: `?v=648`, SW `stormtracker-v648`.

  ## v5.48

  **Rain Clock: dual-ring dial — forecast (inner) beside radar (outer).**

  - `renderRainClock()` now draws a second, INNER ring from the hourly precipitation forecast — dimmer and dashed — beneath the existing solid outer radar ring. The outer ring stays the authoritative nowcast (drives the center summary and windows); the inner ring is the model view, so predicted vs observed arrival times can be compared at a glance. A legend under the dial labels the two.
  - `_rainClockProject()` always computes `out.fcMinutes` from a new shared `_rcForecastHours()` helper (mm/hr → dBZ via Marshall-Palmer, `_RC_FC_MIN_DBZ` floor, 12 h horizon). `out.fcReady` is false in the radar-empty forecast-fallback mode, so the single fallback ring is never duplicated.
  - Dial span mode is user-selectable via a "Span: fits forecast ⇄" chip in the legend — `_rcSpanMode()` / `_rcToggleSpanMode()`, persisted in `st_rcSpanMode`, default `forecast`. `forecast` grows the span to keep forecast rain in view; `radar` keeps it sized to the nearest radar storm.
  - Purely additive to the radar pipeline — no change to windows, tap-details, cell counts, or the center summary.
  - Cache: `?v=647`, SW `stormtracker-v647`.

  ## v5.47

  **Phase 4 (final) of scan-pipeline consolidation: canonical `dbzAtLocation()` oracle (BEHAVIOR CHANGE).**

  - New `dbzAtLocation(lat, lon)` in `docs/js/radar.js` — the one canonical "what dBZ is at this spot right now" answer. Hex-bins the live raw scan points around any location (center cell, else the 6 neighbor cells with centers ≤5 mi). `checkUserInZone()` is now a thin wrapper over it, preserving its array shape for the Storms-tab zone banner; `rainOverUserNow()` (hero card, rain-clock minute 0, rain-overhead/drizzle alerts) is unchanged on top.
  - Perf: the oracle bins with an 8 mi radius instead of the full scan radius — bit-identical results (a point >4.8 mi from the query center can't land in a relevant cell: neighbor centers ≈3.0 mi + hex circumradius ≈1.73 mi) while skipping the hex math for most points.
  - **Behavior change:** the Rain Clock's minute-0 intensity now comes ONLY from the hex-grid oracle. Previously it was raised to `max(zone dBZ, best overhead storm cell dBZ)`, so the clock could paint a heavier band than the hero card showed. Now hero card, clock minute 0, and overhead-alert dBZ are always the same number. The overhead storm cell is still used for motion (pass-duration speed) and now-cell position/pixels.
  - Secondary effect: the "Rain until …" estimate can end earlier — pass duration is sized from the (possibly lower) at-your-spot dBZ cell radius rather than the storm cell's clustered dBZ.
  - Advection remains future-only (inbound `_eta` projection); the minute-0 raise was the last "second opinion" for the current moment. Increases app↔scanner parity: the push scanner's rain clock never had the storm-cell raise.
  - Cache: `?v=646`, SW `stormtracker-v646`.

  ## v5.46

  **Refactor (Phase 3 of scan-pipeline consolidation): one post-scan commit pipeline.**

  - New `commitScanResults(rawPoints, opts)` in `docs/js/radar.js` next to the engine — the single place that commits scan results into app state and notifies every consumer (storm cards, badges, mini-sonar, hero zone, rain clock, ISO grid, map markers/zones, threat ticker). All four scan paths route through it; caller-specific UI (toasts, overlays, SPC/NWS polygons, view circles, setView, path arrows, tiered hi-res, cell alerts, winds retry) stays in the callers.
  - Flags cover the per-path differences: `fullDetect` (hook echoes + NWS-warning rotation, home scan only), `hiRes` (spacing-filter mode + `S._lastScanWasHiRes`), `sonarZoomReset` (hi-res 15 mi sonar snap), `abortCheck` (home scan's post-plot location-change bail), and `spliceRadiusMi`+`center` (overhead poll's 3 mi splice-merge — hero + rain clock refresh only, no storm rebuild).
  - Wrappers now consume the engine's `radarAgeMs` instead of recomputing it (Phase 2 follow-up).
  - Deleted an unreachable `tilePath` assignment in the engine's RainViewer else-branch (flagged in the Phase 2 review).
  - No behavior change intended; architect review verified parity path-by-path (abort semantics, hi-res reorder inertness, spacing-filter falsy-arg equivalence); live e2e passed (Pensacola home scan + map Scan View, 81 cells, zero JS errors).
  - Cache: `?v=645`, SW `stormtracker-v645`.

  ## v5.45

  **Refactor (Phase 2 of scan-pipeline consolidation): one browser scan engine.**

  - New `runRadarScan({lat, lon, radiusMi, zoom, step, minDbz, source, forceRVRefresh, keepStaleTilePath, cacheBustNexrad})` → `{points, frames, tilePath, radarAgeMs, zoom}` in `docs/js/radar.js` — the single tile-scanning engine for all four scan paths: `scanRadarForStorms` (storms.js), `scanRadarForView`, `scanRadarHiRes`, `pollOverheadRain` (radar.js). Each caller is now a thin wrapper; every post-pipeline (spacingFilter, hook echoes, badges, zones, rain clock, scan snapshots, radar-age bookkeeping) is preserved byte-for-byte.
  - `scanTileForPoints` gains explicit `centerLat`/`centerLon` params. The old hack where `scanRadarForView`/`scanRadarHiRes` temporarily overwrote `S.lat`/`S.lon` to steer the distance filter (a known race against concurrent scans) is **gone**.
  - The engine owns the RainViewer `weather-maps.json` fetch for scans behind a 60s TTL cache (`_fetchRvScanFrames`); the overhead poll forces a fresh `no-store` copy. Map-layer/animation fetches are unchanged (non-scan paths).
  - `computeRadarAgeMs(useNexrad, framesOverride)` — optional frames override so the engine can compute age from just-fetched frames; wrappers still recompute for exact parity (Phase 3 will consume `result.radarAgeMs`).
  - Per-caller failure semantics preserved: storms aborts with toast + state reset; view/hi-res abort with toast; overhead silently returns and reuses a stale tile path on fetch hiccups.
  - No behavior change intended; architect review verified wrapper-by-wrapper parity.
  - Cache: `?v=644`, SW `stormtracker-v644`.

  ## v5.44

  **UX fix: "in N storm track cones" no longer contradicts "no storms approaching".**

  - The Storms tab could simultaneously show "🎯 You are currently in 30 storm track cones" (header), a green "No storms currently approaching your location" banner, an empty storm list (with "Approaching only" checked), and a 0 badge — reading like a data-refresh bug. It wasn't: cone membership means the user is inside a storm's broad 15° projected track fan (≈13 mi half-width at 50 mi range), while "approaching" requires a projected closest pass under ~6 mi (direct/near-direct tiers). All surfaces agreed; the display just never explained the distinction.
  - `renderStorms` now publishes `S._coneStats` `{count, minMiss, scanId}` from the existing cone-count loop (min projected pass distance among in-cone storms, via `calcStormETAForBriefing().perpMissMi`).
  - When the forecast banner is empty but the user is in ≥1 cone, `_smartStormSummary` renders an amber explainer with the closest projected pass distance instead of the flat green "nothing approaching".
  - The "N cells hidden by filters" note now says why ("none head directly at you; uncheck 'Approaching only' to see nearby tracks") when that filter is what's hiding everything.
  - Rain Clock: when the dial has no rain windows but precipitation exists in range, the "Nearest Precipitation" line adds "≈ X hrs out at current storm speed" (distance ÷ steering speed) so an empty 3H dial with storms 50 mi away doesn't read as broken.
  - Display-only change — no alert, push, or classification behavior touched.
  - Cache: `?v=643`, SW `stormtracker-v643`.

  ## v5.43

  **Refactor (Phase 1 of scan-pipeline consolidation): one shared radar module for app + scanner.**

  - New `docs/js/radar-shared.js` — a plain global-scope script loaded FIRST (before `core.js`) — now holds the single copy of: `haversine`, `bearingDeg`, `degToDir`, `lonToTileX`, `latToTileY`, the master `DBZ_SCALE` palette, `pixelToDbz`, `NEXRAD_PAL`/`nexradToDbz`, and `RV_UB`/`rvToDbz`. The file ends with a guarded CommonJS export so the Node scanner can consume the exact same code.
  - `scanner/detect.js` now imports these via `createRequire('../docs/js/radar-shared.js')` and re-exports them (its ~120-line verbatim copies deleted) — the GitHub Actions push scanner is now guaranteed to decode radar identically to the app, permanently closing the palette/threshold drift bug class. New `docs/js/package.json` (`"type":"commonjs"`) makes Node treat the shared file as CJS.
  - Duplicates removed: `haversine`/`bearingDeg`/`degToDir`/`DBZ_SCALE`/converters from `core.js`, `lonToTileX`/`latToTileY` from `storms.js`, `bearingDeg3D` from `view3d.js` (`haversineMi3D` intentionally kept — it uses R=3958.8 vs shared 3959; replacing it would nudge 3D distances).
  - New parity fixture test `scanner/test-shared-parity.mjs` (67 cases: converter RGBA→dBZ expected values captured from the pre-refactor code, geo sanity, re-export identity) — passes.
  - `radar-shared.js` added to `sw.js` STATIC_ASSETS (offline) and `index.html` script block. No behavior changes.
  - Cache: `stormtracker-v642`, query strings `?v=642`.

  ## v5.42

  **Fix: 3D tab showed a blank screen (no spinner) during the first-open script download.**

  - On mobile, `#page-3d.visible` is `display:flex` with no CSS height — the height is normally applied by `resize3DPage()` in `view3d.js`. During the first lazy-load, `view3d.js` isn't loaded yet, so `#page-3d` had no height, `#view3d-container` (flex:1) collapsed to ~0px, and the absolutely-positioned `#v3d-loading` spinner was invisible while the Three.js chain downloaded.
  - `_ensure3DLoaded()` now sizes `#page-3d` (same formula as `resize3DPage()`: `innerHeight − header − nav`) *before* showing the spinner, so the loading indicator appears instantly on tab press.
  - Cache: `stormtracker-v641`, query strings `?v=641`.

  ## v5.41

  **Hardening: 3D activation failures now surface visibly (async rejection fix).**

  - `activate3DView()` is `async`, so exceptions inside it (e.g. `new THREE.WebGLRenderer` throwing when WebGL context creation fails — older GPUs, iOS Lockdown Mode) surface as promise rejections, which a bare `try/catch` around the call can never catch. Both activation call sites in `core.js` now go through `_activate3DSafe()`, which wraps the call in `Promise.resolve(...).catch(...)` — on failure it hides `#v3d-loading` and shows `#v3d-engine-error` (Reload & Retry) instead of stranding the spinner.
  - Cache: `stormtracker-v640`, query strings `?v=640`.

  ## v5.40

  **Fix: 3D tab stuck on "Loading 3D…" after v5.39's lazy-load change.**

  - **Root cause** — v5.39's `_ensure3DLoaded()` replaced `#view3d-container`'s `innerHTML` with a "Loading 3D…" indicator, destroying the container's required child markup: the `#v3d-loading` spinner, `#v3d-empty-msg`, `#v3d-engine-error`, and the entire HUD (tier filter buttons, compass tape, camera controls, info panels, storm popup). When `view3d.js` then loaded, `activate3DView()` had none of its overlay elements, so nothing could render or report status — the stale text stayed on screen forever.
  - **Fix** — the loader no longer touches the container's markup. It shows the pre-existing `#v3d-loading` overlay while the Three.js chain downloads, hides it on completion, and shows the pre-existing `#v3d-engine-error` overlay (with its Reload & Retry button) if any script fails to load **or** if `activate3DView()` throws (now wrapped in try/catch).
  - **Hardening** — the `?v=` cache-bust for the dynamically injected `view3d.js` is now derived from `core.js`'s own script tag instead of being hardcoded, so it can never drift out of lockstep with the page version.
  - Cache: `stormtracker-v639`, query strings `?v=639`.

  ## v5.39

  **Startup performance: parallel script loading, 3D on-demand, Turf removed from boot.**

  - **Parallel script loading** — all 15 local app scripts now carry `defer`, so the browser downloads them simultaneously instead of one-at-a-time. The HTML also finishes parsing (and can paint) before any script executes, eliminating render-blocking.
  - **Three.js / 3D view on-demand** — the Three.js library, its OrbitControls and BufferGeometryUtils add-ons, and `view3d.js` are no longer part of the initial page load. They are injected in sequence the first time the user opens the 3D tab, with a "Loading 3D…" indicator while they fetch. Users who never open 3D download nothing. A one-time guard prevents double-loading.
  - **Turf.js removed from startup** — the Turf geometry library was loaded unconditionally at boot but is not called at launch; its script tag has been removed from the page load.
  - **SW precache trimmed** — `view3d.js` removed from the service-worker install-time precache (it is now fetched and runtime-cached on first 3D tab open). All other offline behavior is unchanged.
  - **Cache bumped** — `?v=638` / `stormtracker-v638`.

  ## v5.38

  **Globe icon packs rebuilt at hero resolution — fixes v5.37 pixelation on the Weather hero showcase.**

  - **What changed** — v5.37 sized the Globe pack media for small icons (20–40 px) but missed the Weather tab hero showcase, which renders the icon at 240–300 CSS px (up to ~900 device px on 3× retina). The 256 px PNGs / 320 px videos looked pixelated there. All 88 files were rebuilt from the originals (recovered from git history): PNGs at 768×768 + pngquant (45 MB → 8.6 MB), videos center-cropped square (matching the app's `object-fit:cover` circle) and scaled to 640×640 CRF 28 (120 MB → 24 MB).
  - **Net** — packs remain ~80% smaller than pre-v5.37 while being visually indistinguishable from the originals at every display size, including the hero.
  - **Cache bumped** — `?v=637` / `stormtracker-v637` (flushes the v5.37 low-res media from client caches).

  ## v5.37

  **Globe icon packs optimized — ~95% smaller, identical on screen.**

  - **What changed** — the 🌐 Globe (PNG) and 🌐 Animated Globe (MP4) icon packs shipped full-resolution media (1024×1024 PNGs ~1.3 MB each; 1280×720 videos at ~18 Mbps, 1.5–8.7 MB each) for icons displayed at ~20–40 px. All 88 files were re-encoded to display-appropriate size: PNGs downscaled to 256×256 (45 MB → 4.5 MB), videos to 320px / CRF 30 / audio stripped (120 MB → 3.3 MB). `docs/` dropped from ~168 MB to ~3.6 MB.
  - **Also** — old development screenshots (`attached_assets/`, ~15 MB) were removed from the repository; they were never used by the site. Repo zip download shrinks from ~183 MB to under 10 MB.
  - **Cache bumped** — `?v=636` / `stormtracker-v636` (also flushes any previously cached full-size icon media).

  ## v5.36

  **Choose your AI provider — OpenAI or Claude (Anthropic) — for the assistant, briefings, and background alerts.**

  - **What changed** — the AI Weather Assistant now has a provider selector in Settings. Alongside OpenAI (GPT), you can pick Claude (Anthropic), paste your own Claude API key, and choose a Claude model. Your choice powers the in-app chat, AI Briefings, and the optional AI-written background push notifications.
  - **How** — a single provider switch drives everything. The in-app assistant routes chat/briefings through the selected provider's API (`api.openai.com` or `api.anthropic.com`), and the background alert server (Cloudflare Worker) writes push digests with the matching provider. Keys stay on your device (and encrypted on the alert server for background use) and are billed to your own account. OpenAI remains the default; existing users are unaffected until they switch.
  - **Cache bumped** — `?v=635` / `stormtracker-v635`.

  ## v5.35

  **Bottom tab bar no longer drifts while scrolling on phones — the navigation bar stays pinned for good.**

  - **What changed** — on mobile, swiping the page up/down used to make the bottom tab bar (Weather/Radar/Storms/3D/Alerts) float or jump as the browser's address bar slid in and out. The bar is now rock-solid at the bottom of the screen.
  - **How** — the page body is locked and scrolling moved into the main content area (`.container`), so the document itself no longer scrolls. That stops mobile browsers from resizing the viewport mid-scroll, which was what shifted the fixed nav. The Settings overlay's background-lock and the desktop/landscape sidebar layout were updated to match.
  - **Cache bumped** — `?v=634` / `stormtracker-v634`.

  ## v5.34

  **Faster Weather-tab sonar on phones — HD deep scans no longer flood the radar sonar with thousands of dots.**

  - **Mobile point cap** — the Weather-tab "🛰️ Radar Sonar" now renders at most ~800 clustered points on phones (screens under 1024px). HD deep scans could previously balloon to 15,000+ dots, which slowed the sweep animation on mobile. Desktops keep full, uncapped resolution.
  - **How** — `_clusterSonarPoints()` coarsens its spatial grid until the point count is under budget (preserving spatial spread), with an intensity-based backstop. Storm detection, hex zones and the Rain Clock still use the full-resolution raw scan points, so accuracy is unchanged.
  - **Cache bumped** — `?v=633` / `stormtracker-v633`.

  ## v5.33

  **One storm-strength setting instead of three — the minimum dBZ for storm-track cones, in-app Storm Cell Alerts, and Background Storm Alerts is now a single shared control.**

  - **Single control** — the only editable minimum-dBZ control now lives under Settings → 📡 Background Storm Alerts → **Min strength (dBZ)**. The 🎯 Storm Track Cones section (and its separate input) has been removed, and the 🌩️ Storm Cell Alerts "Intensity (dBZ)" row is now an on/off toggle that shows the shared value read-only.
  - **Everything syncs** — changing **Min strength** updates the background push threshold, the cone floor (`getConeMinDbz()` / `st_stormThresholds.stormDbz.val`), the "in N cones" count + cones drawn on the map, and the in-app storm-cell intensity gate together.
  - **Range** — 20–60 dBZ in steps of 5 (default 40). The shared value rides the push subscription as `thresholds.dbz`, so the scanner uses the same number (no scanner change).
  - **Cache bumped** — `?v=632` / `stormtracker-v632`.

  ## v5.32

  **The storm-track cone intensity floor and the Storm Cell Alerts "Intensity (dBZ)" notification threshold are now one shared number — set it once and both follow.**

  - **Shared value** — the cone floor now reads the same setting as Storm Cell Alerts → Intensity (dBZ) (`st_stormThresholds.stormDbz.val`). Changing it in either place (Settings → 🎯 Storm Track Cones, or the 🌩️ Storm Cell Alerts intensity box) updates the other, plus the "in N cones" count and the cones drawn on the map, immediately.
  - **Range** — the cone control is now 20–60 dBZ in steps of 5 (default 40, matching the notification default). The value is used as the cone floor whether or not the Intensity (dBZ) alert toggle itself is on.
  - **Cache bumped** — `?v=631` / `stormtracker-v631`.

  ## v5.31

  **Storm track cones now honor a minimum intensity (default 30 dBZ, user-adjustable, min 29) so faint cells no longer inflate the "you are in N storm track cones" count or get drawn on the map.**

  - **Storms tab** — the "🎯 You are currently in N storm track cones" line now only counts a cell whose intensity is at or above the cone floor, matching the storm cards (which already drop cells that would arrive as essentially nothing). Fixes the "in 2 cones but nothing listed / nothing approaching" mismatch.
  - **Radar map** — `plotStormTracks` applies the same floor, so the cones drawn on the map and the header count always agree.
  - **New setting** — Settings → 🎯 Storm Track Cones → "Min cone dBZ" (number input, default 30, min 29, max 70). Stored in `st_coneMinDbz`; the count and the drawn cones update immediately on change.
  - **Cache bumped** — `?v=630` / `stormtracker-v630`.

  ## v5.30

  **Desktop / landscape layout overhaul — on wide screens every tab now uses the full width instead of one tall stacked column. Phones and portrait are unchanged.**

  - **Weather** — the hero and rain visuals stay as full-width banners up top, while the remaining cards (sonar, wind, trends, hourly, 7-day, tropical) flow into a balanced 2-column masonry (3 columns at 1600px+), so cards sit side-by-side instead of stretching edge-to-edge.
  - **Storms** — storm cards inside each group (approaching / overhead / nearby) tile into a responsive grid instead of one long vertical list.
  - **Station** — the single station console is centered at a comfortable width on wide screens instead of stretching edge-to-edge (its 2- and 3-tile stat grids keep their intended columns).
  - **Alerts** — active NWS alerts stay full-width on top; the station/storm history and environmental-hazard sections flow into a 2-column masonry.
  - All rules are gated to `min-width:1024px`; the mobile/portrait layout is untouched.
  - **Cache bumped** — `?v=629` / `stormtracker-v629`.

  ## v5.29

  **On slow connections, late-arriving winds aloft now refresh ALL storm surfaces in lockstep (not just some), so the map and the counts can no longer disagree. Scans are hardened against stalled tiles, and AI push alerts reuse the AI Assistant key by default.**

  - **Unified late-winds refresh (`refreshStormViewsForWinds()`)** — the MAP layer (hex zones, cone, flashing) is driven by `S._topStormAnalysis` (set by `computeTopStorms`), while the COUNT/LIST surfaces (Storms-tab cards, header pill, nav badge, Rain Clock dial, forecast banner) are driven by `S._inboundShown`, which is set ONLY by `renderStorms()`/`_renderStormsCore()`. On a slow link, winds aloft arrive AFTER the scan rendered; the four late-winds retry paths each refreshed only ONE of those worlds (the post-scan retries repainted the storm list; `_scheduleWindsAloftRetry` repainted ONLY the Rain Clock), so the map could light up with inbound hexes in the cone while every count still read 0. All four paths (`_scheduleWindsAloftRetry`, `scanRadarForStorms`, `scanRadarForView`, `scanRadarHiRes`) now route through one helper anchored on `renderStorms()` — the single source of truth that re-runs `computeTopStorms`, rebuilds `S._inboundShown`, and repaints the badges + Rain Clock in its `finally{}` — plus `drawMiniSonar`, `refreshHeroFromZone`, `buildPathArrows`, and `updateThreatTicker`.
  - **Scan hang hardening** — added timeouts to the previously-unbounded scan-path network calls so a slow/stuck connection can't freeze the scan: `AbortSignal.timeout(6000)` on the RainViewer `weather-maps.json` fetches in `scanRadarForView` + `scanRadarHiRes` (matching `scanRadarForStorms`), and 15s caps on the per-tile RainViewer `fetch` and the NEXRAD `loadTileImage` so one stalled tile resolves empty instead of blocking `Promise.all`.
  - **Shared OpenAI key** — `_getPushAiKey()` now falls back to the AI Assistant key (`st_aiKey`) when no push-specific key is set, so AI-written alerts work with a single key. The push key field shows only the explicit override (`_getPushAiKeyOwn()`); the effective key still rides the subscribe payload (encrypted server-side) and is used for `hasKey`/test/toasts.
  - **Cache bumped** — `?v=628` / `stormtracker-v628`.

  ## v5.28

  **Push notification times now respect each subscriber's time-format and timezone, and the single most-severe active alert is promoted into the notification title with its end time.**

  - **Localized alert times (`fmtAlertTime(iso, tz, h24)`)** — the scanner's NWS time formatter previously hardcoded 12-hour rendering in the *alert area's* own UTC offset, ignoring the subscriber. It now renders in the subscriber's IANA zone and honors their 12h/24h preference — both already ride along in the subscribe payload (`tz` from `Intl…resolvedOptions().timeZone`, `h24` from `_is24h()`). Same-day times drop the weekday for compactness (`until 8:00 PM`); later ones keep it (`until Fri 6:00 PM`). Falls back to the alert's own offset when no usable `tz` is sent, and to 12h when `h24` is absent. `nwsWindow(a, short, tz, h24)` threads both through. This also fixes AI-written bodies, since the AI rewrites the same deterministic lines.
  - **Worst-alert title promotion** — the most serious *named* active alert (severity order: NWS **warning** → **watch** → **tropical**) is now surfaced in the notification TITLE with its end time, e.g. `🌪️ Tornado Watch until 8:00 PM · 8 alerts · Home`. iOS collapses the banner to ~one line, so leading with the threat + expiry keeps the critical info visible without opening it. Storm-cell / lightning / rain alerts have no fixed end time and stay in the body; a lone non-NWS/tropical alert keeps its existing single-alert title. NWS items now carry `icon`/`win`, and tropical items carry a `label`/`icon`, for the builder.
  - **Cache bumped** — `?v=627` / `stormtracker-v627`. Scanner-only logic change (no new static assets).

  ## v5.27

  **AI-written push alerts now use EACH user's own OpenAI key — the developer's key is never used for another user's notifications.**

  - **Per-user key (`ai:{on,tone,key}`)** — the subscribe payload now carries the user's own OpenAI key (plaintext over HTTPS). The Worker AES-GCM-encrypts it at rest (key derived from `SCANNER_SECRET`) inside the subscription `thresholds`, and STRIPS it from `/subscriptions` — the scanner only ever sees `ai.hasKey:true/false`, never the key. `/ai-digest` now looks the key up BY ENDPOINT, decrypts it, and calls OpenAI with it; the `OPENAI_API_KEY` env fallback was REMOVED, so no user is ever billed to the developer's key.
  - **Scanner** — `aiCfgOf` returns `{on,tone,hasKey}` and AI wording is gated on `on && hasKey`; `aiDigestBody` now forwards the device `endpoint` so the Worker can resolve that user's key.
  - **Client** — new "Your OpenAI key" field under Settings → Background alerts (shown only when AI-written alerts is ON), with a browser-side **Test key** check (`GET /v1/models`), a show/hide toggle, and a link to a new **setup-guide.html** walkthrough. The key lives in `st_pushAiKey` on the device and rides along in the subscribe payload. AI alerts stay default OFF and won't run until a key is added.
  - **Cache bumped** — `?v=626` / `stormtracker-v626`. New static asset: `setup-guide.html`.

  ## v5.26

  **Two opt-in background-alert refinements: AI-written notification wording, and an event-driven ("only on changes") cadence. Both default OFF; deterministic behavior is unchanged unless a user turns them on.**

  - **AI-written alerts (`ai:{on,tone}`)** — when a user opts in, the scanner asks the Worker's new scanner-gated `POST /ai-digest` endpoint to rewrite the deterministic digest lines into one short, natural push body. The OpenAI key lives ONLY as a Cloudflare Worker secret (`OPENAI_API_KEY`) — it never travels from the browser or sits in GitHub Actions; the scanner just forwards the already-built lines (`x-scanner-secret` gated) and gets back ≤300 chars. `gpt-4o-mini`, 9s server-side timeout / 11s scanner timeout, `max_tokens:160`. Best-effort and **never load-bearing**: any failure, missing key, or empty result leaves the deterministic `body` untouched. The call only happens AFTER the digest floor passes (never on a held digest), so we don't spend a call on a suppressed push. Tone reuses the in-app assistant voice (Professional / Friendly / Humorous). Settings → Background alerts → "AI-written alerts".
  - **"Only notify on changes" (`changes:{on}`)** — opt-in edge-triggered cadence. Life-safety items (active NWS **warnings**, lightning, a **severe** storm core, high-urgency tropical) keep their existing re-notify cooldowns so they always break through. Routine items (watches, advisories, non-severe storms, nearby/area, rain-overhead, drizzle, weather thresholds) fire only when their **signature changes** vs. the last sent set, not on every cooldown tick. Signature = `cat | sig | sorted cks`, so a new threat, a cell moving into a new bearing/distance bucket, or an intensity-band change all count as a change; a standing, unchanged situation goes quiet. A cleared-then-returned routine threat re-fires because its token is dropped from the per-location edge set when it clears. Settings → Background alerts → "Only notify on changes".
  - **Edge-state storage** — the last-sent routine signature set is persisted per location as a non-numeric meta key `…#__edge` inside the existing `last_alert` map. The prune sweep now skips non-numeric values so the edge set (and any future meta) is never aged out as if it were a timestamp. The set is only adopted after a successful send (or when there were no new signatures to communicate); a change held by the 45-min digest floor keeps the previous set so it retries. Scanner-only — this affects background SEND TIMING, so there is no in-app runtime equivalent; the flag just rides along in the subscription thresholds.
  - **Parity** — `docs/js/push.js` adds matching `_aiCfg`/`_aiTone`/`_changesCfg` readers, `setPushAi`/`setPushChangesOnly` writers, two new Settings rows + hints, and includes `ai`/`changes` in the subscribe payload. `scanner/scan.js` adds `aiCfgOf`/`aiDigestBody`/`changesCfgOf`/`isLifeSafety`/`routineToken`. Both default OFF, so existing subscribers see no change until they opt in.
  - **Cache bumped** — `?v=625` / `stormtracker-v625`.

  ## v5.25

  **New low-urgency "nearby strong storms" awareness push — strong cells inside your radius that AREN'T heading at you.**

  - **New `area` alert category (push)** — the scanner now emits a low-urgency heads-up when STRONG cells (≥45 dBZ, the Heavy-band floor) sit inside the user's watch radius but are NOT inbound: `!approaching`, beyond the 15 mi near-lightning ring, and with valid fleet steering (`mv.speed ≥ 2`). This is the exact non-overlapping complement of the inbound `sc` alert and the `ltg` corridor, so it never double-fires — it fills the gap where a line passing parallel (e.g. to the north all day) leaves the Storms tab at 0 because nothing is approaching. Message: *"Strong storms ~22 mi to the north (within your 80 mi range), moving east ~19 mph — not heading your way, but stay aware. N strong cells, peak NN dBZ."*
  - **Anti-spam** — `normal` urgency (never bypasses the 45-min digest floor), a 2 h re-notify cooldown, and a single coarse dedupe key from the lead cell's 45° sector × 15 mi distance bucket, so a standing line doesn't re-buzz but activity that relocates does. Steering is required, so "not heading your way" is never claimed from missing motion data (`calcETA` reports `approaching:false` with no steering, which must not be mistaken for "safely parallel").
  - **Settings toggle** — Settings → Background alerts → "Nearby strong storms" (ON/OFF). Synced with the subscription (`area:{on}`); the scanner defaults it ON for legacy/missing payloads so it works without a re-subscribe. Worker unchanged (thresholds pass through as free-form JSON).
  - **Cache bumped** — `?v=624` / `stormtracker-v624`.

  ## v5.24

  **Stop the app from killing its own notification connection on every open — clean service-worker lifecycle + gentle reconnect-when-broken.**

  - **Removed the destructive service-worker reset on every load** — `index.html` was unregistering *all* service workers and wiping *every* cache on each app open, then re-registering. A registration **owns** its push subscription, so this silently destroyed the background-notification connection on every open and forced a fragile rebuild — the most likely cause of "works for a few pushes then stops." `sw.js` already calls `skipWaiting()` on install and `clients.claim()` on activate (and prunes old caches), so a `?v=` bump still takes over immediately without unregistering. Registration is now a clean `register()` + `update()`. (Cross-checked against the MDN Push tutorial, MagicBell's PWA push guide, rishikc's advanced-PWA guide, and the claritybox lifecycle write-up — none unregister on load.)
  - **Gentle reconnect on open** — `refreshPushOnOpen()` no longer re-subscribes on every open. On `visibilitychange→visible` and shortly after load it runs a health check and re-subscribes *only* when the browser subscription is missing, its endpoint rotated, or it carries a stale VAPID key; a healthy connection is left untouched (no endpoint churn, which itself burns Apple's delivery budget). Disabling alerts clears `st_pushSub`, so this no-ops until re-enabled.
  - **Reset clears the digest cooldown** — a manual Re-subscribe now sends `reset:true`; the worker wipes only the per-location `#__digest` keys from `last_alert`, so the very next scan (~5 min) re-confirms current conditions instead of waiting out the ~45-min digest floor. Per-storm and NWS alert dedupe is preserved, so already-seen official warnings are never re-fired.
  - **Cache bumped** — `?v=623` / `stormtracker-v623`.

  ## v5.23

  **Manual notification “Re-subscribe” button + Rain Clock distance cleanup.**

  - **Re-subscribe / reset button** — added under Settings → Background alerts (next to “Send test notification”). `resubscribePushAlerts()` unsubscribes the current browser PushSubscription (forcing a brand-new endpoint, which resets Apple's per-PWA delivery budget — the throttle that silently stops *showing* notifications) then re-subscribes through the normal `enablePushAlerts()` contract. The previous endpoint is still in storage, so the worker MOVES the row: the manage code, thresholds, and watched locations are all preserved. A manual companion to the automatic self-heal added in v5.22.
  - **Rain Clock detail: forecast distance removed** — tapping a colored arc opened a per-cell card that could show "0.0 mi N" for *synthetic forecast cells* (anchored at the user's location) and overhead cells. Distance is now shown only for ACTUAL radar storm cells with a real (>0) distance; forecast/overhead cells show just dBZ + ETA + confidence. The radar-derived "Nearest Precipitation" readout below the dial is unchanged.
  - **Cache bumped** — `?v=622` / `stormtracker-v622`.

  ## v5.22

  **iOS push reliability — conserve Apple's per-PWA notification budget so the alerts that matter keep getting through; RSS feed turned off.**

  - **Root cause** — iOS Home-Screen web push has a small per-app delivery *budget* that depletes as un-tapped notifications accumulate. Once spent, Apple silently stops *showing* pushes while still returning 2xx — the subscription stays alive (no 410) and the scanner logs "sent", but nothing appears. Re-subscribing mints a fresh budget, which is why toggling alerts off/on temporarily restored delivery before it quit again.
  - **Spend the budget on what matters** — `DIGEST_FLOOR_MS` raised 15 → 45 min, so routine rain/storm digests go out at most ~1.3×/hr instead of ~4×/hr, leaving budget in reserve. Life-safety alerts still bypass the floor: NWS warnings + tropical fire immediately, and a severe storm core is held only to `PUSH_FLOOR_MS` (10 min).
  - **Lightning escalates fast** — lightning (`cat:'ltg'`) joined the severe-escalation tier, so a nearby strike is held to 10 min instead of waiting the full routine floor.
  - **Test pushes no longer self-coalesce** — the test notification used a fixed `stormtracker-test` tag, so repeated "Send test" taps silently replaced the existing banner without re-alerting (looked like delivery had stopped). It now uses a unique tag per send, like real digests.
  - **Bulletproof service-worker push handler** — iOS treats any push event that doesn't end in a *visible* notification as a "silent push" and can revoke the subscription after a few. The `push` handler is now wrapped end-to-end: a non-JSON payload falls back to text, and a failed `showNotification` retries with a minimal one, so every push path still shows something. Defends against the *separate* subscription-revocation failure mode (distinct from the budget throttle above).
  - **Subscription self-heal** — iOS can silently drop/revoke a subscription with no event firing. A health check now runs when the app becomes visible (and shortly after load): if alerts are on but the browser no longer holds a matching, current-VAPID-key subscription, it transparently re-subscribes through the normal worker contract (`enablePushAlerts(true)`), preserving thresholds/code/locations and moving the old endpoint instead of leaving a duplicate. (Server already prunes 404/410 endpoints.)
  - **RSS feed UI removed** — the Settings → Background alerts "📡 Copy RSS link" button is hidden while we focus on push reliability (worker/scanner feed code left dormant for an easy restore).
  - **Cache bumped** — `?v=621` / `stormtracker-v621`.

  ## v5.21

  **Hardening for the v5.20 RSS feed — closes a manage-code leak, blocks misleading briefings from failed scans, and self-heals a stale token.**

  - **Security: feed GUIDs no longer carry the manage code.** RSS `<item>` guids were `st-<CODE>-<id>`, so any reader/service handed a feed URL could read the manage code and call `/unsubscribe`. Guids are now namespaced by an opaque SHA-256 of the feed *token* (which the reader already holds) — `st-<ns>-<id>` — exposing nothing manageable. This restores the intended separation between the read-only feed token and the manage code.
  - **Degraded scans never publish.** The 30-min briefing heartbeat (`emitBeat`) was independent of the `degraded` flag, so a failed radar fetch could still post an "all clear" briefing, move `lastEmit`, and suppress the next real change for the 10-min window. Degraded scans now update only the live snapshot — no item, no heartbeat, no `sig`/`lastEmit` change — so the next *healthy* scan still delivers the heartbeat measured from the last real emit.
  - **Client token self-heals.** `st_pushFeedToken` is now stored bound to its manage code; if a re-enable ever hands back a new code, the cached token is discarded and re-minted instead of copying a link to the wrong device's feed.
  - **Cache bumped** — `?v=620` / `stormtracker-v620`.

  ## v5.20

  **New: per-device RSS feed — a reliable, pull-based backup for storm alerts when push is unreliable (especially on iOS).**

  - **Why** — iOS Home-Screen web push is intermittent (Apple silently throttles/drops). A feed a reader pulls on its own schedule sidesteps that entirely while still surfacing the same storm digest.
  - **Client** — Settings → Background alerts shows a **📡 Copy RSS link** button. On first use it asks the worker (endpoint-only, same safe proof as the test push) for a private 128-bit feed token, caches it (`st_pushFeedToken`), and copies `/feed?token=…`. The token is separate from the manage code so a shared feed URL can never manage/unsubscribe.
  - **Scanner** — each scan aggregates EVERY active alert across a code's watched locations into one comprehensive snapshot (no iOS truncation) and POSTs it to the worker. A coarse `sig` (storm band / lightning / rain band / NWS id / tropical id, excluding distance & ETA drift) drives change detection; a `degraded` flag marks a failed radar fetch so a transient outage never reads as "all clear".
  - **Worker** — `POST /feed-update` (scanner-secret) keeps the live snapshot fresh every scan but only EMITS a new RSS `<item>` when the signature changes (debounced by a 10-min min-gap, immediate for NWS warnings / tropical / severe cores) OR a **30-min briefing heartbeat** is due — a timer fully independent of the push cooldowns. `GET /feed?token=…` serves reader-safe RSS 2.0 (emitted items only, each with a unique guid; live snapshot rides in the channel description). `POST /feed-token` mints/returns the token.
  - **Cache bumped** — `?v=619` / `stormtracker-v619`.

  ## v5.19

  **Fix: your manage code is now stable per device — toggling alerts off/on no longer mints a new one.**

  - **Why** — `disablePushAlerts()` cleared `st_pushSub` (which held the code) AND the worker deleted the D1 row, so re-enabling had no code to send and the worker generated a fresh one via `genCode()`. The manage code changed every enable/disable cycle.
  - **Change** — the code is now persisted to a separate durable key `st_pushCode` that Disable does NOT clear, and the previous endpoint to `st_pushEndpoint` (also kept through Disable). When `st_pushSub` is empty, `enablePushAlerts()` re-sends the saved `code` (the worker's `uniqueCode()` reuses any free code; a clean Disable frees it) AND, if a stale row survived a failed `/unsubscribe`, the saved `oldEndpoint` lets the worker MOVE that row (matched by endpoint+code) onto the fresh endpoint — so the same code is reclaimed either way. No worker/schema change needed.
  - **Cache bumped** — `?v=618` / `stormtracker-v618`.

  ## v5.18

  **Fix: real weather pushes never arrived on iOS even though the test push did.**

  - **Why** — the scanner sent a SEPARATE push per category (storm cells, lightning, rain-overhead, weather…) every 5-min scan, and `rovMin=0` ("every time") fired rain-overhead every scan. Apple throttles a frequent multi-message web-push stream to a Home-Screen PWA and silently drops it — amplified ~5× because every settings change / reinstall minted a new push endpoint and the worker INSERTed a duplicate row, so one device ended up with 5 subscriptions. The infrequent one-off test slipped through; the steady barrage didn't.
  - **Change** — scanner now sends ONE coalesced digest push per location per scan (high urgency if any item is high, a single tag per location) instead of one per category; routine (non-severe) rain/storm re-notifies are floored to ≥10 min so "every time" can't trip the throttle; severe rain, top-band cells, lightning and NWS warnings keep their fast cadence.
  - **Dedupe** — client now sends its previous `oldEndpoint` on `/subscribe`; the worker MOVES that verified row (matched by old endpoint + code, preserving code + last_alert) onto the new endpoint instead of inserting a duplicate. Code alone is never accepted (subscription-hijack guard).
  - **Cache bumped** — `?v=616` / `stormtracker-v616`.

  ## v5.17

  **"Send test notification" button — confirm background alerts really reach your phone, on demand.**

  - **Why** — users had no way to verify push delivery without waiting for real weather. A fake local popup would prove nothing; it must go through the actual server-side path.
  - **Change** — a "🔔 Send test notification" button now appears under Settings → Background alerts (only when alerts are ON). Tapping it asks the worker to flag a one-shot test and nudge the scanner, which delivers a real push through the **exact same web-push pipeline as live alerts** (proven VAPID encryption), then clears the flag. Arrives within ~1 min.
  - **How** — new worker `POST /test` (flags `meta` key `test:<endpoint>`, dispatches scanner), `GET /subscriptions` attaches a `testRequested` timestamp (auto-expires after 15 min), `POST /mark-alert {clearTest:true}` drops the flag. Scanner sends the test up-front (independent of weather) via the existing `trySend()` and clears it. Client `sendTestPush()` posts the endpoint. No D1 schema migration (reuses `meta`).
  - **Cache bumped** — `?v=615` / `stormtracker-v615`.

  ## v5.16

  **Confirmation toasts for rain-band alert settings.**

  - **Why** — toggling a rain band on/off or changing its re-notify cadence saved instantly to `st_alertBands` and silently re-synced the push subscription, but gave no visible confirmation, so users couldn't tell whether a tap registered.
  - **Change** — `toggleRainOverhead`/`toggleAlertBand`/`toggleDrizzle` and `setRovCadence`/`setAlertBandCadence`/`setDrizCadence` (docs/js/thresholds.js) now fire a 2.5s `toast()` reporting the new state, e.g. "🌦️ Drizzle alerts: ON" or "Light re-notify: every 10 min". Helpers `_cadLbl()` (shared "every time"/"every N min" wording) and `_bandToast()` added. No behavior/threshold change; scanner untouched.
  - **Cache bumped** — `?v=614` / `stormtracker-v614`.

  ## v5.15

  **New opt-in "Drizzle / very light" overhead alert for sub-band rain (10–19 dBZ), below the Light band floor.**

  - **Why** — the "rain right over you" / Light-band alerts gate at `dbz >= 20` (`bandForDbz` returns null below 20) in both the app and the scanner. Genuinely light drizzle often reads under 20 dBZ, so it stayed silent while the Rain Clock (more sensitive read) still showed rain — a threshold/expectation mismatch, not a bug.
  - **New tier** — a standalone "🌦️ Drizzle / very light (10–19 dBZ)" toggle + cadence dropdown sits right under "🌧️ Rain right over you" in `renderAlertBandSettings()`. Stored as `drizOn`/`drizMin` in `st_alertBands` (default OFF / 15 min; same `0/5/10/15/30/45/60` options). Wired via `toggleDrizzle()`/`setDrizCadence()`/`drizCadenceMin()` and a new branch in `checkRainOverheadAlert()` (fires when `_DRIZ_MIN_DBZ`≤dbz<20, own `_drizzleCooldown`). The Light band (20–29) is unchanged.
  - **Scanner parity** — `bandsFor()` returns `drizOn`/`drizMin` (legacy/partial subs default off / 15 min); a new build-loop branch pushes a `driz` item when `10 ≤ overheadDbz < 20`. New `driz` category (own tag, `🌦️` icon) added to `CAT_META`/`CAT_ORDER`/`COOLDOWN`/`PRUNE`/`keyKind`. Mutually exclusive with `rov` (≥20), so no double-fire.
  - **No D1/worker change** — `drizOn`/`drizMin` ride in the free-form `thresholds.bands` JSON; older subscriptions keep working (drizzle simply off) until they re-subscribe.
  - **Cache bumped** — `?v=613` / `stormtracker-v613`.

  ## v5.14

  **NWS & Tropical re-notify cadence is now severity-based + configurable, and background pushes are split BY TYPE.**

  - **Per-tier NWS cadence** — the flat 12h background cooldown for NWS is replaced by per-severity cadences: warnings (default 30 min), watches (default 2 h), advisories (default 6 h, or off). Warnings & watches additionally TIGHTEN as the alert nears expiry (effective cooldown = min(base, (ends−now)/2), floored at 5 min). Defaults can be overridden from the Background Alerts panel; advisory "off" = advMin 0. Implemented via `nwsCfgOf()`/`nwsTierOf()`/`nwsCooldownMs()` in `scanner/scan.js`, each NWS item carrying its own `cooldownMs` and `cat` (`nws-warn`/`nws-watch`/`nws-adv`).
  - **Tropical cadence** — base repeat picked from 3/6/9/12 h (default 6 h, `tropical.everyH`); in-cone systems (high urgency) step up to ≤3 h. `tropCfgOf()` normalizes legacy `{on,radius}` subs.
  - **Notifications split by type** — instead of one bundled digest per location, the scanner now sends ONE push per category (storm cells, rain, lightning, weather, NWS warnings/watches/advisories, tropical), each with its own tag `stormtracker-<locId>-<cat>` so they stack on the device. Per-category "stamp only DUE items" preserves each cadence. (`situationLead` digest helper removed.)
  - **In-app controls** — Background Alerts panel: NWS master on/off + Warnings/Watches/Advisories repeat dropdowns, Tropical on/off + repeat dropdown. Config rides in the free-form `thresholds` JSON (`nws:{on,warnMin,watchMin,advMin}`, `tropical:{on,radius,everyH}`); legacy boolean subs fall back to defaults. (`docs/js/push.js`)
  - **Backward compatible** — no D1/worker change; older subscriptions keep working until they re-subscribe.
  - **Cache bumped** — `?v=612` / `stormtracker-v612`.

  ## v5.13

  **"Rain right over you" now has its OWN re-notify timer (instead of borrowing the matching band's cadence).**

  - **Dedicated overhead cadence** — the rain-overhead alert is throttled by a new standalone `rovMin` (stored in `st_alertBands`, same `0/5/10/15/30/45/60` options, default 5 min) instead of the cadence of whichever band the overhead dBZ matched. `renderAlertBandSettings()` adds a timer dropdown to the "🌧️ Rain right over you" row (above the four bands), wired via `setRovCadence()`/`rovCadenceMin()` in `docs/js/thresholds.js`. The four bands still GATE the overhead alert by intensity (it only fires when the overhead dBZ lands in an enabled band) — they just no longer set its timing.
  - **Scanner parity** — `bandsFor()` in `scanner/scan.js` returns `rovMin` (legacy/partial subs fall back to 5 min), and the `rov` digest item now uses `bands.rovMin` for its `cooldownMs`.
  - **No D1/worker change** — `rovMin` rides in the free-form `thresholds.bands` JSON.
  - **Cache bumped** — `?v=611` / `stormtracker-v611`.

  ## v5.12

  **More re-notify timer choices per band: added 45 min, 60 min, and an "every time" (no cooldown) option.**

  - **Extended band cadence options** — `_BAND_CADENCE_OPTS` in `docs/js/thresholds.js` and `BAND_CADENCE_OPTS` in `scanner/scan.js` widened from `[5,10,15,30]` to `[0,5,10,15,30,45,60]`. A value of `0` means "every time" (no cooldown): the cooldown checks (`now-last < min*60000`) and the scanner's per-item `cooldownMs` both evaluate to `0`, so the alert fires on every eligible check/scan tick. The dropdown renders `0` as "every time" and the rest as "every N min".
  - **No D1/worker change** — still rides in the free-form `thresholds` JSON; older subscriptions fall back to defaults as before.
  - **Cache bumped** — `?v=610` / `stormtracker-v610`.

  ## v5.11

  **New "rain right over you" alert + four configurable intensity bands that gate and pace every storm/rain notification (in-app and background push).**

  - **Rain-overhead alert** — `checkRainOverheadAlert()` in `docs/js/thresholds.js` reads the shared `rainOverUserNow()` band (the same radar-over-user value the conditions card shows) and fires a toast + browser notification whenever the dBZ directly over the user lands in an enabled band, independent of any inbound storm. Throttled by a single `st_rovCooldown` timestamp at the matched band's cadence. Called at the end of `checkWeatherThresholds()`.
  - **Four intensity bands** — `_ALERT_BAND_DEFS` (Light 20–29 `#3aa0ff`, Moderate 30–44 `#36d96b`, Heavy 45–54 `#ffb300`, Severe 55+ `#ff3b6b`), stored in `localStorage st_alertBands` as `{light,moderate,heavy,severe:{on,min}, rovOn}`. Defaults: all bands on; Light re-notifies every 10 min, the rest every 5; `rovOn` true. Cadence options: 5/10/15/30 min.
  - **Bands gate intensity AND drive cooldown** — `checkStormCellAlerts()` now drops any storm whose dBZ falls in an off band, and replaces the old fixed 15-min per-cell cooldown with that band's cadence. The storm-alert cooldown prune window widened 15→30 min to cover the longest band cadence. `renderAlertBandSettings()` adds a Settings → **Rain Intensity Bands** section (rain-overhead master toggle + a swatch/toggle/timer row per band), wired in `docs/js/settings.js` and mounted at `#alert-band-settings` in `index.html`.
  - **Scanner parity** — `dbzAtPoint(lat,lon)` in `scanner/detect.js` decodes the radar tile(s) over the user's exact spot (NEXRAD z11 in the US, RainViewer z8 elsewhere) and returns the max dBZ within ~2 mi. `scanner/scan.js` computes it once per location group, adds a `rov` alert kind (with its own COOLDOWN/PRUNE/keyKind/situationLead/prio entries), band-gates inbound storm hits, and switches the digest trigger to a per-item `cooldownMs` (the matched band's cadence) instead of the fixed `COOLDOWN[kind]`.
  - **No D1/worker change** — the bands config rides inside the existing free-form `thresholds` JSON on the subscription (`_pushBands()` in `docs/js/push.js`). Subscriptions made before this version have no `bands` field; both the app and the scanner (`bandsFor()`) fall back to all-bands-on + `rovOn` true, so existing users keep their previous behavior until they re-subscribe.
  - **Heads-up:** background per-band cadence is still bounded by how often the scanner cron actually runs (GitHub cron can be delayed/skipped); the in-app timers are exact.
  - **Cache bumped** — `?v=609` / `stormtracker-v609`.

  ## v5.10

  **Storm-card "in path" rain now reflects the path toward you, not the whole radar radius.**

  - The Storms-tab card's 💧 *In path* line (`getStormConeRain` in `docs/js/storms.js`, rendered at the `_coneRainLine` in the card template) reported the max dBZ and return count over the storm's **full projected track cone**, which `buildStormCone` always extends to at least the full scan radius (≥80 mi). That swept up strong cores far down-range and reported them as the cell's "max" — e.g. a 30 dBZ cell showing "55 dBZ max" because an unrelated 55 dBZ core sat 60 mi ahead in the same direction.
  - `buildStormCone(storm, mv, rangeOverride)` now accepts an optional range override. The map's visual projection cone is unchanged (still shows where a storm *might* go); only the card stat passes a clamped range — `Math.max(10, Math.min(scanRadius, storm.distance + 6))` — so "in path" describes the rain between the storm and you. It scales naturally: a far inbound storm keeps a long path, a near one gets a short path, with a 10 mi floor so close storms still show their near-path core.
  - **Cache bumped** — `?v=608` / `stormtracker-v608`.

  ## v5.09

  **Background storm alerts now cover up to 5 saved locations, each with its own 🔔 toggle.**

  - Each saved location (favorite) in the Location menu's Saved list gets a 🔔/🔕 button (`toggleFavPush` + `renderFavorites` in `docs/js/geo.js`). Bell ON adds that place to the background watch set; OFF mutes it. State persists in `localStorage` (`st_pushLocs`, keyed by a rounded `lat,lon` id).
  - The push subscription now carries a `thresholds.locs` array (up to 5 `{id,lat,lon,name}`) — `_enabledPushLocs`/`_watchedPushLocs` in `docs/js/push.js`. No D1 schema change: the array rides inside the existing free-form `thresholds` JSON, so the worker is untouched and old single-location subscriptions keep working (they fall back to Home/current). Threshold settings stay global across all watched locations.
  - The background scanner (`scanner/scan.js`) fans each device out into one virtual entry per watched location, groups them by coarse location for shared radar/conditions/NWS fetches, namespaces each location's dedupe keys (`<locId>#<ck>`, `keyKind` strips the prefix), and merges every location's `last_alert` into ONE per-endpoint write at the end. Each location sends a **separate** notification (`tag: stormtracker-<locId>`) with the location name appended to the header.
  - The Settings → background-alerts panel now lists every watched location and points to the per-location bells.
  - **Background wind/gust parity fix** — the scanner (`scanner/alerts.js` `fetchConditions`) now blends nearest-station observations (NWS station obs + AWC METAR) on top of the Open-Meteo model and computes gust as `max(avg gusts, avg winds)`, mirroring `blendSources()` in `docs/js/weather.js`. Previously the scanner used model-only gusts, which run lower than real station gusts, so the app would show a gust over the user's threshold while the background scan stayed silent. Temperature, wind, gust and visibility are now blended; pressure-trend, humidity and rain stay Open-Meteo (the app sources those the same way). Best-effort: any station fetch failure falls back to model-only. Scanner-only change — no client cache bump required.
  - **Cache bumped** — `?v=607` / `stormtracker-v607`.

  ## v5.08

  **Radar palette: smoother gradient + user-customizable colors.**

  - Refined the `DBZ_SCALE` colors in `docs/js/core.js` for a cleaner light→deep gradient within each color family (deeper = stronger), with hue shifts only at band boundaries. Removed the near-black darks (navy/hunter/maroon) that turned muddy at the low opacity radar tiles render with. New colors: 15 `#7FC4FF`, 20 `#2E7BF0`, 25 `#7BF06B`, 30 `#28D028`, 35 `#15A523`, 40 `#FCE300`, 45 `#FF9D00`, 50 `#FF3B23`, 55 `#D11226`, 60 `#E81DE8`, 65 `#FF8FE0` (0/5 blues unchanged).
  - **Customizable radar colors** — new "🎨 Radar Colors" section in Settings (`renderDbzColorSettings` in `docs/js/settings.js`) lets users override the color of any dBZ bin via a native color picker or HEX input. Overrides persist in `localStorage` (`st_dbzColors`, keyed by bin min) and are applied in place onto `DBZ_SCALE.color` by `applyDbzColorOverrides()` (core.js), so every consumer (radar tiles, sonar, storm cells, 3D, legend, AI tags) picks them up. Per-bin and global reset to default. `_SONAR_DBZ_COLORS` snapshot in `gauges.js` replaced with a live lookup so the sonar dot-size controls reflect custom colors.
  - **Cache bumped** — `?v=606` / `stormtracker-v606`.

  ## v5.07

  **Radar palette: 5 dBZ stepped colors to match real radar.**

  - Reworked the master `DBZ_SCALE` in `docs/js/core.js` so reflectivity steps in 5 dBZ increments. ≤20 dBZ stays blue (15 neon blue `#1F51FF`, 20 navy `#001F8F`), then green (25 light `#90EE90`, 30 neon `#39FF14`, 35 hunter `#355E3B`), 40 yellow `#FFFF00`, 45 orange `#FF8C00`, 50 neon red `#FF1E1E`, 55 maroon `#800000`, 60 magenta `#FF00FF`, 65 pink `#FF69B4`. Sub-15 sprinkle/trace blues unchanged.
  - `stormCat` rain-rate map extended to the new 25/35/50 bins (imperial + metric). All consumers (radar tiles, sonar, storm cells, 3D view via `_dbzEntry`, the radar legend via `DBZ_BINS`, and AI `[!dbz]` tags) inherit the palette automatically.
  - **Cache bumped** — `?v=605` / `stormtracker-v605`.

  ## v5.06

  **UX: single slide toggle for Background Storm Alerts + 30s lockup safety.**

  - `docs/js/push.js` `renderPushAlertSettings` now renders one accessible slide toggle (`role="switch"`, left=off / right=on) wired to a new `togglePushAlerts(want)` (→ `enablePushAlerts`/`disablePushAlerts`), replacing the separate "🔔 Turn on" / "↻ Update" / "🔕 Turn off" buttons. A contextual "↻ Update" button now appears only when the saved subscription location has drifted (>0.05° lat/lon) so the watch can follow the user.
  - Retuned the enable/disable network budget to fit a 30s lockup safety (per request): `_pushPost` timeout 20s→14s for `/subscribe` and 15s→12s for `/unsubscribe` (still 1 automatic retry each → worst case ~28s), and the busy-overlay safety timeout 45s→30s.
  - **Cache bumped** — `?v=604` / `stormtracker-v604`.

  ## v5.05

  **Fix: "Could not enable alerts: Fetch is aborted" when enabling Background Storm Alerts on mobile data.**

  - `docs/js/push.js` used `AbortSignal.timeout(10000)` on the `/subscribe` (and `/unsubscribe`) POST to the push worker. The worker itself is fast (root ~130ms, `/subscribe` ~700ms), but on a weak/handoff-prone LTE connection the first TLS connection to `workers.dev` can exceed 10s, and iOS Safari surfaces the aborted fetch as **"Fetch is aborted"** — so enabling alerts failed every time on a poor signal.
  - Added a `_pushPost(url, body, {timeout, retries})` helper: 20s timeout with one automatic retry on abort/network errors for `/subscribe` (15s for `/unsubscribe`). Bumped the busy-overlay safety timeout 30s → 45s to cover the longer worst case. The enable error toast now distinguishes an abort/timeout ("connection too slow — try Wi-Fi") from other failures.
  - **Cache bumped** — `?v=603` / `stormtracker-v603`.

  ## v5.04

  **Fix: Background Storm Alerts panel could render blank (push.js was never precached).**

  - `docs/sw.js` `STATIC_ASSETS` listed every JS module *except* `js/push.js`, so the service worker never precached it. `push.js` only loaded via a live network fetch (network-first with cache fallback) — and since it was never cached, an offline/flaky fetch left `renderPushAlertSettings` undefined. `settings.js` guards that call with `typeof renderPushAlertSettings==='function'`, so it silently skipped, leaving the Background Storm Alerts section (status badge, controls, on/off toggle, manage code) empty while the other settings sections (from precached `thresholds.js`) rendered fine. Added `/StormTracker/js/push.js` to the precache list so it's always available offline like the other modules.
  - **Why it surfaced now:** `push.js` was added with the background-alerts feature but never added to the SW precache list; the gap only bites on weak/offline connections (e.g. LTE).
  - **Cache bumped** — `?v=602` / `stormtracker-v602`.

  ## v5.03

  **Fixed scan cadence — steady every 5 minutes (randomizer removed).**

  - **Removed the randomized `choose(5–60)` cadence** (`scanner/scan.js`): the scanner previously used a GameMaker-style `choose(SCAN_GAPS)` to roll a random 5–60 min gap, gated by a frequent cron heartbeat and a shared next-due timestamp persisted in the Worker/D1. That indirection (plus the `getScanDue`/`setScanDue` `/scan-due` round-trips) is gone — every scheduled cron tick now simply scans. The cron interval in `.github/workflows/storm-scan.yml` is the single source of cadence; set to `*/5 * * * *` for a steady 5-minute schedule (the GitHub minimum). Per-alert cooldowns unchanged, so the same storm still won't re-buzz every scan.
  - **Why:** the random spacing meant a fast storm could wait up to ~60 min between scans, and changing the cron alone didn't produce a clean fixed interval because the randomizer still gated each tick. A plain fixed cadence is predictable and as fast as the platform allows.
  - **Cache bumped** — `?v=601` / `stormtracker-v601`.

  ## v5.02

  **Faster scan cadence — every 10 minutes.**

  - **Scan interval 30 min → 10 min** (`.github/workflows/storm-scan.yml`): the GitHub Actions cron now runs `*/10 * * * *` with `timeout-minutes: 5` (was `*/30` / 10). A fast-developing storm is now detected within ~10 min instead of potentially waiting most of an hour. Per-alert cooldowns are unchanged (`scanner/scan.js` `COOLDOWN`: storms/lightning 30 min, wx 3 h, NWS/tropical 12 h), so the same storm still won't re-buzz every scan — only genuinely new threats trigger between cooldowns. A scan with nothing matching simply runs and exits.
  - **Cache bumped** — `?v=600` / `stormtracker-v600`.

  ## v5.01

  **Notification-update progress UI + de-duplicated lightning wording.**

  - **"Please wait" overlay with count-up timer** (`docs/js/push.js` `_showPushBusy`/`_hidePushBusy`): turning Background Storm Alerts on/off or tapping Update shows a full-screen "Updating your notification settings, please wait…" overlay with a live seconds counter (the disable path reads "Turning off notifications…"). A 30s safety timeout clears the overlay, re-renders the settings panel, and toasts if the operation stalls (e.g. a hung permission prompt). Threshold/NWS/tropical changes now re-sync **silently** (`enablePushAlerts(true)`) so the overlay only appears for the primary on/off/update actions.
  - **No more double-timed lightning** (`scanner/scan.js` `fmtLightning`): when the lead cell's own ETA already shows it's ≤15 min out, the alert no longer also says "within 15 min" (the two times were redundant). That phrase now only appears when it adds info — a count of multiple imminent cells, or a faster non-lead cell — and the closing advice escalates to "Move indoors or to a safe location now." whenever anything is imminent.
  - **Cache bumped** — `?v=599` / `stormtracker-v599`.

  ## v5.00

  **Lightning estimates + bottom-line summary in background push alerts.**

  - **Estimated lightning advisory** (`scanner/scan.js` `fmtLightning`): a new `ltg` digest item warns when a strong storm (≥45 dBZ) is in the user's impact corridor (approaching / in the cone) out to 80 mi. Leads with the closest cell by direction (full compass word) + distance + ETA — e.g. `Lightning ⚡ estimated to the southwest around 12 mi in a strong storm (52 dBZ) · ETA ~24 min …`. Cells arriving within 15 min are flagged as the urgent set; the total count of strong corridor cells is included for context. Lightning is radar-derived (not observed), runs independent of the user's dBZ/impact storm-alert thresholds, and is deduped by 45° direction sector + 10 mi distance bucket (`ltg_` keys, 30 min cooldown).
  - **Bottom-line lead** (`scanner/scan.js` `situationLead`): multi-alert digests now open with a one-line actionable summary (e.g. `🚨 Bottom line: severe weather active near you — take protective action.`) before the item list, prioritizing tropical > any high-urgency > storms > general.
  - **Cache bumped** — `?v=598` / `stormtracker-v598`.

  ## v4.99

  **Push notification polish: ETA arrival clock, NWS effective times, clearer distance, subscription cleanup.**

  - **Storm push body** (`scanner/scan.js` `fmtStormBody`) now appends the arrival wall-clock time to the ETA — `ETA 8 min (08:09 AM)` for 12-hour users, `ETA 8 min (0809)` for 24-hour users — and renders distance as `4.7 mi away` instead of `at 4.7 mi`. Arrival time is formatted in the subscriber's own time zone via `Intl.DateTimeFormat`.
  - **Subscriber tz/format**: `docs/js/push.js` now sends `tz` (IANA zone) and `h24` (resolved 12/24h preference) in the subscription `thresholds`. Existing subscribers must toggle Background Alerts off/on once to populate these; until then the push gracefully omits the clock time.
  - **NWS push body** (`scanner/alerts.js` `fetchNws` + new `nwsWindow`/`fmtAlertTime`): active watches/warnings now include their effective window — `In effect until Thu 7:12 PM`, or `Begins … · until …` for future onsets — using the offset embedded in the NWS timestamp. Compact `· until …` is appended to each line in multi-alert digests.
  - **In-app toast** (`docs/js/thresholds.js`): storm-cell toast/notification distance wording changed to `… dBZ · 4.7 mi away …` to match the push.
  - **Subscription cleanup**: removed stale/duplicate push subscriptions server-side (kept only the active device).
  - **Cache bumped** — `?v=597` / `stormtracker-v597`.

  ## v4.98

  **Fix: Background Storm Alerts toggle did not update in real time after tapping Turn on.**

  - `docs/js/push.js` called `syncSettingsUI()` to re-render the settings panel after enable/disable/update, but no such function exists — the panel re-render function is `syncSettingsPanel()`. Every call threw a `ReferenceError`, so the subscription state was saved (line that calls `_setPushSub`) but the toggle only reflected ON after a reload.
  - Renamed all 5 `syncSettingsUI()` calls in `push.js` to `syncSettingsPanel()`. The toggle now flips to ON/OFF immediately on tap.
  - **Cache bumped** — `?v=596` / `stormtracker-v596`.

  ## v4.97

  **Fix: Background Storm Alerts toggle could get stuck after the v4.96 VAPID rotation.**

  - After the key rotation, a device's existing `PushSubscription` still carried the OLD `applicationServerKey`. The old enable flow did `if (!sub) subscribe(...)`, so it either re-registered the dead old key or hit iOS `InvalidStateError` and silently failed — leaving the toggle unable to flip back to ON.
  - `docs/js/push.js`: new `_ensureFreshSubscription()` compares the existing subscription's `applicationServerKey` to the current `PUSH_VAPID_PUBLIC_KEY`; on mismatch it unsubscribes and re-subscribes with the current key, with a retry that clears a lingering stale subscription if `subscribe()` throws. `enablePushAlerts()` now uses it. Makes Enable/Update self-healing across future key changes.
  - **Cache bumped** — `?v=595` / `stormtracker-v595`.
  
## v4.96

**Fix: background push rejected by Apple (`VapidPkHashMismatch`).**

- Root cause: the VAPID keypair the GitHub Actions scanner signs with no longer matched the `applicationServerKey` the iOS/macOS subscription was created with, so every push to `web.push.apple.com` returned HTTP 400 `{"reason":"VapidPkHashMismatch"}` and `Notifications sent: 0` despite the scan correctly detecting alerts. (Apple strictly enforces the public-key hash; FCM is more lenient, which masked the issue earlier.)
- Fix: rotated to a single fresh VAPID keypair used on **both** ends — the private/public halves are stored in the GitHub Actions secrets (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) and the matching public key is embedded as `PUSH_VAPID_PUBLIC_KEY` in `docs/js/push.js`.
- `scanner/scan.js` `trySend()` now logs the push-service error body, host, and payload size on failure, so future delivery errors are diagnosable from the Actions log.
- **Action needed:** rotating VAPID keys invalidates existing subscriptions. Subscribers must open Settings → Background Storm Alerts and tap **Disable** then **Enable** once to re-register.
- **Cache bumped** — `?v=594` / `stormtracker-v594`.

## v4.95

**One digest notification per scan + tropical (NHC) coverage.**

- `scanner/scan.js` no longer fires a separate push per alert type. Every currently-active alert for a subscriber (storm cells, weather thresholds, NWS warnings, tropical systems) is merged into a single `stormtracker-digest` notification that lists them all. The digest sends whenever at least one item is fresh (past its per-type cooldown) and resets every listed item's cooldown, so a sustained system shows the full picture without re-buzzing per type.
- New `scanner/tropical.js`: keyless NHC Active Hurricanes ArcGIS FeatureServer (layer 0 positions + layer 4 forecast cone). `evalTropical()` mirrors the in-app proximity + forecast-cone logic — a system pushes when it's within the user's tracking radius (default 200 mi) or the user's location is inside the cone, **before** any local NWS tropical watch is issued. New `trop_` dedupe namespace (12 h cooldown), state-encoded keys so a track→cone escalation re-notifies.
- `docs/js/push.js` subscription now carries a `tropical {on, radius}` config (radius mirrors the in-app `st_nhc_prox_radius`); added a **Tropical systems** ON/OFF toggle. Existing subscribers default to tropical ON.
- **Cache bumped** — `?v=593` / `stormtracker-v593`.

## v4.94

**Full "fresh open" background scan — every alert type now pushes, not just storm cells.**

- New `scanner/alerts.js`: keyless Open-Meteo current conditions for the weather threshold alerts (wind, gusts, temp, pressure, rain, humidity, visibility — comparisons ported verbatim from `_WX_ALERT_DEFS`) and `api.weather.gov` active NWS warnings at the point (US). UV is intentionally omitted to stay at parity with the app, whose UV alert is currently inert.
- `scanner/scan.js` now runs storms + weather thresholds + NWS for each location every cron, with independent per-type dedupe/prune windows (`sc_`/`wx_`/`nws_` keys in `last_alert`). No D1 migration — the `thresholds`/`last_alert` columns are free-form JSON.
- `docs/js/push.js` subscription now carries the user's in-app weather thresholds (`st_wxThresholds`) + unit prefs + an NWS warnings toggle, so background pushes match the in-app alerts exactly. Existing subscribers default to NWS warnings ON.
- **Cache bumped** — `?v=592` / `stormtracker-v592`.

## v4.93

**Clearer Background Storm Alerts on/off state.**

- `renderPushAlertSettings()` now shows an explicit ON (green dot) / OFF (grey dot) status badge so it is obvious whether alerts are active, names the watched location in both states, and uses a green "Turn on" / red "Turn off" button.
- Documented that the scanner watches a single location (Home, or current location if no Home), captured at enable/Update time — not all saved locations and not the live position.
- **Cache bumped** — `?v=591` / `stormtracker-v591`.

## v4.92

**Fix: "Could not enable alerts: Not found" when turning on Background Storm Alerts.**

- `docs/js/push.js` now resolves the push API as `st_pushApiUrl` override → baked worker default, and no longer falls back to `st_syncApiUrl`. The push endpoints (`/subscribe`, `/unsubscribe`) exist only on the dedicated worker, so a stale/other sync URL saved in `st_syncApiUrl` was causing a 404 ("Not found") on `/subscribe` and blocking enablement.
- **Cache bumped** — `?v=590` / `stormtracker-v590`.

## v4.91

**Background storm alerts now work out of the box — the companion Cloudflare Worker is live and baked into the app, so you no longer need to paste a sync URL to enable alerts.**

- **Push backend deployed & wired in** — `docs/js/push.js` now defaults to the live Cloudflare Worker (`stormtracker-proxy`, D1-backed) for storing subscriptions. Resolution order: `st_pushApiUrl` override → configured sync server (`_syncApiUrl()`) → baked default. This fixes "Could not enable alerts: Not found" on devices that never set a sync URL.
- **Cache bumped** — `?v=589` / `stormtracker-v589`.

## v4.90

**Multi-user background storm push alerts — radar is scanned server-side every ~30 minutes and subscribers get a push when a storm is inbound, even with the app closed.**

- **PWA opt-in & manage UI** — new "Background Storm Alerts" section in Settings (`docs/js/push.js`, rendered from `syncSettingsUI()` into `#push-alert-settings`). Requests notification permission, calls `pushManager.subscribe()` with the embedded VAPID public key, and POSTs the subscription + saved home location + thresholds (min dBZ / min impact / watch radius) to the Cloudflare Worker. Shows a shareable manage code, an Update button (re-syncs thresholds/location), and one-tap Disable. Reuses the existing sync-server base URL (`_syncApiUrl()`).
- **Cloudflare Worker + D1** — `worker/index.js` keeps the AWC METAR/TAF proxy and adds a D1-backed subscriptions API: `POST /subscribe`, `POST /unsubscribe`, secret-protected `GET /subscriptions` and `POST /mark-alert` (with dead-subscription pruning). Schema in `worker/schema.sql`, binding in `worker/wrangler.toml`.
- **Node scanner** — `scanner/detect.js` is a framework-free port of the in-app detection pipeline (NEXRAD/RainViewer dBZ palettes, slippy-tile math, PNG decode via `pngjs`, winds-aloft steering from Open-Meteo with NOMADS-GFS fallback, spacing-filter clustering, impact and ETA). `scanner/scan.js` pulls subscribers, scans per location, evaluates thresholds, dedupes per storm cell (30-min cooldown), and sends Web Push.
- **GitHub Actions** — `.github/workflows/storm-scan.yml` runs the scanner every 30 minutes (plus manual dispatch), with `WORKER_URL` / `SCANNER_SECRET` / VAPID keys supplied as repository secrets.
- **Setup runbook** — `PUSH_ALERTS_SETUP.md` documents the one-time Cloudflare + GitHub steps only the repo owner can perform.
- **Cache bumped** — `?v=588` / `stormtracker-v588`.

## v4.89

**AI briefing dBZ ranges now color by their strongest end, and every dBZ value is paired with a plain-language intensity word.**

- **Range coloring fixed** — the dBZ markup pass in `docs/js/ai.js` (the `[!dbz:…]…[/!]` → colored `<span>` replacement) previously captured only the FIRST number of a tagged range and discarded the second, so a tag like `[!dbz:35-55]35–55 dBZ[/!]` rendered in the color for 35 (green) even though it described a core reaching 55 (red). The regex now captures BOTH ends of the range and colors the phrase by `Math.max(lo, hi)`, so a range is always tinted by its strongest reflectivity. Single-value tags are unaffected. The defensive markup-strip passes are unchanged.
- **Intensity words in the prompt** — `getSystemPrompt()` in `docs/js/ai.js` gains two formatting rules alongside the existing dBZ-tag rule: (1) emit ranges as `[!dbz:LO-HI]LO–HI dBZ[/!]` and never imply a range is light just because it starts low, and (2) pair every dBZ value/range with the radar palette's plain-language term (31-40 moderate, 41-45 heavy, 46-51 very heavy, 52-59 heavy core, 60-64 severe, 65+ extreme). The prior severity-calibration guardrail is preserved verbatim — 55 dBZ is a heavy core, not automatically "severe".
- **Cache bumped** — `?v=587` / `stormtracker-v587`.

## v4.88

**Tropical storm proximity alerts now include a compass direction, and the Rain Clock reverts to its card-driven dial.**

- **Storm direction in tropical alerts** — the NHC/JTWC proximity banner (`_renderNHCBanner()`) and the one-shot proximity toast/notification (`_nhcProximityCheck()`) in `docs/js/storms.js` previously rendered only the distance ("656 mi away — Tracking" / "656 mi from your location") for an approaching tropical system. They now append a compass bearing computed from the user to the storm via `degToDir(bearingDeg(S.lat, S.lon, storm.lat, storm.lon))`, e.g. "656 mi to the SE — Tracking". The direction is omitted gracefully when either set of coordinates is missing, and the in-cone wording ("You are inside the forecast cone") is unchanged.
- **Rain Clock reverted to card-driven (v4.86 behavior)** — the v4.87 reverse-cone continuous coverage fill is fully removed from `docs/js/weather.js`: the `_RC_COV_MIN_DBZ` / `_RC_COV_MAX_MIN` / `_RC_COV_GAP_TOL` constants, the `_rcCoverageFill()` and `_rcCovTrailEdge()` helpers, the `rawMaxDbz` capture in the nearest-precip loop, the `_covFull`/`_covEdge` computation, and the max-merge of coverage minutes onto `out.minutes[]`. The dynamic span is back to `_rcPickSpan(_maxEta)` (furthest inbound card ETA only). The dial's painted arc is once again built purely from the discrete inbound storm cards, so it agrees exactly with the Storms-tab cards. The inbound count (`S._inboundShown`), tap-detail cell list, header pill, "raining now" path, and the forecast fallback / "no rain inbound" state are all unchanged.
- **Cache bumped** — `?v=586` / `stormtracker-v586`.

## v4.87

**Rain Clock dial now fills in continuously for broad rain shields.** The dial built its painted arc only from the discrete inbound-storm *cards* — each card painted a short pass-window (cell diameter ÷ speed) centered on its ETA — so a wide, continuous band of rain rendered as a few isolated colored chunks with dark gaps between them, even though rain was actually falling the whole time. A new reverse-cone coverage pass fills the gaps.

- **Reverse-cone coverage fill** — new `_rcCoverageFill()` in `docs/js/weather.js` builds one cone anchored at the user opening UPWIND (storm-motion direction + 180°, ±15°, reaching the full scan radius), sweeps every raw radar return inside it (`S._rawScanPts`) down to a dedicated light-rain floor (`_RC_COV_MIN_DBZ` = 18 dBZ), and buckets each return by its arrival minute over the user (along-track distance projected onto the motion vector ÷ storm speed, shifted earlier by `radarAgeMin()`). The resulting minute→peak-dBZ map is max-merged onto the dial's `out.minutes[]` so the arc paints as one continuous stretch. Cone half-width auto-scales to the strongest inbound storm's dBZ (the same `clamp((dbz-20)/15, 0, 3)` the Storms-tab cone uses), floored at 0.5 mi.
- **Span stretches to the shield's trailing edge** — the dial's dynamic span now considers the coverage trailing edge (`_rcCovTrailEdge()`, gap-tolerant so isolated far stragglers don't zoom the dial to 12 h) alongside the furthest inbound card ETA, so a continuous band reaching past the closest storms zooms the dial out to show how long it lasts.
- **Counts & cards untouched** — coverage only fills the painted ARC and the windows derived from it. The inbound count (`S._inboundShown`), the Storms-tab cards, the header pill, and the dial's tap-detail cell list are all still driven by the discrete inbound cards, so card↔dial count agreement is preserved. Motion comes from the existing in-memory `S.stormMovement` (no winds-aloft fetch). The forecast fallback and the stricter 15 dBZ card/window floor are unchanged.
- **Cache bumped** — `?v=585` / `stormtracker-v585`.

## v4.86

**Inbound storm lines no longer repeat the "DIRECT / NEAR DIRECT / NEAR MISS" tier word.** Inside the inbound section every cell is inbound by definition, so the tier label was redundant and broke the flow of the sentence. The color emoji (🔴🟠🟡…) is kept since it mirrors the storm cell card; only the inline word is dropped.

- **Deterministic engine** — `_stormLine()` in `docs/js/briefingEngine.js` (used for the "⏱️ Soonest" and "🔺 Strongest at your location" lines) now emits just the emoji + dBZ + distance/direction, with no tier word. Unused `lbl`/`pct` locals removed.
- **AI prompt** — the emoji color-coding rule in `docs/js/ai.js` now instructs the model to use the EMOJI ONLY (no tier word) inside the Inbound subsection, writing natural prose. The "Elsewhere on Radar" subsection may still keep the motion word (passing / moving away) for non-inbound cells.
- **Cache bumped** — `?v=584` / `stormtracker-v584`.

## v4.85

**Storm briefings now summarize the inbound rain instead of listing every cell.** Both the AI Briefing (`docs/js/ai.js`) and the deterministic System Briefing (`docs/js/briefingEngine.js`) used to enumerate one bullet per inbound storm cell, and the AI prompt additionally mandated that every strong (≥45 dBZ) non-inbound cell be named individually. With a broad rain event this produced a long, repetitive list that duplicated the Storms tab and could get truncated before the Aviation section finished.

- **Inbound = summary, not a list** — both briefings now frame the inbound threat as a short summary and highlight only the two cells that matter: the **SOONEST** (nearest radar-age-adjusted ETA) and the **STRONGEST** (highest projected dBZ-at-user). When ~15+ cells are inbound the lead line describes it as one broad rain shield (repeated rounds over the next hour), not N separate storms. The full per-cell list is left to the Storms tab.
- **Deterministic engine** — `buildThreats()` drops the per-cell inbound bullet loop (and the "+N more" tally) in favor of a lead summary line plus a "⏱️ Soonest" and "🔺 Strongest at your location" line. Light/drizzle and non-inbound (MISS/DISTANT/FAR, passing, moving-away) summaries are unchanged.
- **AI prompt** — the DETAIL-vs-MENTAL-PICTURE per-cell mandate, the per-cell two-subsection requirement, and the "every ≥45 dBZ non-inbound cell MUST be named individually" rule are replaced with a SUMMARIZE-DON'T-LIST philosophy. Subsection 1 highlights soonest + strongest; Subsection 2 ("Elsewhere on Radar:") summarizes non-inbound cells by direction and may name only the single strongest non-inbound cell for awareness. The context builder now emits explicit **INBOUND SUMMARY HINTS** (soonest + strongest) and reworded the STRONG NON-INBOUND block to "summarize, name only the strongest."
- **Cache bumped** — `?v=583` / `stormtracker-v583`.

## v4.84

**AI briefing now frames high cell counts as a broad rain area, not many discrete storms.** When the radar resolves a single continuous line/area of rain into dozens-to-hundreds of returns, the AI briefing previously mirrored the raw count (e.g. "130+ additional inbound cells"), which read as if 100+ separate thunderstorms were inbound.

- **Prompt rule added** — new "HIGH CELL COUNT = BROAD RAIN, NOT MANY STORMS" directive in `getSystemPrompt()` (`docs/js/ai.js`). When inbound cell count is high (~15+), the AI leads with the overall band as one feature (motion, dBZ range, how long rain persists at the user's location), details only the strongest cores, and never implies the raw count equals a number of separate storms. It may still quote the engine's "+N more inbound cells" tally but must pair it with language clarifying these are returns within one rain shield.
- **Scope** — prompt-only change; the deterministic System Briefing and the underlying detection/cell counts are unchanged (the fragmentation itself lives in the radar detector, not the briefing).
- **Cache bumped** — `?v=582` / `stormtracker-v582`.

## v4.83

**Storm-track rain-coverage labels moved off the map into the Storms tab.** Each storm-track cone used to draw a 💧 "count · max dBZ" text badge on the radar map. With the user sitting inside many overlapping cones, a dozen of these badges stacked into an unreadable pile over the user's location.

- **Removed the on-map cone label** — the per-cone 💧 divIcon marker in `plotStormTracks()` (`docs/js/radar.js`) is no longer created/added. The cone polygon (dashed path shading) still draws as before.
- **Added in-path coverage to the storm card** — new `getStormConeRain(s)` in `docs/js/storms.js` reuses `buildStormCone()` + `_coneRainStats()` to derive `{count, maxDbz}` for a storm's projected track, cached per storm per scan (`_coneRainScanId`/`_coneRain`) so card re-renders don't re-run the raw-point sweep. Each card now shows a "💧 In path: N returns · max X dBZ" line (only when count > 0 and the storm has a fast-enough track). This is distinct from the existing bottom "N returns" (the cell's own pixel count).
- **Cache bumped** — `?v=581` / `stormtracker-v581`.

## v4.82

**"Rotation" is now gated on a real NWS Tornado Warning.** The radar/sonar Rotation indicator (🌪️ marker + "ROTATION" / "Possible Rotation (Hook Echo)" labels) used to be driven purely by a radar-shape heuristic (`detectHookEchoes()` → `cell._hookEcho`). Hook-shaped echoes frequently have no tornado, so the marker was misleading. Rotation now requires an active warning.

- **Warning-gated rotation flag** — new `detectWarningRotation()` in `docs/js/storms.js` runs each scan after `detectHookEchoes()`. It clears `_rotation` on all cells, then, for each active NWS Tornado Warning in `S.alerts`, marks the single strongest radar cell inside the warning polygon (via `_pointInAlertPoly`) as `_rotation`. The hook-shape score is kept only as an internal tiebreaker — it no longer triggers any display or risk boost on its own.
- **Hybrid placement** — `_warnStormPoint()` parses the warning's `eventMotionDescription` storm point (lat/lon); when present, the rotation cell is chosen from cells within ~10 mi of that point, falling back to the strongest cell anywhere in the polygon.
- **All surfaces switched to `_rotation`** — radar-map 🌪️ marker + popup ("Tornado Warning — Rotation") + ring tier (`radar.js`), sonar 🌪️/"ROTATION" overlay (`weather.js`), 3D view flag (`view3d.js`), storm-card icon/name ("Rotation") + badge ("🌪️ Tornado Warning") (`storms.js`), and the Impact %/threat-score boosts now all key off `_rotation` instead of `_hookEcho`.
- **US-only** — NWS Tornado Warnings don't exist outside NWS coverage, so rotation never shows elsewhere (no reliable rotation source there anyway).
- **Cache bumped** — `?v=580` / `stormtracker-v580`.

## v4.81

**Rain Clock forecast now hides drizzle.** The v4.80 forecast fallback plotted *any* measurable rain (floor ~0.1 mm/hr), so the dial could read "raining until …" for hours even when the forecast was just trace/light rain. The forecast dial now has a meaningful-intensity floor.

- **28 dBZ forecast floor** — new `_RC_FC_MIN_DBZ=28` (~0.08 in/hr, light-moderate) in `docs/js/weather.js`. The forecast fallback in `_rainClockProject()` skips forecast hours below it, only builds windows from minutes at/above it, and `renderRainClock()` uses the same value as the forecast arc-draw floor (was 1). The "expected rain" center total now sums only the shown (≥28 dBZ) hours. The live-radar dial is unchanged — it keeps the stricter 15 dBZ radar-noise floor.
- **Cache bumped** — `?v=579` / `stormtracker-v579`.

## v4.80

**Rain forecast fallback on the Rain Clock.** The Rain Clock dial is built purely from the live radar / inbound-storm pipeline, so whenever nothing was inbound it showed the empty "No rain expected" face — even when the hourly forecast clearly had rain coming. The dial now falls back to the forecast in that case.

- **Forecast-to-dBZ projection** — `_rainClockProject()` (`docs/js/weather.js`) gained a fallback block that runs only when the radar path produced nothing (no windows, no cells, not raining now). It walks the hourly precipitation forecast (`S._hourlyData`), converts each rainy hour's mm/hr to dBZ via the existing `_precipMmToDbz()` (Marshall-Palmer), and paints one-hour blocks onto the dial's minutes array, re-picking the dynamic span to cover the furthest rainy hour (12 h cap). Contiguous rainy hours merge into one window; each window gets a synthetic forecast cell so the tap-detail/cell-count UX works. The projection is tagged `out.forecast`.
- **Forecast-aware rendering** — `renderRainClock()` draws forecast windows with the normal arc/color treatment but lowers the arc-draw floor (forecast rain can be lighter than the radar noise floor), labels the card **FORECAST**, words the center/text summary as a forecast ("Rain forecast at …" / "From the hourly forecast — no storms on radar yet."), and swaps the accuracy/tap hints for forecast-appropriate copy. Live radar always wins — the fallback never alters the dial when storms are inbound.
- **Cache bumped** — `?v=578` / `stormtracker-v578`.

## v4.79

**Real version bump + automatic update check on launch.** The visible version label was stuck at v4.76 across several deploys (only the cache-bust counter and SW cache name were bumped, never the `<title>`/header), so the app always *looked* outdated and "Check for update" compared the stale title against itself and reported "up to date."

- **Display version fixed** — `docs/index.html` `<title>` and the header `<span>` now read v4.79 (were hardcoded v4.76). `forceAppUpdate()` reads the title version, so the manual check now reports the correct version and detects real differences.
- **Auto update check on launch** — new `_autoCheckUpdate()` (`docs/js/settings.js`) runs at the top of `init()` (`docs/js/init.js`) *before* weather loads. It fetches the live `index.html` (`no-store`, 3s abort), and if the network `<title>` version differs from the loaded one it clears caches, unregisters the SW, and reloads once. A `sessionStorage` guard (`st_autoUpd`) prevents reload loops if the CDN is briefly stale.
- **Cache bumped** — `?v=577` / `stormtracker-v577` to force a fresh SW install so the new build propagates.

## v4.78

**Rain-coverage detail on storm track cones.** Each green track cone now carries a small label showing how much rain actually sits inside its projected path, so the cone communicates more than just direction.

- **Per-cone rain stats** — `_coneRainStats(pts)` (`docs/js/radar.js`) counts how many raw radar scan points (`S._rawScanPts`) fall inside each cone polygon (ray-cast point-in-polygon with a bounding-box prefilter for speed) and tracks the peak dBZ among them. `plotStormTracks` draws a `💧 <count> · <max> dBZ` badge at the midpoint of each cone, colored to match the cone, and registers it in `S._trackCones` so it clears/redraws with the cones. Selection logic is unchanged — still the top-strongest inbound set; this only adds detail.

## v4.77

**Stable storm-forecast ETA layout.** The inbound-cells summary at the top of the Storms tab (e.g. "🟡 Moderate to heavy cells inbound…") rendered the live ETA inline, so the once-a-second countdown's changing digit width kept reflowing the text — sometimes the time sat next to "ETA", sometimes it wrapped to the next line.

- **Two-line layout** — each tier line now shows the description (with cell count and max dBZ) on top, then the ETA pinned to its own line below as `ETA: 03h:23m:22s (10:58)`. The time can tick without ever bouncing the layout, since the "ETA:" label lives outside the live-updated countdown span. Applies to the AI/plain text summary too (`buildStormForecastLines` in `docs/js/storms.js`).

## v4.76

**Gate storm points on winds aloft + manual reboot button.** Storm steering, movement vectors, ETAs, cones and the Rain Clock all depend on winds-aloft data, but the startup scan used to fire `fetchWindsAloft()` without waiting on it — on a slow or failed fetch it just scheduled a background retry and returned, so storm points, markers, cones and projections rendered on first load with no steering data behind them.

- **Blocking winds-aloft gate** — new `ensureWindsAloft(lat, lon, reqId)` (`docs/js/storms.js`) force-refreshes winds aloft and retries until `S._aloftData` has ≥2 levels or a ~30-second budget elapses (≈3 s pause between attempts), surfacing progress through the boot/scan overlay's "wind" step. It's idempotent (a single in-flight gate promise is shared across overlapping scans/location changes) and respects the per-request guard `S._locReqId`, so a stale gated scan can't render after the user has moved on. The background retry is left active afterward so projections fill in once winds aloft finally arrives.
- **Every scan entry point awaits it** — `scanRadarForStorms` (`docs/js/storms.js`), `scanRadarForView` and `scanRadarHiRes` (`docs/js/radar.js`) now `await` the gate before scanning radar tiles or plotting any points, so no storm point/marker/cone/calculation appears until winds aloft is in hand. The AFD fetch still runs in parallel since it doesn't gate point rendering.
- **One consistent fallback** — if winds aloft genuinely can't be fetched within the 30-second window, the gate resolves and the scan falls through and renders anyway (rather than hanging forever), with a clear "⚠️ Winds aloft unavailable — storm motion & ETAs may be limited" notice. Verified on both NEXRAD (US) and RainViewer (non-US) radar sources.
- **Manual "Reboot Startup" button** — a new Settings entry (`rebootStartup()` in `docs/js/settings.js`) re-runs the startup sequence in place for the current location without a full app reload: it clears the winds-aloft cache so the gate genuinely re-fetches, then re-runs the location refresh pipeline (weather → gated scan → hazards). Handy if storm motion/ETAs ever look stuck because winds aloft never loaded.
- **Location-scoped readiness (race fix)** — "winds aloft ready" is now tied to the location the data was fetched at (`_waReady(lat, lon)` checks `S._windCache` is within range of the request), and every location change (`setLoc`, HD-scan `prepHdTarget`) clears `S._aloftData` and bumps `S._locReqId`. The gate also only reuses an in-flight fetch when both the request id **and** the coordinates match. Together these stop a failed new-location fetch from rendering against stale winds-aloft data from the previous spot.

## v4.75

**RainViewer dBZ recalibration.** On non-US locations (RainViewer radar source), storm intensity read noticeably hotter than the NEXRAD scale used in the US — the same rain showed up a few dBZ categories higher. The cause was a legacy "boost" multiplier inside the RainViewer color→dBZ decoder that the NEXRAD decoder never had.

- **Dropped the boost multiplier** — `rvToDbz()` (`docs/js/core.js`) was inflating its decoded dBZ by ×1.10 to ×1.29 depending on intensity (a true 50 dBZ core was reported as 65, a ~15 dBZ over-read at the top end). The RainViewer "Universal Blue" palette and the heuristic color branches already decode the tiles to true dBZ, so the raw value is now returned directly (still clamped to the 75 dBZ ceiling). RainViewer and NEXRAD now report on the same dBZ scale, so storm severity colors, cell counts, the Rain Clock, and alert thresholds behave consistently regardless of radar source. The NEXRAD path is unchanged.

## v4.74

**Rain Clock "raining now" detection.** When radar showed rain sitting right on top of you, the Rain Clock could still read "Rain starting at <future time>" — it built the dial only from *inbound* storm cards and dropped any overhead/proximity cell (those carry no ETA), so it fell through to the next approaching storm's arrival time. The clock now shares one signal with the conditions card.

- **One shared "raining now" signal** — both the hero conditions LIVE RADAR override and the Rain Clock now read `rainOverUserNow()`, which classifies the same dBZ-at-user radar zone (`checkUserInZone()`) the conditions card already uses. The two can no longer disagree ("pouring now but the clock says rain starts in an hour").
- **Now-window anchored at minute 0** — when rain is overhead, the dial anchors a cell and window at the 12 o'clock (now) position, so the summary reads "Raining now / Rain until …" with the cell's intensity and an estimated end time, instead of a future start time. Duration over the user uses the same cell-diameter / storm-speed model as inbound cells.

## v4.73

**Hybrid storm direction prediction.** Storm movement used to come from a single source — either winds-aloft steering or a raw cell track — with no sense of how trustworthy it was. Now the app keeps a persistent track for each storm cell across scans and blends *observed* cell motion with the winds-aloft prior, weighted by confidence. Winds-aloft is the starting estimate; as a cell is seen moving consistently over 2–3 scans, the prediction shifts toward what's actually observed.

- **Per-cell track memory** — a persistent track database (`S._cellTrackDB`) accumulates up to 4 position deltas per cell across scans, matching cells frame-to-frame within ~15 mi / 25 dBZ and pruning stale tracks. Each track computes a vector-mean direction/speed, a *consistency* score (how steady the motion is), and a *confidence* that ramps from 0 to 1 over the first few consistent updates.
- **Confidence-weighted blend** — `getHybridMovement(storm)` blends the winds-aloft direction (prior) with the observed cell track by confidence: low confidence leans on winds-aloft, high confidence (≥60%) is labelled **observed**, in between is **hybrid**. A fleet-level aggregate (`getSteeringMv()`) drives the path arrows, sonar steering arrow, 3D cones/steering, and summary lines.
- **Source badges everywhere** — storm cards, the map cone, the sonar arrow, the 3D steering readout/popup, and the AI briefing now show whether a prediction is 📡 observed, hybrid, or from winds-aloft, with the confidence %. Every direction consumer (ETA, cones, X-track, impact, alerts) is routed through the same hybrid source so the numbers agree.

## v4.72

**Radar latency time offset.** Radar imagery is several minutes old by the time it reaches the app, but storm positions are frozen at that observation moment — so every ETA and arrival time computed from "now" was reading a few minutes *late*. Now the app accounts for that radar age and shifts every arrival/ETA earlier so the times match reality.

- **One canonical radar age** — a single value (`S._radarAgeMs`) is captured at scan time and read everywhere via `radarAgeMin()` (in `docs/js/core.js`). For RainViewer we measure the real age of the latest observed (past) frame; NEXRAD and any unknown case fall back to a 5-minute default. The value is clamped 0–30 min so a bad timestamp can never produce an absurd shift.
- **Every ETA consumer subtracts it** — storm-card countdowns, the map-marker popup countdown, the severe/light storm ticker, the threshold storm-cell alerts, the Rain Clock dial cell positions, the 3D arrival sprites, and the AI/briefing arrival lines all now show times shifted ~5 min earlier.
- **Caption** — a small note under the Rain Clock dial reads "Arrival times shifted ~N min earlier to account for radar age" so the adjustment is transparent.

## v4.71

Small Rain Clock polish: the 6 dial labels now lead with the **wall-clock arrival time** and show the offset in parentheses underneath — e.g. **14:22** over **(+1:20 hrs)** — instead of the offset on top and the time below. The offset reads as `+H:MM hrs` (or `+N min` under an hour). The per-minute clock refresh still lands on the time line, and everything still scales to the dynamic span.

## v4.70

The Rain Clock dial now has a **dynamic time span** — it stretches from 1 hour up to 12 hours so **every** inbound storm is drawn at its real arrival position, instead of being pinned to a fixed 3-hour edge.

User idea: storms arriving after 3 hours (e.g. at 3:30 or 4:00) were getting pinned to the dial's edge instead of being drawn where they actually arrive, so not everything showed properly. The fix: let the dial pick how far ahead it looks based on the furthest inbound storm.

Changes (all in `docs/js/weather.js`):

- **Dynamic span (1h–12h)** — `_rainClockProject()` now looks at the furthest inbound storm's ETA and picks the smallest "nice" span that contains it (1h, 2h, 3h, 4h, 6h, 8h, or 12h). So a storm 20 min out gets a tight 1-hour dial (great resolution), while a storm 5 hours out gets a 6-hour dial — and it's drawn at its true position, not the edge. Falls back to the familiar 3-hour dial when there's no inbound rain.
- **Everything scales to the span** — the 6 outer clock labels space themselves evenly across the chosen span (30 min apart on a 3 h dial, 2 h apart on a 12 h dial), the card title shows the live span ("Rain Clock · 6h"), the per-minute arc, windows, and rain-amount estimate all integrate over the full span, and the center/text summaries say "next N hours" to match.
- **Confidence note** — the dial is a *live-radar projection*: extremely accurate in the very short term, less certain the further out it reaches (a cell that's "arriving" can weaken, build, or veer before it gets here). A caption under the dial now reads "≈95% accurate within 30 min · further out is a live-radar projection — storms can still weaken, build, or shift," and each cell in the tap-details list is tagged **High confidence** (within ~30 min) or **Projection · may shift** (beyond).
- **Label-clock fix** — the per-minute tick that refreshes the wall-clock times under each label assumed a fixed hourly spacing; it now reads each label's actual offset, so the times stay correct on any span.

## v4.69

The **Total Precipitation Next 36 hrs** chart is now fully independent of the Rain Clock.

We tried tying the two together once (the chart's first 3 hours were overridden with the Rain Clock's live radar nowcast so they'd agree about "right now"). In practice that mixed two different things — a short-range radar nowcast and a 36-hour forecast — and made the chart confusing. They're now kept separate, as they should be.

Changes (all in `docs/js/weather.js`, `renderRainForecastBars`):

- **Forecast-only, all 36 hours** — the chart now draws the precipitation forecast straight from the hourly forecast data (Open-Meteo, with the NWS QPF merge already applied) for every hour, with no radar/clock override on hours 0–2. The Rain Clock keeps doing its own thing (inbound radar cells, 0–3 h); this chart is the forecast (0–36 h). They're deliberately separate measurements.
- **Always shows the graph, even with no rain** — when the forecast has no measurable rain, the card used to collapse to a single line of text. Now it still draws the chart frame (time axis, "Now → +36 h" labels, gridlines) with a centered "No measurable rain forecast" note, so it's clear the widget is working and it's simply a dry forecast — not a broken/empty card.

## v4.68

The Rain Clock dial now shows the **exact same inbound storms as the Storms tab** — same cells, same count, always in sync.

User asked for full sync (not a relabel): the Storms tab said "2 inbound" while the Rain Clock showed 3 cells. The two surfaces were telling different stories about the same thing.

Root cause: the Rain Clock ran its **own independent pipeline**. `_rainClockProject()` re-clustered the raw radar pixels (`S._rawScanPts`) using advection plus a 2.5 mi spatial-hash cluster — a completely different data path and a different clustering rule from the Storms-tab cards (which come from `computeTopStorms` → `S._topStorms` → the filtered, capped `S._inboundShown`). Different input + different clustering = a different number, every time.

Changes (all in `docs/js/weather.js`):

- **One source of truth for the dial's cells** — `_rainClockProject()` no longer re-clusters raw pixels. It now reads the **same `S._inboundShown` list** the header pill (`core.js`) and the Storms-tab cards (`storms.js`) read, falling back to the unfiltered top-storms list only before the Storms tab has rendered once. Each inbound storm card maps to exactly one cell on the dial, so the dial, the pill, and the cards can never disagree on which storms are inbound or how many there are. The user's active storm filter is honored automatically because `S._inboundShown` already reflects it.
- **Arrival mapped from the card's own ETA** — each cell is placed on the 0–180 min (3 h) dial at the same ETA the card shows. An overhead/now cell sits at the top; a card whose ETA is beyond the 3 h horizon is pinned to the dial edge so it is still counted (one card = one cell, always) without painting a misleading mid-dial arc. The v4.66 intensity-scaled cell radius and diameter ÷ speed pass-duration model are retained — only the *source* of each cell changed (storm card, not raw pixel).
- **No more cell capping** — the old window builder did `clusters.slice(0,5)`, which could undercount cells in a busy window. Now every cell is assigned to exactly one window and never dropped, so the total number of cells across all windows always equals the inbound card count. Tap-tooltips ("N cells"), the tap-details list, and the cards stay in lock-step.
- **Nearest Precipitation readout unchanged** — it still scans the raw radar points, so "rain X mi to the NW" keeps working even when nothing is inbound. Zero inbound storms now means the dial correctly shows "No rain expected next 3 hours," matching a Storms tab with no inbound cards.
- **Always re-renders when the inbound set changes** — the dial now recomputes whenever the Storms tab re-renders (`renderStorms` in `docs/js/storms.js`) and whenever you return to the weather page (`switchPage('weather')` in `docs/js/core.js`). Previously a storm-filter change or a page switch could update the cards/pill while the dial kept showing a stale window/count until an unrelated refresh; now the dial stays in lock-step in real time. Also, the dial no longer blanks out when the radar scan is stale — the cards still show their inbound storms (with ETAs) when stale, so the dial mirrors them instead of dropping to zero cells.

Note: "inbound" on the dial means the same thing it means on the Storms tab — approaching cells. Overhead cells (sitting on you, not approaching) are tracked separately on the Storms tab and aren't counted as "inbound" on either surface; the Nearest Precipitation line still surfaces close rain. The 36-hour bar chart still mirrors the clock for hours 0–2 via the radar-derived `radarHourlyMm`, which is now computed from these inbound cells.

## v4.67

Reconciled the confusing "inbound" counts across the app and switched the Rain Clock summary to a single clock format.

User reported the header pill said "5 inbound", the Storms-tab cards showed "2 inbound", and the Rain Clock told a third story — three different numbers for what reads like the same thing. Separately, the Rain Clock's plain-language summary printed every time in both 12-hour and 24-hour form ("around 11:00 AM (1100)"), ignoring the user's chosen time format.

Changes:

- **One inbound count everywhere** — the Storms tab is now the single source of truth. After it builds the filtered, capped inbound set it stashes it on `S._inboundShown` (`docs/js/storms.js`). The header pill (`docs/js/core.js`) and the "Light rain inbound — N cells" forecast banner (`buildStormForecastLines` in `docs/js/storms.js`) both read that same set, so all three agree and all honor the user's active storm filter. Previously the pill counted the unfiltered top-storms list while the cards counted the filtered list, which is why they disagreed (5 vs 2). Before the Storms tab has rendered once, the pill and banner fall back to their old unfiltered computation so nothing is blank on first paint.
- **Single clock format in the Rain Clock summary** — the summary sentence now shows arrival/end times in the app's chosen format only (12h or 24h, via the existing `fmtClock` helper that respects the time-format setting), e.g. *"A light rain cell @ 20 dBZ arriving around 11:00 AM, ending about 3 min later (around 11:03 AM)."* The dual-format helpers `_rcFmt12`/`_rcFmt24` were removed from `docs/js/weather.js`.

Note on the other on-screen numbers: the "storm track cones" count (how many storms' projected paths currently cover you) and the Rain Clock's "cells contributing" (radar-pixel rain windows) are deliberately different measurements from "inbound storm cards" and keep their own distinct labels — they were never meant to equal the inbound count. *(Superseded in v4.68: the Rain Clock's cells are no longer independent radar-pixel windows — the dial now mirrors the inbound storm cards exactly, so its cell count equals the inbound count. The storm-track-cones count remains a separate measurement.)*

## v4.66

Rain Clock now uses a dynamic, intensity-based catch size (like the storm cones), estimates how long the rain lasts from the cell's size and speed, and writes a plain-language summary.

User asked for the Rain Clock to size each cell by its strength the same way the Storms-tab cones do — a light drizzle cell should have a small footprint, an extreme core a large one — and to use that size, the storm speed, and the arrival time to estimate how long the rain will actually last over them. Desired summary wording: *"A Light rain cell @ 20 dBZ arriving around 11:00 AM (1100) ending about 3 minutes later."*

Changes (all in `docs/js/weather.js`):

- **Dynamic cell radius** — replaced the flat 1.5 mi catch radius that every cell used with `_rcCellRadiusMi(dbz)`, which mirrors the Storms-tab cone base width `clamp((dbz-20)/15, 0, 3)` plus a 0.2 mi floor. A ~20 dBZ cell is ~0.2 mi; a 60+ dBZ core is ~3 mi.
- **Cone-matched catch** — the catch radius now widens with how far the cell must travel to reach its closest approach, using the same 15° cone half-angle the cards use (`effR = baseR + distAlongV·tan15`, capped at 6 mi to avoid sweeping in far off-track cells). This makes the dial agree with the Storms-tab cards: a distant lighter cell the cards call "inbound" now registers an arrival on the dial instead of being missed by the old fixed circle.
- **Duration from diameter ÷ speed** — each rain window's length now reflects the physical pass time of the cell (cell diameter divided by storm speed, centered on the closest-approach time) instead of the old catch-circle chord length, which grew with the catch radius and didn't represent the real cell size.
- **Plain-language summary** — the Rain Clock text view now reads e.g. *"A light rain cell @ 20 dBZ arriving around 11:00 AM (1100), ending about 3 min later (around 11:03 AM)."* It names the intensity (Light / Moderate / Heavy / Intense from peak dBZ), shows the dBZ value, and shows the arrival time plus the estimated duration. *(Superseded in v4.67: the summary now uses a single clock format instead of both 12-hour and 24-hour.)*

## v4.65

Reverted the Storms-tab filter to its original working behavior and flipped the direction of the match: the Rain Clock now matches the Storms-tab cards, not the other way around.

User asked to put the cards back exactly as they were (they worked) and instead make the Rain Clock agree with the cards. Previously v4.63/v4.64 raised the shared floor to 20 dBZ and pushed the cards up toward the Rain Clock's stricter cutoff, which hid inbound cards. The Storms tab is now the source of truth.

Changes:

- **`docs/js/core.js`** — `STORM_MIN_DBZ` changed from 20 to 15, matching the Storms tab's long-standing radar detection floor.
- **`docs/js/storms.js`** — the card filter is back to its original form (only drops a cell when its estimated intensity at the user would arrive below 15 dBZ); no peak-reflectivity gate. The radar scan floor now reads from `STORM_MIN_DBZ` (still 15) so it stays linked to the Rain Clock.
- **`docs/js/weather.js`** — the Rain Clock's `_RC_MIN_DBZ` reads from `STORM_MIN_DBZ` (15), down from its old 25, so it surfaces the same light cells the cards do.

Net effect: storm cards behave exactly as before the v4.63 experiment, and the Rain Clock now shows rain for the same cells the cards surface instead of using a stricter, separate threshold.

## v4.64

Fixed a regression from v4.63 that hid every storm card.

User reported the Storms tab showed "5 inbound" with the mini sonar map and Rain Clock rendering normally, but the Storm Points cards were completely gone ("showing 0/1038"). v4.63 applied the new 20 dBZ shared floor to TWO different metrics: the cell's own peak reflectivity AND its estimated intensity at the user's exact location (`estDbzAtUser`). The est-at-user metric is not what the Rain Clock filters on — the Rain Clock gates on raw radar point reflectivity. Because inbound cells commonly weaken to below 20 dBZ by the time they reach the user's precise location, the est-at-user gate hid all of them, leaving no cards even though strong cells were clearly on the map.

Fix:

- **`docs/js/storms.js`** — the shared `STORM_MIN_DBZ` (20) floor is now applied ONLY to a cell's own peak reflectivity (`s.dbz`), which is the same metric the Rain Clock uses. The original weak-arrival guard (hide cells projected to arrive below 15 dBZ) is kept as-is, not raised to the shared floor. This restores the inbound cards while still enforcing a true 20 dBZ minimum on both surfaces using one consistent rule.

## v4.63

Storms-tab cards and the Rain Clock now share one minimum-dBZ floor (20 dBZ).

User reported a mismatch: the Storms tab was showing a weak "Rain Cell" (peak 25 dBZ, projected to arrive at only ~18 dBZ, labeled LIGHT RAIN / Drizzle) as "1 inbound", while the Rain Clock said "No rain expected next 3 hours." The two surfaces were using different cutoffs — the Rain Clock filtered cells below 25 dBZ, while the Storms tab only hid cells whose estimated arrival intensity was below 15 dBZ. The user asked that both use the same minimum and set it to 20 dBZ.

Changes:

- **`docs/js/core.js`** — new shared constant `STORM_MIN_DBZ = 20`, exported on `window`, so there's a single source of truth for the minimum-rain floor.
- **`docs/js/weather.js`** — the Rain Clock's `_RC_MIN_DBZ` (was hardcoded `25`) now reads from `STORM_MIN_DBZ`, lowering its floor to 20 to match.
- **`docs/js/storms.js`** — the Storms-tab baseline filter now hides a cell if EITHER its own peak reflectivity is below 20 dBZ OR its estimated intensity at the user's location is below 20 dBZ (was: only hide when estimated arrival < 15 dBZ). This drops the weak drizzle cells the user didn't want surfaced and keeps the Storms tab in agreement with the Rain Clock.

Net effect: anything too weak to register on the Rain Clock no longer shows up as an "inbound" storm card, and vice versa. The radar scan itself still samples down to 15 dBZ for accurate cell-building; the 20 dBZ floor is applied at display time.

## v4.62

Fixed raw `[!dbz:...]` / `[/!]` markup leaking into AI briefings.

User reported that about 3/4 of the way down their AI briefing, raw markup tokens like `[!dbz:...]` and `[/!]` were leaking into the rendered text. The system prompt instructs the model to wrap every dBZ value in a custom tag — `[!dbz:55]55 dBZ[/!]` — so the number can be rendered in the radar-palette color matching its intensity. The renderer's regex was strict: it only matched a single number (`[!dbz:55]`), no ranges, no stray whitespace, no case variation. The model frequently emits ranges in summary sentences (`[!dbz:45-55]45–55 dBZ[/!]`), and when it does, the regex misses and the raw markup leaks straight through to the user's screen and the copied-to-clipboard text.

Changes (`docs/js/ai.js`):

- **`fmtAIText()`** — dBZ regex widened to accept ranges (`[!dbz:45-55]`), decimals, optional whitespace around the colon/brackets, and case-insensitive `DBZ`. The color/severity regex (`[!red]…[/!]`, etc.) is now also case-insensitive and whitespace-tolerant.
- **Defensive sweep at the end of `fmtAIText()`** — any orphan `[!...]` or `[/!]` token that survived the structured passes (mismatched pairs, unknown tag names, markup the model invented on its own) is stripped before render. The user will never again see raw markup leak, even if the model invents a tag we don't recognize.
- **`stripAIMarkup()`** (the copy-to-clipboard path) — same tolerance widening and the same final sweep, so the text the user copies into another app is also always clean.

## v4.61

AI request per-attempt timeout bumped from 30s to 60s.

User reported that on slower connections legitimate AI Briefing responses were sometimes pushing close to a minute end-to-end (the model is summarizing storms, METAR, AFD, alerts, shear, instability, and inbound cells all in one prompt — it's a lot of context to chew through). At a 30-second per-attempt timeout the AbortController was firing on real, in-flight responses, not just dead sockets, so the user was watching the retry kick in unnecessarily.

Changes:

- **`docs/js/ai.js`** — `PER_ATTEMPT_MS` in `sendAIChat` raised from `30000` to `60000`. The visible countdown ("Attempt 2/3 · 47s remaining…") and the abort-error fallback string ("timed out after 60s") follow. Total worst-case wall time is now 3 × 60s ≈ 3 minutes before the "Three failed attempts" message appears, vs. ~1.5 minutes before. Non-retryable failures (401 / 429 / 402) still short-circuit instantly, so the longer ceiling only applies when the network is actually struggling.

## v4.60

AI panel collapses to a clean "Built-in Summary Assistant (NO AI)" view when there's no OpenAI key.

User pointed out that the AI panel was showing five quick-question buttons (Current conditions, Storms approaching?, Next few hours?, Safe outdoors?, plus the Send button and chat input) even when no API key was configured — and every one of those except "Full briefing" just produced a "No API key configured" error. Dead buttons that all fail with the same message are worse than no buttons. Asked to auto-run the briefing on open and replace the dead controls with a single ♻️ refresh button.

Changes:

- **`docs/index.html`** — added IDs (`ai-header-icon`, `ai-header-title`, `ai-input-row`, `ai-refresh-btn`, `ai-clear-btn`) so the panel can be retitled and restructured per mode. Added the ♻️ refresh button next to the close button (hidden by default).
- **`docs/js/ai.js`** — new `_applyAIPanelMode()` runs every time the panel opens and picks between two modes based on `getAIKey()`:
  - **No key:** title becomes "Built-in Summary Assistant (NO AI)", icon swaps to 📋, the chat input row and quick-question buttons are hidden, the 🗑️ clear button is hidden (nothing to clear — each refresh replaces the previous snapshot), and the ♻️ button is exposed. The deterministic on-device briefing auto-runs immediately on open and on every ♻️ press, with the panel cleared first so each refresh feels instant and snapshot-like instead of stacking stale briefings.
  - **Key present:** original full chat UI is restored — same title, same quick questions, same input, same Send button. Nothing changes for paying users.
- New `refreshSummaryBriefing()` is the single entry point for the no-key path. It clears the message area, calls `buildBriefing()`, and prepends a small `[!cyan]Built-in Summary (deterministic, on-device · no AI).[/!]` banner so the user always knows which engine produced the text on screen.

## v4.59

System Briefing drops the AFD wall + AI Briefing now retries with a visible countdown.

User reported two things:

1. The non-AI (System) briefing was getting cut short because we were dumping the full NWS Area Forecast Discussion (AFD) verbatim into the body. The AFD is a long, technical narrative written for meteorologists — it overflowed the briefing window with a "...[Truncated]" tail and pushed the useful sections off-screen. User suggested either dropping it from the System briefing or summarizing it with something free.
2. The AI Briefing hit a "Connection error" on spotty LTE with no retry — the user had to manually re-ask. Asked for an automatic retry with a visible 30-second countdown, up to 3 attempts total, and a friendly message after the third failure.

Changes:

- **`docs/js/briefingEngine.js`** — the System (non-AI) briefing no longer pastes the raw AFD into the Situation Overview. The AI Briefing still consumes the AFD (with the model summarizing it naturally) via the separate `buildWeatherContext()` path in `docs/js/ai.js`, so nothing is lost on that side. Skipping a third-party summarizer service keeps the System briefing fully on-device and key-free as advertised.
- **`docs/js/ai.js`** — `sendAIChat` rewritten as a retry loop: up to 3 attempts, each with a hard 30-second timeout via `AbortController`. A live status line under the typing dots shows which attempt is running (`Attempt 2/3 · 27s remaining…`). After the third failure the user sees: *"Three failed attempts. Internet connection is weak — try moving to a different location or connecting to Wi-Fi, then ask again."* Non-retryable failures (401 bad key, 429 rate limit, 402 quota) still short-circuit and surface their specific message immediately — no point burning retries on errors that won't fix themselves.

## v4.58

Rain Clock wording fix + faster recovery on slow connections.

User reported two issues on a slow LTE connection: (1) the Rain Clock header still said "RADAR + FORECAST" and the card showed "Nothing showing up on radar" next to "~0.06 in expected next 3 h" — a confusing contradiction, since the small expected amount was actually coming from the Open-Meteo fallback, not from radar. (2) Storm points loaded but winds aloft never arrived; the card sat on "Waiting on Open-Meteo" indefinitely and only fixed itself when the app was closed and reopened.

Wording fixes in `docs/js/weather.js`:

1. **Source tag**: "RADAR + FORECAST" → just "RADAR" (or "FORECAST (fallback)" in the rare case radar isn't ready but the forecast has filled in). The dial is radar-only as of v4.57, so claiming forecast input on the tag was wrong.
2. **Expected-rainfall amount** is now suppressed when the dial has no rain windows AND the amount came purely from the forecast fallback — so the card no longer shows "No rain on radar" right next to "~0.06 in expected." When radar actually projects rain, the amount still appears as before.

Recovery fixes:

3. **Open-Meteo background retry** (`_OM_RETRY_DELAYS` in `docs/js/weather.js`): retry delays tightened from [15s, 30s, 60s] (gave up after ~1m45s) to [5s, 10s, 20s, 45s, 90s] (~3m total, snappier first attempt). On slow connections this back-fills hourly/daily/UV/freeze-level cells without the user having to close and reopen the app.
4. **Winds aloft background retry** (new `_scheduleWindsAloftRetry` in `docs/js/storms.js`): mirrors the Open-Meteo retry. Previously, if every aloft provider (Open-Meteo main → customer-api → NOMADS GFS) timed out, the card just said "Winds aloft failed" and storm-cone projections silently went stale until the next hourly autorefresh. Now a retry chain fires at 6s / 15s / 30s / 60s, and on success the rain clock and storm projections re-render automatically.

## v4.57

Rain Clock shrunk back to 3 hours, radar-only.

User reported the rain clock was still putting too much emphasis on Open-Meteo instead of actual radar, plus a startup timing race where on the first load OM hadn't loaded yet but the dial drew anyway, then on subsequent loads OM was there but still wasn't drawing correctly. Asked to simply: make the clock a 3-hour radar-only dial, keep the expected-rainfall amount, and let the 36-hour bar chart below carry the forecast story.

Changes to the rain clock in `docs/js/weather.js`:

1. **Dial span**: `_RC_TOTAL_MIN` 720 → 180. The whole dial now represents the next 3 hours, matching the radar advection horizon.
2. **Hour labels**: 12 hourly labels → 6 labels at 30-minute intervals (Now, +30m, +1h, +1h30m, +2h, +2h30m). The live wall-clock time tick still updates each label every 60s.
3. **Tick ring**: minor ticks unchanged (still 120), majors moved from every 10th tick to every 20th so they line up with the new 30-minute label positions.
4. **Forecast overlay removed from the dial**. The hourly forecast walk still runs, but only to compute a 3-hour fallback rainfall amount — it no longer paints arcs. Radar advection is the sole source for what appears on the dial.
5. **Center text** now reads "next 3 hours" instead of "next 12 hours". Expected-rainfall amount prefers the radar-derived per-hour mm/hr sum (from v4.56) and only falls back to the forecast model when radar isn't ready yet.
6. **Boundary marker** at the 3-hour position removed — it now coincides with the top of the dial (same place as "Now"), so the dashed line would have been redundant.
7. **Background arc** redrawn as a full circle (the old SVG path arc degenerated at TOTAL=180 because start and end angles coincided).
8. **Title** updated from "Rain Clock · 12h" to "Rain Clock · 3h".

The 36-hour Total Precipitation bar chart below is unchanged — it still uses the OM+NWS hybrid for hours 3+ and the v4.56 radar-derived values for hours 0-2.

## v4.56

Rain Clock and Rain Forecast Bars now agree about the next 3 hours.

User reported the bar chart was painting heavy rain Now → 19:00 (NWS QPF) while the rain clock above it only showed a small arc at +3h. Same time window, two different data sources, two different stories. The user asked: first 3 hours should be real radar observations on **both** views, and only +3h onward should use the forecast hybrid (Open-Meteo preferred, NWS as backup).

Implementation:

1. **Rain clock forecast overlay** now skips minutes 0–180 entirely. The 0–3h ring is filled exclusively by radar advection (cells projected to cross the 1.5 mi radius). Forecast data only fills the 3–12h zone. This was already mostly the case, but the v4.55 forecast loop would still write into minutes 0–180 whenever radar wrote nothing — now it doesn't.

2. **Radar-derived per-hour mm/hr** is computed inside `_rainClockProject()` before the forecast overlay runs. Per-minute dBZ values from the radar advection are converted back to mm/hr via inverse Marshall-Palmer (R = (Z/200)^(1/1.6)), then averaged across each hour. Result is stashed on `S._rainClockData.radarHourlyMm` as a 3-element array.

3. **Rain Forecast Bars** read that array and override the first three forecast slots with the radar-derived values whenever radar is ready. Hours 3+ keep the existing hybrid OM+NWS forecast (with NWS still merged per-hour MAX, as v4.54 introduced — the user wants both sources represented for the forecast zone).

Net effect: if the rain clock says "no rain in the next hour," the bar chart's first hour bar will also be zero. If the clock shows a window of moderate rain starting at +90 min, the second hour of the bar chart will reflect that. When radar isn't loaded yet, the bars fall back to the forecast for hours 0-2 — graceful degradation, same pattern as the v4.51 winds-aloft watchdog.

## v4.55

Rain Clock now draws forecast rain that's below the radar-noise threshold.

User reported the Rain Forecast Bars graph was painting the next 6 hours of rain after the v4.54 NWS QPF backup, but the Rain Clock dial above it was completely empty — only a tiny "Now" arc at top. Same data, two different renderings, only one of them showed rain.

Root cause: the rain clock used a single 25 dBZ threshold for everything, originally tuned to keep radar noise off the dial. But the forecast overlay feeds the dial with `_precipMmToDbz(mm)`, and NWS QPF returns its values as 3–6 hour gridpoint totals that get spread across clock hours — peak per-hour values typically land around 0.3–1 mm/hr, which converts to about 15–23 dBZ. Right under the 25 dBZ cutoff. The bar chart shows the values fine (it uses raw mm); the clock silently dropped them.

Two fixes, both in `_rainClockProject()` in `docs/js/weather.js`:

1. **Forecast overlay**: now uses a light-rain floor (`mm >= 0.1`) instead of the dBZ filter, and clamps the dBZ value to a minimum of 15 so even drizzle-class forecast hours get drawn in the dial's lightest color. Radar contributions still use the original 25 dBZ noise filter — only the forecast portion is more permissive.
2. **Window builder**: the "where is rain happening" detector that walks `out.minutes[]` and groups continuous segments into colored arcs also used 25 dBZ as its start threshold. Lowered to 15 dBZ to match the new floor; otherwise anything just written in by fix #1 would still get dropped here.

Net effect: the Rain Clock now paints the same continuous rain windows you see in the bar chart, including light-rain hours. Radar advection still wins for the 0–180 min ring (no fighting between the two sources for the same minute).

## v4.54

NWS gridpoint QPF added as a backup precipitation source for US locations.

After v4.53 fixed the "graph disappears" bug, the user reported the graph was now rendering but reading zero across the next 36 hours in Pensacola despite radar clearly showing inbound storms. Open-Meteo's GFS+HRRR blend was returning 0 mm for every hour — a real model-vs-radar disagreement, not a missing-data bug. User correctly suggested adding NWS as a backup, same pattern as the v4.51 winds-aloft watchdog.

Added `fetchNwsHourlyQpf()` that pulls `quantitativePrecipitation` from `api.weather.gov/gridpoints/{wfo}/{x},{y}`. The endpoint returns multi-hour periods in ISO 8601 notation (e.g. `"2026-05-26T18:00:00+00:00/PT3H"` with a single mm value covering 3 hours); `_parseNwsValidTime()` decodes the period and `_nwsQpfOnce()` spreads the value evenly across clock hours so it lines up with Open-Meteo's hourly grid. Two-try retry pattern mirrors `fetchNWSForecast()`.

Hooked into the existing parallel fan-out in `fetchWeather()` (US-only — NWS coverage), and merged into `omData.hourly.precipitation` via `_mergeNwsQpfIntoOM()`. Strategy: per-hour MAX, same safety-conservative pattern as the GFS+HRRR blend. If OM says 0 mm and NWS says 0.5 mm, the bar reflects 0.5 mm. Logs how many hours got bumped upward so model disagreements are visible in console.

Non-US locations are unchanged (no QPF backup available globally yet). When NWS is down, the bars still render with whatever Open-Meteo returned.

## v4.53

Rain Forecast Bars graph stops vanishing when one Open-Meteo model is missing the precipitation array.

User reported the "Total Precipitation Next 36 hrs" graph was completely missing in Pensacola — not "no rain" empty state, the entire card was gone. Root cause was a precipitation-specific strictness bug in `_blendOMModels()`: every other field (temperature, humidity, wind, pressure, etc.) gracefully falls back to whichever model has the data when one is missing it, but `precipitation` required **both** GFS and HRRR to have the array, otherwise the blended output had no `precipitation` key at all. When the renderer then saw `!h.precipitation`, it set `el.innerHTML=''` and the card disappeared with no indication anything was wrong.

Two fixes:

1. **`_blendOMModels()` in `docs/js/weather.js`**: `hourly.precipitation`, `daily.precipitation_sum`, and `daily.precipitation_probability_max` now mirror the same "both → max, one → use it, neither → skip" fallback pattern that the rest of the fields already use.

2. **`renderRainForecastBars()`**: never blanks the card. Both empty-state code paths (missing precipitation array, zero usable slots after the time-window filter) now always render the card frame with a friendly placeholder message ("⏳ Hourly precipitation forecast not available right now — will appear on the next refresh.") so the user can see the section exists and that it's a data issue, not a missing widget.

No other behavior changed — when both models return precipitation as before, the bars render identically.

## v4.52

AI briefing — every ≥45 dBZ non-inbound cell gets called out individually.

After v4.51 the AI was finally seeing the full unfiltered scan radius, but it still rolled strong non-inbound cells into vague group sentences like "a ring of 20–55 dBZ echoes is drifting NW." The user wanted each strong cell named: "the strongest storm on radar is 25 mi NE of you with a strength of 55 dBZ moving N at 12 mph, poses no risk."

v4.52 adds a dedicated `STRONG NON-INBOUND CELLS` block to the AI prompt context. The block lists every non-inbound cell at ≥45 dBZ (capped at 12 for prompt size), pre-sorted by dBZ descending, with the exact distance, bearing of user, dBZ, motion direction & speed, projected miss, closing speed, and a precomputed threat verdict ("receding — no threat", "tangent track — no impact", "well clear — no threat", or "inbound but hidden by your filter — review filter" for the `_hiddenInbound` edge case from v4.51).

A matching hard rule was added to the prompt: when the `STRONG NON-INBOUND CELLS` block is present, every cell in it MUST be named individually in the "Elsewhere on Radar" subsection in the form *"The strongest cell on radar is a [!dbz:55]55 dBZ[/!] cell 25 mi NE of you, moving N at 12 mph — receding, no threat."* — strongest first, with the `[!dbz:NN]` color tag, and the threat verdict from the block. Weaker cells (<45 dBZ) still get the existing geometry/motion narrative ("a band of 20–35 dBZ cells parked to the SW"); only ≥45 dBZ get individual call-outs.

No changes to the storm classifier, the data path, the deterministic briefing, or any UI rendering — just additional context fed to the AI plus one prompt rule.

## v4.51

AI briefing — non-inbound buckets now bypass the user's storm filter, plus a winds-aloft watchdog.

**The actual fix for "AI keeps missing stuff that's clearly on radar."**

Background: in v4.50 the AI's Active Threats section was already split into two mandatory subsections — Inbound (filtered) and Elsewhere on Radar (situational awareness). But the *data* fed to both subsections was being pulled from the user's filtered storm set, so cells hidden by the user's filter (e.g. "Threats only ✓", "min 31 dBZ") never reached the AI in any bucket. The AI couldn't narrate the big yellow/red blob to the north because the briefing engine was told that blob didn't exist.

v4.51 changes the data path in `gatherBriefingData()`:

- **Inbound bucket** is still built from the filtered set, so the "Inbound (in your impact corridor)" bullets exactly mirror the cards on the Storms tab.
- **Background / passing / moving-away buckets** now walk the **entire unfiltered scan radius** (the full ~80 mi `S.storms` list), minus any cell already surfaced as inbound to avoid double-counting. A new `unfilteredTotal` count is exposed so the prompt can say "X cells after filter / Y total in scan radius."
- If an inbound cell was hidden by the user's filter (e.g. a 28 dBZ cell with the filter set to ≥31), it now appears in the background bucket with a `_hiddenInbound` flag and a NOTE in the STORM DATA line so the AI explicitly knows "N inbound cell(s) hidden by your filter."

The STORM DATA preamble in `ai.js` was updated to mark the buckets as "inbound = post-filter mirror; non-inbound = full unfiltered scan radius" so the model understands the asymmetry.

**Winds-aloft watchdog.** Separate from the AI fix: the user reported winds aloft sometimes fails on a flaky connection and only recovers on app restart. v4.51 adds `scheduleAloftWatchdog()` in `geo.js` that runs every 10 min and re-fetches winds aloft if `S._aloftData` is empty or the wind cache is older than 30 min. Cheap when winds are already loaded (just a presence check); only fires the network call when data is actually stale. Hooked into `scheduleAutoRefresh()` so it runs whenever auto-refresh is scheduled. Travel mode and "no location yet" both skip it.

What this does NOT change: the storm classifier itself, the radar scan, the deterministic system briefing, or any UI rendering. Same set of cells the user sees on the Storms tab; the AI just gets a richer picture of what's around them.

## v4.50

AI briefing — explicit "filtered first, then non-filtered for situational awareness" layout in **Active Threats & Storm Tracking**.

Background: a user report showed the AI confidently narrating two small inbound cells from the south while completely ignoring a wall of 45-55 dBZ cells parked over the N-NE quadrant that the radar sonar made obvious. The cells were in the data — MOVING AWAY and OVERHEAD buckets — but the previous prompt called the non-inbound narration a "Surrounding Picture: wrap-up" of "1-3 sentences," which the model kept collapsing into a single "nothing else of note" sentence even when the buckets were full.

v4.50 restructures the section into two **mandatory subsections** so the model can't compress them away:

1. **Subsection 1 — Inbound (in your impact corridor):** the existing per-cell bullets for DIRECT / NEAR DIRECT / NEAR MISS. These are the *filtered* cells the user sees on the Storms tab.
2. **Subsection 2 — Elsewhere on Radar (situational awareness):** a 1-4-sentence prose block walking through every non-empty non-inbound bucket (MISS / DISTANT / FAR background, PASSING, MOVING AWAY, and OVERHEAD / ARRIVED) by direction, with explicit dBZ when a non-inbound cell is **stronger than the strongest inbound cell**. New label "**Elsewhere on Radar:**" replaces the old "Surrounding Picture:" label so the user has a stable thing to search for.

Hard rules added: never write "no other notable storms" or "nothing else on radar" as a contradiction of the STORM DATA block; if the data shows non-zero counts in any non-inbound bucket those cells exist on the user's screen and MUST be narrated. The "all buckets empty" fallback sentence is preserved verbatim so the model still has a clean exit when the screen really is quiet.

Only the prompt strings in `docs/js/ai.js` changed — no behavior change in the deterministic briefing or the storm classifier. The cell classifier itself (the upstream reason cells may end up in the "moving away" bucket when they're huge and overhead) is a separate, larger problem that this prompt change does not fix; it just guarantees the AI will narrate what it's already given.

## v4.49

Adds the dial ↔ text-view toggle requested after v4.48 shipped.

1. **Tap the dial center to switch to text view.** A transparent click target now sits over the center of the Rain Clock SVG; tapping it (or the new TEXT/DIAL pill in the card header) flips `S._rainClockTextView` and re-renders. The text view is a single card with a one-line headline and a friendly prose body — phrasings like "Rain starts in 5 min · Begins around 12:05, lasts about 30 min, ending around 12:35. Then a second round around 13:15 (~15 min)." or "Raining until 12:30 · Active rain for about 25 min more. Next round starts around 13:45 (~20 min)." The first and (when it exists) second rain windows from `_rainClockProject()` drive both views, so the dial and the text never disagree about what's coming. Tap anywhere on the text card to flip back. State is intentionally session-only — every reload starts on the dial.

2. **Plumbing.** New `_phrases[]` array is built alongside the existing `centerLines[]` inside `renderRainClock()` so both surfaces share one source of truth. New `_fmtDur(min)` helper writes durations as "30 min" / "1 h" / "1 h 15 min". New `_rainClockToggleView()` global function is the click handler. The dial-mode SVG gains one new `<circle>` (r=55, transparent) acting as the tap surface; the text-mode card replaces the SVG block entirely. Both modes still emit the same header (with reorder buttons + sourceTag + new toggle pill), nearest-precipitation sub line, "motion unknown" footer, and tap-arc hint, so nothing else about the card moves around when you flip views.

The AI briefing's "missed the heavy yellow/red blob to the north" issue from the same report is logged as a separate follow-up — the cell-classifier is collapsing those cells into "moving away" with zero counts before they reach the AI prompt, so the fix needs deeper work in the briefing engine, not the Rain Clock.

## v4.48

Three more refinements to the Rain Clock based on the user's annotated screenshot of v4.47:

1. **Forecast arc now wraps the full 12 h.** The v4.47 forecast loop iterated from a `findIndex` anchor with a fixed 14-slot cap, intending to mirror the Rain Forecast Bars below the dial. In practice, when the bar chart and the dial computed their anchors slightly differently (or when Open-Meteo returned a non-monotonic first slot), the dial's loop could exit before reaching slots at +5h..+11h, leaving the arc visually "stopping" around the radar/forecast boundary even though the bar chart clearly showed rain later. v4.48 drops the anchor and the cap entirely and instead walks the whole `h.time` array, bucketing each entry by its computed `mins` offset (`-60 ≤ mins ≤ 720`). Every future hour with rain is now considered, regardless of where Open-Meteo's first slot lands.

2. **Arc moved out to the rim.** The arc band was at `R_ARC=78` inside a 320-px viewBox — deep in the middle of the dial face, where the labels and the center status text crowded it. v4.48 enlarges the dial canvas to 360 px (CX/CY = 180) and moves the arc to `R_ARC=122, R_ARC_W=18`, sitting in the wide strip between the tick ring (`R_TICK_OUT=108`) and the outer rim (`R_OUTER=132`). The arc is now visually the dominant element of the dial.

3. **Hour labels moved outside the dial circle.** Labels were at `R_LABEL=139` (inside the old `R_OUTER=152`), so they overlapped the arc near the top. v4.48 puts them at `R_LABEL=154`, in the new space between `R_OUTER=132` and the 360-px viewBox edge. Nothing on the dial face fights the rain arc for attention anymore. Font sizes nudged up (11 / 10) to fill the extra room. SVG `max-width` bumped from 340 px to 380 px to keep the rendered size visually similar despite the larger viewBox.

The 24-hour clock complaint was already covered by `fmtClock()` honoring `_timeFormat` from `localStorage.st_timeFormat`; if the user was still seeing AM/PM in the screenshot, it was the v4.46 service worker serving stale JS. The v4.48 cache bump (`?v=544`, `stormtracker-v544`) forces a fresh fetch, after which the label times will follow whichever `st_timeFormat` value the user has selected.

## v4.47

Fixes three user-reported issues on the v4.46 Rain Clock:

1. **Combined hour labels.** The old design had two concentric rings of text — "+1h / +2h / …" on the inner ring and "12:24 / 13:24 / …" on the outer ring — which doubled the visual noise and collided with the rain arc near the top of the dial. v4.47 collapses both into a single combined label per hour position, stacked as two short lines inside one `<text>` element: top line is the offset (`Now` / `+1h` / `+2h` / …), bottom line is the dynamic wall-clock time, refreshed every 60 s by `_rainClockStartTick()` via the existing `data-rc-outer` tspan scan. Constants `R_OUTER_LABEL=144` and `R_HOUR_LABEL=98` were replaced with a single `R_LABEL=139` ring positioned just outside the tick marks.

2. **Forecast rain now appears on the dial.** v4.46's `_rainClockProject()` iterated `h.time` from index 0 with `i < 60`, computing `mins = (ts - now) / 60000` for each entry. When Open-Meteo's first hourly slot wasn't aligned with "now" (e.g., starts at today 00:00 and includes past hours), future-hour slots were either skipped by the `mins < -30` filter or computed against the wrong base. v4.47 uses the same `findIndex(t => ts >= now - 30min)` anchor that the Rain Forecast Bars below the dial already use, so what the dial paints and what the bar chart paints now always agree.

3. **Cache bust ?v=542 → 543, SW cache stormtracker-v542 → v543.**

## v4.46

v4.46 overhauls the Weather tab per user feedback: (1) the Rain Clock is redesigned as a 12-hour analog face with **dynamic outer wall-clock labels** at each hour position (each label = `fmtClock(now + i hours)` for i=0..11, repainted every 60s via a `data-rc-outer` text scan so the labels stay current without rebuilding the whole SVG), an inner "Now / +1h / +2h …" ring, and a small "Now" pointer at the top; (2) the clock now spans the next 12 hours instead of 180 minutes by overlaying **radar advection (0-180min) with Open-Meteo hourly precipitation (181-720min)** — `_rainClockProject()` extends the minutes array from 181 → 721 slots and fills the 181+ portion from `S._hourlyData.precipitation` via `_precipMmToDbz` (Marshall-Palmer), with a faint blue background tint on the 0-180 radar zone and a dashed boundary line at the 3-hour position so users can see where radar ends and forecast begins; (3) rain windows are now painted as **per-minute gradient segments** (one tiny colored chord per minute where dBZ ≥ 25, each colored by `dbzHex(minutes[m])`) instead of one flat color per window — so a window that ramps from light → moderate → heavy → light visibly blends Green → Yellow → Orange → Red along the arc, matching the user's "BLUE→YELLOW→GREEN→BLUE break, YELLOW/RED/MAGENTA/GREEN end" mental model; (4) the cone-projection floor is raised from 20 dBZ → **25 dBZ** so only cells producing measurable rain at the user's location are counted; (5) a proper **loading state** — when neither weather data nor radar points have loaded yet, the dial center shows "Loading rain forecast…" instead of the misleading "No rain expected for hours"; (6) the dial center now shows an **estimated rain amount** ("~0.42 in expected") summed from the 12h Open-Meteo precipitation total below the start/end clock time; (7) the source tag in the card header shows `RADAR + FORECAST` / `RADAR` / `FORECAST` based on which providers fed the dial; (8) the Rain Clock and Rain Forecast Bars cards both get **up/down reorder buttons** in their headers — the existing `secBtns` / `getSecOrder` / `moveSection` reorder system now includes `rainclock` and `rainbars` alongside `wind`/`trends`/`forecast`/`hourly`, and `moveSection()` physically reparents the `#rain-clock` and `#rain-forecast-bars` DOM divs (in addition to re-running `renderWeather()`) so swapping their order persists between cards that own their own card wrappers; (9) the **Rain Forecast Bars** chart gets **horizontal gridlines + Y-axis labels** (dashed lines at 25/50/75/100% of peak with mm/in labels right-aligned), gated by a new per-graph toggle button (📊) in the card header that flips `localStorage.st_grid_rainbars` and re-renders — `_graphGridOn(key)` and `toggleGraphGrid(key)` are generic helpers ready for the trend charts to opt in. Built atop v4.45 (Open-Meteo outage survival). Open-Meteo, NWS, and AWC now fan out in parallel (no longer gated by OM serial-first), and the OM fetch itself has an `api.open-meteo.com` → `customer-api.open-meteo.com` sibling-host fallback (mirrors the v4.42 winds-aloft pattern). When BOTH hosts fail but NWS or AWC returned data, the renderer paints a **partial hero** using whatever the other services provided (temp/feels/humidity/dew/pressure/cloud/wind/precip), shows a "⏳ Waiting on Open-Meteo" banner at the top of the hero plus inline chips on the Open-Meteo-only cells (UV, Freezing Level, hourly bars, 36h rain forecast), and a `· ⏳ Open-Meteo` suffix on the source line. A capped background retry (15s → 30s → 60s) attempts OM again in the background; on success the cached omData is mutated in place — `hourly`, `daily`, `_modelBlend`, `_omHost` are set, missing `current.*` fields are filled, `_omPartial` cleared, source suffix stripped — then `renderWeather()` and `refreshRainClock(true)` are called so UV / freeze level / hourly bars / 36h rain bars / 7-day forecast appear without the user touching anything. After 3 background attempts the retry stops and the regular auto-refresh interval picks it up. The `blendSources` filter accepts both `Open-Meteo` and `Open-Meteo (customer-api)` labels so the customer-host path participates in the multi-source blend identically

## v4.44

v4.44 adds an optional Skylink (RapidAPI) aviation-grade winds-aloft provider as a user opt-in upgrade. When the user pastes a RapidAPI key into Settings → ✈️ Skylink, `fetchWindsAloft()` tries Skylink first; on any error (missing key, 401/403, 429 quota, bad shape, timeout) it falls through to the existing free chain (Open-Meteo api → customer-api → NOMADS GFS for US). Skylink returns winds at FAA-standard altitude bands (3k/6k/9k/12k/18k/24k/30k/34k/39k ft); the new `fetchWindsAloftSkylink()` helper converts each band to ISA pressure and snaps to the existing 925/850/700/500 hPa slots `_applyAloftData()` consumers expect, so the radar sonar ALOFT arrow, G1000 panel, briefing, AI prompt, and ILS cone all see the new data without any further changes. Key persists in `localStorage.st_skylinkKey` (paste/save/show-eye/clear, mirrors the OpenAI key pattern, never sent anywhere except RapidAPI). Boot-splash row reads `Winds aloft: 18 mph @ 240° · Skylink` when this path succeeds. Defensive parser accepts multiple plausible JSON shapes (root array, `winds`, `windsAloft`, `data`, `forecast.winds`) and common field-name variants so minor API quirks don't break the upgrade

## v4.43

v4.43 adds a NOAA NOMADS GFS fallback for US locations to the winds-aloft chain. When both Open-Meteo subdomains fail (HTTP 5xx, timeout, network error) AND `isUSLocation(lat,lon)` is true, `fetchWindsAloft()` now calls the new `fetchWindsAloftNOMADS(lat,lon)` helper, which queries NOAA GSL's rucsoundings.noaa.gov for the same NCEP GFS model output that NOMADS distributes — but as plain GSL-format text with CORS=*, so it's browser-fetchable without GRIB2 binary parsing. The parser scans type 4/5/9 (mandatory/significant/surface) rows, extracts wind dir + speed at 1000 / 925 / 850 / 700 / 500 hPa within ±5 mb tolerance, and writes the same `S._aloftData` shape the existing consumers use. A new `_applyAloftData(aloftSpeeds, providerInfo, lat, lon)` helper was extracted so both Open-Meteo and NOMADS providers drive identical downstream logic (`S._windShear`, `S._upperWindDir/Spd`, `S.stormMovement`, `S._windCache`, boot-splash row, path arrows). Cache TTL reuses the existing 30 min / 100 mi rule (NOMADS GFS only updates every 6 h so over-fetching is also wasteful). `S._windCache.provider='nomads-gfs'` (host=null) when this path is used, and the boot splash row reads `Winds aloft: 24 mph @ 220° · NOMADS GFS` so the source is visible. On non-US coordinates the NOMADS fallback is skipped and the existing failure path runs as before

## v4.42

v4.42 adds a sibling-subdomain fallback to the winds-aloft fetcher: when `api.open-meteo.com` returns HTTP 5xx, times out, or fails to reach the network, `fetchWindsAloft()` automatically retries the same query against `customer-api.open-meteo.com` (the Open-Meteo customer subdomain is operationally independent and tends to stay up when the public subdomain is throwing 502s from nginx). Both subdomains are no-key/free, so the upgrade requires no settings change. The successful host is recorded in `S._windCache.provider='open-meteo'` / `S._windCache.host='api'|'customer-api'` and surfaced in the boot-splash row as `Winds aloft: 24 mph @ 220° · Open-Meteo (customer-api)` so the source is visible. Only on a back-to-back failure across both subdomains does the existing failure path run

## v4.41

v4.41 makes the Rain Clock forecast-aware so it stops sitting on `Waiting for radar…` when scan points exist. A new `_nextRainHourFromForecast()` helper scans `S._hourlyData.precipitation` for the first hour ≥0.1 mm in the next 36 h. The dial center text now reads `Possible rain at {clock}` when rain is within 6 h, `No threat of rain / next 3 hours` when rain comes later in the 36 h window, or `No rain expected / for hours` when the window is dry — applied to BOTH the `data.empty` (no scan pts yet) and `data.windows.length===0` (scan ran, nothing inside the 3 h advection cone) branches, so the dial degrades gracefully before AND after a scan. To make sure the dial actually refreshes when radar populates, `_clusterSonarPoints()` in `gauges.js` now calls `refreshRainClock(true)` after writing `S._sonarClusteredPts`, covering every path that publishes new scan points (initial scan, hi-res scan, overhead poll, sonar zoom) in addition to the existing post-scan hooks

## v4.40

v4.40 bundles two Weather-hero upgrades that landed together. First, the Rain Clock arcs are now **tappable** — clicking a colored arc opens an inline detail panel below the dial listing the storm cells responsible for that rain window. Each row shows peak dBZ (color-chip swatch), current distance + bearing from the user (respects the user's mi/km radar unit), ETA range as `+tIn-tOut min` (or "overhead" when t=0), and a `View on radar` button that calls `switchPage('radar')` then `S.map.setView([lat, lng], 10)`. Cells are derived from the same `S._rawScanPts` slice `_rainClockProject()` already uses: each contributing point's `{lat,lng,dbz,dist,bearing,tIn,tOut}` is recorded during the closest-approach pass and then matched to each window where `tIn ≤ endMin && tOut ≥ startMin`. Matched contributors are spatially clustered with a 2.5 mi merge radius (peak dBZ wins for each cluster's display values) and the top 5 by dBZ are attached as `w.cells`. The render side adds `onclick="_rainClockSelectWindow(wi)"` to each arc `<path>`, a small "Tap a colored arc to see which storms cause it" hint when at least one window has cells, and a `<div id="rain-clock-detail">` panel slot. Tapping the same arc twice toggles the panel closed; the `✕` in the panel header also closes it. Selection survives radar refreshes via `S._rainClockSelectedIdx`. Second, v4.40 also adds a 36-hour rain forecast bar chart directly under the Rain Clock on the Weather hero tab, matching the RainAware reference layout (IMG_7613–7615). New `renderRainForecastBars()` in `weather.js` reads `S._hourlyData.precipitation` / `S._hourlyData.time` (already loaded by Open-Meteo), finds the current hour, bars the next 36 hourly slots, colors each bar by intensity (mm/h converted to dBZ via the Marshall-Palmer Z-R relation `dBZ = 10·log10(200·R^1.6)`, then through the existing `dbzHex()` palette so the bars match the Rain Clock's Light→Heavy gradient). X-axis ticks at Now / +6h / +12h / +24h / +36h render in the user's 12h/24h format via `fmtClock()`. Header shows total inches/mm over the window and a "peak X.XX/hr" badge using `fmtPrecip()` for unit consistency. Renders on every weather refresh and on every Rain Clock refresh (so a fresh radar scan re-paints both). Shows a clean "No measurable rain in the next 36 hours" empty state when total < 0.01

## v4.39

v4.39 adds a RainAware-style **Rain Clock** at the very top of the Weather hero — a 280px circular SVG dial showing the next 0–180 min of expected precipitation at the user's location. Tick marks every 3 min (thicker every 15) with minute labels at `Now / 15 / 30 / … / 165`. Rain windows are painted as colored arcs using the existing `dbzHex()` palette (green→yellow→orange→red), with a small Light→Heavy gradient legend inside the dial. Center text summarizes the situation: `Dry for the next 3 hours` when nothing is projected to hit, `Rain starting at {clock time}` when the first window is in the future, or `Rain until {clock time}` when rain is already overhead. A header bar above the dial mirrors the first window as `Rain Start Time:` / `Rain End Time:`, and a sub-line below reads `Nearest Precipitation: {N} mi to the {DIR}`. Clock times honor the user's 12h/24h setting via `fmtClock()`. Projection is **deterministic on-device**: for each scan point in `S._rawScanPts` with dBZ ≥ 20, the new `_rainClockProject()` helper analytically solves the closest-approach time against the user's location using the `S.stormMovement` advection vector (no per-minute brute-force scan), fills a 181-slot intensity array, and collapses contiguous runs into `{startMin, endMin, peakDbz}` windows. Empty / stale states: `Waiting for radar…` when `_rawScanPts` is empty, `Radar stale` when the last scan is >15 min old, and a `Motion unknown — projection limited` footnote when `stormMovement` is missing (only points already over the user are counted in that case). The dial auto-refreshes after every radar scan via `refreshRainClock(true)` hooks added next to each `refreshHeroFromZone()` call-site (view scan, hi-res scan, overhead poll, and the location-aware scan in storms.js), throttled to once per 10 s

## v4.38

v4.38 fixes two confusing things on the Storms-tab cell cards: (1) the "STRENGTH AT YOU" tile no longer reads "0% of peak" on DIRECT-hit drizzle cells — it now shows the expected dBZ at the user with a secondary "% of peak" derived from `estDbzAtUser / storm.dbz`, e.g. a DIRECT hit on a 20 dBZ cell now reads `20 dBZ (100% of peak)` instead of the broken `0% of peak` that came from `impactScore = closeness × intensityFactor` zeroing out for any cell at the 20 dBZ floor. (2) The "PROJECTED MISS" tile is renamed to "Storm X-TRK" and ALWAYS shows distance + bearing — even for DIRECT cells, which previously displayed the standalone text "Direct hit" that conflicted with the format used by NEAR DIRECT / NEAR MISS tiles. DIRECT-overhead cells (perpMissMi=0) render as `0.0 mi` with no bearing suffix. Both changes are display-only in `storms.js buildCard()`; `calcStormETAForBriefing()` (which feeds the AI prompt, system briefing, and storms-tab snapshot) is unchanged so downstream consumers keep the same `impactScore` / `closenessPct` / `estDbzAtUser` semantics

## v4.37

v4.37 appends a wall-clock arrival time alongside every storm ETA so users immediately see when a cell hits without doing the math — `ETA ~28 min (13:18)` in 24h mode or `ETA ~28 min (1:18 PM)` in 12h mode (uses the user's Time Format setting via `fmtClock()`). Applied to the AI's STORM DATA bullets in `getAIChatContext()` (ai.js) and to all three ETA call-sites in the System Briefing (`briefingEngine.js`: DIRECT bullets, NEAR DIRECT bullets, and the Public Safety "Light to moderate rain is approaching" line)

## v4.36

v4.36 makes the "Surrounding Picture" wrap-up a hard, non-skippable output requirement in the AI's `⛈️ Active Threats & Storm Tracking` section: after the per-cell inbound bullets, the model must end with 1–3 narrative sentences painting what else is on radar (background / passing / moving-away groups), or emit the exact "nothing else of note on radar — the inbound cells above are the whole story" line when those buckets are empty. To support this, `getAIChatContext()` now precomputes ready-made `SCENE HINTS` phrasings ("a ring of returns 28-34 mi to the SE, sitting in the background" / "a small cluster 18-22 mi NW, tracking past, outside the impact corridor") that the model can quote or rephrase, and the STORM DATA bucket lines are reworded to drop dismissive "background context, NOT inbound" / "no threat" framing that was previously telling the model to skip them

## v4.35

v4.35 hardens the service worker so it never intercepts non-GET requests or cross-origin requests — this fixes a "FetchEvent.respondWith received an error: Returned response is null" error that was breaking AI chat (the SW was catching the OpenAI POST and falling back to a null cache match). The AI system prompt also adds a `DETAIL vs MENTAL PICTURE` rule: inbound DIRECT/NEAR DIRECT/NEAR MISS cells get per-cell bullets with numbers, while background/passing/moving-away cells are painted as one short narrative sentence per group ("a ring of light returns sits 25-35 mi to the NE, drifting away") instead of a data-dump

## v4.34

v4.34 makes the user's Storms-tab filter (`S._stormFilter`: Min dBZ / Max dist / Approaching only / Threats only / Sort) the single source of truth across all three surfaces. New `getFilteredStorms()` helper in `storms.js` exposes the post-filter snapshot; `gatherBriefingData()` in `briefingEngine.js` now consumes it (so the System Briefing only references cells the user is actually looking at, plus a one-line "Storm filter active: showing N of M cells (X hidden by your filters)" mirror of the Storms-tab badge); and `getAIChatContext()` in `ai.js` replaces its ~155-line raw-storm rebuild with a snapshot consumer that reads `classified.inboundTop / inboundRest / inboundLight / background / passing / away` from the same source and injects an explicit `STORM FILTER` section + system-prompt instruction telling the model never to reference cells outside the filter. Active NWS alerts in the AI prompt now include `areaDesc`, full description (up to 1200 chars), and `instruction` so the AI sees the same wording the Alerts tab renders. `fetchAFD()` now concatenates SYNOPSIS + DISCUSSION + NEAR/SHORT/LONG TERM + AVIATION + MARINE sections from the NWS product (12 KB safety bound, replacing the prior 1500-char cap) so the System Briefing AFD line reflects the full forecaster discussion. The `⛈️ Active Threats & Storm Tracking` inbound bullet selection adds two upgrades in `gatherBriefingData()`: a significance filter (cells <25 dBZ and >5 mi away collapse into one `💧 N light cells (sprinkles / drizzle)` summary line) and a strongest-cell guarantee (top 4 by raw dBZ always present in the bullets so peak cells like 55 dBZ DIRECT at 58 mi aren't starved by hundreds of close 20 dBZ noise pixels sharing miss-band 0). Display order in the bullets still follows the v4.31 miss-distance-band sort. Built atop the v4.30 deterministic on-device HTML Weather Briefing engine (docs/js/briefingEngine.js) with Settings → Briefing Mode toggle (System default vs AI).

