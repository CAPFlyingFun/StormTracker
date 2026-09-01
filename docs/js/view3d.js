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
  if (V3D.ar && V3D.ar.active) _arExit();
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
  // v6.95: the mode button stays tappable during AR, but 'free' mode would
  // strip the FOV pinch handlers and re-enable orbit input under a
  // sensor-driven camera — so a tap here means "back to normal viewing".
  if (V3D.ar && V3D.ar.active) { _arExit(); return; }
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

// v7.08: optional registry so a burst of tile loads can be CANCELLED (img.src=''
// aborts the in-flight request) when the view that wanted them goes away.
function loadImgCors3D(url, reg) {
  return new Promise(function (res) {
    var img = new Image(); img.crossOrigin = 'anonymous';
    var done = false;
    var finish = function (v) {
      if (done) return; done = true;
      if (reg) { var i = reg.indexOf(img); if (i >= 0) reg.splice(i, 1); }
      res(v);
    };
    img.onload = function () { finish(img); }; img.onerror = function () { finish(null); };
    if (reg) {
      reg.push(img);
      img._cancel = function () { try { img.onload = img.onerror = null; img.src = ''; } catch (e) {} finish(null); };
    }
    img.src = url;
  });
}
function _cancelLoads3D(reg) {
  if (!reg) return;
  while (reg.length) { var im = reg.pop(); try { if (im && im._cancel) im._cancel(); } catch (e) {} }
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

  // v6.95: alpha:true so AR mode can clear transparent over the live camera
  // <video> behind the canvas — context attributes are fixed at creation, so
  // this must be set here even though normal mode never shows transparency
  // (the explicit opaque clear color below reproduces the old look exactly).
  V3D.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' });
  V3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  V3D.renderer.setClearColor(0x050a14, 1);
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
  // v6.44: size the 3D page to the ACTUAL gap between its top and the bottom
  // nav bar, measured live. The old math (innerHeight − header − 60) assumed a
  // 60px nav and ignored the iPhone home-indicator safe-area the nav reserves,
  // so on notched phones the page ran ~34px too tall and the bottom control bar
  // tucked behind the nav (looked like the buttons vanished). getBoundingClientRect
  // handles ticker, safe-area and header size in one shot.
  var nav = document.querySelector('.bottom-nav');
  var pgTop = pg.getBoundingClientRect().top;
  var navTop = nav ? nav.getBoundingClientRect().top : (function () {
    var hdr = document.querySelector('.app-header');
    var hdrH = hdr ? hdr.offsetHeight : 0;
    var navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 60;
    return window.innerHeight - navH;
  })();
  var h = Math.max(200, Math.round(navTop - pgTop));
  pg.style.height = h + 'px';
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
  // v6.95: the terrain arrives async — born hidden if AR passthrough is live
  if (V3D.ar && V3D.ar.active && V3D.ar.stream) V3D.terrainMesh.visible = false;
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
        var url = (typeof basemapTileUrl === 'function') ? basemapTileUrl(z, tx, ty) : '';
        if (!url) return;               // basemap off — the plane keeps its flat fill
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
    V3D.groundMesh = newPlane;
    if (V3D.ar && V3D.ar.active && V3D.ar.stream) V3D.groundMesh.visible = false;  // v6.95: async arrival during AR
    V3D.scene.add(V3D.groundMesh);
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


// ═══════════════════════════════════════════════════════════════════════════
// v6.98: SUN ☀️ & MOON 🌙 — real positions in the 3D sky
// Standard low-precision solar/lunar ephemeris (the same public formulas
// SunCalc popularised — accurate to a fraction of a degree, plenty for an
// icon). Both bodies render as canvas-drawn icon sprites on the sky sphere at
// their true azimuth/altitude for S.lat/S.lon at the current time, in normal
// 3D AND in AR — where lining the ☀️ up with the actual sun is the quickest
// possible compass check. Sun label shows the next rise/set time from the
// Open-Meteo daily data refreshSky3D already reads; the moon label shows
// phase + illumination. Updated on the refreshSky3D cadence (~once a minute).
var _ASTRO_RAD = Math.PI / 180, _ASTRO_E = 23.4397 * Math.PI / 180;
function _astroDays(t) { return t / 86400000 - 0.5 + 2440588 - 2451545; }
function _astroRaDec(l, b) {
  return {
    ra: Math.atan2(Math.sin(l) * Math.cos(_ASTRO_E) - Math.tan(b) * Math.sin(_ASTRO_E), Math.cos(l)),
    dec: Math.asin(Math.sin(b) * Math.cos(_ASTRO_E) + Math.cos(b) * Math.sin(_ASTRO_E) * Math.sin(l))
  };
}
function _astroAzAlt(ra, dec, t, lat, lon) {
  var lw = -lon * _ASTRO_RAD, phi = lat * _ASTRO_RAD;
  var H = _ASTRO_RAD * (280.16 + 360.9856235 * _astroDays(t)) - lw - ra;
  return {
    az: (Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) / _ASTRO_RAD + 180 + 360) % 360,
    alt: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / _ASTRO_RAD
  };
}
function _astroSunCoords(d) {
  var M = _ASTRO_RAD * (357.5291 + 0.98560028 * d);
  var L = M + _ASTRO_RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M) + 102.9372) + Math.PI;
  return _astroRaDec(L, 0);
}
function _astroSun(t, lat, lon) {
  var c = _astroSunCoords(_astroDays(t));
  return _astroAzAlt(c.ra, c.dec, t, lat, lon);
}
function _astroMoon(t, lat, lon) {
  var d = _astroDays(t);
  var L = _ASTRO_RAD * (218.316 + 13.176396 * d);
  var M = _ASTRO_RAD * (134.963 + 13.064993 * d);
  var F = _ASTRO_RAD * (93.272 + 13.229350 * d);
  var l = L + _ASTRO_RAD * 6.289 * Math.sin(M);
  var b = _ASTRO_RAD * 5.128 * Math.sin(F);
  var m = _astroRaDec(l, b);
  var pos = _astroAzAlt(m.ra, m.dec, t, lat, lon);
  // illumination: phase angle between sun and moon as seen from earth
  var sc = _astroSunCoords(d);
  var sdist = 149598000, mdist = 385001 - 20905 * Math.cos(M);
  var phi = Math.acos(Math.sin(sc.dec) * Math.sin(m.dec) + Math.cos(sc.dec) * Math.cos(m.dec) * Math.cos(sc.ra - m.ra));
  var inc = Math.atan2(sdist * Math.sin(phi), mdist - sdist * Math.cos(phi));
  var angle = Math.atan2(Math.cos(sc.dec) * Math.sin(sc.ra - m.ra),
    Math.sin(sc.dec) * Math.cos(m.dec) - Math.cos(sc.dec) * Math.sin(m.dec) * Math.cos(sc.ra - m.ra));
  pos.fraction = (1 + Math.cos(inc)) / 2;
  pos.phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI;
  return pos;
}
function _astroPhaseName(p) {
  if (p < 0.03 || p > 0.97) return 'New Moon';
  if (p < 0.22) return 'Waxing Crescent';
  if (p < 0.28) return 'First Quarter';
  if (p < 0.47) return 'Waxing Gibbous';
  if (p < 0.53) return 'Full Moon';
  if (p < 0.72) return 'Waning Gibbous';
  if (p < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}
function _astroSunTex() {
  var cv2 = document.createElement('canvas'); cv2.width = cv2.height = 128;
  var c = cv2.getContext('2d'), m = 64;
  var g = c.createRadialGradient(m, m, 4, m, m, 62);
  g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.35, 'rgba(255,214,64,0.95)');
  g.addColorStop(0.55, 'rgba(255,180,40,0.35)'); g.addColorStop(1, 'rgba(255,160,30,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  c.strokeStyle = 'rgba(255,220,90,0.9)'; c.lineWidth = 5; c.lineCap = 'round';
  for (var i = 0; i < 8; i++) {
    var a = i * Math.PI / 4;
    c.beginPath();
    c.moveTo(m + Math.cos(a) * 34, m + Math.sin(a) * 34);
    c.lineTo(m + Math.cos(a) * 48, m + Math.sin(a) * 48);
    c.stroke();
  }
  c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(m, m, 24, 0, Math.PI * 2); c.fill();
  return new THREE.CanvasTexture(cv2);
}
function _astroMoonTex(phase) {
  var cv2 = document.createElement('canvas'); cv2.width = cv2.height = 128;
  var c = cv2.getContext('2d'), m = 64, R = 44;
  // night side first, lit shape on top: semicircle on the lit limb plus a
  // terminator half-ellipse that bulges lit-side before quarter, dark-side after
  c.fillStyle = '#3a4150'; c.beginPath(); c.arc(m, m, R, 0, Math.PI * 2); c.fill();
  var waxing = phase <= 0.5;
  var k = Math.cos(phase * 2 * Math.PI);       // +1 new … -1 full … +1 new
  c.fillStyle = '#e8e4d8';
  c.beginPath();
  c.arc(m, m, R, -Math.PI / 2, Math.PI / 2, !waxing);          // lit limb: right if waxing
  c.ellipse(m, m, Math.abs(k) * R, R, 0, Math.PI / 2, -Math.PI / 2, k < 0 ? !waxing : waxing);
  c.fill();
  // a few craters on the lit side for texture
  c.fillStyle = 'rgba(150,148,138,0.5)';
  [[18, -12, 7], [-8, 14, 5], [6, 26, 4], [-16, -20, 4]].forEach(function (cr) {
    c.beginPath(); c.arc(m + cr[0], m + cr[1], cr[2], 0, Math.PI * 2); c.fill();
  });
  c.strokeStyle = 'rgba(232,228,216,0.35)'; c.lineWidth = 2;
  c.beginPath(); c.arc(m, m, R, 0, Math.PI * 2); c.stroke();
  return new THREE.CanvasTexture(cv2);
}
var _ASTRO_R = 600;   // on the sky sphere, inside the 750 dome
function _astroPlace(spr, az, alt, r) {
  var azR = az * _ASTRO_RAD, altR = alt * _ASTRO_RAD;
  spr.position.set(r * Math.cos(altR) * Math.sin(azR), r * Math.sin(altR), -r * Math.cos(altR) * Math.cos(azR));
}
function _astroTick() {
  if (!V3D.ready || S.lat == null || typeof THREE === 'undefined') return;
  var A = V3D._astro;
  if (!A) {
    A = V3D._astro = { grp: new THREE.Group() };
    A.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: _astroSunTex(), transparent: true, depthWrite: false }));
    A.sun.scale.set(46, 46, 1);
    A.moonPhase = -1;
    A.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: null, transparent: true, depthWrite: false }));
    A.moon.scale.set(34, 34, 1);
    A.sunLbl = makeSprite3D('', 'rgba(255,225,120,0.95)', 4.5, true);
    A.moonLbl = makeSprite3D('', 'rgba(220,225,235,0.9)', 4.5, true);
    A.grp.add(A.sun); A.grp.add(A.moon); A.grp.add(A.sunLbl); A.grp.add(A.moonLbl);
    V3D.scene.add(A.grp);
  }
  var t = Date.now();
  var sun = _astroSun(t, S.lat, S.lon);
  var moon = _astroMoon(t, S.lat, S.lon);
  A.sun.visible = sun.alt > -3;
  A.sunLbl.visible = A.sun.visible;
  if (A.sun.visible) {
    _astroPlace(A.sun, sun.az, sun.alt, _ASTRO_R);
    _astroPlace(A.sunLbl, sun.az, Math.max(-2, sun.alt - 5.5), _ASTRO_R);
    // next rise/set from the daily data refreshSky3D already trusts
    var lbl = '';
    try {
      var dl = S._lastWeatherData && S._lastWeatherData.daily;
      if (dl && dl.sunset && dl.sunset[0]) {
        var st = new Date(dl.sunset[0]).getTime(), rt = dl.sunrise && dl.sunrise[0] ? new Date(dl.sunrise[0]).getTime() : 0;
        lbl = (t < st) ? ('sets ' + fmtClock(new Date(st))) : (rt ? ('rose ' + fmtClock(new Date(rt))) : '');
      }
    } catch (e) {}
    if (lbl !== A._sunLblTxt) { A._sunLblTxt = lbl; updateSpriteText3D(A.sunLbl, lbl, 'rgba(255,225,120,0.95)'); }
    A.sunLbl.visible = !!lbl;
  }
  A.moon.visible = moon.alt > -3;
  A.moonLbl.visible = A.moon.visible;
  if (A.moon.visible) {
    _astroPlace(A.moon, moon.az, moon.alt, _ASTRO_R);
    _astroPlace(A.moonLbl, moon.az, Math.max(-2, moon.alt - 4.5), _ASTRO_R);
    if (Math.abs(moon.phase - A.moonPhase) > 0.01) {
      A.moonPhase = moon.phase;
      var old = A.moon.material.map;
      A.moon.material.map = _astroMoonTex(moon.phase);
      A.moon.material.needsUpdate = true;
      if (old) old.dispose();
    }
    var mTxt = _astroPhaseName(moon.phase) + ' ' + Math.round(moon.fraction * 100) + '%';
    if (mTxt !== A._moonLblTxt) { A._moonLblTxt = mTxt; updateSpriteText3D(A.moonLbl, mTxt, 'rgba(220,225,235,0.9)'); }
  }
}

