// =====================================================
// StormTracker — Integrated 3D Tab (THREE.js)
// Reads storm data from main app globals (S.storms, S.lat, S.lon, etc.)
// Renders volumetric storm clouds, rain, lightning, wind, terrain
// =====================================================
var V3D = {
  ready: false,
  active: false,
  renderer: null,
  camera: null,
  scene: null,
  controls: null,
  raycaster: null,
  mouse: null,
  clock: null,
  skyDome: null,
  skyMat: null,
  stormGroup: null,
  windGroup: null,
  coneGroup: null,
  compassGroup: null,
  ambientLight: null,
  sunLight: null,
  stormMeshes: [],
  windSystems: [],
  groundMesh: null,
  terrainMesh: null,
  terrainElevData: null,
  ringLabels: [],
  compassTape: null,
  compassHdg: null,
  ppd: Math.min(6, window.innerWidth < 500 ? 4 : Math.max(4, Math.round(window.innerWidth / 100))),
  frame: 0,
  rafId: null,
  metric: false,
  _labelsVisible: localStorage.getItem('v3d_labels') === 'on',
  _camMode: 'fixed',
  _fov: 72,
  _tierFilter: (function () {
    try { var s = localStorage.getItem('v3d_tiers'); if (s) { var a = JSON.parse(s); if (a.length === 6) return a; } } catch (e) {}
    return [true, true, true, true, true, true];
  })(),
  _cloudMaterial: null,
  _flashMaterial: null,
  _sharedHaloTextures: {},
  _sharedLabelTextures: {},
  _lightningCells: [],
  _lightningFlashes: [],
  _rainRerollInterval: null,
  _etaSprites: [],
  _etaInterval: null,
  glowLevel: 1,
  _markerGrp: null,
  _dayGlowMult: 1.0,
  _lightingMode: localStorage.getItem('st_3dLighting') || 'auto'
};

var _TIER_TINT_COLORS = [0x88ccff, 0x44ff88, 0xffee44, 0xff8800, 0xff2222, 0xcc00ff];

function toggle3DLabels() {
  V3D._labelsVisible = !V3D._labelsVisible;
  localStorage.setItem('v3d_labels', V3D._labelsVisible ? 'on' : 'off');
  V3D.stormMeshes.forEach(function (sm) {
    if (sm.label) { sm.label.visible = V3D._labelsVisible && V3D._tierFilter[sm.tierIdx]; }
  });
}

function setGlowLevel3D(val) {
  V3D.glowLevel = Math.max(0, Math.min(3, parseInt(val) || 0));
  var lbl = document.getElementById('v3d-lt-val');
  if (lbl) lbl.textContent = V3D.glowLevel;
  _applyGlowIntensity();
}
function _applyGlowIntensity() {
  var mult = V3D.glowLevel * V3D._dayGlowMult;
  if (V3D._cloudMaterial) {
    V3D._cloudMaterial.color.setScalar(0.35 + mult * 0.65);
  }
}

function cycleLightingMode3D() {
  var modes = ['auto', 'day', 'night', 'golden'];
  var labels = ['🌐 Auto', '☀️ Day', '🌙 Night', '🌅 Golden'];
  var idx = modes.indexOf(V3D._lightingMode);
  idx = (idx + 1) % modes.length;
  V3D._lightingMode = modes[idx];
  localStorage.setItem('st_3dLighting', V3D._lightingMode);
  var btn = document.getElementById('v3d-lighting-btn');
  if (btn) btn.textContent = labels[idx];
  refreshSky3D();
  _applyGlowIntensity();
}

function toggleFilterPanel3D() {
  var row = document.getElementById('v3d-tier-row');
  if (!row) return;
  var open = row.style.maxHeight !== '0px' && row.style.maxHeight !== '0' && row.style.maxHeight !== '';
  row.style.maxHeight = open ? '0' : '36px';
  row.style.opacity = open ? '0' : '1';
  row.style.padding = open ? '0 4px' : '3px 4px';
  var btn = document.getElementById('v3d-filter-toggle');
  if (btn) {
    btn.style.borderColor = open ? 'rgba(0,200,255,0.25)' : 'rgba(0,200,255,0.6)';
    btn.style.background = open ? 'rgba(5,10,20,0.78)' : 'rgba(0,80,120,0.7)';
    btn.setAttribute('aria-expanded', open ? 'false' : 'true');
  }
}

function reset3DView() {
  if (!V3D.camera || !V3D.controls) return;
  _setFov(72);
  _setCamMode('fixed');
}

function _setCamMode(mode) {
  V3D._camMode = mode;
  var btn = document.getElementById('v3d-cam-mode-btn');
  if (mode === 'fixed') {
    V3D.camera.position.set(0, 0.15, 0);
    V3D.controls.target.set(0, 0.15, -0.05);
    V3D.controls.enablePan = false;
    V3D.controls.enableZoom = false;
    V3D.controls.minDistance = 0.05;
    V3D.controls.maxDistance = 0.05;
    V3D.controls.dampingFactor = 0.12;
    if (V3D._markerGrp) V3D._markerGrp.visible = false;
    if (btn) btn.textContent = '📌 Fixed';
    _updateFovLabel();
    _initFovZoom();
  } else {
    _setFov(72);
    V3D.camera.position.set(0, 1, 0.01);
    V3D.controls.target.set(0, 0.4, -6);
    V3D.controls.enablePan = true;
    V3D.controls.enableZoom = true;
    V3D.controls.minDistance = 0.5;
    V3D.controls.maxDistance = 250;
    V3D.controls.dampingFactor = 0.07;
    if (V3D._markerGrp) {
      var camOriginDist = V3D.camera.position.length();
      var fadeStart = 2, fadeEnd = 5;
      var opFactor = camOriginDist < fadeStart ? 0 : camOriginDist > fadeEnd ? 1 : (camOriginDist - fadeStart) / (fadeEnd - fadeStart);
      V3D._markerGrp.children.forEach(function (ch) {
        if (ch.material) { ch.material.opacity = (ch.material.wireframe ? 0.35 : 0.82) * opFactor; }
      });
      V3D._markerGrp.visible = opFactor > 0.01;
    }
    if (btn) btn.textContent = '🔓 Free';
    _updateFovLabel();
    _removeFovZoom();
  }
  V3D.controls.update();
}

function _fovWheel(e) {
  if (V3D._camMode !== 'fixed') return;
  e.preventDefault();
  var delta = e.deltaY > 0 ? 2 : -2;
  _setFov(V3D._fov + delta);
}

var _fovTouchDist = 0;
function _fovTouchStart(e) {
  if (V3D._camMode !== 'fixed' || e.touches.length !== 2) return;
  e.preventDefault();
  var dx = e.touches[0].clientX - e.touches[1].clientX;
  var dy = e.touches[0].clientY - e.touches[1].clientY;
  _fovTouchDist = Math.sqrt(dx * dx + dy * dy);
}

function _fovTouchMove(e) {
  if (V3D._camMode !== 'fixed' || e.touches.length !== 2) return;
  e.preventDefault();
  var dx = e.touches[0].clientX - e.touches[1].clientX;
  var dy = e.touches[0].clientY - e.touches[1].clientY;
  var newDist = Math.sqrt(dx * dx + dy * dy);
  var diff = _fovTouchDist - newDist;
  if (Math.abs(diff) > 2) {
    _setFov(V3D._fov + (diff > 0 ? 1 : -1));
    _fovTouchDist = newDist;
  }
}

function _setFov(val) {
  var fov = Math.max(30, Math.min(120, Math.round(val)));
  V3D._fov = fov;
  if (V3D.camera) { V3D.camera.fov = fov; V3D.camera.updateProjectionMatrix(); }
  _updateFovLabel();
  var slider = document.getElementById('v3d-zoom-slider');
  if (slider && parseInt(slider.value) !== fov) slider.value = fov;
}

function _updateFovLabel() {
  var lbl = document.getElementById('v3d-fov-val');
  if (!lbl) return;
  var isFixed = V3D._camMode === 'fixed';
  if (isFixed) {
    lbl.textContent = V3D._fov + '°';
    lbl.style.display = '';
  } else {
    lbl.style.display = 'none';
  }
  var zoomWrap = document.getElementById('v3d-zoom-wrap');
  if (zoomWrap) zoomWrap.style.display = isFixed ? 'flex' : 'none';
}

function _initFovZoom() {
  if (!V3D.renderer) return;
  var el = V3D.renderer.domElement;
  _removeFovZoom();
  el.addEventListener('wheel', _fovWheel, { passive: false });
  el.addEventListener('touchstart', _fovTouchStart, { passive: false });
  el.addEventListener('touchmove', _fovTouchMove, { passive: false });
  V3D._fovZoomBound = true;
}

function _removeFovZoom() {
  if (!V3D.renderer || !V3D._fovZoomBound) return;
  var el = V3D.renderer.domElement;
  el.removeEventListener('wheel', _fovWheel);
  el.removeEventListener('touchstart', _fovTouchStart);
  el.removeEventListener('touchmove', _fovTouchMove);
  V3D._fovZoomBound = false;
}

function toggleCamMode3D() {
  _setCamMode(V3D._camMode === 'fixed' ? 'free' : 'fixed');
}

var _TIER_COLORS = ['#00F8FF','#00FF39','#F5FF00','#FFB200','#FF0200','#FF00F5'];
var _TIER_LETTERS = ['B','G','Y','O','R','M'];

function toggleTier3D(idx) {
  var onCount = V3D._tierFilter.reduce(function (s, v) { return s + (v ? 1 : 0); }, 0);
  if (V3D._tierFilter[idx] && onCount <= 1) return;
  V3D._tierFilter[idx] = !V3D._tierFilter[idx];
  localStorage.setItem('v3d_tiers', JSON.stringify(V3D._tierFilter));
  syncTierButtons3D();
  _applyTierVisibility();
  _updateLOD();
}

function _applyTierVisibility() {
  V3D.stormMeshes.forEach(function (sm) {
    var show = V3D._tierFilter[sm.tierIdx];
    sm.mesh.visible = show;
    if (sm.halo) sm.halo.visible = show;
    if (sm.label) sm.label.visible = show && V3D._labelsVisible !== false;
    if (sm.rain) sm.rain.visible = show && sm._showRain;
  });
}

function syncTierButtons3D() {
  for (var i = 0; i < 6; i++) {
    var el = document.getElementById('v3d-tier-' + i);
    if (el) {
      el.style.background = V3D._tierFilter[i] ? _TIER_COLORS[i] : 'rgba(5,10,20,0.78)';
      el.style.color = V3D._tierFilter[i] ? '#000' : _TIER_COLORS[i];
      el.style.borderColor = V3D._tierFilter[i] ? _TIER_COLORS[i] : 'rgba(255,255,255,0.15)';
      el.textContent = V3D._tierFilter[i] ? '✓' : _TIER_LETTERS[i];
    }
  }
}

