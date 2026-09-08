// =====================================================
// StormTracker — STORM MOTION FROM RADAR FRAME CORRELATION  (v7.35)
//
// A third steering source, independent of Open-Meteo AND of cell identity.
//
// WHY: the cell tracker (updateCellTracks) matches storm CENTROIDS between
// scans by nearest predicted position within 15 mi. Scans are 10-30 min apart
// and a 13 mph cell moves ~3 mi between them, so the true displacement is far
// SMALLER than the match radius. In banded precipitation many similar cells sit
// inside that radius, so a cell mis-pairs with its neighbour ALONG THE BAND —
// consistently, scan after scan — which the tracker reads as agreement and
// rewards with high confidence. The result is a stable, confident vector
// pointing along the band instead of along the motion. That is what put a wrong
// steering bearing on the dial with a hurricane SW of Kaua'i.
//
// HOW: never track identities. Cross-correlate the radar IMAGE. For each block
// of frame N, search frame N+1 for the offset that best matches it, and build a
// motion FIELD. The owner's own sketch is the argument for this: tracing the
// green edge, the yellow mid and the red core of the same storm by hand gave
// three different directions, so no single match is trustworthy — but the
// MEDIAN of many is. Rotation and differential motion fall out for free.
// =====================================================

var _FM_ZOOM_DEFAULT = 7;         // 2x2 tiles ≈ 580 km wide at mid-latitudes
var _FM_TILES = 2;                // 2x2 tile mosaic → 512 x 512 px
var _FM_MAX_FRAMES = 4;           // the owner's ask: last 3-4 frames, most current
var _FM_BLOCK = 32;               // px — big enough to hold a recognisable feature
var _FM_SEARCH = 16;              // px — ±16 px/frame ≈ 68 mph at z7
var _FM_STEP = 2;                 // SAD subsampling (every 2nd px in x and y)
var _FM_MIN_DBZ = 20;             // a block needs real echo to be matchable
var _FM_MIN_FILL = 0.10;          // ...over at least this fraction of the block
var _FM_MIN_CONTRAST = 8;         // dBZ range — a flat blob has no feature to lock onto
var _FM_MIN_SHARP = 0.06;         // best match must beat the runner-up peak by this
var _FM_TILE_TIMEOUT = 9000;
var _FM_MIN_BLOCKS = 5;           // fewer than this and the field is not speaking
var _FM_STALE_MS = 25 * 60000;