function refreshSky3D() {
  if (!V3D.ready || typeof THREE === 'undefined') return;   // v7.08: never touch a scene that isn't built
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
  // v6.98: the sun/moon ride the same cadence as the sky recolour (activate,
  // ~once a minute in the loop, and each lighting-mode change)
  try { _astroTick(); } catch (e) {}
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
  if (V3D._suppressClickUntil && Date.now() < V3D._suppressClickUntil) return;  // v6.96: drag, not a tap
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
  if (V3D.ar && V3D.ar.active) {
    // v6.95 AR: the phone's orientation sensors own the camera this frame.
    // OrbitControls.update() would overwrite the quaternion from its internal
    // spherical (even with controls.enabled=false), so it is skipped entirely;
    // _arApplyOrientation also re-syncs controls.target so the compass tape,
    // raycaster and sprite scaling keep working unmodified.
    _arApplyOrientation();
  } else {
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
  }

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
    if (V3D._arCache && !_arCacheHit()) _arDisposeCache();   // v7.08: parked AR ground is for the old spot
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


// ═══════════════════════════════════════════════════════════════════════════
// v6.95: AR STORM VIEW — "magic window" augmented reality, no WebXR needed
// (iOS Safari has no immersive-ar). The live rear camera plays as a fullscreen
// <video> BEHIND the WebGL canvas, the renderer clears transparent, and the
// device orientation sensors drive the camera so storm cells hang at their
// REAL compass bearings: point the phone at the storm and its cell is drawn
// over the actual clouds. Nothing is warped into an HDRI — passthrough AR
// keeps the video flat and rotates the WORLD, which is both cheaper and
// correct (a phone camera only ever sees ~70° of sky at once).
//
// Heading model: alpha/beta/gamma → quaternion (the classic W3C YXZ formula,
// screen-orientation compensated). iOS alpha is RELATIVE (arbitrary zero), so
// a slow servo steers the yaw toward webkitCompassHeading (absolute magnetic);
// Android absolute events already carry a magnetic alpha. Magnetic vs true
// north (declination, roughly ±15° across CONUS, ~2° in Pensacola) and compass
// wobble are absorbed by the same servo plus a one-finger drag trim.
// ═══════════════════════════════════════════════════════════════════════════
V3D.ar = { active: false, stream: null, video: null, handler: null, evt: null,
  compass: null, hasAbs: false, yawFix: 0, trim: 0, yawRaw: null, hint: null, hintTimer: null,
  dragX: null, dragged: false, ts: null, tm: null, te: null, vis: null,
  pending: false, vtrack: null, trackEnd: null, sensorTimer: null, noSensor: false,
  prevFov: null, fade: null, ground: null, bldg: null, revealed: false, revealTimer: null,
  progress: null, groundPending: false, altM: 100, vr: false, prevTouchAction: '',
  loads: null, bldgAbort: null, groundKey: null, groundElev: null, groundDatum: 0 };
// v7.04: AR eye altitude above the user's ground level, preset-cycled and remembered
var _AR_ALTS = [2, 5, 10, 20, 50, 100, 200, 350, 500];
try { var _aAlt = parseFloat(localStorage.getItem('v3d_ar_alt')); if (_AR_ALTS.indexOf(_aAlt) >= 0) V3D.ar.altM = _aAlt; } catch (e) {}
function cycleARAlt3D() {
  var i = _AR_ALTS.indexOf(V3D.ar.altM);
  V3D.ar.altM = _AR_ALTS[(i + 1) % _AR_ALTS.length];   // unknown value → index -1 → wraps to 2 m
  try { localStorage.setItem('v3d_ar_alt', String(V3D.ar.altM)); } catch (e) {}
  _arAltLabel();
}
// v7.06: −/+ stepper (clamps at 2 m and 500 m instead of wrapping)
function stepARAlt3D(d) {
  var i = _AR_ALTS.indexOf(V3D.ar.altM);
  if (i < 0) i = 5;                                    // unknown value → restart from 100 m
  else i = Math.max(0, Math.min(_AR_ALTS.length - 1, i + d));
  V3D.ar.altM = _AR_ALTS[i];
  try { localStorage.setItem('v3d_ar_alt', String(V3D.ar.altM)); } catch (e) {}
  _arAltLabel();
}
function _arAltLabel() {
  var b = document.getElementById('v3d-alt-btn');
  if (b) b.textContent = V3D.ar.altM + ' m';
}

// v7.05: VR mode — the same sensor-aimed first-person view as AR, but the
// camera stays off: the rendered sky, sun/moon, terrain, buildings and storm
// cells ARE the scene. One code path with AR (stream === null, vr flag on),
// so the compass servo, drag trim, altitude presets and terrain build are
// shared, and only the passthrough/reveal differ.
function toggleVRMode3D() {
  if (V3D.ar.active && V3D.ar.vr) { _arExit(); return; }   // VR again → off
  if (!V3D.ready || V3D.ar.pending) return;
  if (V3D.ar.active) _arExit();                    // v7.07: in AR → switch straight to VR, one tap
  V3D.ar.pending = true;
  var motionP;
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    motionP = DeviceOrientationEvent.requestPermission().then(function (r) { return r === 'granted'; }).catch(function () { return false; });
  } else {
    motionP = Promise.resolve(true);
  }
  motionP.then(function (motion) {
    if (!motion) { V3D.ar.pending = false; _arHint('Motion access was denied — VR needs the compass/gyro to aim the view. Close and reopen the app (or this tab) to be asked again.', 6000); return; }
    _arEnter(null, true);
  });
}