var _CLOUD_TIER_DBZ = [30,40,45,51,60,999];

function _cloudTierIdx(dbz) {
  for (var i = 0; i < _CLOUD_TIER_DBZ.length; i++) { if (dbz <= _CLOUD_TIER_DBZ[i]) return i; }
  return 5;
}

function _initCloudMaterials() {
  if (!V3D._cloudMaterial) {
    V3D._cloudMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.8,
      depthWrite: false, side: THREE.DoubleSide
    });
  }
  if (!V3D._flashMaterial) {
    V3D._flashMaterial = new THREE.MeshBasicMaterial({
      vertexColors: false, transparent: true, opacity: 1.0,
      depthWrite: false, color: new THREE.Color(5, 5, 6)
    });
  }
}

function _getSharedHaloTexture(tierIdx) {
  if (V3D._sharedHaloTextures[tierIdx]) return V3D._sharedHaloTextures[tierIdx];
  var c = new THREE.Color(_TIER_TINT_COLORS[tierIdx]);
  var hR = Math.round(c.r * 255), hG = Math.round(c.g * 255), hB = Math.round(c.b * 255);
  var cv = document.createElement('canvas'); cv.width = cv.height = 64;
  var cx = cv.getContext('2d');
  var g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(' + hR + ',' + hG + ',' + hB + ',0.25)');
  g.addColorStop(0.4, 'rgba(' + hR + ',' + hG + ',' + hB + ',0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, 64, 64);
  V3D._sharedHaloTextures[tierIdx] = new THREE.CanvasTexture(cv);
  return V3D._sharedHaloTextures[tierIdx];
}

function _getSharedLabelTexture(dbz) {
  var key = Math.floor(dbz / 5) * 5;
  if (V3D._sharedLabelTextures[key]) return V3D._sharedLabelTextures[key];
  var text = key + '+ dBZ';
  var color = dbzCat3D(key + 2).col;
  var cw = 128, ch = 64;
  var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  var cx = cv.getContext('2d'); cx.clearRect(0, 0, cw, ch);
  cx.font = 'bold 38px Segoe UI,Arial,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.shadowColor = 'rgba(0,0,0,0.9)'; cx.shadowBlur = 10;
  cx.fillStyle = color; cx.fillText(text, cw / 2, ch / 2);
  V3D._sharedLabelTextures[key] = new THREE.CanvasTexture(cv);
  return V3D._sharedLabelTextures[key];
}

function toRad3D(d) { return d * Math.PI / 180; }
function haversineMi3D(la1, lo1, la2, lo2) {
  var R = 3958.8;
  var a = Math.sin(toRad3D(la2 - la1) / 2) * Math.sin(toRad3D(la2 - la1) / 2) +
    Math.cos(toRad3D(la1)) * Math.cos(toRad3D(la2)) * Math.sin(toRad3D(lo2 - lo1) / 2) * Math.sin(toRad3D(lo2 - lo1) / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function haversineKm3D(la1, lo1, la2, lo2) { return haversineMi3D(la1, lo1, la2, lo2) * 1.60934; }
function fmtDist3D(mi) { return V3D.metric ? Math.round(mi * 1.60934) + ' km' : Math.round(mi) + ' mi'; }
function fmtSpeed3D(mph) { return V3D.metric ? Math.round(mph * 1.60934) + ' km/h' : Math.round(mph) + ' mph'; }
// bearingDeg3D removed — identical to the shared bearingDeg in radar-shared.js
// (loaded first; global), which view3d now calls directly. haversineMi3D above
// intentionally stays: it uses R=3958.8 mi vs the shared haversine's R=3959, so
// replacing it would nudge 3D distances — left as-is to avoid any behavior change.
var DIRS16_3D = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
function dir16_3D(deg) { return DIRS16_3D[Math.round(deg / 22.5) % 16]; }

function geoToScene3D(lat, lon) {
  var R = 6371, dLa = toRad3D(lat - S.lat), dLo = toRad3D(lon - S.lon), avgLa = toRad3D((lat + S.lat) / 2);
  return { x: dLo * R * Math.cos(avgLa), z: -dLa * R };
}

function dbzCat3D(dbz) { var e = _dbzEntry(dbz); return { name: e.label, col: e.color }; }
function dbzHex3D(dbz) { return dbzCat3D(dbz).col; }
function dbzInt3D(dbz) { return Math.max(0.3, Math.min(2.5, (dbz - 15) / 30)); }

function loadImgCors3D(url) {
  return new Promise(function (res) {
    var img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = function () { res(img); }; img.onerror = function () { res(null); }; img.src = url;
  });
}

function sampleTerrainHeight3D(sx, sz) {
  if (!V3D.terrainElevData) return 0;
  var td = V3D.terrainElevData;
  var nx = (sx - td.centerX + td.sceneW / 2) / td.sceneW;
  var nz = (sz - td.centerZ + td.sceneD / 2) / td.sceneD;
  nx = Math.max(0, Math.min(1, nx)); nz = Math.max(0, Math.min(1, nz));
  var gx = nx * (td.w - 1), gz = nz * (td.h - 1);
  var gxi = Math.floor(gx), gzi = Math.floor(gz);
  var gxf = gx - gxi, gzf = gz - gzi;
  gxi = Math.max(0, Math.min(td.w - 2, gxi)); gzi = Math.max(0, Math.min(td.h - 2, gzi));
  var e00 = td.elev[gzi * td.w + gxi] || 0;
  var e10 = td.elev[gzi * td.w + (gxi + 1)] || 0;
  var e01 = td.elev[(gzi + 1) * td.w + gxi] || 0;
  var e11 = td.elev[(gzi + 1) * td.w + (gxi + 1)] || 0;
  var e = e00 * (1 - gxf) * (1 - gzf) + e10 * gxf * (1 - gzf) + e01 * (1 - gxf) * gzf + e11 * gxf * gzf;
  return Math.max(0, (e - td.minE) * td.elevScale);
}

// =====================================================
// SCENE INIT
// =====================================================
function init3DScene() {
  if (V3D.ready) return;
  var container = document.getElementById('view3d-container');
  if (!container) return;

  var cv = document.createElement('canvas');
  cv.id = 'view3d-canvas';
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0';
  container.appendChild(cv);

  V3D.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: 'high-performance' });
  V3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  V3D.renderer.sortObjects = true;
  var w = container.clientWidth, h = container.clientHeight;
  V3D.renderer.setSize(w, h);
  V3D.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  V3D.renderer.toneMappingExposure = 1.4;

  V3D.scene = new THREE.Scene();
  V3D.scene.fog = new THREE.FogExp2(0x70aae8, 0.0012);

  V3D._fov = 72;
  V3D._camMode = 'fixed';
  V3D.camera = new THREE.PerspectiveCamera(72, w / h, 0.001, 1000);
  V3D.camera.position.set(0, 0.15, 0.001); V3D.camera.lookAt(0, 0.15, -1);

  V3D.controls = new THREE.OrbitControls(V3D.camera, V3D.renderer.domElement);
  V3D.controls.enableDamping = true; V3D.controls.dampingFactor = 0.07;
  V3D.controls.screenSpacePanning = false;
  V3D.controls.minDistance = 0.5; V3D.controls.maxDistance = 250;
  V3D.controls.minPolarAngle = Math.PI * 0.05;
  V3D.controls.maxPolarAngle = Math.PI * 0.48;
  V3D.controls.target.set(0, 0.15, -1); V3D.controls.update();
  _setCamMode('fixed');
  if (V3D.controls.saveState) V3D.controls.saveState();

  V3D.raycaster = new THREE.Raycaster();
  V3D.mouse = new THREE.Vector2();
  V3D.clock = new THREE.Clock();

  V3D.ambientLight = new THREE.AmbientLight(0x8ab4e0, 1.2); V3D.scene.add(V3D.ambientLight);
  V3D.sunLight = new THREE.DirectionalLight(0xfff4d6, 1.5); V3D.sunLight.position.set(60, 90, 60); V3D.scene.add(V3D.sunLight);
  var fill = new THREE.DirectionalLight(0x4466bb, 0.4); fill.position.set(-40, 30, -40); V3D.scene.add(fill);

  V3D.stormGroup = new THREE.Group(); V3D.scene.add(V3D.stormGroup);
  V3D.windGroup = new THREE.Group(); V3D.scene.add(V3D.windGroup);
  V3D.coneGroup = new THREE.Group(); V3D.scene.add(V3D.coneGroup);
  V3D.compassGroup = new THREE.Group(); V3D.scene.add(V3D.compassGroup);

  buildGround3D(); buildSky3D(); buildCompass3D(); buildUserMarker3D(); buildCompassTape3D();
  updateRingLabels3D();
  _initCloudMaterials();

  window.addEventListener('resize', onResize3D);
  cv.addEventListener('click', onClick3D);
  cv.addEventListener('touchend', function (e) {
    e.preventDefault();
    if (e.changedTouches.length) onClick3D({ clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY });
  }, { passive: false });

  V3D.ready = true;
}

function resize3DPage() {
  var pg = document.getElementById('page-3d');
  if (!pg) return;
  var hdr = document.querySelector('.app-header');
  var hdrH = hdr ? hdr.offsetHeight : 0;
  var navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 60;
  pg.style.height = (window.innerHeight - hdrH - navH) + 'px';
}

function onResize3D() {
  if (!V3D.ready || !V3D.active) return;
  resize3DPage();
  var container = document.getElementById('view3d-container');
  if (!container) return;
  var w = container.clientWidth, h = container.clientHeight;
  V3D.camera.aspect = w / h;
  V3D.camera.updateProjectionMatrix();
  V3D.renderer.setSize(w, h);
  var newPpd = Math.min(6, window.innerWidth < 500 ? 4 : Math.max(4, Math.round(window.innerWidth / 100)));
  if (newPpd !== V3D.ppd) { V3D.ppd = newPpd; buildCompassTape3D(); }
}

// =====================================================
// GROUND
// =====================================================
function buildGround3D() {
  var sz = 512, cv2 = document.createElement('canvas'); cv2.width = sz; cv2.height = sz;
  var c2 = cv2.getContext('2d');
  c2.fillStyle = '#07111e'; c2.fillRect(0, 0, sz, sz);
  c2.strokeStyle = 'rgba(0,160,230,0.07)'; c2.lineWidth = 1;
  for (var i = 0; i <= 16; i++) { var p = i * (sz / 16); c2.beginPath(); c2.moveTo(p, 0); c2.lineTo(p, sz); c2.stroke(); c2.beginPath(); c2.moveTo(0, p); c2.lineTo(sz, p); c2.stroke(); }
  var g = c2.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2.2);
  g.addColorStop(0, 'rgba(0,160,230,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c2.fillStyle = g; c2.fillRect(0, 0, sz, sz);
  var tex = new THREE.CanvasTexture(cv2);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(50, 50);
  V3D.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshBasicMaterial({ map: tex }));
  V3D.groundMesh.rotation.x = -Math.PI / 2; V3D.groundMesh.position.y = 0; V3D.scene.add(V3D.groundMesh);
}

