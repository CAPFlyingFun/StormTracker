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
```

## One-time deploy steps

1. **Deploy the worker** (adds `/glm-ingest` and `/glm`):
   ```
   cd worker && wrangler deploy
   ```
2. **Nothing else.** The Actions job reuses the existing `WORKER_URL` and
   `SCANNER_SECRET` repository secrets, and runs as a second job inside the
   existing `storm-scan.yml` workflow. The first successful run makes
   `GET /glm` start answering; until then the app logs
   "GLM: no snapshot yet" and quietly retries every 10 minutes.

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

## Local testing

```
pip install -r scanner/glm-requirements.txt
python3 scanner/glm_fetch.py --out /tmp/glm.json     # no secrets needed
```