function toggleARMode3D() {
  if (V3D.ar.active && !V3D.ar.vr) { _arExit(); return; }  // AR (or ghost) again → off
  if (!V3D.ready || V3D.ar.pending) return;
  if (V3D.ar.active) _arExit();                    // v7.07: in VR → switch straight to AR, one tap
  V3D.ar.pending = true;
  // iOS choreography: DeviceOrientationEvent.requestPermission() must run
  // SYNCHRONOUSLY inside the tap gesture — so it goes first; getUserMedia
  // tolerates being past the await.
  var motionP;
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    motionP = DeviceOrientationEvent.requestPermission().then(function (r) { return r === 'granted'; }).catch(function () { return false; });
  } else {
    motionP = Promise.resolve(true);
  }
  motionP.then(function (motion) {
    if (!motion) { V3D.ar.pending = false; _arHint('Motion access was denied — AR needs the compass/gyro to aim the view. Close and reopen the app (or this tab) to be asked again.', 6000); return; }
    var gum = (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
      ? navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      : Promise.reject(new Error('mediaDevices unavailable'));
    gum.then(function (stream) { _arEnter(stream); })
      .catch(function (err) {
        // camera refused or absent → ghost mode: sensors aim the virtual scene.
        // (Installed iOS web apps re-ask for the camera each cold launch, and a
        // denial there is sticky — hence the explicit hint.)
        _arEnter(null);
        _arHint((err && err.name === 'NotAllowedError')
          ? 'Camera blocked — AR is running against the virtual sky instead. To get passthrough in the installed app, remove and re-add it, or use Safari directly.'
          : 'No rear camera found — AR is running against the virtual sky instead.', 7000);
      });
  });
}