// =====================================================
// TERRAIN HEIGHTMAP
// =====================================================
async function fetchElevationGrid3D(lat, lon, radiusKm, gridW, gridH) {
  var z = 9;
  var n = Math.pow(2, z);
  var tsz = 256;
  var R = 6371;
  var dLat = radiusKm / R * (180 / Math.PI);
  var dLon = dLat / Math.cos(toRad3D(lat));
  var latMin = lat - dLat, latMax = lat + dLat;
  var lonMin = lon - dLon, lonMax = lon + dLon;

  function lonToTileF(lo, z) { return (lo + 180) / 360 * Math.pow(2, z); }
  function latToTileF(la, z) { var lr = toRad3D(la); return (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * Math.pow(2, z); }

  var txMin = Math.floor(lonToTileF(lonMin, z));
  var txMax = Math.floor(lonToTileF(lonMax, z));
  var tyMin = Math.floor(latToTileF(latMax, z));
  var tyMax = Math.floor(latToTileF(latMin, z));

  var tilesX = txMax - txMin + 1, tilesY = tyMax - tyMin + 1;
  var canvW = tilesX * tsz, canvH = tilesY * tsz;
  var cv2 = document.createElement('canvas'); cv2.width = canvW; cv2.height = canvH;
  var ctx2 = cv2.getContext('2d', { willReadFrequently: true });
  ctx2.fillStyle = 'rgb(1,134,160)';
  ctx2.fillRect(0, 0, canvW, canvH);

  var tileJobs = [];
  for (var ty = tyMin; ty <= tyMax; ty++) {
    for (var tx = txMin; tx <= txMax; tx++) {
      (function (ttx, tty) {
        var url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + z + '/' + ttx + '/' + tty + '.png';
        tileJobs.push(loadImgCors3D(url).then(function (img) {
          if (!img) return;
          var dx = (ttx - txMin) * tsz, dy = (tty - tyMin) * tsz;
          ctx2.drawImage(img, dx, dy, tsz, tsz);
        }));
      })(tx, ty);
    }
  }
  try { await Promise.all(tileJobs); } catch (e) { }

  var pixelData = ctx2.getImageData(0, 0, canvW, canvH).data;
  function latLonToCanvPx(la, lo) {
    var fx = lonToTileF(lo, z), fy = latToTileF(la, z);
    var px = (fx - txMin) * tsz, py = (fy - tyMin) * tsz;
    return { px: Math.floor(Math.max(0, Math.min(canvW - 1, px))), py: Math.floor(Math.max(0, Math.min(canvH - 1, py))) };
  }

  var elev = new Float32Array(gridW * gridH);
  var minE = Infinity, maxE = -Infinity;
  for (var gy = 0; gy < gridH; gy++) {
    for (var gx = 0; gx < gridW; gx++) {
      var t = gy / (gridH - 1), s2 = gx / (gridW - 1);
      var sLat = latMax - (t * (latMax - latMin));
      var sLon = lonMin + (s2 * (lonMax - lonMin));
      var px2 = latLonToCanvPx(sLat, sLon);
      var pi = (px2.py * canvW + px2.px) * 4;
      var R2 = pixelData[pi], G = pixelData[pi + 1], B = pixelData[pi + 2];
      var e = (R2 * 256 + G + B / 256) - 32768;
      elev[gy * gridW + gx] = e;
      if (e < minE) minE = e; if (e > maxE) maxE = e;
    }
  }
  if (!isFinite(minE)) minE = 0; if (!isFinite(maxE)) maxE = 0;
  return { elev: elev, minE: minE, maxE: maxE, latMin: latMin, latMax: latMax, lonMin: lonMin, lonMax: lonMax };
}

function buildTerrainMesh3D(elevData, mapTex, plW, plD, planeCX, planeCZ) {
  if (V3D.terrainMesh) { V3D.scene.remove(V3D.terrainMesh); if (V3D.terrainMesh.geometry) V3D.terrainMesh.geometry.dispose(); if (V3D.terrainMesh.material) V3D.terrainMesh.material.dispose(); V3D.terrainMesh = null; }
  var gridW = elevData.elev.length > 0 ? Math.round(Math.sqrt(elevData.elev.length)) : 64;
  var gridH = Math.round(elevData.elev.length / gridW);
  var segsX = gridW - 1, segsZ = gridH - 1;
  var geo = new THREE.PlaneGeometry(plW, plD, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);
  var pos = geo.attributes.position.array;
  var elevScale = 0.001;
  var maxDispKm = 8;
  for (var i = 0; i < segsZ + 1; i++) {
    for (var j = 0; j < segsX + 1; j++) {
      var vi = (i * (segsX + 1) + j);
      var e = elevData.elev[i * gridW + j] || 0;
      var h = (e - elevData.minE) * elevScale;
      h = Math.min(h, maxDispKm);
      pos[vi * 3 + 1] = h;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  V3D.terrainElevData = {
    elev: elevData.elev, w: gridW, h: gridH,
    minE: elevData.minE, maxE: elevData.maxE, elevScale: elevScale,
    sceneW: plW, sceneD: plD, centerX: planeCX, centerZ: planeCZ,
    latMin: elevData.latMin, latMax: elevData.latMax, lonMin: elevData.lonMin, lonMax: elevData.lonMax
  };
  var mat = new THREE.MeshBasicMaterial({ map: mapTex });
  V3D.terrainMesh = new THREE.Mesh(geo, mat);
  V3D.terrainMesh.position.set(planeCX, 0, planeCZ);
  V3D.scene.add(V3D.terrainMesh);
}

async function buildMapGround3D(lat, lon) {
  var z = 7, n = Math.pow(2, z), tsz = 256, canvSz = 1280;
  var fullPx = n * tsz;
  var lr = toRad3D(lat);
  var userGPx = (lon + 180) / 360 * fullPx;
  var userGPy = (1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * fullPx;
  var cx = Math.floor(userGPx / tsz), cy = Math.floor(userGPy / tsz);
  var originGPx = userGPx - canvSz / 2, originGPy = userGPy - canvSz / 2;
  var cv2 = document.createElement('canvas'); cv2.width = cv2.height = canvSz;
  var ctx2 = cv2.getContext('2d');
  ctx2.fillStyle = '#07111e'; ctx2.fillRect(0, 0, canvSz, canvSz);
  var R2 = 2, jobs = [];
  for (var dy = -R2; dy <= R2; dy++) {
    for (var dx = -R2; dx <= R2; dx++) {
      (function (ddx, ddy) {
        var rawTx = cx + ddx, rawTy = cy + ddy;
        var tx = ((rawTx % n) + n) % n, ty = Math.max(0, Math.min(n - 1, rawTy));
        var drawX = rawTx * tsz - originGPx, drawY = rawTy * tsz - originGPy;
        var srv = ['a', 'b', 'c'][(Math.abs(tx) + Math.abs(ty)) % 3];
        var url = 'https://' + srv + '.basemaps.cartocdn.com/dark_all/' + z + '/' + tx + '/' + ty + '.png';
        jobs.push(loadImgCors3D(url).then(function (img) {
          if (!img) return;
          ctx2.drawImage(img, drawX, drawY, tsz, tsz);
        }));
      })(dx, dy);
    }
  }
  await Promise.all(jobs);
  function pxToLon(px) { return px / fullPx * 360 - 180; }
  function pxToLat(py) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * py / fullPx))) * 180 / Math.PI; }
  var nwLat = pxToLat(originGPy), nwLon = pxToLon(originGPx);
  var seLat = pxToLat(originGPy + canvSz), seLon = pxToLon(originGPx + canvSz);
  var nwS = geoToScene3D(nwLat, nwLon), seS = geoToScene3D(seLat, seLon);
  var plW = seS.x - nwS.x, plD = seS.z - nwS.z;
  var planeCX = 0, planeCZ = 0;
  var tex = new THREE.CanvasTexture(cv2);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  if (V3D.groundMesh) { V3D.scene.remove(V3D.groundMesh); if (V3D.groundMesh.geometry) V3D.groundMesh.geometry.dispose(); if (V3D.groundMesh.material) V3D.groundMesh.material.dispose(); V3D.groundMesh = null; }

  try {
    var elevData = await fetchElevationGrid3D(lat, lon, 80, 128, 128);
    buildTerrainMesh3D(elevData, tex, plW, plD, planeCX, planeCZ);
  } catch (e) {
    console.warn('3D terrain elevation failed, using flat ground:', e);
    if (V3D.terrainMesh) { V3D.scene.remove(V3D.terrainMesh); if (V3D.terrainMesh.geometry) V3D.terrainMesh.geometry.dispose(); if (V3D.terrainMesh.material) V3D.terrainMesh.material.dispose(); V3D.terrainMesh = null; }
    V3D.terrainElevData = null;
    var newPlane = new THREE.Mesh(new THREE.PlaneGeometry(plW, plD), new THREE.MeshBasicMaterial({ map: tex }));
    newPlane.rotation.x = -Math.PI / 2; newPlane.position.set(planeCX, 0, planeCZ);
    V3D.groundMesh = newPlane; V3D.scene.add(V3D.groundMesh);
  }
}

// =====================================================
// SKY DOME
// =====================================================
function buildSky3D() {
  var geo = new THREE.SphereGeometry(750, 32, 16);
  V3D.skyMat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(0x020612) }, uHorizon: { value: new THREE.Color(0x0a1d3a) }, uGround: { value: new THREE.Color(0x040a12) }, uExp: { value: 0.55 } },
    vertexShader: 'varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 uTop,uHorizon,uGround;uniform float uExp;varying vec3 vPos;void main(){float h=normalize(vPos).y;vec3 sky=mix(uHorizon,uTop,pow(clamp(h,0.,1.),uExp));gl_FragColor=vec4(mix(uGround,sky,step(0.,h)),1.);}',
    side: THREE.BackSide, depthWrite: false
  });
  V3D.skyDome = new THREE.Mesh(geo, V3D.skyMat); V3D.scene.add(V3D.skyDome);
}

function _getSkyPeriod(now, rise, set) {
  if (now < rise - 3600 || now > set + 3600) return 'night';
  if (now < rise + 2400) return 'dawn';
  if (now < set - 2400) return 'day';
  return 'dusk';
}

