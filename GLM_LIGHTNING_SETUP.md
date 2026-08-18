# GOES GLM Lightning Feed — Setup & Operations

Free, keyless observed-lightning source added in v6.64. Real flashes from
NOAA's Geostationary Lightning Mapper (GLM) on GOES-East, pulled from the
public AWS Open Data bucket (public domain — no API key, no quota, no terms
of service to violate).

## How it flows

```
NOAA GOES-19 GLM ──(new granule every 20 s)──► s3://noaa-goes19 (public)
        │
        ▼  every ~5 min (same workflow_dispatch heartbeat as the push scan)
GitHub Actions job "glm-lightning" → scanner/glm_fetch.py
        │  parses NetCDF granules, keeps quality==0 flashes in a CONUS bbox
        ▼
POST {WORKER_URL}/glm-ingest   (header x-scanner-secret — same secret as scanner)
        │  stored as one JSON blob in D1 `meta` (key glm:latest)
        ▼
GET {WORKER_URL}/glm?since_minutes=15&limit=500&min_lat=…   (public, CORS)
        │  same response shape as the WarPulse /lightning proxy
        ▼
App: Settings → ⚡ Lightning → source "Auto" (key → satellite → estimate)
        │
        └─► Push scanner (scan.js) also reads GET /glm per scan group:
            a real strike within ~10 mi in the last 15 min sends a
            "⚡ Lightning OBSERVED (satellite)" push and forces the fastest
            scan cadence; otherwise the radar-estimate ⚡ push runs as before.
```

## One-time deploy steps

The worker must be redeployed once so `/glm-ingest` and `/glm` exist.
Two ways — the first needs no local tooling at all:

**A. Via the auto-deploy workflow (recommended).** Add three repository
secrets (GitHub → Settings → Secrets and variables → Actions):

| Secret | Where to find it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → My Profile → API Tokens → Create Token → **"Edit Cloudflare Workers"** template |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages overview page, right sidebar |
| `D1_DATABASE_ID` | Storage & Databases → D1 → `stormtracker_push` → database ID (the repo's `wrangler.toml` holds a placeholder; the workflow injects the real id at deploy time) |

Then run **Actions → Deploy Worker → Run workflow**. From then on, every
push to `main` that touches `worker/` deploys automatically. Until the
secrets exist, the workflow ends green with a "not deployed" notice rather
than failing. Worker runtime secrets (`SCANNER_SECRET`, set via
`wrangler secret put`) live in Cloudflare and are untouched by deploys.

**B. Locally:** `cd worker && npx wrangler deploy` (after
`npx wrangler login`), from a checkout whose `wrangler.toml` has the real
`database_id`.

Nothing else is needed: the GLM Actions job reuses the existing
`WORKER_URL` and `SCANNER_SECRET` repository secrets and runs as a second
job inside `storm-scan.yml`. The first successful run makes `GET /glm`
start answering; until then the app logs "GLM: no snapshot yet" and quietly
retries every 10 minutes.

## Tunables (workflow env, all optional)

| Env | Default | Meaning |
| --- | --- | --- |
| `GOES_BUCKET` | `noaa-goes19` | GOES-East. Use `noaa-goes18` for GOES-West coverage. |
| `GLM_WINDOW_MIN` | `16` | Minutes of history per snapshot (app shows 15). |
| `GLM_BBOX` | `20,55,-130,-60` | lat_min,lat_max,lon_min,lon_max kept in the snapshot. |

## Characteristics & honesty notes

- **Latency:** flash → bucket is under a minute; the effective app latency is
  the ~5-min job cadence. The app anchors freshness to the snapshot build
  time, so if the pipeline stalls >10 min the app automatically falls back to
  the radar-derived estimate (and says so).
- **Accuracy:** GLM geolocates optically from GEO at ~8–14 km — coarser than
  a ground network like WarPulse (~1 km). The UI labels the source and shows
  satellite strike distances as approximate ("~3.2 mi").
- **Coverage:** GOES-East full disk covers the Americas; the default bbox
  trims the snapshot to CONUS + margins to keep it small. Widen `GLM_BBOX`
  if lightning display is needed outside that box.
- **Cost:** $0. NOAA open data is free to fetch; the Actions job runs in the
  free tier for public repos; the worker stores one ~400 KB blob in D1.

## Real-time Storm Proximity webhook (WarPulse zones)

WarPulse's zone feature POSTs to a webhook the instant a strike lands inside
a zone you define — seconds-level latency, quota-free, with their own
per-zone cooldown. The worker's `POST /lightning-webhook` receives it,
verifies the HMAC signature, and immediately dispatches the push scanner
(pulling the next scheduled scan forward too). The alert content itself is
built by the scanner from our own sources (GLM/radar) — the webhook is a
trigger only, so no WarPulse data is redistributed to other users.

One-time setup (Free plan allows 1 zone — center it on your location):

1. Create the zone with your personal key (or from the WarPulse dashboard):
   ```
   curl -X POST https://api.lightningapi.dev/developer/zones \
     -H "X-API-Key: YOUR_PERSONAL_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Home",
       "center_lat": <your lat>,
       "center_lon": <your lon>,
       "radius_km": 16,
       "cooldown_minutes": 5,
       "webhook_url": "https://stormtracker-proxy.joshua-622.workers.dev/lightning-webhook"
     }'
   ```
   The response includes `webhook_secret` **once** — copy it now.
2. Store the secret on the worker: Cloudflare dashboard → the
   `stormtracker-proxy` Worker → Settings → Variables and Secrets → add
   secret `WARPULSE_WEBHOOK_SECRET` (or `wrangler secret put
   WARPULSE_WEBHOOK_SECRET` locally). Until it's set, the route answers 503
   and WarPulse's 4-attempt retry/delivery-history will show failures.
3. Verify: `GET /developer/zones/{id}/alerts` (their API) shows each
   firing's `delivery_status`; the worker keeps its own last-delivery
   breadcrumb in D1 meta (`ltg_webhook_last`).

Behavior: deliveries are debounced to at most one scanner dispatch per
60 s (several zones or a retry can land together), and the flash is the
schedule — the next scan tick is pulled forward rather than waiting out
the cadence. More zones (e.g. one per push subscriber location) need a
bigger zone allowance — part of the WarPulse licensing conversation.

## Local testing

```
pip install -r scanner/glm-requirements.txt
python3 scanner/glm_fetch.py --out /tmp/glm.json     # no secrets needed
```