function _arEnter(stream, vr) {
  V3D.ar.pending = false;
  var container = document.getElementById('view3d-container');
  if (V3D.ar.active || !V3D.active || !container) {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    return;
  }
  _setCamMode('fixed');            // camera at the user's spot; FOV pinch stays live
  var ar = V3D.ar;
  ar.prevFov = V3D._fov;
  _setFov(64);                     // ≈ a phone main camera's vertical FOV in portrait; pinch to fine-tune
  ar.active = true; ar.stream = stream || null; ar.vr = !!vr;
  ar.yawFix = 0; ar.trim = 0; ar.compass = null; ar.evt = null; ar.hasAbs = false; ar.yawRaw = null;
  V3D.controls.enabled = false;    // sensors own the look direction now
  var altGrp = document.getElementById('v3d-alt-grp');
  if (altGrp) altGrp.style.display = '';
  _arAltLabel();
  if (stream) {
    // v7.01: NO video element yet, and no opacity games ever. On the owner's
    // phone the v6.98 video was VISIBLE while carrying opacity:0 (the camera
    // appeared before the terrain, loading bar and all) and intermittently
    // painted over the HUD even after v6.99's translateZ pins — iOS promotes
    // a fullscreen MediaStream video to its own layer and then mis-applies
    // both its opacity and its stacking. So the element simply does not exist
    // until _arReveal(): the stream stays warm on its own, and the video is
    // inserted at reveal as a plain static element — the exact configuration
    // v6.97 proved stacks correctly under the HUD on-device.
    var vt = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    if (vt) {
      ar.vtrack = vt;
      ar.trackEnd = function () { _arExit(); };
      vt.addEventListener('ended', ar.trackEnd);
    }
  }
  if ((stream || vr) && S.lat != null && !_arCacheHit()) {   // v7.08: a cached ground needs no loading bar
    var prog = document.createElement('div');
    prog.id = 'v3d-ar-progress';
    prog.style.cssText = 'position:absolute;top:44px;left:15%;right:15%;z-index:26;transform:translateZ(0);background:rgba(5,10,20,0.85);backdrop-filter:blur(8px);border:1px solid rgba(0,200,255,0.25);border-radius:10px;padding:8px 12px;pointer-events:none';
    prog.innerHTML = '<div id="v3d-ar-prog-label" style="font-size:10px;color:#e8eef8;margin-bottom:5px;text-align:center">Loading terrain — 0%</div>'
      + '<div style="height:4px;border-radius:2px;background:rgba(0,200,255,0.15)"><div id="v3d-ar-prog-fill" style="height:100%;width:0%;border-radius:2px;background:#00c8ff;transition:width .2s"></div></div>';
    container.appendChild(prog);
    ar.progress = prog;
  }
  if (stream || vr) {
    // failsafe: a stalled tile must never hold the reveal hostage
    ar.revealTimer = setTimeout(function () { _arReveal(); }, 15000);
  }
  // one handler for both event names: iOS fires deviceorientation with
  // webkitCompassHeading; Android Chrome fires deviceorientationabsolute with
  // absolute=true. Once an absolute event is seen, relative ones are ignored
  // for pose (mixed zero-points would make the view jump).
  ar.handler = function (e) {
    if (e.alpha == null && e.beta == null) return;
    if (e.absolute) { ar.hasAbs = true; ar.evt = { a: e.alpha, b: e.beta, g: e.gamma }; ar.compass = (360 - e.alpha) % 360; return; }
    if (!ar.hasAbs) ar.evt = { a: e.alpha, b: e.beta, g: e.gamma };
    if (e.webkitCompassHeading != null && e.webkitCompassHeading >= 0) ar.compass = e.webkitCompassHeading;
  };
  window.addEventListener('deviceorientation', ar.handler, true);
  window.addEventListener('deviceorientationabsolute', ar.handler, true);
  // one-finger horizontal drag = heading trim (map-drag metaphor: pull the
  // world right → view turns left). Compasses drift; the horizon doesn't.
  var dom = V3D.renderer.domElement;
  // v7.06: while AR/VR owns the view, a finger on the canvas must never scroll
  // the page (the whole app was scrolling under look-around drags — owner
  // screenshots). touch-action:none stops the browser's native pan/zoom, and
  // the touchmove handler swallows what remains (bound non-passive below so
  // preventDefault is honored).
  ar.prevTouchAction = dom.style.touchAction || '';
  dom.style.touchAction = 'none';
  ar.ts = function (e) { if (e.touches && e.touches.length === 1) ar.dragX = e.touches[0].clientX; };
  ar.tm = function (e) {
    if (e.cancelable) e.preventDefault();          // page must not scroll or pinch-zoom
    if (ar.dragX == null || !e.touches || e.touches.length !== 1) return;
    var x = e.touches[0].clientX;
    if (Math.abs(x - ar.dragX) > 2) ar.dragged = true;
    ar.trim -= (x - ar.dragX) * 0.12;
    ar.dragX = x;
  };
  ar.te = function () {
    ar.dragX = null;
    // the canvas touchend handler turns every lift into a raycast tap —
    // a trim drag must not open a storm popup at the lift point
    if (ar.dragged) { V3D._suppressClickUntil = Date.now() + 350; ar.dragged = false; }
  };
  dom.addEventListener('touchstart', ar.ts, true);
  dom.addEventListener('touchmove', ar.tm, { capture: true, passive: false });
  dom.addEventListener('touchend', ar.te, true);
  if (stream || vr) { _arBuildGround(); if (!ar.groundPending) _arReveal(); }
  ar.sensorTimer = setTimeout(function () {
    if (ar.active && !ar.evt) {
      ar.noSensor = true;
      _arHint('No motion sensors detected — drag sideways to look around.', 5000);
    }
  }, 2500);
  // backgrounding the app must not leave the camera held — exit AR outright
  // (re-entering is one tap, and a stale sensor/camera session isn't worth it)
  ar.vis = function () { if (document.hidden) _arExit(); };
  document.addEventListener('visibilitychange', ar.vis, true);
  if (vr) {
    var vbtn = document.getElementById('v3d-vr-btn');
    if (vbtn) { vbtn.textContent = '🥽 Exit VR'; vbtn.style.borderColor = '#ffcc00'; vbtn.style.color = '#ffcc00'; }
  } else {
    var btn = document.getElementById('v3d-ar-btn');
    if (btn) { btn.textContent = '📷 Exit AR'; btn.style.borderColor = '#ffcc00'; btn.style.color = '#ffcc00'; }
  }
  _arHint(stream
    ? 'Point the phone toward a storm — cells are drawn at their real compass bearings over the camera view. Drag sideways if the compass looks off · pinch to zoom · tap a cell for details.'
    : (vr
      ? 'VR — move the phone to look around: sky, sun/moon, terrain, buildings and storms are all live at their real bearings. Drag sideways to trim · pinch to zoom · HEIGHT sets your eye altitude.'
      : 'Move the phone to look around the virtual sky. Drag sideways to trim the heading · pinch to zoom.'), 9000,
    stream ? 'ar-intro' : (vr ? 'vr-intro' : 'ghost-intro'));
}


// v6.98: swap from virtual sky to camera passthrough. Runs once per AR
// session — when the terrain table finishes (or fails, or the 15 s failsafe
// fires) — so the ground is already in place when the real world appears.
function _arReveal() {
  var ar = V3D.ar;
  if (!ar.active || ar.revealed || (!ar.stream && !ar.vr)) return;
  ar.revealed = true;
  if (ar.revealTimer) { clearTimeout(ar.revealTimer); ar.revealTimer = null; }
  if (ar.progress) { try { ar.progress.remove(); } catch (e) {} ar.progress = null; }
  if (!ar.stream) return;   // v7.05 VR: no passthrough — sky and clear color stay
  var container = document.getElementById('view3d-container');
  var cv = document.getElementById('view3d-canvas');
  if (container) {
    var v = document.createElement('video');
    v.setAttribute('playsinline', ''); v.muted = true; v.autoplay = true;
    v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;background:#000';
    v.srcObject = ar.stream;
    container.insertBefore(v, cv || null);   // same z-index, earlier in DOM → behind the canvas
    var p = v.play(); if (p && p.catch) p.catch(function () {});
    ar.video = v;
    var fadeEl = document.createElement('div');
    fadeEl.id = 'v3d-ar-fade';
    fadeEl.style.cssText = 'position:absolute;left:0;right:0;top:-100%;height:300%;z-index:0;pointer-events:none;will-change:transform;' +
      'background:linear-gradient(to bottom,rgba(5,10,20,0) 44%,rgba(5,10,20,0.55) 50%,rgba(5,10,20,0.94) 56%,rgba(5,10,20,0.96) 100%)';
    container.insertBefore(fadeEl, cv || null);   // above the video, below the canvas
    ar.fade = fadeEl;
  }
  // hide everything that would paint over the real world; cells, labels,
  // cones, rings, cardinal markers and the sun/moon stay — they ARE the overlay
  if (V3D.skyDome) V3D.skyDome.visible = false;
  if (V3D.groundMesh) V3D.groundMesh.visible = false;
  if (V3D.terrainMesh) V3D.terrainMesh.visible = false;
  V3D.renderer.setClearColor(0x000000, 0);
}
function _arExit() {
  var ar = V3D.ar;
  if (!ar.active) return;
  ar.active = false;
  if (ar.stream) { ar.stream.getTracks().forEach(function (t) { t.stop(); }); ar.stream = null; }
  if (ar.video) { try { ar.video.srcObject = null; ar.video.remove(); } catch (e) {} ar.video = null; }
  if (ar.fade) { try { ar.fade.remove(); } catch (e) {} ar.fade = null; }
  var altGrp = document.getElementById('v3d-alt-grp');
  if (altGrp) altGrp.style.display = 'none';
  _arDisposeGround();
  if (ar.handler) {
    window.removeEventListener('deviceorientation', ar.handler, true);
    window.removeEventListener('deviceorientationabsolute', ar.handler, true);
    ar.handler = null;
  }
  var dom = V3D.renderer && V3D.renderer.domElement;
  if (dom) {
    if (ar.ts) dom.removeEventListener('touchstart', ar.ts, true);
    if (ar.tm) dom.removeEventListener('touchmove', ar.tm, true);
    if (ar.te) dom.removeEventListener('touchend', ar.te, true);
    dom.style.touchAction = ar.prevTouchAction || '';
  }
  ar.ts = ar.tm = ar.te = null; ar.evt = null;
  if (ar.vtrack) { if (ar.trackEnd) ar.vtrack.removeEventListener('ended', ar.trackEnd); ar.vtrack = null; ar.trackEnd = null; }
  if (ar.sensorTimer) { clearTimeout(ar.sensorTimer); ar.sensorTimer = null; }
  ar.noSensor = false; ar.pending = false; ar.revealed = false; ar.groundPending = false; ar.vr = false;
  if (ar.revealTimer) { clearTimeout(ar.revealTimer); ar.revealTimer = null; }
  if (ar.progress) { try { ar.progress.remove(); } catch (e) {} ar.progress = null; }
  if (ar.prevFov != null) { _setFov(ar.prevFov); ar.prevFov = null; }
  if (ar.vis) { document.removeEventListener('visibilitychange', ar.vis, true); ar.vis = null; }
  if (V3D.skyDome) V3D.skyDome.visible = true;
  if (V3D.groundMesh) V3D.groundMesh.visible = true;
  if (V3D.terrainMesh) V3D.terrainMesh.visible = true;
  if (V3D.renderer) V3D.renderer.setClearColor(0x050a14, 1);
  if (ar.hint) { try { ar.hint.remove(); } catch (e) {} ar.hint = null; }
  if (ar.hintTimer) { clearTimeout(ar.hintTimer); ar.hintTimer = null; }
  var btn = document.getElementById('v3d-ar-btn');
  if (btn) { btn.textContent = '📷 AR'; btn.style.borderColor = ''; btn.style.color = ''; }
  var vbtn = document.getElementById('v3d-vr-btn');
  if (vbtn) { vbtn.textContent = '🥽 VR'; vbtn.style.borderColor = ''; vbtn.style.color = ''; }
  if (V3D.controls) V3D.controls.enabled = true;
  _setCamMode('fixed');            // clean re-sync of camera/target/handlers
}