function refreshSky3D() {
  var now = Date.now() / 1000;
  var rise = 0, set = 0;
  try {
    var wd = S._lastWeatherData;
    if (wd && wd.daily && wd.daily.sunrise && wd.daily.sunrise[0]) rise = new Date(wd.daily.sunrise[0]).getTime() / 1000;
    if (wd && wd.daily && wd.daily.sunset && wd.daily.sunset[0]) set = new Date(wd.daily.sunset[0]).getTime() / 1000;
  } catch (e) { }
  if (!rise || !set) {
    var today = new Date(); today.setHours(6, 30, 0, 0); rise = today.getTime() / 1000;
    var today2 = new Date(); today2.setHours(19, 30, 0, 0); set = today2.getTime() / 1000;
  }

  var period = _getSkyPeriod(now, rise, set);
  var mode = V3D._lightingMode;
  if (mode === 'day') { period = 'day'; }
  else if (mode === 'night') { period = 'night'; }
  else if (mode === 'golden') { period = 'dawn'; }

  var cloud = Math.min(1, (S.weather && S.weather.cloud_cover || 0) / 100);
  var topC = new THREE.Color(), horizC = new THREE.Color(), groundC = new THREE.Color(0x060d18);

  if (period === 'night') {
    topC.setHex(0x010408); horizC.setHex(0x050e20); groundC.setHex(0x030608);
    V3D.sunLight.intensity = 0.05; V3D.sunLight.color.setHex(0x223366); V3D.ambientLight.intensity = 0.15;
    V3D._dayGlowMult = 0.3;
  } else if (period === 'dawn') {
    var d = (mode !== 'auto') ? 0.6 : Math.max(0, Math.min(1, (now - rise + 3600) / 5000));
    topC.lerpColors(new THREE.Color(0x020510), new THREE.Color(0x2060b8), d);
    horizC.lerpColors(new THREE.Color(0xaa3818), new THREE.Color(0x6090c8), d);
    groundC.lerpColors(new THREE.Color(0x030608), new THREE.Color(0x0a1525), d);
    V3D.sunLight.intensity = 0.2 + d * 1.2; V3D.sunLight.color.setHex(0xffaa66); V3D.ambientLight.intensity = 0.5 + d * 0.9;
    V3D._dayGlowMult = 0.7;
  } else if (period === 'day') {
    topC.setHex(0x1a6edd); horizC.setHex(0x70aae8);
    groundC.setHex(0x0e1e30);
    V3D.sunLight.intensity = Math.max(0.6, 1.8 - cloud * 0.7); V3D.sunLight.color.setHex(0xfff4d6);
    V3D.ambientLight.intensity = Math.max(0.8, 1.6 - cloud * 0.5);
    V3D.ambientLight.color.setHex(0x8ab4e0);
    V3D._dayGlowMult = 1.0;
  } else {
    var d = (mode !== 'auto') ? 0.6 : Math.max(0, Math.min(1, 1 - (now - (set - 2400)) / 4200));
    topC.lerpColors(new THREE.Color(0x020510), new THREE.Color(0x2060b8), d);
    horizC.lerpColors(new THREE.Color(0xaa3818), new THREE.Color(0x6090c8), d);
    groundC.lerpColors(new THREE.Color(0x030608), new THREE.Color(0x0a1525), d);
    V3D.sunLight.intensity = 0.2 + d * 1.2; V3D.sunLight.color.setHex(0xff8040); V3D.ambientLight.intensity = 0.5 + d * 0.9;
    V3D._dayGlowMult = 0.7;
  }

  if (cloud > 0.3) { topC.lerp(new THREE.Color(0x3a4858), cloud * 0.5); horizC.lerp(new THREE.Color(0x506878), cloud * 0.4); }
  V3D.skyMat.uniforms.uTop.value.copy(topC); V3D.skyMat.uniforms.uHorizon.value.copy(horizC);
  V3D.skyMat.uniforms.uGround.value.copy(groundC); V3D.scene.fog.color.copy(horizC);

  _applyGlowIntensity();
}

// =====================================================
// COMPASS + USER MARKER
// =====================================================
function makeSprite3D(text, color, scale, wide) {
  var cw = wide ? 256 : 128, ch = 64;
  var cv2 = document.createElement('canvas'); cv2.width = cw; cv2.height = ch;
  var cx = cv2.getContext('2d'); cx.clearRect(0, 0, cw, ch);
  cx.font = 'bold 38px Segoe UI,Arial,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.shadowColor = 'rgba(0,0,0,0.9)'; cx.shadowBlur = 10;
  cx.fillStyle = color || 'rgba(255,255,255,0.5)'; cx.fillText(text, cw / 2, ch / 2);
  var tex = new THREE.CanvasTexture(cv2);
  var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  var sx = (scale || 1) * (wide ? 9 : 4.5), sy = (scale || 1) * 2.2;
  spr.scale.set(sx, sy, 1);
  spr._wide = !!wide;
  spr._baseScaleX = sx;
  spr._baseScaleY = sy;
  return spr;
}

function updateSpriteText3D(spr, text, color) {
  var wide = spr._wide;
  var cw = wide ? 256 : 128, ch = 64;
  var cv2 = document.createElement('canvas'); cv2.width = cw; cv2.height = ch;
  var cx = cv2.getContext('2d'); cx.clearRect(0, 0, cw, ch);
  cx.font = 'bold 38px Segoe UI,Arial,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.shadowColor = 'rgba(0,0,0,0.9)'; cx.shadowBlur = 10;
  cx.fillStyle = color || 'rgba(0,200,255,0.90)'; cx.fillText(text, cw / 2, ch / 2);
  if (spr.material.map) spr.material.map.dispose();
  spr.material.map = new THREE.CanvasTexture(cv2);
  spr.material.needsUpdate = true;
}

function updateRingLabels3D() {
  V3D.ringLabels.forEach(function (r) {
    var txt = V3D.metric ? r.km + ' km' : Math.round(r.km * 0.621371) + ' mi';
    updateSpriteText3D(r.spr, txt);
  });
}

function buildCompassTape3D() {
  var tape = document.getElementById('v3d-compass-tape');
  V3D.compassTape = tape;
  V3D.compassHdg = document.getElementById('v3d-compass-hdg');
  var CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  var html = '';
  for (var rep = 0; rep < 3; rep++) {
    var base = rep * 360;
    for (var d = 0; d < 360; d += 5) {
      var px = (base + d) * V3D.ppd;
      var isCard = CARD[d] !== undefined;
      var isMajor = d % 10 === 0;
      html += '<div class="ct-tick' + (isMajor ? ' major' : '') + '" style="left:' + px + 'px"></div>';
      if (isCard) html += '<div class="ct-lbl' + (d % 90 !== 0 ? ' inter' : '') + '" style="left:' + px + 'px">' + CARD[d] + '</div>';
      else if (d % 30 === 0) html += '<div class="ct-lbl inter" style="left:' + px + 'px">' + d + '°</div>';
    }
  }
  tape.innerHTML = html;
  tape.style.width = (1080 * V3D.ppd) + 'px';
}

function updateCompass3D() {
  if (!V3D.compassTape || !V3D.camera || !V3D.controls) return;
  var dx = V3D.controls.target.x - V3D.camera.position.x, dz = V3D.controls.target.z - V3D.camera.position.z;
  var hdg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  var container = document.getElementById('view3d-container');
  var center = container ? container.clientWidth / 2 : window.innerWidth / 2;
  var offset = center - (hdg + 360) * V3D.ppd;
  V3D.compassTape.style.transform = 'translateX(' + offset + 'px)';
  V3D.compassHdg.textContent = Math.round(hdg) + '°';
}

function buildCompass3D() {
  var R = 90;
  [{ t: 'N', b: 0, m: 1 }, { t: 'NE', b: 45, m: 0 }, { t: 'E', b: 90, m: 1 }, { t: 'SE', b: 135, m: 0 },
  { t: 'S', b: 180, m: 1 }, { t: 'SW', b: 225, m: 0 }, { t: 'W', b: 270, m: 1 }, { t: 'NW', b: 315, m: 0 }].forEach(function (d) {
    var ar = toRad3D(d.b);
    var spr = makeSprite3D(d.t, d.m ? 'rgba(0,229,255,0.85)' : 'rgba(255,255,255,0.3)', d.m ? 1 : 0.6);
    spr.position.set(R * Math.sin(ar), d.m ? 2.5 : 1.5, -R * Math.cos(ar)); V3D.compassGroup.add(spr);
  });
  var RINGS = [
    {mi:10,op:0.25,label:false},{mi:20,op:0.5,label:true},{mi:30,op:0.25,label:false},{mi:40,op:0.5,label:true},
    {mi:50,op:0.25,label:false},{mi:60,op:0.5,label:true},{mi:70,op:0.25,label:false},{mi:80,op:0.85,label:true}
  ];
  V3D.ringLabels = [];
  RINGS.forEach(function (r) {
    var km = r.mi * 1.60934;
    var pts = []; for (var a = 0; a <= 64; a++) { var ar = a / 64 * Math.PI * 2; pts.push(new THREE.Vector3(km * Math.sin(ar), 0.02, -km * Math.cos(ar))); }
    var col = r.mi === 80 ? 0x60ccff : 0x4a9ad0;
    var rl = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: r.op }));
    rl.renderOrder = 1; V3D.scene.add(rl);
    if (r.label) {
      var lspr = makeSprite3D(r.mi + ' mi', 'rgba(60,200,255,0.95)', r.mi === 80 ? 0.6 : 0.5);
      lspr.position.set(0, 1.2, -km); lspr.renderOrder = 5; V3D.scene.add(lspr);
      V3D.ringLabels.push({ spr: lspr, km: km });
    }
  });
}

function buildUserMarker3D() {
  var grp = new THREE.Group();
  var gem = new THREE.OctahedronGeometry(0.35, 0);
  gem.scale(1, 1.6, 1);
  var mat = new THREE.MeshBasicMaterial({ color: 0x0036FF, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false });
  var diamond = new THREE.Mesh(gem, mat);
  var wireGeo = new THREE.OctahedronGeometry(0.38, 0);
  wireGeo.scale(1, 1.6, 1);
  var wire = new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({ color: 0x4488FF, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false }));
  grp.add(diamond); grp.add(wire);
  grp.position.set(0, 1.0, 0); grp.renderOrder = 6; V3D.scene.add(grp);
  V3D._markerGrp = grp;
  if (V3D._camMode === 'fixed') grp.visible = false;
  var t = 0;
  V3D._markerRAF = null;
  function tick() {
    if (!V3D.active) { V3D._markerRAF = null; return; }
    V3D._markerRAF = requestAnimationFrame(tick);
    t += 0.012;
    grp.rotation.y = t;
    grp.position.y = 1.0 + 0.1 * Math.sin(t * 0.8);
  }
  V3D._startMarkerPulse = tick;
  tick();
}

