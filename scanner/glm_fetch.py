#!/usr/bin/env python3
"""GOES GLM lightning fetcher — free, keyless observed-strike source.

Pulls the last GLM_WINDOW_MIN minutes of GLM L2 Lightning Cluster-Filtered
Flash (LCFA) granules from the NOAA GOES Open Data bucket on S3 (public
domain, no auth, no quota), extracts quality-flagged flash locations/times,
and POSTs a compact JSON snapshot to the Cloudflare worker's /glm-ingest
route (authenticated with the same SCANNER_SECRET the push scanner uses).
The app then serves it keyless via GET /glm as a fallback lightning source
when no personal WarPulse key is available.

GLM notes:
- One granule every 20 s, ~400 KB NetCDF4 (HDF5). Latency from event to
  bucket is well under a minute; the effective app latency is this job's
  run cadence (~5 min via the worker's workflow_dispatch heartbeat).
- Geolocation accuracy is ~8-14 km (optical, from GEO) — coarser than
  ground networks, and noted as such in the app UI.
- flash_quality_flag == 0 means good; everything else is dropped.

Env:
  WORKER_URL       worker base URL (required unless --out)
  SCANNER_SECRET   shared secret for /glm-ingest (required unless --out)
  GOES_BUCKET      default noaa-goes19 (GOES-East; use noaa-goes18 for West)
  GLM_WINDOW_MIN   minutes of history to ship (default 16 — one minute more
                   than the app's 15-min display window so it's never short)
  GLM_BBOX         lat_min,lat_max,lon_min,lon_max (default 20,55,-130,-60 —
                   CONUS + margins; keeps the snapshot small vs full disk)

Usage: python3 glm_fetch.py [--out snapshot.json]
"""
import json
import os
import re
import sys
import tempfile
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import netCDF4

MAX_FLASHES = 8000          # snapshot cap (oldest dropped) — bounds worker blob size
DOWNLOAD_THREADS = 8
GRANULE_TIMEOUT_S = 30

BUCKET = os.environ.get('GOES_BUCKET', 'noaa-goes19')
WINDOW_MIN = int(os.environ.get('GLM_WINDOW_MIN', '16'))
_bbox = os.environ.get('GLM_BBOX', '20,55,-130,-60').split(',')
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = (float(x) for x in _bbox)

S3 = f'https://{BUCKET}.s3.amazonaws.com'
# OR_GLM-L2-LCFA_G19_sYYYYDDDHHMMSSt_e..._c....nc  (t = tenths of a second)
KEY_START_RE = re.compile(r'_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})\d_')