// scratch objects — loop3D calls this every frame, so no per-frame allocation
var _AR_EUL = null, _AR_Q0 = null, _AR_QS = null, _AR_FWD = null, _AR_ZEE = null, _AR_UP = null, _AR_DTOP = null;
function _arApplyOrientation() {
  var ar = V3D.ar, e = ar.evt;
  var aY = (ar.altM || 100) * 0.001;             // v7.04: preset eye altitude, km units
  if (!e || e.a == null || e.b == null || e.g == null) {
    if (ar.noSensor && _AR_UP) {
      // no motion sensors at all (desktop): drag-to-look, level pitch
      V3D.camera.quaternion.setFromAxisAngle(_AR_UP, -ar.trim * Math.PI / 180);
      V3D.camera.position.set(0, aY, 0);
      _AR_FWD.set(0, 0, -1).applyQuaternion(V3D.camera.quaternion);
      V3D.controls.target.set(_AR_FWD.x * 0.05, aY + _AR_FWD.y * 0.05, _AR_FWD.z * 0.05);
      _arPlaceFade(_AR_FWD.y);
    } else if (ar.noSensor && !_AR_UP) {
      _AR_UP = new THREE.Vector3(0, 1, 0); _AR_FWD = new THREE.Vector3();
    }
    return;  // otherwise hold last pose until sensors speak
  }
  if (!_AR_EUL) {
    _AR_EUL = new THREE.Euler(); _AR_QS = new THREE.Quaternion();
    _AR_Q0 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));  // -90° about X: device flat → camera out the back
    _AR_FWD = new THREE.Vector3(); _AR_ZEE = new THREE.Vector3(0, 0, 1); _AR_UP = new THREE.Vector3(0, 1, 0);
  }
  var D2R = Math.PI / 180;
  var scr = (screen.orientation && screen.orientation.angle != null) ? screen.orientation.angle : (window.orientation || 0);
  var q = V3D.camera.quaternion;
  _AR_EUL.set(e.b * D2R, e.a * D2R, -e.g * D2R, 'YXZ');   // the W3C deviceorientation frame
  q.setFromEuler(_AR_EUL);
  q.multiply(_AR_Q0);
  q.multiply(_AR_QS.setFromAxisAngle(_AR_ZEE, -scr * D2R)); // undo screen rotation
  // device TOP in Y-up world: the camera frame coincides with the device frame
  // in portrait, and the scr correction re-rolled the camera relative to the
  // device — so the device top is the SCREEN-frame up rotated back by scr,
  // pushed through the finished pose. (Computing this from the raw W3C euler
  // instead lands in the wrong frame and reads upright portrait as sideways.)
  if (!_AR_DTOP) _AR_DTOP = new THREE.Vector3();
  var scrR = scr * D2R;
  _AR_DTOP.set(-Math.sin(scrR), Math.cos(scrR), 0).applyQuaternion(q);
  // ── v7.02: yaw first, then pitch (owner-prescribed) ──
  // The raw quaternion above is only a MEASUREMENT now — it is never rendered.
  // Extract where the camera actually faces: yaw about world-Y from the
  // forward's horizontal projection, then pitch from its rise. Near straight
  // up/down that projection collapses and the sensor euler stream turns
  // treacherous (paired alpha/gamma ±180 flips that preserve forward but spin
  // the frame, and transient one-axis-flipped samples that reverse it), so
  // the yaw HOLDS its last trusted value whenever the projection is too short
  // to believe (|pitch| ≳ 81°), and roll is discarded entirely. The pose is
  // then REBUILT as Qy(yaw)·Qx(pitch), so no representation artifact can
  // rotate the camera toward a direction it isn't physically facing.
  _AR_FWD.set(0, 0, -1).applyQuaternion(q);
  var R2D = 180 / Math.PI;
  var fhm = Math.sqrt(_AR_FWD.x * _AR_FWD.x + _AR_FWD.z * _AR_FWD.z);
  var fwdPitch = Math.atan2(_AR_FWD.y, fhm) * R2D;      // ±90, never wraps
  if (fhm >= 0.15 || ar.yawRaw == null)
    ar.yawRaw = Math.atan2(_AR_FWD.x, -_AR_FWD.z) * R2D;
  var rawHdg = (ar.yawRaw % 360 + 360) % 360;
  // servo the yaw so scene-north (-z, TRUE north per geoToScene3D) tracks the
  // real compass: raw alpha has an arbitrary zero on iOS, so compare the pose's
  // own heading against the absolute compass and converge slowly (no snapping).
  // Servo gating (v6.96):
  // - Android absolute events carry an earth-referenced alpha, so the pose
  //   quaternion is ALREADY absolute — servoing it against a device-top heading
  //   would steer it wrong in any non-portrait pose. Servo off; trim remains.
  // - webkitCompassHeading is referenced to the device TOP in portrait; in
  //   landscape it is ~90° off the view azimuth, and near the zenith/nadir its
  //   horizontal projection degenerates and can flip. Servo only in portrait
  //   with the view within ±55° of level; otherwise hold the converged yawFix.
  var servoOK = ar.compass != null && !ar.hasAbs && Math.abs(fwdPitch) < 55;
  if (servoOK) {
    // physical-attitude gate (v7.00): the compass reference follows the device
    // TOP, so it equals the view azimuth only while the top LEANS TOWARD the
    // view. What matters is the direction of the lean, not how vertical the
    // top is — v6.97's near-zenith test left a hole: tilt UP past vertical and
    // the top swings BEHIND you while still near the zenith, the compass reads
    // the reciprocal (view ±180°), and the servo slewed the whole scene around
    // (owner report: flips at 40–60° up; down was always fine, because tilting
    // down leans the top toward the view). Rule: freeze unless the top's
    // horizontal lean points with the view — which also freezes any sideways
    // hold (lean ⟂ view), portrait-locked or not. A dead-vertical top (lean
    // magnitude < ~5°) is measurement noise, not a lean: keep the servo, since
    // that is the normal upright hold where the compass is well-behaved.
    var hm = Math.sqrt(_AR_DTOP.x * _AR_DTOP.x + _AR_DTOP.z * _AR_DTOP.z);
    if (hm >= 0.08) {
      var fm = fhm || 1;
      if ((_AR_DTOP.x * _AR_FWD.x + _AR_DTOP.z * _AR_FWD.z) / (hm * fm) < 0.5) servoOK = false;
    }
  }
  if (servoOK) {
    var diff = ((ar.compass - (rawHdg + ar.yawFix) + 540) % 360) - 180;
    ar.yawFix += diff * 0.04;
  }
  // rebuild: heading = extracted yaw + compass servo + drag trim, applied about
  // world-Y FIRST, then the (clamped) pitch about the camera's own X. Roll = 0.
  var pc = Math.max(-89, Math.min(89, fwdPitch));
  _AR_EUL.set(pc * D2R, -(ar.yawRaw + ar.yawFix + ar.trim) * D2R, 0, 'YXZ');
  q.setFromEuler(_AR_EUL);
  V3D.camera.position.set(0, aY, 0);
  // keep controls.target just ahead so the compass tape (which reads target),
  // the raycaster and the sprite distance-scaling all keep working untouched
  _AR_FWD.set(0, 0, -1).applyQuaternion(q);
  V3D.controls.target.set(_AR_FWD.x * 0.05, aY + _AR_FWD.y * 0.05, _AR_FWD.z * 0.05);
  _arPlaceFade(_AR_FWD.y);
}