// =====================================================
// STORM CLOUDS
// =====================================================
function _isSharedMaterial(mat) {
  if (mat === V3D._cloudMaterial || mat === V3D._flashMaterial) return true;
  return false;
}
function _isSharedTexture(tex) {
  for (var k in V3D._sharedHaloTextures) { if (V3D._sharedHaloTextures[k] === tex) return true; }
  for (var k in V3D._sharedLabelTextures) { if (V3D._sharedLabelTextures[k] === tex) return true; }
  return false;
}
function disposeObj3D(obj) {
  if (!obj) return;
  if (obj.children && obj.children.length) {
    while (obj.children.length > 0) { var ch = obj.children[0]; disposeObj3D(ch); obj.remove(ch); }
  }
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) {
    if (Array.isArray(obj.material)) obj.material.forEach(function (m) { if (!_isSharedMaterial(m)) { if (m.map && !_isSharedTexture(m.map)) m.map.dispose(); m.dispose(); } });
    else if (!_isSharedMaterial(obj.material)) { if (obj.material.map && !_isSharedTexture(obj.material.map)) obj.material.map.dispose(); obj.material.dispose(); }
  }
}
function clearGroup3D(grp) {
  while (grp.children.length > 0) { var c = grp.children[0]; disposeObj3D(c); grp.remove(c); }
}
function _startEtaInterval() {
  if (V3D._etaInterval) clearInterval(V3D._etaInterval);
  if (V3D._etaSprites.length) {
    V3D._etaInterval = setInterval(_updateEtaCountdowns, 1000);
  }
}

function clearStorms3D() {
  V3D.stormMeshes = [];
  V3D._etaSprites = [];
  V3D._lightningCells = [];
  V3D._lightningFlashes = [];
  if (V3D._etaInterval) { clearInterval(V3D._etaInterval); V3D._etaInterval = null; }
  if (V3D._rainRerollInterval) { clearInterval(V3D._rainRerollInterval); V3D._rainRerollInterval = null; }
  clearGroup3D(V3D.stormGroup);
  clearGroup3D(V3D.coneGroup);
}

function makeCloudGroup3D(dbz) {
  _initCloudMaterials();
  var baseR = Math.max(1.2, Math.min(6, (dbz - 10) / 7));
  var mobileScale = _isDesktop() ? 1.0 : 2.6;
  baseR *= mobileScale;
  var tierIdx = _cloudTierIdx(dbz);
  var tintCol = new THREE.Color(_TIER_TINT_COLORS[tierIdx]);
  var cat = dbzCat3D(dbz);
  var baseCol = new THREE.Color(cat.col);
  baseCol.lerp(tintCol, 0.2);
  var bright = 0.6 + (dbz / 100) * 0.6;
  baseCol.multiplyScalar(bright);
  var white = new THREE.Color(1, 1, 1);
  var dark = new THREE.Color(0.18, 0.18, 0.22);
  var severe = dbz >= 50, heavy = dbz >= 40, moderate = dbz >= 35;
  var SEG_W = 8, SEG_H = 6;
  var spheres = [];
  if (severe) {
    spheres.push({ sx: 1.3, sy: 0.55, sz: 1.2, px: 0, py: 0, pz: 0, col: baseCol.clone().lerp(dark, 0.4), r: baseR * 1.1 });
    spheres.push({ sx: 1.1, sy: 0.7, sz: 1.0, px: 0, py: baseR * 0.8, pz: 0, col: baseCol.clone().lerp(white, 0.15), r: baseR * 0.99 });
    spheres.push({ sx: 0.9, sy: 0.8, sz: 0.85, px: 0, py: baseR * 1.5, pz: 0, col: baseCol.clone().lerp(white, 0.3), r: baseR * 0.825 });
    spheres.push({ sx: 1.8, sy: 0.18, sz: 1.5, px: 0, py: baseR * 2.0, pz: 0, col: baseCol.clone().lerp(white, 0.35), r: baseR * 1.76 });
  } else if (heavy) {
    spheres.push({ sx: 1.2, sy: 0.5, sz: 1.1, px: 0, py: 0, pz: 0, col: baseCol.clone().lerp(dark, 0.3), r: baseR * 0.95 });
    spheres.push({ sx: 1.0, sy: 0.65, sz: 0.9, px: 0, py: baseR * 0.7, pz: 0, col: baseCol.clone().lerp(white, 0.2), r: baseR * 0.76 });
  } else if (moderate) {
    spheres.push({ sx: 1.1, sy: 0.5, sz: 1.0, px: 0, py: 0, pz: 0, col: baseCol.clone().lerp(white, 0.1), r: baseR * 0.85 });
    spheres.push({ sx: 0.9, sy: 0.55, sz: 0.85, px: 0, py: baseR * 0.55, pz: 0, col: baseCol.clone().lerp(white, 0.25), r: baseR * 0.51 });
  } else {
    spheres.push({ sx: 1.0, sy: 0.45, sz: 0.9, px: 0, py: 0, pz: 0, col: baseCol.clone().lerp(white, 0.15), r: baseR * 0.7 });
  }
  var geos = [];
  spheres.forEach(function (s) {
    var g = new THREE.SphereGeometry(s.r, SEG_W, SEG_H);
    var mat4 = new THREE.Matrix4();
    mat4.compose(new THREE.Vector3(s.px, s.py, s.pz), new THREE.Quaternion(), new THREE.Vector3(s.sx, s.sy, s.sz));
    g.applyMatrix4(mat4);
    var cnt = g.attributes.position.count;
    var cols = new Float32Array(cnt * 3);
    for (var i = 0; i < cnt; i++) { cols[i * 3] = s.col.r; cols[i * 3 + 1] = s.col.g; cols[i * 3 + 2] = s.col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geos.push(g);
  });
  var merged;
  if (geos.length > 1 && typeof THREE.BufferGeometryUtils !== 'undefined') {
    merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geos, false);
    geos.forEach(function (g) { g.dispose(); });
  } else if (geos.length > 1) {
    var grp = new THREE.Group();
    geos.forEach(function (g) {
      var m = new THREE.Mesh(g, V3D._cloudMaterial);
      m.renderOrder = 4;
      grp.add(m);
    });
    return { grp: grp, r: baseR };
  } else {
    merged = geos[0];
  }
  var mesh = new THREE.Mesh(merged, V3D._cloudMaterial);
  mesh.renderOrder = 4;
  return { grp: mesh, r: baseR };
}

function makeRain3D(dbz, r, terrainBaseH) {
  var maxP = _isDesktop() ? 120 : 60;
  var n = Math.min(maxP, 30 + dbz * 2), pos = new Float32Array(n * 3), vel = new Float32Array(n);
  for (var i = 0; i < n; i++) {
    var a = Math.random() * Math.PI * 2, d = Math.random() * r * 1.3;
    pos[i * 3] = Math.cos(a) * d; pos[i * 3 + 1] = -Math.random() * r * 2; pos[i * 3 + 2] = Math.sin(a) * d;
    vel[i] = 0.018 + Math.random() * 0.035;
  }
  var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x88aacc, size: 0.09, transparent: true, opacity: 0.45, sizeAttenuation: true, depthWrite: false }));
  pts.userData = { vel: vel, r: r, floorOffset: terrainBaseH || 0 }; return pts;
}

function animRain3D(rain, windDir) {
  if (!rain) return;
  var pos = rain.geometry.attributes.position.array, vel = rain.userData.vel, r = rain.userData.r;
  var localFloor = (rain.userData.floorOffset || 0) - rain.position.y;
  var resetThreshold = Math.max(-r * 2.8, localFloor - 0.01);
  var wd = toRad3D(windDir || 0), dx = Math.sin(wd) * 0.0015, dz = -Math.cos(wd) * 0.0015;
  for (var i = 0; i < vel.length; i++) {
    pos[i * 3] += dx; pos[i * 3 + 1] -= vel[i]; pos[i * 3 + 2] += dz;
    if (pos[i * 3 + 1] < resetThreshold) {
      var a = Math.random() * Math.PI * 2, d = Math.random() * r;
      pos[i * 3] = Math.cos(a) * d; pos[i * 3 + 1] = r * 0.4 + Math.random() * r * 0.4; pos[i * 3 + 2] = Math.sin(a) * d;
    }
  }
  rain.geometry.attributes.position.needsUpdate = true;
}

function _fmtEtaCountdown(arriveAt) {
  var remain = Math.max(0, arriveAt - Date.now());
  if (remain <= 0) return 'ARRIVING';
  var totalSec = Math.floor(remain / 1000);
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  if (h >= 1) return pad(h) + 'h:' + pad(m) + 'm';
  return pad(m) + 'm:' + pad(s) + 's';
}

function _updateEtaCountdowns() {
  V3D._etaSprites.forEach(function (e) {
    updateSpriteText3D(e.spr, _fmtEtaCountdown(e.arriveAt), 'rgba(255,200,55,0.92)');
  });
}

function _qualifyCone3D(cell, sp) {
  var mv = (typeof getSteeringMv === 'function') ? getSteeringMv() : S.stormMovement;
  if (!mv || mv.speed < 0.5) return null;
  var dkm = haversineKm3D(S.lat, S.lon, cell.lat, cell.lon);
  var distMi = dkm * 0.621371;
  var bearU = (cell.bearing + 180) % 360;
  var diff = Math.abs(((mv.direction - bearU + 180) % 360) - 180);
  var baseWidthMi = Math.max(0, Math.min(3, (cell.dbz - 20) / 15));
  var widthAngle = distMi > 0.5 ? Math.atan2(baseWidthMi, distMi) * 180 / Math.PI : 15;
  var CONE_HALF = 15 + widthAngle;
  if (diff > CONE_HALF) return null;
  var closingSpeed = mv.speed * Math.cos(Math.min(diff, 60) * Math.PI / 180);
  if (closingSpeed <= 1) return null;
  var etaMin = Math.round(distMi / closingSpeed * 60);
  return { cell: cell, sp: sp, dkm: dkm, distMi: distMi, etaMin: etaMin, baseWidthMi: baseWidthMi };
}