def _http_get(url, timeout=GRANULE_TIMEOUT_S):
    req = urllib.request.Request(url, headers={'User-Agent': 'StormTracker-GLM/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def list_keys(window_start, now):
    """List granule keys for every UTC hour the window touches."""
    keys = []
    hour = window_start.replace(minute=0, second=0, microsecond=0)
    while hour <= now:
        prefix = f'GLM-L2-LCFA/{hour.year}/{hour.timetuple().tm_yday:03d}/{hour.hour:02d}/'
        # <=180 granules per hour, so a single 1000-key page always suffices.
        xml = _http_get(f'{S3}/?list-type=2&prefix={prefix}&max-keys=1000').decode()
        keys.extend(re.findall(r'<Key>([^<]+)</Key>', xml))
        hour += timedelta(hours=1)
    return keys


def key_start_time(key):
    m = KEY_START_RE.search(key)
    if not m:
        return None
    year, doy, hh, mm, ss = (int(g) for g in m.groups())
    return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1, hours=hh, minutes=mm, seconds=ss)


def parse_granule(data):
    """Extract good-quality flashes inside the bbox from one granule."""
    flashes = []
    # netCDF4 needs a real file path; NamedTemporaryFile keeps this threadsafe.
    with tempfile.NamedTemporaryFile(suffix='.nc') as tf:
        tf.write(data)
        tf.flush()
        ds = netCDF4.Dataset(tf.name)
        try:
            n = ds.dimensions['number_of_flashes'].size
            if n == 0:
                return flashes
            lat = ds.variables['flash_lat'][:]
            lon = ds.variables['flash_lon'][:]
            qual = ds.variables['flash_quality_flag'][:]
            tvar = ds.variables['flash_time_offset_of_first_event']
            times = netCDF4.num2date(tvar[:], tvar.units)
            energy = ds.variables['flash_energy'][:]  # joules (scaled), ~1e-15 J scale
            for i in range(n):
                if qual[i] != 0:
                    continue
                la, lo = float(lat[i]), float(lon[i])
                if not (LAT_MIN <= la <= LAT_MAX and LON_MIN <= lo <= LON_MAX):
                    continue
                t = times[i]
                epoch_s = int(datetime(t.year, t.month, t.day, t.hour, t.minute, t.second,
                                       tzinfo=timezone.utc).timestamp())
                flashes.append({
                    'lat': round(la, 3),
                    'lon': round(lo, 3),
                    't': epoch_s,
                    'e': round(float(energy[i]) * 1e15, 1),  # femtojoules
                })
        finally:
            ds.close()
    return flashes


def main():
    out_path = None
    if '--out' in sys.argv:
        out_path = sys.argv[sys.argv.index('--out') + 1]
    worker_url = os.environ.get('WORKER_URL', '').rstrip('/')
    secret = os.environ.get('SCANNER_SECRET', '')
    if not out_path and (not worker_url or not secret):
        print('ERROR: WORKER_URL and SCANNER_SECRET required (or use --out file)', file=sys.stderr)
        sys.exit(2)

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(minutes=WINDOW_MIN)
    keys = [k for k in list_keys(window_start, now)
            if (st := key_start_time(k)) is not None and st >= window_start]
    keys.sort()
    print(f'[glm] {len(keys)} granules in last {WINDOW_MIN} min ({BUCKET})', flush=True)

    def fetch(key):
        try:
            return key, _http_get(f'{S3}/{key}')
        except Exception as e:
            print(f'[glm] download failed {key.rsplit("/", 1)[-1]}: {e}', file=sys.stderr)
            return key, None

    # Downloads are network-bound and safe to parallelize; PARSING IS NOT —
    # the HDF5 C library under netCDF4 is not thread-safe (concurrent Dataset
    # opens segfault), so granules are parsed sequentially in this thread.
    flashes = []
    with ThreadPoolExecutor(DOWNLOAD_THREADS) as pool:
        for key, data in pool.map(fetch, keys):
            if data is None:
                continue
            try:
                flashes.extend(parse_granule(data))
            except Exception as e:  # one bad granule must not kill the snapshot
                print(f'[glm] skip {key.rsplit("/", 1)[-1]}: {e}', file=sys.stderr)
    flashes.sort(key=lambda f: f['t'])
    if len(flashes) > MAX_FLASHES:
        flashes = flashes[-MAX_FLASHES:]

    snapshot = {
        'updated': int(now.timestamp()),
        'sat': BUCKET.replace('noaa-', '').upper(),   # e.g. GOES19
        'window_min': WINDOW_MIN,
        'bbox': [LAT_MIN, LAT_MAX, LON_MIN, LON_MAX],
        'granules': len(keys),
        'flashes': flashes,
    }
    body = json.dumps(snapshot, separators=(',', ':')).encode()
    print(f'[glm] {len(flashes)} flashes, snapshot {len(body) / 1024:.0f} KB', flush=True)

    if out_path:
        with open(out_path, 'wb') as f:
            f.write(body)
        print(f'[glm] wrote {out_path}')
        return

    # User-Agent matters: without one, urllib sends "Python-urllib/3.x" and
    # Cloudflare's browser-integrity check blocks it at the edge with
    # HTTP 403 "error code: 1010" before the worker ever runs.
    req = urllib.request.Request(
        f'{worker_url}/glm-ingest', data=body, method='POST',
        headers={'Content-Type': 'application/json', 'x-scanner-secret': secret,
                 'User-Agent': 'StormTracker-GLM/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            # The worker answers unknown paths with HTTP 200 + a plain-text help
            # page, so a 200 alone doesn't prove the route exists. Require the
            # real JSON ack; anything else means the deployed worker predates
            # /glm-ingest — a known, user-actionable state, not a red-run error.
            try:
                ack = json.loads(text)
            except ValueError:
                ack = None
            if ack and ack.get('ok'):
                print(f'[glm] ingest OK -> {ack}', flush=True)
            else:
                print('::warning::GLM snapshot NOT ingested — the deployed worker has no /glm-ingest route yet. '
                      'Deploy it (Actions -> Deploy Worker, or `wrangler deploy` in worker/); this job will succeed on the next run.',
                      flush=True)
                print(f'[glm] worker answered HTTP {r.status} without a JSON ok-ack: {text[:160]!r}', flush=True)
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:300]
        if e.code == 404:
            # New worker not deployed yet (or a worker that 404s unknown paths).
            print('::warning::GLM snapshot NOT ingested — /glm-ingest returned 404 (worker not deployed with the GLM routes yet). '
                  'Deploy it (Actions -> Deploy Worker, or `wrangler deploy` in worker/).', flush=True)
            print(f'[glm] ingest -> HTTP 404: {detail}', flush=True)
            return
        # 401 = wrong SCANNER_SECRET, 403 = edge block, 5xx = worker error —
        # real failures that deserve a red run.
        print(f'[glm] ingest FAILED -> HTTP {e.code}: {detail}', file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