// v6.96: slide the horizon fade so its midpoint tracks where level (pitch 0)
// projects on screen. Clamped so extreme pitches park the fade off-screen
// (all-video looking up, all-dark looking down) instead of inverting.
function _arPlaceFade(fwdY) {
  var ar = V3D.ar;
  if (!ar.fade || !V3D.renderer) return;
  var H = V3D.renderer.domElement.clientHeight || 1;
  var pitch = Math.asin(Math.max(-1, Math.min(1, fwdY)));
  var halfTan = Math.tan((V3D._fov || 64) * Math.PI / 360);
  var yH = H / 2 * (1 + Math.tan(pitch) / halfTan);
  yH = Math.max(-H, Math.min(2 * H, yH));
  // fade element spans -H..+2H with its gradient midpoint at its centre (H/2
  // into the container when untranslated) → translate by (yH − H/2)
  var ty = Math.round(yH - H / 2);
  if (ty !== ar._fadeTy) { ar._fadeTy = ty; ar.fade.style.transform = 'translateY(' + ty + 'px)'; }
}


// ═══ v6.96: AR local terrain — a real-elevation ground table around the user ═══
// Pattern borrowed from Visual-Sensor-Studio's terrain module (terrarium tiles
// at a fixed zoom, a small aligned tile window, hole-tolerant assembly, datum-
// relative heights): a ~6-mile-radius patch centred on the user, elevations
// from AWS terrarium z=12 (~30 m, SRTM's native resolution) and the current
// basemap as its texture, rendered as a semi-transparent tactical table below
// the horizon fade. Uses S.lat/S.lon, so it follows GPS or a typed location.
var _AR_GROUND_GEN = 0;
// v7.08: the finished ground + buildings are KEPT across AR/VR exits (hidden,
// out of the scene) and reused on the next entry at the same spot — no second
// download, no loading bar, instant reveal. Leaving mid-build cancels every
// in-flight tile so the radar scan and winds-aloft fetch get the link back.
V3D._arCache = null;          // { key, ground, bldg, elevAt, datum }
function _arCacheKey() { return (S.lat != null) ? (S.lat.toFixed(4) + ',' + S.lon.toFixed(4)) : null; }
function _arCacheHit() { return !!(V3D._arCache && V3D._arCache.key && V3D._arCache.key === _arCacheKey()); }
function _arDisposeCache() {
  var c = V3D._arCache; V3D._arCache = null;
  if (!c) return;
  [c.ground, c.bldg].forEach(function (m) {
    if (!m) return;
    try {
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
    } catch (e) {}
  });
}
function _arBuildGround() {
  var ar = V3D.ar;
  if (!ar.active || (!ar.stream && !ar.vr) || ar.ground || S.lat == null) return;
  var gen = ++_AR_GROUND_GEN;
  var lat = S.lat, lon = S.lon;
  var key = _arCacheKey();
  if (_arCacheHit()) {
    // reuse: same spot, ground already built this session
    var c = V3D._arCache;
    ar.ground = c.ground; ar.bldg = c.bldg || null;
    ar.groundKey = key; ar.groundElev = c.elevAt; ar.groundDatum = c.datum;
    ar.ground.visible = true; V3D.scene.add(ar.ground);
    if (ar.bldg) { ar.bldg.visible = true; V3D.scene.add(ar.bldg); }
    if (!ar.stream) {
      if (V3D.groundMesh) V3D.groundMesh.visible = false;
      if (V3D.terrainMesh) V3D.terrainMesh.visible = false;
    }
    _arReveal();
    if (!ar.bldg) _arBuildBuildings(gen, lat, lon, c.elevAt, c.datum);   // buildings never landed last time
    return;
  }
  if (V3D._arCache) _arDisposeCache();        // different location — the old one is dead weight
  ar.groundPending = true;
  ar.loads = [];
  S._netBusyUntil = Date.now() + 90000;       // our own tile burst — the net monitor must not blame the link
  var _done = 0, _total = 0;
  function _tick() {
    _done++;
    var f = document.getElementById('v3d-ar-prog-fill'), l = document.getElementById('v3d-ar-prog-label');
    var pct = Math.round(_done / Math.max(1, _total) * 100);
    if (f) f.style.width = pct + '%';
    if (l) l.textContent = 'Loading terrain — ' + pct + '%';
  }
  function tileXY(la, lo, z) {
    var scale = Math.pow(2, z), r = Math.max(-85.05, Math.min(85.05, la)) * Math.PI / 180;
    return { x: (lo + 180) / 360 * scale, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * scale };
  }
  function tileLatLon(x, y, z) {
    var scale = Math.pow(2, z), n = Math.PI - 2 * Math.PI * y / scale;
    return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon: x / scale * 360 - 180 };
  }
  // 5×5 basemap tiles at z=13 centred on the user (~21 km across at 30°N);
  // the covering terrarium window at z=12 is those bounds' parent tiles (≤3×3)
  // v6.98: 7×7 imagery tiles at z=13 (~30 km across at 30°N — the requested
  // ~10-mile reach) with a per-tile loading bar; the camera reveal waits on us
  var ZT = 13, ZE = 12;
  var c13 = tileXY(lat, lon, ZT);
  var minX13 = Math.floor(c13.x) - 3, maxX13 = Math.floor(c13.x) + 3;
  var minY13 = Math.floor(c13.y) - 3, maxY13 = Math.floor(c13.y) + 3;
  var nw = tileLatLon(minX13, minY13, ZT), se = tileLatLon(maxX13 + 1, maxY13 + 1, ZT);
  var minX12 = Math.floor(minX13 / 2), maxX12 = Math.floor(maxX13 / 2);
  var minY12 = Math.floor(minY13 / 2), maxY12 = Math.floor(maxY13 / 2);
  var exW = (maxX12 - minX12 + 1), exH = (maxY12 - minY12 + 1);
  var ecv = document.createElement('canvas'); ecv.width = exW * 256; ecv.height = exH * 256;
  var ectx = ecv.getContext('2d', { willReadFrequently: true });
  var tcv = document.createElement('canvas'); tcv.width = 7 * 256; tcv.height = 7 * 256;
  var tctx = tcv.getContext('2d');
  tctx.fillStyle = '#1a2318'; tctx.fillRect(0, 0, tcv.width, tcv.height);
  var jobs = [];
  for (var ey = minY12; ey <= maxY12; ey++) for (var ex = minX12; ex <= maxX12; ex++) (function (ex, ey) {
    jobs.push(loadImgCors3D('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + ZE + '/' + ex + '/' + ey + '.png', ar.loads)
      .then(function (img) { if (img) ectx.drawImage(img, (ex - minX12) * 256, (ey - minY12) * 256); _tick(); }));
  })(ex, ey);
  for (var ty = minY13; ty <= maxY13; ty++) for (var tx = minX13; tx <= maxX13; tx++) (function (tx, ty) {
    var sat = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + ZT + '/' + ty + '/' + tx;
    jobs.push(loadImgCors3D(sat, ar.loads).then(function (img) {
      if (img) { tctx.drawImage(img, (tx - minX13) * 256, (ty - minY13) * 256); _tick(); return; }
      if (gen !== _AR_GROUND_GEN) { _tick(); return; }   // cancelled — don't start the fallback fetch
      var url = (typeof basemapTileUrl === 'function') ? basemapTileUrl(ZT, tx, ty) : '';
      if (!url) { _tick(); return; }
      return loadImgCors3D(url, ar.loads).then(function (img2) { if (img2) tctx.drawImage(img2, (tx - minX13) * 256, (ty - minY13) * 256); _tick(); });
    }));
  })(tx, ty);
  _total = jobs.length;
  Promise.all(jobs).then(function () {
    S._netBusyUntil = Date.now() + 8000;      // short grace, same as the radar scan's tail
    if (gen !== _AR_GROUND_GEN || !ar.active || (!ar.stream && !ar.vr)) return;   // AR/VR exited or re-entered meanwhile
    ar.groundPending = false;
    var ed;
    try { ed = ectx.getImageData(0, 0, ecv.width, ecv.height).data; } catch (e) { _arReveal(); return; }
    function elevAt(la, lo) {
      var t = tileXY(la, lo, ZE);
      var px = Math.round((t.x - minX12) * 256), py = Math.round((t.y - minY12) * 256);
      px = Math.max(0, Math.min(ecv.width - 1, px)); py = Math.max(0, Math.min(ecv.height - 1, py));
      var i = (py * ecv.width + px) * 4;
      if (ed[i] === 0 && ed[i + 1] === 0 && ed[i + 2] === 0) return null;   // hole (failed/ocean tile)
      return ed[i] * 256 + ed[i + 1] + ed[i + 2] / 256 - 32768;
    }
    var datum = elevAt(lat, lon); if (datum == null) datum = 0;
    var nwS = geoToScene3D(nw.lat, nw.lon), seS = geoToScene3D(se.lat, se.lon);
    var plW = seS.x - nwS.x, plD = seS.z - nwS.z;
    var SEG = 127;
    var geo = new THREE.PlaneGeometry(plW, plD, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var fx = (pos.getX(i) - (-plW / 2)) / plW, fz = (pos.getZ(i) - (-plD / 2)) / plD;
      var la = nw.lat + (se.lat - nw.lat) * fz, lo = nw.lon + (se.lon - nw.lon) * fx;
      var el = elevAt(la, lo);
      pos.setY(i, el == null ? 0 : Math.max(-0.5, Math.min(8, (el - datum) * 0.001)));
    }
    geo.computeVertexNormals();
    var nrm = geo.attributes.normal;
    var cols = new Float32Array(pos.count * 3);
    var sx = -0.45, sy = 0.78, sz = -0.35, sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    sx /= sl; sy /= sl; sz /= sl;
    for (var ci = 0; ci < pos.count; ci++) {
      var d = Math.max(0, nrm.getX(ci) * sx + nrm.getY(ci) * sy + nrm.getZ(ci) * sz);
      var b = 0.72 + 0.28 * d;
      cols[ci * 3] = b; cols[ci * 3 + 1] = b; cols[ci * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    var tex = new THREE.CanvasTexture(tcv);
    // v6.97: OPAQUE — the 55%-alpha table read as glass with the camera feed
    // bleeding through it. Real ground occludes; depthWrite on so hills can
    // also occlude storm geometry behind them.
    var mat = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, depthWrite: true });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((nwS.x + seS.x) / 2, 0, (nwS.z + seS.z) / 2);
    mesh.renderOrder = -1;                     // under the storm cells/halos
    if (gen !== _AR_GROUND_GEN || !ar.active) { geo.dispose(); mat.dispose(); tex.dispose(); return; }
    ar.ground = mesh; ar.groundKey = key; ar.groundElev = elevAt; ar.groundDatum = datum;
    V3D.scene.add(mesh);
    if (!ar.stream) {
      // VR: the real terrain table replaces the flat stand-in ground outright
      // (done here, not in _arReveal, so a post-failsafe arrival still swaps)
      if (V3D.groundMesh) V3D.groundMesh.visible = false;
      if (V3D.terrainMesh) V3D.terrainMesh.visible = false;
    }
    _arReveal();                                // ground is in — bring the real world up under it
    _arBuildBuildings(gen, lat, lon, elevAt, datum);   // v7.03: OSM buildings pop in when ready
  });
}
// v7.08: on exit the ground is RELEASED, not destroyed — in-flight downloads are
// cancelled, and a finished ground (+ buildings) is parked in V3D._arCache for
// the next entry. Real disposal happens only when the location changes.
function _arDisposeGround() {
  _AR_GROUND_GEN++;                            // invalidate any in-flight build
  var ar = V3D.ar;
  _cancelLoads3D(ar.loads); ar.loads = null;   // abort every pending tile — give the link back
  if (ar.bldgAbort) { try { ar.bldgAbort.abort(); } catch (e) {} ar.bldgAbort = null; }
  ar.groundPending = false;
  if (!ar.ground) return;
  try {
    V3D.scene.remove(ar.ground); ar.ground.visible = false;
    if (ar.bldg) { V3D.scene.remove(ar.bldg); ar.bldg.visible = false; }
  } catch (e) {}
  V3D._arCache = { key: ar.groundKey, ground: ar.ground, bldg: ar.bldg || null, elevAt: ar.groundElev, datum: ar.groundDatum };
  ar.ground = null; ar.bldg = null; ar.groundKey = null; ar.groundElev = null;
}