function _renderCone3D(q, coneIdx) {
  var cell = q.cell, sp = q.sp, dkm = q.dkm, distMi = q.distMi, baseWidthMi = q.baseWidthMi, etaMin = q.etaMin;
  var mv = (typeof getSteeringMv === 'function') ? getSteeringMv() : S.stormMovement;
  if (!mv) mv = S.stormMovement;
  var mRad = toRad3D(mv.direction);
  var rangeKm = Math.min(60, Math.max(distMi * 1.5, 20)) * 1.609;
  var halfWidthKm = baseWidthMi * 1.609 / 2;
  var col = new THREE.Color(dbzHex3D(cell.dbz));
  var dbzLayer = Math.max(0, Math.min(5, Math.floor((cell.dbz - 20) / 10)));
  var yOff = 0.02 + dbzLayer * 0.008 + (coneIdx || 0) * 0.002;
  var Y = sampleTerrainHeight3D(sp.x, sp.z) + yOff;

  var movX = Math.sin(mRad), movZ = -Math.cos(mRad);
  var perpLX = -Math.cos(mRad), perpLZ = -Math.sin(mRad);
  var perpRX = Math.cos(mRad), perpRZ = Math.sin(mRad);

  var bLx, bLz, bRx, bRz;
  if (halfWidthKm > 0.05) {
    bLx = sp.x + perpLX * halfWidthKm; bLz = sp.z + perpLZ * halfWidthKm;
    bRx = sp.x + perpRX * halfWidthKm; bRz = sp.z + perpRZ * halfWidthKm;
  } else { bLx = sp.x; bLz = sp.z; bRx = sp.x; bRz = sp.z; }
  var mL = mRad - 15 * Math.PI / 180, mR = mRad + 15 * Math.PI / 180;
  var fLx = bLx + Math.sin(mL) * rangeKm, fLz = bLz - Math.cos(mL) * rangeKm;
  var fCx = sp.x + movX * rangeKm, fCz = sp.z + movZ * rangeKm;
  var fRx = bRx + Math.sin(mR) * rangeKm, fRz = bRz - Math.cos(mR) * rangeKm;

  var coneRO = 3 + dbzLayer * 0.1;
  var outVerts = new Float32Array([bLx, Y, bLz, fLx, Y, fLz, fCx, Y, fCz, fRx, Y, fRz, bRx, Y, bRz]);
  var outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute('position', new THREE.BufferAttribute(outVerts, 3));
  var outline = new THREE.LineLoop(outGeo, new THREE.LineDashedMaterial({ color: col, transparent: true, opacity: 0.45, depthWrite: false, dashSize: 1.5, gapSize: 1.0, scale: 1 }));
  outline.computeLineDistances();
  outline.renderOrder = coneRO + 0.05; V3D.coneGroup.add(outline);

  if (etaMin > 0 && etaMin < 180) {
    V3D._etaCandidates = V3D._etaCandidates || [];
    V3D._etaCandidates.push({ dkm: dkm, etaMin: etaMin, spx: sp.x, spz: sp.z });
  }
}

function getCloudBase3D() {
  if (S._cloudBaseFt) return Math.max(2.5, S._cloudBaseFt / 3281 * 10);
  try {
    var wd = S._lastWeatherData;
    if (wd && wd.hourly && wd.hourly.temperature_2m && wd.hourly.dew_point_2m) {
      var hr = new Date().getHours();
      var t = wd.hourly.temperature_2m[hr], dp = wd.hourly.dew_point_2m[hr];
      if (t != null && dp != null) {
        var cbFt = Math.max(500, Math.round((t - dp) * 400));
        return Math.max(2.5, cbFt / 3281 * 10);
      }
    }
  } catch (e) { }
  return 1.5;
}

var _HEX3D_SIZE = 6 / Math.sqrt(3);
function _llToXY3D(lat, lon, cLat, cLon) {
  var dy = (lat - cLat) * 69.172;
  var dx = (lon - cLon) * 69.172 * Math.cos(cLat * Math.PI / 180);
  return [dx, dy];
}
function _xyToLL3D(x, y, cLat, cLon) {
  return [cLat + y / 69.172, cLon + x / (69.172 * Math.cos(cLat * Math.PI / 180))];
}
function _pxToHex3D(x, y) {
  var s = _HEX3D_SIZE;
  var fq = (2 / 3 * x) / s;
  var fr = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / s;
  var fs = -fq - fr;
  var rq = Math.round(fq), rr = Math.round(fr), rs = Math.round(fs);
  var dq = Math.abs(rq - fq), dr = Math.abs(rr - fr), ds = Math.abs(rs - fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, rr];
}
function _hexCenter3D(q, r) {
  var s = _HEX3D_SIZE;
  return [s * 3 / 2 * q, s * Math.sqrt(3) * (r + q / 2)];
}
function hexGridBin3D(rawPts, cLat, cLng, maxRadiusMi) {
  var cells = new Map();
  for (var i = 0; i < rawPts.length; i++) {
    var p = rawPts[i];
    var xy = _llToXY3D(p.lat, p.lng, cLat, cLng);
    var dist = Math.sqrt(xy[0] * xy[0] + xy[1] * xy[1]);
    if (dist > maxRadiusMi) continue;
    var qr = _pxToHex3D(xy[0], xy[1]);
    var key = qr[0] + ',' + qr[1];
    if (cells.has(key)) {
      var c = cells.get(key);
      if (p.dbz > c.maxDbz) c.maxDbz = p.dbz;
      c.sumDbz += p.dbz;
      c.count++;
    } else {
      var hc = _hexCenter3D(qr[0], qr[1]);
      var hDist = Math.sqrt(hc[0] * hc[0] + hc[1] * hc[1]);
      var hBear = (Math.atan2(hc[0], hc[1]) * 180 / Math.PI + 360) % 360;
      cells.set(key, { q: qr[0], r: qr[1], maxDbz: p.dbz, sumDbz: p.dbz, count: 1, dist: hDist, bearing: hBear });
    }
  }
  return cells;
}

function sonarZones3D() {
  if (_isDesktop()) {
    var storms = S.storms;
    if (!storms || !storms.length) return [];
    var out = [];
    for (var i = 0; i < storms.length; i++) {
      var s = storms[i];
      if (s.lat == null || (s.lng == null && s.lon == null)) continue;
      var lng = s.lng != null ? s.lng : s.lon;
      out.push({ lat: s.lat, lon: lng, lng: lng, dbz: s.dbz, distance: s.distance, bearing: s.bearing, count: s.pixels || 1, hookEcho: !!s._rotation });
    }
    out.sort(function (a, b) { return b.dbz - a.dbz; });
    return out;
  }
  var raw = S._rawScanPts;
  if (!raw || !raw.length) {
    var storms = S.storms;
    if (!storms || !storms.length) return [];
    var out = [];
    for (var i = 0; i < storms.length; i++) {
      var s = storms[i];
      if (s.lat == null || (s.lng == null && s.lon == null)) continue;
      var lng = s.lng != null ? s.lng : s.lon;
      out.push({ lat: s.lat, lon: lng, lng: lng, dbz: s.dbz, distance: s.distance, bearing: s.bearing, count: s.pixels || 1, hookEcho: !!s._rotation });
    }
    out.sort(function (a, b) { return b.dbz - a.dbz; });
    return out;
  }
  var cells = hexGridBin3D(raw, S.lat, S.lon, S.scanRadius || 80);
  var out = [];
  cells.forEach(function (c) {
    if (c.maxDbz < 20) return;
    var xy = _hexCenter3D(c.q, c.r);
    var ll = _xyToLL3D(xy[0], xy[1], S.lat, S.lon);
    out.push({ lat: ll[0], lon: ll[1], lng: ll[1], dbz: c.maxDbz, distance: c.dist, bearing: c.bearing, count: c.count, hookEcho: false });
  });
  out.sort(function (a, b) { return b.dbz - a.dbz; });
  return out;
}

function _rainProb(dbz) {
  if (dbz < 35) return 0;
  if (dbz >= 50) return 1;
  return Math.min(1, (dbz - 35) / 15 * 0.6 + 0.4);
}

function _rerollRain() {
  if (!V3D.active || !V3D.stormMeshes.length) return;
  var desktop = _isDesktop();
  var batchSize = Math.max(1, Math.ceil(V3D.stormMeshes.length / 6));
  var offset = V3D._rainRerollOffset || 0;
  var end = Math.min(offset + batchSize, V3D.stormMeshes.length);
  for (var i = offset; i < end; i++) {
    var sm = V3D.stormMeshes[i];
    if (!sm.cell) continue;
    var dbz = sm.cell.dbz;
    if (dbz >= 50) continue;
    if (dbz < 35) { if (sm.rain) sm.rain.visible = false; sm._showRain = false; continue; }
    var p = _rainProb(dbz);
    sm._showRain = Math.random() < p;
    if (sm.rain) sm.rain.visible = sm._showRain && V3D._tierFilter[sm.tierIdx];
  }
  V3D._rainRerollOffset = end >= V3D.stormMeshes.length ? 0 : end;
}

function _startRainReroll() {
  if (V3D._rainRerollInterval) clearInterval(V3D._rainRerollInterval);
  V3D._rainRerollOffset = 0;
  V3D._rainRerollInterval = setInterval(_rerollRain, 5000);
}

function _ltInterval(dbz) {
  if (dbz >= 65) return 1000 + Math.random() * 2000;
  if (dbz >= 60) return 2000 + Math.random() * 3000;
  if (dbz >= 55) return 4000 + Math.random() * 4000;
  return 8000 + Math.random() * 7000;
}

function _tickLightning() {
  if (!V3D._lightningCells.length) return;
  var now = performance.now();
  var i = V3D._lightningFlashes.length;
  while (i--) {
    var f = V3D._lightningFlashes[i];
    if (V3D.frame >= f.endFrame) {
      var sm = V3D.stormMeshes[f.meshIdx];
      if (sm && sm.mesh) {
        sm.mesh.material = V3D._cloudMaterial;
        sm.mesh.visible = f.prevVisible;
      }
      V3D._lightningFlashes.splice(i, 1);
    }
  }
  for (var j = 0; j < V3D._lightningCells.length; j++) {
    var lc = V3D._lightningCells[j];
    if (now < lc.nextFlash) continue;
    var alreadyFlashing = false;
    for (var k = 0; k < V3D._lightningFlashes.length; k++) {
      if (V3D._lightningFlashes[k].meshIdx === lc.meshIdx) { alreadyFlashing = true; break; }
    }
    if (alreadyFlashing) continue;
    var sm2 = V3D.stormMeshes[lc.meshIdx];
    if (sm2 && sm2.mesh) {
      var prevVis = sm2.mesh.visible;
      sm2.mesh.visible = true;
      sm2.mesh.material = V3D._flashMaterial;
      V3D._lightningFlashes.push({ meshIdx: lc.meshIdx, endFrame: V3D.frame + 8 + Math.floor(Math.random() * 9), prevVisible: prevVis });
    }
    lc.nextFlash = now + _ltInterval(lc.dbz);
  }
}

