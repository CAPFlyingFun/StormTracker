# StormTracker - Real-Time Storm Detection Application

## Overview

StormTracker is a real-time storm detection web application providing live weather radar maps, storm tracking, and weather alerts. It uses GPS or manual location input to monitor storm activity within a customizable radius. The application is enhanced with AI-powered weather analysis, integrating National Weather Service Area Forecast Discussions for comprehensive meteorological assessments. The project aims to deliver a professional, reliable, and user-friendly tool for anticipating and reacting to severe weather, with a vision to become a leading platform for public safety and meteorological insight. Current version: **v5.86** (cache bust ?v=683, SW cache stormtracker-v683).

For a full per-version changelog, see [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

## Repository Structure

This repository contains the **live StormTracker app**: a static, vanilla-JavaScript Progressive Web App (PWA) in `docs/`, deployed via GitHub Pages, plus its supporting services:
- `docs/` — the live PWA (HTML/CSS/JS, no build step).
- `scanner/` — GitHub Actions storm scanner that powers background push alerts (own `package.json`).
- `worker/` — Cloudflare Worker for push notifications and the RSS backup feed (`wrangler.toml`, D1 schema).
- `windy-plugin-stormtracker/` — a separate, self-contained Windy.com plugin (own build).
- `scripts/`, `.github/workflows/` — asset generation and automation.

The older **React + Express + TypeScript** version (which rendered "v1.50") has been moved to its own private repository, `CAPFlyingFun/StormTracker-TS`, to keep the two projects from being confused. Nothing in this repo depends on it. The local Replit preview serves `docs/` directly (static file server on port 5000).

## User Preferences

Preferred communication style: Simple, everyday language with customizable AI assistant tone options (Professional, Friendly, Humorous) similar to Carrot Weather app for personalized user experience.

## System Architecture

### Frontend (live app)
- **Framework**: Vanilla JavaScript — a static HTML/CSS/JS PWA in `docs/` with no build step. Scripts load in order via global-scope `<script>` tags (see "JavaScript Module Structure" below).
- **Styling**: Hand-written CSS (`docs/css/style.css`).
- **Mapping**: Leaflet for interactive maps.
- **UI/UX**: Mobile-first design featuring interactive Leaflet-based maps, real-time storm tracking panels, and an intuitive alert system. Includes sonar-style radar, 3D storm visualization, and professional meteorological color schemes.
- **Multilingual Support**: Supports 20 languages with auto-detection, persistence, RTL support, and a dynamic auto-translation system using OpenAI's GPT-4o-mini for UI strings.
- **Archived TypeScript/React version**: The earlier build used React 18 + TypeScript, Tailwind CSS with shadcn/ui and Radix UI, React Query, and Wouter. That version now lives in the separate `StormTracker-TS` repo.

### Backend / Services (live app)
- **Hosting**: Static site on GitHub Pages (there is no app server in this repo).
- **Push & sync**: Cloudflare Worker (`worker/`) backed by D1 (SQLite).
- **Background scanning**: GitHub Actions runs `scanner/` on a schedule to detect storms and trigger push alerts.
- **Data**: Most weather logic runs client-side in the browser, calling external APIs directly or via the Worker proxy.
- **Archived backend**: The earlier version's Express + Drizzle ORM + PostgreSQL (Neon) backend lives in the separate `StormTracker-TS` repo; the PostgreSQL/Neon entries under External Dependencies refer to that archived version.
- **Core Features**:
    - **Location Services**: GPS detection and OpenWeather geocoding.
    - **Weather Data Integration**: Multiple sources including OpenWeather, RainViewer, NEXRAD, and government weather services.
    - **Storm Detection & Tracking**: Multi-source data integration, sector-based analysis, pixel sampling, intelligent clustering, frame-by-frame radar comparison, and directional movement predictions.
    - **AI Weather Assistant**: OpenAI GPT-4o integration for risk assessment, comprehensive weather analysis, and chat functionality.
    - **Lightning Detection**: Radar-derived indicators with customizable display.
    - **Alert System**: Personalized, real-time risk alerts based on intensity and distance, integrated with NWS alerts, chronological sorting, and AI-powered translation. Features impact threshold filters, color-coded borders, and live countdown timers.
    - **Wind Speed Simulator**: Range-based model (Floor=WS−50%, Ceiling=WG+10%) with configurable sim interval target picking and smoothstep lerp. Configurable rolling gust/avg windows. AWC refresh syncs both speed and gust data. Wind trend arrows (↑↓→) on all gauge styles.
    - **Sonar Point Clustering**: Grid-based spatial hash (`_clusterSonarPoints()`) reduces 2K-5K raw scan points to ~300-800 clustered points for sonar rendering. Resolution adapts to zoom level. Preserves `_rawScanPts` for storm detection/zones. Cluster dot size scales with merged count.
    - **Storm Feedback System**: Collects user feedback on storm impact to refine prediction accuracy.
    - **Messaging System**: Database-driven inbox for alerts.
    - **Aviation Weather**: Multi-source METAR data and AI analysis.
    - **Weather Station (PWS Console)**: Dedicated interface for real-time METAR data from AWC, including wind compass, various gauges, barometric pressure trends, precipitation, cloud cover, moon phase, forecast icon strip, and a METAR decoder. Features 24-hour history with sparkline charts, pressure tendency charts, wind distribution charts, and a condition timeline. Supports multi-station TAFs and station favoriting.
    - **Global Timezone System**: Comprehensive timezone handling.
    - **Location Management System**: Three-tier system for managing and scanning locations (Home, Scan Here, HD Scan).

### JavaScript Module Structure (docs/js/)
The frontend is a static HTML site with global-scope script tags (no ES modules). Load order matters:
0. **radar-shared.js** (~200 lines) — SHARED with the Node scanner (`scanner/detect.js` consumes it via `createRequire`; `docs/js/package.json` marks it CJS for Node). Single source for: haversine, bearingDeg, degToDir, lonToTileX/latToTileY, master DBZ_SCALE palette, pixelToDbz, NEXRAD_PAL/nexradToDbz, RV_UB/rvToDbz. Guarded `module.exports` at the end; loads before all other scripts.
1. **core.js** (~711 lines) — Global state object `S`, unit constants, time/clock formatting, basic utilities (toast, escHtml, degToDir), temperature/wind/altitude/visibility formatters, FAA weather theory (cloud base, density alt, flight categories), Beaufort scale, unit system management, storm DBZ/ETA utilities, pixel-to-dBZ radar converters, page switching
2. **gauges.js** (~724 lines) — Sonar radar configuration, gyro compass, wind min/max tracking, 5 gauge renderers (neon, marine, minimal, G1000, speedo), LED7 display, wind gauge animation, gauge style management
3. **icons.js** (~322 lines) — Icon pack system (8 built-in packs), custom icon upload/import/export via IndexedDB, WMO code mapping, weather condition icons, Basmilius CDN integration
4. **geo.js** (~791 lines) — Geolocation search (Nominatim/Photon/Open-Meteo fallback), autocomplete suggestions, location confirmation, favorites system, map picker, home/scan/HD-scan, travel mode with GPS tracking, reverse geocoding
5. **settings.js** (~239 lines) — Tutorial overlay, changelog, first launch detection, settings panel rendering, wind sim/gust/avg/ticker speed controls, auto-refresh configuration, travel interval popup
6. **thresholds.js** (~302 lines) — Weather threshold alerts (temp, wind, pressure, humidity, visibility), storm cell alerts (distance, dBZ, ETA, closing speed), rain alerts, browser notification system, alert history management
7. **weather.js** — Weather data fetching, rendering, wind simulation
8. **radar.js** — Radar tile management, sonar rendering
9. **storms.js** — Storm detection, tracking, rendering
10. **station.js** — METAR/TAF station console
11. **alerts.js** — NWS alerts rendering, alert page
12. **ai.js** — AI weather assistant
13. **init.js** — App initialization, event binding

### Key Architectural Decisions
- **Monorepo Structure**: Shared types and schemas between frontend and backend.
- **Real-time Updates**: Achieved via React Query.
- **Performance**: Optimized map rendering, adaptive sampling, and API timeouts.
- **Reliability**: Server-side proxy, multi-source data with fallbacks, and robust error handling.
- **Scalability**: Designed for global coverage and high data volumes.

### API Key Manager & Personal Weather Station
- **API Key Management**: Centralized settings for managing API keys (Ambient Weather, Weather Underground, OpenAI) stored in localStorage, with bulk import/export.
- **Personal Weather Station (PWS) Viewer**: Dashboard section displaying real-time PWS data when keys are configured, supporting multiple stations.
- **Server Proxy Routes**: Secure proxy endpoints for PWS APIs to prevent CORS issues.

## External Dependencies

### APIs
- **OpenWeather API**: Weather data, geocoding, radar.
- **RainViewer API**: Global weather radar tiles.
- **NEXRAD (Iowa Mesonet RIDGE API)**: US high-resolution radar.
- **Government Weather Services / NWS API**: Weather alerts, Area Forecast Discussions.
- **Iowa Environmental Mesonet (IEM) mPING GeoJSON**: Crowdsourced weather reports.
- **USGS Earthquake API**: Real-time earthquake data.
- **NASA EONET API**: Global natural events.
- **JTWC (Joint Typhoon Warning Center)**: Global tropical cyclone data (W. Pacific, Indian Ocean, S. Hemisphere) via RSS.
- **NIFC Wildfire API**: Active fire perimeters (US).
- **US Drought Monitor API**: State-level drought statistics (US).
- **Open-Meteo API**: Upper atmospheric winds, stability parameters.
- **OpenAI GPT-4o API**: AI weather assistant, chat.
- **AccuWeather API**: MinuteCast™, forecasts, current conditions, lightning (enterprise).
- **CheckWX API**: International METAR/TAF data.
- **WeatherAPI.com**: Secondary weather data.
- **Ambient Weather API**: Personal weather station data.
- **Weather Underground PWS API**: Personal weather station data.
- **Resend API**: For email alerts from the Cloudflare Worker.

### Libraries
- **React**: Frontend framework.
- **Tailwind CSS**: Styling.
- **shadcn/ui, Radix UI**: UI components.
- **React Query (@tanstack/react-query)**: Server state management.
- **Wouter**: Client-side routing.
- **Leaflet**: Interactive mapping.
- **Drizzle ORM**: Database operations.
- **Zod**: Runtime schema validation.
- **@react-three/fiber, @react-three/drei**: 3D visualization.
- **Sharp**: Image processing.
- **connect-pg-simple**: PostgreSQL session store.

### Databases
- **PostgreSQL**: Primary database.
- **Neon Database**: Serverless PostgreSQL provider.
- **Cloudflare D1 (SQLite)**: Used by the Notification Server for user settings and alert logs.

### Cloudflare Worker (Notification Server)
- **Runtime**: Cloudflare Workers with D1.
- **Auth**: Email + PIN, session tokens.
- **Functionality**: Settings sync, email alerts based on weather thresholds, and user management.