// ═══ v7.03: OSM buildings — real footprints and heights on the AR ground ═══
// OpenStreetMap building outlines from the free, keyless Overpass API,
// extruded at TRUE scale (same 1 unit = 1 km frame as everything else):
// height comes from the mapped `height` tag, else `building:levels` ×
// storey height, else a one-storey default. A ~2.5 km-radius box keeps the
// download small while filling the AR foreground where buildings actually
// read; footprints sit on the terrain via the same elevation sampler and
// datum the ground mesh used, sunk slightly so slopes never leave them
// floating. Baked hillshade (same sun as the terrain) + a per-building
// brightness hash so blocks don't render as one uniform slab.
var _BLDG_CACHE = null;         // { key, ways } — re-entering AR at the same spot skips the refetch
function _bldgHeightM(tags) {
  if (tags) {
    var h = parseFloat(tags.height);
    if (isFinite(h) && h > 0) return Math.min(h, 350);
    var lv = parseFloat(tags['building:levels']);
    if (isFinite(lv) && lv > 0) return Math.min(lv, 100) * 3.2 + 1.5;
  }
  return 5;                     // most untagged OSM buildings are single-storey houses
}
function _arBuildBuildings(gen, lat, lon, elevAt, datum) {
  if (typeof fetch !== 'function' || typeof THREE === 'undefined' || !THREE.ExtrudeGeometry) return;
  var key = lat.toFixed(3) + ',' + lon.toFixed(3);
  if (_BLDG_CACHE && _BLDG_CACHE.key === key) { _arBldgFromWays(_BLDG_CACHE.ways, gen, elevAt, datum); return; }
  var dLa = 2.5 / 111.32, dLo = 2.5 / (111.32 * Math.cos(lat * Math.PI / 180));
  var q = '[out:json][timeout:25];way["building"]('
    + (lat - dLa).toFixed(5) + ',' + (lon - dLo).toFixed(5) + ','
    + (lat + dLa).toFixed(5) + ',' + (lon + dLo).toFixed(5) + ');out geom 4000;';
  var urls = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  var ar = V3D.ar;
  (function attempt(i) {
    if (i >= urls.length || gen !== _AR_GROUND_GEN) return;   // mirrors down, or AR/VR already left
    // v7.08: abortable + 30 s cap — leaving AR/VR must not leave a multi-MB
    // building download running against the radar scan
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    ar.bldgAbort = ctrl;
    var tmo = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 30000) : null;
    S._netBusyUntil = Date.now() + 30000;
    fetch(urls[i], { method: 'POST', body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        if (tmo) clearTimeout(tmo);
        if (ar.bldgAbort === ctrl) ar.bldgAbort = null;
        S._netBusyUntil = Date.now() + 8000;
        var ways = (j && j.elements) ? j.elements : [];
        _BLDG_CACHE = { key: key, ways: ways };
        _arBldgFromWays(ways, gen, elevAt, datum);
      })
      .catch(function () {
        if (tmo) clearTimeout(tmo);
        if (ar.bldgAbort === ctrl) ar.bldgAbort = null;
        S._netBusyUntil = Date.now() + 8000;
        if (ctrl && ctrl.signal.aborted && gen !== _AR_GROUND_GEN) return;   // we cancelled it — stop
        attempt(i + 1);
      });
  })(0);
}
function _arBldgFromWays(ways, gen, elevAt, datum) {
  var ar = V3D.ar;
  if (gen !== _AR_GROUND_GEN || !ar.active || ar.bldg || !ways.length) return;
  if (!THREE.BufferGeometryUtils || !THREE.BufferGeometryUtils.mergeBufferGeometries) return;
  var sunx = -0.45, suny = 0.78, sunz = -0.35;
  var sl = Math.sqrt(sunx * sunx + suny * suny + sunz * sunz);
  sunx /= sl; suny /= sl; sunz /= sl;
  var geos = [];
  for (var w = 0; w < ways.length && geos.length < 2500; w++) {
    var gm = ways[w].geometry;
    if (!gm || gm.length < 4) continue;
    try {
      var pts = [], cla = 0, clo = 0, n = gm.length - 1;   // drop the closing repeat node
      for (var p = 0; p < n; p++) {
        var sp = geoToScene3D(gm[p].lat, gm[p].lon);
        pts.push(new THREE.Vector2(sp.x, -sp.z));          // rotateX(-90°) maps shape (x,y) → world (x,·,-y)
        cla += gm[p].lat; clo += gm[p].lon;
      }
      if (pts.length < 3) continue;
      if (THREE.ShapeUtils.area(pts) < 0) pts.reverse();   // OSM winding varies; CCW keeps wall normals outward
      var hgt = _bldgHeightM(ways[w].tags) * 0.001;
      var eg = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: hgt, bevelEnabled: false });
      eg.rotateX(-Math.PI / 2);
      var el = elevAt ? elevAt(cla / n, clo / n) : null;
      var base = (el == null ? 0 : Math.max(-0.5, Math.min(8, (el - datum) * 0.001))) - 0.002;
      eg.translate(0, base, 0);
      var epos = eg.attributes.position, enrm = eg.attributes.normal;
      var cols = new Float32Array(epos.count * 3);
      var vary = 0.9 + (((w * 2654435761) >>> 0) % 97) / 97 * 0.18;   // per-building brightness hash
      for (var vi = 0; vi < epos.count; vi++) {
        var b;
        if (enrm.getY(vi) > 0.7) b = 0.88;                            // roof: flat light gray
        else b = 0.5 + 0.38 * Math.max(0, enrm.getX(vi) * sunx + enrm.getY(vi) * suny + enrm.getZ(vi) * sunz);
        b *= vary;
        cols[vi * 3] = b * 0.95; cols[vi * 3 + 1] = b * 0.94; cols[vi * 3 + 2] = b * 0.92;
      }
      eg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      if (eg.attributes.uv) eg.deleteAttribute('uv');                 // unused; keeps merge attribute sets identical
      geos.push(eg);
    } catch (e) {}                                                    // one bad footprint never sinks the batch
  }
  if (!geos.length) return;
  var merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geos);
  geos.forEach(function (g2) { g2.dispose(); });
  if (!merged) return;
  var mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: true }));
  mesh.renderOrder = -1;                       // with the ground, under the storm cells/halos
  if (gen !== _AR_GROUND_GEN || !ar.active || ar.bldg) { merged.dispose(); mesh.material.dispose(); return; }
  ar.bldg = mesh;
  V3D.scene.add(mesh);
}