function _updateLOD() {
  if (!V3D.camera) return;
  var camPos = V3D.camera.position;
  var lodDist = _isDesktop() ? 9999 : 40;
  var lodScene = lodDist * 0.6;
  V3D.stormMeshes.forEach(function (sm) {
    var tierOn = V3D._tierFilter[sm.tierIdx];
    if (!tierOn) return;
    var mp = sm.mesh.position;
    var dx = mp.x - camPos.x, dz = mp.z - camPos.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    var far = d > lodScene;
    if (sm.rain) sm.rain.visible = !far && sm._showRain;
    if (sm.halo) sm.halo.visible = !far;
    if (sm.label && V3D._labelsVisible) sm.label.visible = !far;
  });
}

function rebuildStorms3D() {
  clearStorms3D();
  _initCloudMaterials();
  _applyGlowIntensity();
  var storms = sonarZones3D();
  if (!storms.length) return;
  var surfWind = S.weather ? S.weather.wind_direction_10m || S.weather.windDirection || 0 : 0;
  var showLabels = V3D._labelsVisible !== false;
  var desktop = _isDesktop();
  var _coneCandidates = [];
  var _rainCandidates = [];
  storms.forEach(function (cell) {
    var tierIdx = _cloudTierIdx(cell.dbz);
    var lon = cell.lon || cell.lng;
    var lat = cell.lat;
    var sp = geoToScene3D(lat, lon);
    var dkm = haversineKm3D(S.lat, S.lon, lat, lon);
    var cloudBase = getCloudBase3D();
    var cl = makeCloudGroup3D(cell.dbz);
    var yJitter = (Math.random() - 0.5) * 0.06;
    var alt = cloudBase + cl.r + yJitter;

    cl.grp.position.set(sp.x, alt, sp.z); cl.grp.rotation.y = (Math.random() * 358 - 179) * (Math.PI / 180); cl.grp.userData.cell = cell; V3D.stormGroup.add(cl.grp);

    var haloMesh = null;
    if (cell.dbz >= 50) {
      var haloTex = _getSharedHaloTexture(tierIdx);
      var haloSz = cl.r * 2;
      haloMesh = new THREE.Mesh(new THREE.PlaneGeometry(haloSz * 2, haloSz * 2),
        new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      var haloBaseH = sampleTerrainHeight3D(sp.x, sp.z);
      haloMesh.rotation.x = -Math.PI / 2; haloMesh.position.set(sp.x, haloBaseH + 0.015, sp.z); haloMesh.renderOrder = 2; V3D.stormGroup.add(haloMesh);
    }

    var rp = _rainProb(cell.dbz);
    if (rp > 0 && Math.random() < rp) {
      _rainCandidates.push({ meshIdx: V3D.stormMeshes.length, dkm: dkm, sp: sp, alt: alt, r: cl.r, dbz: cell.dbz, showRain: true });
    }

    if (cell.dbz >= 50) {
      V3D._lightningCells.push({ meshIdx: V3D.stormMeshes.length, dbz: cell.dbz, dkm: dkm, nextFlash: performance.now() + _ltInterval(cell.dbz) });
    }

    var lspr = null;
    if (cell.dbz >= 35) {
      var cloudTop = alt + cl.r * 2.2;
      var labelTex = _getSharedLabelTexture(cell.dbz);
      var scale = 0.35;
      lspr = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false }));
      var sx2 = scale * 4.5, sy2 = scale * 2.2;
      lspr.scale.set(sx2, sy2, 1);
      lspr._baseScaleX = sx2; lspr._baseScaleY = sy2;
      lspr.position.set(sp.x, cloudTop + 0.4, sp.z); lspr.visible = showLabels; lspr.renderOrder = 5; V3D.stormGroup.add(lspr);
    }

    var cellForCone = { lat: lat, lon: lon, dbz: cell.dbz, distance: cell.distance, bearing: cell.bearing || bearingDeg(S.lat, S.lon, lat, lon) };
    V3D.stormMeshes.push({ mesh: cl.grp, cell: cellForCone, rain: null, label: lspr, halo: haloMesh, dkm: dkm, _showRain: false, tierIdx: tierIdx });
    if (cell.dbz >= 35) {
      var q = _qualifyCone3D(cellForCone, sp);
      if (q) { _coneCandidates.push(q); }
    }
  });
  _rainCandidates.sort(function (a, b) { return a.dkm - b.dkm; });
  var maxRainCells = desktop ? _rainCandidates.length : 20;
  for (var ri = 0; ri < Math.min(_rainCandidates.length, maxRainCells); ri++) {
    var rc = _rainCandidates[ri];
    var terrainBase = sampleTerrainHeight3D(rc.sp.x, rc.sp.z);
    var rain = makeRain3D(rc.dbz, rc.r, terrainBase);
    rain.position.set(rc.sp.x, rc.alt, rc.sp.z);
    V3D.stormGroup.add(rain);
    V3D.stormMeshes[rc.meshIdx].rain = rain;
    V3D.stormMeshes[rc.meshIdx]._showRain = true;
  }
  _coneCandidates.sort(function (a, b) { return a.dkm - b.dkm; });
  var coneMax = Math.min(_coneCandidates.length, 12);
  for (var ci = 0; ci < coneMax; ci++) { _renderCone3D(_coneCandidates[ci], ci); }
  var cands = V3D._etaCandidates || [];
  cands.sort(function (a, b) { return a.dkm - b.dkm; });
  var etaMax = Math.min(cands.length, 12);
  for (var ei = 0; ei < etaMax; ei++) {
    var c = cands[ei];
    var arriveAt = Date.now() + Math.max(0, c.etaMin - ((typeof radarAgeMin==='function')?radarAgeMin():5)) * 60000;
    var eSpr = makeSprite3D(_fmtEtaCountdown(arriveAt), 'rgba(255,200,55,0.92)', 0.5, true);
    eSpr.position.set(c.spx, Math.min(c.dkm * 0.12 + 3.5, 6), c.spz); eSpr.renderOrder = 5; V3D.coneGroup.add(eSpr);
    V3D._etaSprites.push({ spr: eSpr, arriveAt: arriveAt });
  }
  V3D._etaCandidates = [];
  _startEtaInterval();
  _startRainReroll();
  _applyTierVisibility();
  _updateLOD();
}

// =====================================================
// WIND PARTICLES (desktop only — skipped on mobile for performance)
// =====================================================
var _v3dIsMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function rebuildWind3D() {
  if (_v3dIsMobile) return;
  while (V3D.windGroup.children.length > 0) V3D.windGroup.remove(V3D.windGroup.children[0]);
  V3D.windSystems = [];
  var aloftData = S._aloftData || [];
  if (!aloftData.length) return;
  var R = 130;
  aloftData.forEach(function (lv, i) {
    var n = 500; var pos = new Float32Array(n * 3);
    for (var j = 0; j < n; j++) {
      pos[j * 3] = (Math.random() - .5) * R * 2;
      pos[j * 3 + 1] = lv.altKm + Math.random() * lv.altKm * 0.2;
      pos[j * 3 + 2] = (Math.random() - .5) * R * 2;
    }
    var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: lv.sfc ? 0x6688bb : 0x4477aa,
      size: lv.sfc ? 0.14 : 0.18 + i * 0.035,
      transparent: true, opacity: lv.sfc ? 0.10 : 0.15,
      sizeAttenuation: true, depthWrite: false
    });
    var pts = new THREE.Points(geo, mat); V3D.windGroup.add(pts);
    V3D.windSystems.push({ pts: pts, spdMs: lv.spdMs, dir: lv.dir, R: R });
  });
}

function animWind3D() {
  if (_v3dIsMobile) return;
  V3D.windSystems.forEach(function (ws) {
    var pos = ws.pts.geometry.attributes.position.array;
    var n = pos.length / 3, dr = toRad3D(ws.dir), spd = ws.spdMs * 0.0006;
    var dx = Math.sin(dr) * spd, dz = -Math.cos(dr) * spd;
    for (var i = 0; i < n; i++) {
      pos[i * 3] += dx; pos[i * 3 + 2] += dz;
      if (pos[i * 3] > ws.R) pos[i * 3] -= ws.R * 2; if (pos[i * 3] < -ws.R) pos[i * 3] += ws.R * 2;
      if (pos[i * 3 + 2] > ws.R) pos[i * 3 + 2] -= ws.R * 2; if (pos[i * 3 + 2] < -ws.R) pos[i * 3 + 2] += ws.R * 2;
    }
    ws.pts.geometry.attributes.position.needsUpdate = true;
  });
}

// =====================================================
// HUD
// =====================================================
function refreshHUD3D() {
  var el = function (id) { return document.getElementById(id); };
  el('v3d-loc-name').textContent = S.locName || '\u2014';
  el('v3d-loc-coords').textContent = S.lat ? S.lat.toFixed(4) + '\u00b0, ' + S.lon.toFixed(4) + '\u00b0' : '\u2014';
  var stormsScanned = !!S.scanTime;
  var zones = sonarZones3D();
  var cnt = zones.length;
  el('v3d-storm-count').textContent = !stormsScanned ? 'Not scanned' : cnt ? cnt + ' zone' + (cnt !== 1 ? 's' : '') : 'Clear';
  var noscanEl = document.getElementById('v3d-noscan-msg');
  if (noscanEl) noscanEl.style.display = stormsScanned ? 'none' : 'block';
  if (!stormsScanned) {
    el('v3d-nearest-threat').textContent = 'Go to Radar tab to scan';
    el('v3d-nearest-threat').style.color = 'rgba(255,200,50,0.7)';
  } else {
    var sig = zones.filter(function (s) { return s.dbz >= 35; });
    if (sig.length) {
      var n = sig[0];
      el('v3d-nearest-threat').textContent = Math.round(n.dbz) + ' dBZ \u00b7 ' + fmtDist3D(n.distance) + ' ' + dir16_3D(n.bearing);
      el('v3d-nearest-threat').style.color = dbzHex3D(n.dbz);
    } else {
      el('v3d-nearest-threat').textContent = cnt ? 'No severe zones' : 'No active zones';
      el('v3d-nearest-threat').style.color = 'rgba(255,255,255,0.45)';
    }
  }
  var _sm3d = (typeof getSteeringMv === 'function') ? getSteeringMv() : S.stormMovement;
  if (_sm3d && _sm3d.speed > 1.5) {
    var _srcTag = (_sm3d.source && _sm3d.source !== 'aloft') ? ' \u00b7 ' + (_sm3d.source === 'observed' ? 'obs' : 'hyb') + ' ' + Math.round((_sm3d.confidence || 0) * 100) + '%' : '';
    el('v3d-steering-info').textContent = 'Steer: ' + dir16_3D(_sm3d.direction) + ' ' + fmtSpeed3D(_sm3d.speed) + ' (' + Math.round(_sm3d.direction) + '\u00b0)' + _srcTag;
  } else {
    el('v3d-steering-info').textContent = 'Steer: Calm';
  }
  var w = S.weather;
  if (w) {
    var wsKmh = (w.wind_speed_10m || w.windSpeed || 0), wsMph = wsKmh * 0.621371;
    el('v3d-wind-info').textContent = 'Wind: ' + dir16_3D(w.wind_direction_10m || w.windDirection || 0) + ' ' + fmtSpeed3D(wsMph);
  }
  var cbFt3D = S._cloudBaseFt || 0;
  if (!cbFt3D) {
    try {
      var wd = S._lastWeatherData;
      if (wd && wd.hourly && wd.hourly.temperature_2m && wd.hourly.dew_point_2m) {
        var hr = new Date().getHours();
        cbFt3D = Math.max(500, Math.round((wd.hourly.temperature_2m[hr] - wd.hourly.dew_point_2m[hr]) * 400));
      }
    } catch (e) { }
  }
  if (cbFt3D) {
    var cbTxt = V3D.metric ? Math.round(cbFt3D * 0.3048) + ' m' : cbFt3D.toLocaleString() + ' ft';
    el('v3d-cloud-base-info').textContent = 'Base: ' + cbTxt + ' AGL';
  }
}