// metres per pixel of a Web-Mercator tile pyramid at latitude φ
function _fmMetresPerPx(lat, z) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
}
function _fmTileUrl(path, z, x, y) {
  return 'https://tilecache.rainviewer.com' + path + '/256/' + z + '/' + x + '/' + y + '/2/1_1.png';
}
// Stitch an n x n tile mosaic into one dBZ raster. Returns null if nothing
// decoded; a partial mosaic is fine (missing tiles read as empty and their
// blocks simply fail the fill test).
async function _fmFetchGrid(path, z, tx0, ty0, n) {
  var jobs = [];
  for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
    (function (i, j) {
      jobs.push(fetch(_fmTileUrl(path, z, tx0 + i, ty0 + j), { signal: AbortSignal.timeout(_FM_TILE_TIMEOUT) })
        .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .then(function (b) { return b ? decodeRvRgba(b) : null; })
        .then(function (t) { return { i: i, j: j, t: t }; })
        .catch(function () { return { i: i, j: j, t: null }; }));
    })(i, j);
  }
  var res = await Promise.all(jobs);
  var W = 256 * n, H = 256 * n, g = new Uint8Array(W * H), filled = 0;
  for (var k = 0; k < res.length; k++) {
    var r = res[k]; if (!r.t) continue; filled++;
    var w = r.t.w, h = r.t.h, d = r.t.data;
    for (var y = 0; y < h && y < 256; y++) {
      var gy = r.j * 256 + y;
      for (var x = 0; x < w && x < 256; x++) {
        var p = (y * w + x) * 4;
        if (d[p + 3] < 20) continue;
        var dbz = rvToDbz(d[p], d[p + 1], d[p + 2], d[p + 3]);
        if (dbz > 0) g[gy * W + r.i * 256 + x] = Math.min(255, Math.round(dbz));
      }
    }
  }
  return filled ? { g: g, W: W, H: H, tiles: filled } : null;
}
// Block-match A→B. Returns [{bx,by,dx,dy,q}] — dx,dy in pixels, q = peak
// sharpness (how much better the winning offset is than the best RIVAL peak).
function _fmBlockMatch(A, B, W, H) {
  var BS = _FM_BLOCK, SR = _FM_SEARCH, ST = _FM_STEP, out = [];
  var perAxis = Math.ceil(BS / ST), samples = perAxis * perAxis;
  for (var by = SR; by + BS + SR <= H; by += BS) {
    for (var bx = SR; bx + BS + SR <= W; bx += BS) {
      var cnt = 0, mx = 0, mn = 255;
      for (var y = 0; y < BS; y += ST) for (var x = 0; x < BS; x += ST) {
        var v = A[(by + y) * W + bx + x];
        if (v >= _FM_MIN_DBZ) { cnt++; if (v > mx) mx = v; if (v < mn) mn = v; }
      }
      if (cnt < samples * _FM_MIN_FILL) continue;      // not enough echo to match
      if (mx - mn < _FM_MIN_CONTRAST) continue;        // featureless: any offset "matches"
      var scores = [], best = Infinity, bdx = 0, bdy = 0;
      for (var oy = -SR; oy <= SR; oy += 2) for (var ox = -SR; ox <= SR; ox += 2) {
        var sad = 0;
        for (var yy = 0; yy < BS; yy += ST) {
          var ra = (by + yy) * W + bx, rb = (by + yy + oy) * W + bx + ox;
          for (var xx = 0; xx < BS; xx += ST) sad += Math.abs(A[ra + xx] - B[rb + xx]);
        }
        scores.push({ ox: ox, oy: oy, s: sad });
        if (sad < best) { best = sad; bdx = ox; bdy = oy; }
      }
      // refine ±1 px around the coarse winner
      for (var ry = bdy - 1; ry <= bdy + 1; ry++) for (var rx = bdx - 1; rx <= bdx + 1; rx++) {
        if (rx === bdx && ry === bdy) continue;
        if (by + ry < 0 || bx + rx < 0 || by + ry + BS > H || bx + rx + BS > W) continue;
        var s2 = 0;
        for (var y2 = 0; y2 < BS; y2 += ST) {
          var ra2 = (by + y2) * W + bx, rb2 = (by + y2 + ry) * W + bx + rx;
          for (var x2 = 0; x2 < BS; x2 += ST) s2 += Math.abs(A[ra2 + x2] - B[rb2 + x2]);
        }
        if (s2 < best) { best = s2; bdx = rx; bdy = ry; }
      }
      // The runner-up must be a DISTINCT peak (≥3 px away), otherwise every
      // match looks sharp simply because its own neighbours score similarly.
      var rival = Infinity;
      for (var si = 0; si < scores.length; si++) {
        var sc = scores[si];
        if (Math.abs(sc.ox - bdx) <= 3 && Math.abs(sc.oy - bdy) <= 3) continue;
        if (sc.s < rival) rival = sc.s;
      }
      var q = (isFinite(rival) && rival > 0) ? (rival - best) / rival : 0;
      if (!(q >= _FM_MIN_SHARP)) continue;
      out.push({ bx: bx, by: by, dx: bdx, dy: bdy, q: q });
    }
  }
  return out;
}
function _fmMedian(a) {
  if (!a.length) return 0;
  var s = a.slice().sort(function (p, q) { return p - q; }), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
// The owner's point, in code: hand-tracing the green edge, the yellow mid and
// the red core of one storm gave three different directions. So take the
// component-wise MEDIAN of every block vector — outliers (mis-matches, rotating
// band edges, growth/decay) cannot drag it the way a mean would.
function _fmAggregate(vectors) {
  if (vectors.length < _FM_MIN_BLOCKS) return null;
  var mvx = _fmMedian(vectors.map(function (v) { return v.vx; }));
  var mvy = _fmMedian(vectors.map(function (v) { return v.vy; }));
  var mag = Math.sqrt(mvx * mvx + mvy * mvy);
  if (mag < 1) return null;                                   // stationary field
  var dir = (Math.atan2(mvx, mvy) * 180 / Math.PI + 360) % 360;  // TOWARD, like every other steering vector
  var agree = 0, qSum = 0;
  for (var i = 0; i < vectors.length; i++) {
    var v = vectors[i], m = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
    if (m > 0.5) {
      var cos = (v.vx * mvx + v.vy * mvy) / (m * mag);
      if (cos > 0.707) agree++;                               // within 45° of the median
    }
    qSum += v.q;
  }
  var agreement = agree / vectors.length;
  var countF = Math.min(1, vectors.length / 12);
  var meanQ = qSum / vectors.length;
  var conf = Math.max(0, Math.min(0.9, countF * agreement * (0.5 + 0.5 * Math.min(1, meanQ * 4))));
  return {
    direction: Math.round(dir),
    speed: Math.round(mag * 0.621371),          // km/h → mph
    confidence: Math.round(conf * 100) / 100,
    agreement: Math.round(agreement * 100) / 100,
    blocks: vectors.length
  };
}
// Turn one frame pair's pixel offsets into km/h vectors.
function _fmVectorsFor(matches, lat, z, dtH) {
  var kmPerPx = _fmMetresPerPx(lat, z) / 1000, out = [];
  if (!(dtH > 0)) return out;
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    out.push({
      vx: (m.dx * kmPerPx) / dtH,        // +x = east
      vy: (-m.dy * kmPerPx) / dtH,       // +y = north (screen y grows southward)
      q: m.q
    });
  }
  return out;
}
// ---------------------------------------------------------------------------
// Main entry. Fetches the newest _FM_MAX_FRAMES RainViewer frames over the
// user's area, correlates each consecutive pair, pools EVERY block vector from
// EVERY pair, and takes the robust median. More frames = more vectors = a
// steadier answer, which is exactly the owner's "the more frames the more
// accurate". Returns the estimate, or null.
// ---------------------------------------------------------------------------
async function estimateMotionFromFrames(lat, lon, opts) {
  opts = opts || {};
  var z = opts.zoom || _FM_ZOOM_DEFAULT;
  var frames = opts.frames;
  if (!frames) {
    var rv = (typeof _fetchRvScanFrames === 'function') ? await _fetchRvScanFrames(true) : null;
    frames = rv && rv.frames ? rv.frames : null;
  }
  if (!frames || frames.length < 2) { console.log('[FrameMotion] no radar frames available'); return null; }
  // PAST frames only — a nowcast frame is a model's guess, and correlating
  // against a guess would measure the model, not the sky.
  var past = frames.filter(function (f) { return f && f.path && !/nowcast/.test(f.path); });
  if (past.length < 2) past = frames.slice();
  var use = past.slice(-_FM_MAX_FRAMES);
  if (use.length < 2) { console.log('[FrameMotion] need at least 2 past frames'); return null; }
  // 2x2 mosaic centred on the user
  var n = Math.pow(2, z);
  var fx = (lon + 180) / 360 * n;
  var fy = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  var tx0 = Math.max(0, Math.min(n - _FM_TILES, Math.round(fx - _FM_TILES / 2)));
  var ty0 = Math.max(0, Math.min(n - _FM_TILES, Math.round(fy - _FM_TILES / 2)));
  var t0 = Date.now();
  var grids = [];
  for (var i = 0; i < use.length; i++) {
    var g = await _fmFetchGrid(use[i].path, z, tx0, ty0, _FM_TILES);
    grids.push(g);
    if (opts.onProgress) try { opts.onProgress(i + 1, use.length); } catch (e) {}
  }
  var all = [], pairs = 0;
  for (var p = 0; p + 1 < grids.length; p++) {
    var A = grids[p], B = grids[p + 1];
    if (!A || !B) continue;
    var dtH = (use[p + 1].time - use[p].time) / 3600;         // frame times are epoch SECONDS
    if (!(dtH > 0) || dtH > 1) continue;                       // a gap that big is not one step
    var matches = _fmBlockMatch(A.g, B.g, A.W, A.H);
    var vecs = _fmVectorsFor(matches, lat, z, dtH);
    for (var v = 0; v < vecs.length; v++) all.push(vecs[v]);
    pairs++;
  }
  var est = _fmAggregate(all);
  var ms = Date.now() - t0;
  if (!est) { console.log('[FrameMotion] no usable motion from ' + pairs + ' pair(s), ' + all.length + ' block vectors (' + ms + ' ms)'); return null; }
  est.pairs = pairs; est.frames = use.length; est.ms = ms; est.zoom = z; est.ts = Date.now();
  est.lat = lat; est.lon = lon;
  console.log('[FrameMotion] ' + est.direction + '° @ ' + est.speed + ' mph from ' + est.blocks +
              ' block vectors across ' + pairs + ' frame pair(s) — agreement ' + est.agreement +
              ', confidence ' + est.confidence + ' (' + ms + ' ms)');
  return est;
}
// ---------------------------------------------------------------------------
// Orchestration: kicks off on the FIRST winds-aloft failure (the owner's ask),
// runs in the background, and refreshes the storm surfaces when it lands.
// ---------------------------------------------------------------------------
function frameMotionMv() {
  var m = (typeof S !== 'undefined') ? S._frameMotion : null;
  if (!m || !m.direction == null) return null;
  if (Date.now() - m.ts > _FM_STALE_MS) return null;
  if (typeof S !== 'undefined' && S.lat != null && m.lat != null && typeof haversine === 'function'
      && haversine(S.lat, S.lon, m.lat, m.lon) > 100) return null;    // estimated somewhere else
  if (!(m.speed >= 2) || !(m.confidence >= 0.2)) return null;
  return { direction: m.direction, speed: m.speed, confidence: m.confidence };
}
var _FM_MIN_GAP_MS = 5 * 60000;
function maybeStartFrameMotion(why) {
  if (typeof S === 'undefined' || S.lat == null) return false;
  if (S._fmRunning) return false;
  if (S._fmLastAt && Date.now() - S._fmLastAt < _FM_MIN_GAP_MS) return false;
  S._fmRunning = true; S._fmLastAt = Date.now();
  console.log('[FrameMotion] starting radar frame correlation (' + (why || 'winds aloft unavailable') + ')');
  var lat = S.lat, lon = S.lon, reqId = S._locReqId;
  estimateMotionFromFrames(lat, lon).then(function (est) {
    S._fmRunning = false;
    if (reqId !== S._locReqId) return;
    if (!est) return;
    S._frameMotion = est;
    if (typeof toast === 'function' && !S._fmToldAt) {
      S._fmToldAt = Date.now();
      var dir = (typeof degToDir === 'function') ? degToDir(est.direction) : est.direction + '°';
      toast('📡 Storm motion measured from radar frames — tracking ' + dir + ' at ' + est.speed + ' mph');
    }
    // repaint everything that consumes steering
    if (typeof _queueWindStormRefresh === 'function') _queueWindStormRefresh();
    else {
      if (typeof renderStorms === 'function') try { renderStorms(); } catch (e) {}
      if (typeof drawMiniSonar === 'function') try { drawMiniSonar(); } catch (e) {}
      if (typeof refreshRainClock === 'function') try { refreshRainClock(true); } catch (e) {}
    }
  }).catch(function (e) {
    S._fmRunning = false;
    console.log('[FrameMotion] failed: ' + (e && e.message));
  });
  return true;
}
if (typeof window !== 'undefined') {
  window.estimateMotionFromFrames = estimateMotionFromFrames;
  window.maybeStartFrameMotion = maybeStartFrameMotion;
  window.frameMotionMv = frameMotionMv;
}