// v7.07: centered popup with an OK button (no more waiting out the fade), and
// — when dismissKey is given — a "don't show again" checkbox remembered in
// localStorage. Errors and warnings pass no key, so they can never be muted.
function _arHint(html, ms, dismissKey) {
  var ar = V3D.ar;
  if (dismissKey) { try { if (localStorage.getItem('v3d_hint_off_' + dismissKey)) return; } catch (e) {} }
  var container = document.getElementById('view3d-container');
  if (!container) return;
  if (ar.hint) { try { ar.hint.remove(); } catch (e) {} ar.hint = null; }
  if (ar.hintTimer) { clearTimeout(ar.hintTimer); ar.hintTimer = null; }
  var el = document.createElement('div');
  el.id = 'v3d-ar-hint';
  el.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) translateZ(0);z-index:30;width:min(340px,84%);background:rgba(5,10,20,0.92);backdrop-filter:blur(10px);border:1px solid rgba(255,204,0,0.35);border-radius:12px;padding:12px 14px;font-size:11px;line-height:1.5;color:#e8eef8;pointer-events:auto;transition:opacity .4s';
  el.innerHTML = '<div>' + html + '</div>'
    + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px">'
    + (dismissKey
      ? '<label style="display:flex;align-items:center;gap:5px;font-size:10px;color:rgba(255,255,255,0.55);cursor:pointer;user-select:none"><input type="checkbox" id="v3d-hint-chk" style="accent-color:#ffcc00;width:13px;height:13px;margin:0">Don’t show again</label>'
      : '<span></span>')
    + '<button id="v3d-hint-ok" style="background:rgba(255,204,0,0.12);border:1px solid rgba(255,204,0,0.4);border-radius:7px;color:#ffcc00;font-size:11px;font-weight:600;padding:4px 18px;cursor:pointer;font-family:inherit">OK</button></div>';
  container.appendChild(el);
  ar.hint = el;
  var close = function () {
    if (dismissKey) {
      var chk = el.querySelector('#v3d-hint-chk');
      if (chk && chk.checked) { try { localStorage.setItem('v3d_hint_off_' + dismissKey, '1'); } catch (e) {} }
    }
    if (ar.hintTimer) { clearTimeout(ar.hintTimer); ar.hintTimer = null; }
    if (ar.hint === el) ar.hint = null;
    el.style.opacity = '0';
    setTimeout(function () { try { el.remove(); } catch (e) {} }, 450);
  };
  var ok = el.querySelector('#v3d-hint-ok');
  if (ok) ok.addEventListener('click', close);
  // dismissable intros stay up longer so there's time to reach the checkbox;
  // the OK button is the fast path either way
  ar.hintTimer = setTimeout(close, ms || 5000);
}

function deactivate3DView() {
  // leaving the tab must release the camera (kills the OS recording indicator)
  // and the orientation listener — unlike the gauges compass, AR really stops.
  try { if (V3D.ar && V3D.ar.active) _arExit(); } catch (e) {}
  V3D.active = false;
  if (V3D._markerRAF) { cancelAnimationFrame(V3D._markerRAF); V3D._markerRAF = null; }
  if (V3D._etaInterval) { clearInterval(V3D._etaInterval); V3D._etaInterval = null; }
  V3D._lightningCells = [];
  V3D._lightningFlashes = [];
  var popup = document.getElementById('v3d-popup');
  if (popup) popup.style.display = 'none';
}