// =====================================================
// STORM POPUP (3D)
// =====================================================
function openPopup3D(cell, cx, cy) {
  var popup = document.getElementById('v3d-popup');
  if (!popup) return;
  var cat = dbzCat3D(cell.dbz);
  document.getElementById('v3d-pop-cat').textContent = cat.name; document.getElementById('v3d-pop-cat').style.color = cat.col;
  document.getElementById('v3d-pop-dbz').textContent = Math.round(cell.dbz) + ' dBZ'; document.getElementById('v3d-pop-dbz').style.color = cat.col;
  var rows = '<div class="pop-row"><span class="pop-k">Distance</span><span class="pop-v">' + fmtDist3D(cell.distance) + '</span></div>';
  rows += '<div class="pop-row"><span class="pop-k">Direction</span><span class="pop-v">' + dir16_3D(cell.bearing) + ' (' + Math.round(cell.bearing) + '\u00b0)</span></div>';
  var _pmv = (typeof getSteeringMv === 'function') ? getSteeringMv() : S.stormMovement;
  if (_pmv && _pmv.speed > 1.5) {
    var _ptag = (_pmv.source && _pmv.source !== 'aloft') ? ' (' + (_pmv.source === 'observed' ? 'obs' : 'hyb') + ' ' + Math.round((_pmv.confidence || 0) * 100) + '%)' : '';
    rows += '<div class="pop-row"><span class="pop-k">Steering</span><span class="pop-v">' + dir16_3D(_pmv.direction) + ' ' + fmtSpeed3D(_pmv.speed) + _ptag + '</span></div>';
  }
  rows += '<div class="pop-row"><span class="pop-k">Lat / Lon</span><span class="pop-v">' + cell.lat.toFixed(3) + '\u00b0, ' + (cell.lon || cell.lng).toFixed(3) + '\u00b0</span></div>';
  document.getElementById('v3d-pop-rows').innerHTML = rows;
  popup.style.left = Math.min(cx, window.innerWidth - 230) + 'px';
  popup.style.top = Math.min(cy, window.innerHeight - 200) + 'px';
  popup.style.display = 'block';
}

function onClick3D(e) {
  if (!V3D.ready) return;
  var rect = V3D.renderer.domElement.getBoundingClientRect();
  V3D.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  V3D.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  V3D.raycaster.setFromCamera(V3D.mouse, V3D.camera);
  var meshList = []; V3D.stormMeshes.forEach(function (sm) { sm.mesh.traverse(function (c) { if (c.isMesh) meshList.push(c); }); });
  var hits = V3D.raycaster.intersectObjects(meshList, false);
  if (hits.length) {
    var hitObj = hits[0].object, found = null;
    V3D.stormMeshes.forEach(function (sm) { sm.mesh.traverse(function (c) { if (c === hitObj) found = sm; }); });
    if (found) openPopup3D(found.cell, e.clientX, e.clientY);
  } else {
    var popup = document.getElementById('v3d-popup');
    if (popup) popup.style.display = 'none';
  }
}

// =====================================================
// RENDER LOOP
// =====================================================
function loop3D() {
  if (!V3D.active) { V3D.rafId = null; return; }
  V3D.rafId = requestAnimationFrame(loop3D);
  V3D.frame++;
  var _off = V3D.camera.position.clone().sub(V3D.controls.target);
  var _dist = _off.length();
  if (V3D._camMode === 'fixed') {
    V3D.controls.minPolarAngle = Math.PI * 0.05;
    V3D.controls.maxPolarAngle = Math.PI * 0.95;
  } else {
    var _cosMax = (0.15 - V3D.controls.target.y) / _dist;
    _cosMax = Math.max(-1, Math.min(1, _cosMax));
    V3D.controls.maxPolarAngle = Math.min(Math.PI * 0.48, Math.acos(_cosMax));
  }
  V3D.controls.update();
  if (V3D._camMode !== 'fixed' && V3D.camera.position.y < 0.15) { V3D.camera.position.y = 0.15; V3D.controls.update(); }

  var camDist = _dist;
  var zf = Math.max(1, Math.min(5, camDist / 18));
  if (V3D._markerGrp) {
    if (V3D._camMode === 'free') {
      var camOriginDist = V3D.camera.position.length();
      var fadeStart = 2, fadeEnd = 5;
      var opacityFactor = camOriginDist < fadeStart ? 0 : camOriginDist > fadeEnd ? 1 : (camOriginDist - fadeStart) / (fadeEnd - fadeStart);
      V3D._markerGrp.children.forEach(function (ch) {
        if (ch.material) {
          var baseOp = ch.material.wireframe ? 0.35 : 0.82;
          ch.material.opacity = baseOp * opacityFactor;
        }
      });
      V3D._markerGrp.visible = opacityFactor > 0.01;
    }
  }
  if (V3D.frame % 4 === 0) {
    var _scaleSprite = function (s) { if (s && s._baseScaleX) s.scale.set(s._baseScaleX * zf, s._baseScaleY * zf, 1); };
    V3D.ringLabels.forEach(function (r) { _scaleSprite(r.spr); });
    V3D._etaSprites.forEach(function (e) { _scaleSprite(e.spr); });
    V3D.stormMeshes.forEach(function (sm) { if (sm.label) _scaleSprite(sm.label); });
    if (V3D.compassGroup) V3D.compassGroup.children.forEach(function (ch) { if (ch.isSprite) _scaleSprite(ch); });
  }

  var surfWind = S.weather ? S.weather.wind_direction_10m || S.weather.windDirection || 0 : 0;
  var animRainThisFrame = V3D.frame % 2 === 0;
  V3D.stormMeshes.forEach(function (sm) {
    if (animRainThisFrame) animRain3D(sm.rain, surfWind);
    sm.mesh.position.y += Math.sin(V3D.frame * 0.015 + sm.mesh.id) * 0.0002;
  });
  if (V3D.frame % 2 === 0) _tickLightning();
  if (V3D.frame % 30 === 0) _updateLOD();
  if (V3D.frame % 2 === 0) animWind3D();
  if (V3D.frame % 3600 === 0) refreshSky3D();
  if (V3D.frame % 2 === 0) updateCompass3D();
  V3D.renderer.render(V3D.scene, V3D.camera);
}

// =====================================================
// PUBLIC API — called by switchPage / core.js
// =====================================================
var _v3dLocKey = '';
var _v3dLoading = false;

async function activate3DView() {
  if (typeof THREE === 'undefined') {
    console.warn('THREE.js not loaded — 3D view unavailable');
    var errEl = document.getElementById('v3d-engine-error');
    if (errEl) errEl.style.display = 'flex';
    return;
  }
  var errEl2 = document.getElementById('v3d-engine-error');
  if (errEl2) errEl2.style.display = 'none';
  if (!S.lat) {
    var msg = document.getElementById('v3d-empty-msg');
    if (msg) msg.style.display = 'flex';
    return;
  }
  var msg2 = document.getElementById('v3d-empty-msg');
  if (msg2) msg2.style.display = 'none';

  V3D.active = true;
  if (V3D.ready) reset3DView();
  if (V3D._startMarkerPulse && !V3D._markerRAF) V3D._startMarkerPulse();
  syncTierButtons3D();
  var _camBtn = document.getElementById('v3d-cam-mode-btn');
  if (_camBtn) _camBtn.textContent = V3D._camMode === 'fixed' ? '📌 Fixed' : '🔓 Free';
  requestAnimationFrame(function () { resize3DPage(); onResize3D(); });

  if (!V3D.ready) {
    var loadEl = document.getElementById('v3d-loading');
    if (loadEl) loadEl.style.display = 'flex';
    init3DScene();
    var locKey = S.lat + ',' + S.lon;
    _v3dLocKey = locKey;
    _v3dLoading = true;
    await buildMapGround3D(S.lat, S.lon);
    _v3dLoading = false;
    refreshSky3D();
    _initLightingBtn();
    rebuildStorms3D();
    rebuildWind3D();
    refreshHUD3D();
    if (loadEl) loadEl.style.display = 'none';
    loop3D();
    return;
  }

  var locKey = S.lat + ',' + S.lon;
  if (locKey !== _v3dLocKey && !_v3dLoading) {
    _v3dLocKey = locKey;
    _v3dLoading = true;
    var loadEl = document.getElementById('v3d-loading');
    if (loadEl) loadEl.style.display = 'flex';
    await buildMapGround3D(S.lat, S.lon);
    _v3dLoading = false;
    if (loadEl) loadEl.style.display = 'none';
  }

  refreshSky3D();
  _initLightingBtn();
  rebuildStorms3D();
  rebuildWind3D();
  refreshHUD3D();
  onResize3D();
  if (!V3D.rafId) loop3D();
}

function _initLightingBtn() {
  var modes = ['auto', 'day', 'night', 'golden'];
  var labels = ['🌐 Auto', '☀️ Day', '🌙 Night', '🌅 Golden'];
  var idx = modes.indexOf(V3D._lightingMode);
  if (idx < 0) idx = 0;
  var btn = document.getElementById('v3d-lighting-btn');
  if (btn) btn.textContent = labels[idx];
}

function deactivate3DView() {
  V3D.active = false;
  if (V3D._markerRAF) { cancelAnimationFrame(V3D._markerRAF); V3D._markerRAF = null; }
  if (V3D._etaInterval) { clearInterval(V3D._etaInterval); V3D._etaInterval = null; }
  V3D._lightningCells = [];
  V3D._lightningFlashes = [];
  var popup = document.getElementById('v3d-popup');
  if (popup) popup.style.display = 'none';
}
