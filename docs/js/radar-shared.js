// =====================================================
// StormTracker — radar-shared.js
// Phase 1 consolidation: the ONE pure, framework-free module that both the
// browser app (docs/js/*) and the Node scanner (scanner/detect.js) derive from,
// so radar pixel→dBZ decoding, the master reflectivity palette, geo math and
// tile math are defined exactly once.
//
// Loads FIRST in index.html (before core.js) as a plain global-scope <script
// defer> — every symbol below becomes a global the rest of docs/js can use by
// name. It ALSO exports the same symbols for CommonJS (Node) via the guarded
// module.exports at the bottom, WITHOUT breaking its validity as a browser
// script. Do NOT add DOM / localStorage / window access here: this file must
// stay pure so it runs identically in the browser and under Node.
// =====================================================

// ---------------------------------------------------------------------------
// Geo math (miles). haversine returns great-circle distance in MILES (R=3959);
// bearingDeg returns initial bearing 0–360°; degToDir maps a heading to a
// 16-point compass abbreviation.
// ---------------------------------------------------------------------------
function haversine(lat1,lon1,lat2,lon2){const R=3959,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function bearingDeg(lat1,lon1,lat2,lon2){const dLon=(lon2-lon1)*Math.PI/180;const y=Math.sin(dLon)*Math.cos(lat2*Math.PI/180);const x=Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180)-Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos(dLon);return((Math.atan2(y,x)*180/Math.PI)+360)%360}
function degToDir(d){const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];return dirs[Math.round(d/22.5)%16]}

// ---------------------------------------------------------------------------
// Web-Mercator tile math (Slippy map). lon/lat → integer tile X/Y at zoom z.
// ---------------------------------------------------------------------------
function lonToTileX(lon,z){return Math.floor((lon+180)/360*Math.pow(2,z))}
function latToTileY(lat,z){const r=lat*Math.PI/180;return Math.floor((1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*Math.pow(2,z))}

// Master radar reflectivity palette — drives radar tiles, sonar, storm cells,
// 3D view, legend and AI [!dbz] tags. Stepped in 5 dBZ increments. Within each
// color family it goes light→deep (so deeper = stronger); the hue only shifts at
// a band boundary: blue (≤20) → green → yellow → orange → red → magenta → pink
// (extreme). Colors are kept vivid (never near-black) because radar tiles draw at
// low opacity and very dark shades turn muddy/gray on the map.
const DBZ_SCALE=[
  {min:0,  color:'#004488',label:'Below threshold',         cls:'trace',    opacity:0.10},
  {min:5,  color:'#A8E5FF',label:'Sprinkles',               cls:'sprinkles',opacity:0.12},
  {min:15, color:'#7FC4FF',label:'Drizzle',                 cls:'drizzle',  opacity:0.16},
  {min:20, color:'#2E7BF0',label:'Light rain',              cls:'light',    opacity:0.22},
  {min:25, color:'#7BF06B',label:'Light–moderate rain',     cls:'light2',   opacity:0.26},
  {min:30, color:'#28D028',label:'Moderate rain',           cls:'moderate', opacity:0.30},
  {min:35, color:'#15A523',label:'Moderate–heavy rain',     cls:'moderate2',opacity:0.35},
  {min:40, color:'#FCE300',label:'Heavy rain',              cls:'heavy',    opacity:0.40},
  {min:45, color:'#FF9D00',label:'Very heavy rain',         cls:'intense',  opacity:0.46},
  {min:50, color:'#FF3B23',label:'Intense',                 cls:'mod-severe',opacity:0.52},
  {min:55, color:'#D11226',label:'Severe',                  cls:'severe',   opacity:0.56},
  {min:60, color:'#E81DE8',label:'Severe, hail possible',   cls:'severe2',  opacity:0.59},
  {min:65, color:'#FF8FE0',label:'Extreme, hail likely',    cls:'extreme',  opacity:0.62}
];

// ---------------------------------------------------------------------------
// Pixel → dBZ converters. pixelToDbz is a generic HSV-hue fallback; nexradToDbz
// / rvToDbz decode the two radar tile sources (IEM NEXRAD N0Q and RainViewer's
// Universal Blue scheme) to true reflectivity on the same dBZ scale.
// ---------------------------------------------------------------------------
function pixelToDbz(r,g,b,a){
  if(a<30)return 0;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
  if(d===0||d/mx<0.15)return 0;
  let h;
  if(mx===r)h=60*((g-b)/d%6);
  else if(mx===g)h=60*((b-r)/d+2);
  else h=60*((r-g)/d+4);
  if(h<0)h+=360;
  if(h>=170&&h<=250)return 15;
  if(h>=80&&h<170)return 25;
  if(h>=40&&h<80)return 35;
  if(h>=20&&h<40)return 45;
  if(h<20||h>=340)return 55;
  if(h>=250&&h<340)return 70;
  return 0;
}
const NEXRAD_PAL=[
  {dbz:5,r:100,g:210,b:230},{dbz:5,r:136,g:221,b:238},
  {dbz:10,r:54,g:186,b:229},{dbz:10,r:0,g:100,b:150},
  {dbz:15,r:0,g:160,b:230},{dbz:15,r:0,g:136,b:191},
  {dbz:15,r:0,g:145,b:202},{dbz:15,r:0,g:163,b:224},
  {dbz:20,r:0,g:127,b:180},{dbz:20,r:0,g:112,b:163},
  {dbz:20,r:0,g:215,b:130},{dbz:20,r:0,g:145,b:65},
  {dbz:25,r:0,g:78,b:120},{dbz:25,r:0,g:74,b:112},
  {dbz:25,r:0,g:81,b:128},{dbz:25,r:0,g:85,b:136},
  {dbz:25,r:0,g:110,b:33},{dbz:30,r:0,g:75,b:0},
  {dbz:35,r:255,g:255,b:33},{dbz:35,r:255,g:238,b:0},
  {dbz:42,r:255,g:115,b:0},
  {dbz:45,r:255,g:0,b:0},{dbz:55,r:150,g:0,b:0},
  {dbz:55,r:175,g:0,b:150},
  {dbz:60,r:230,g:100,b:230}
];
function nexradToDbz(r,g,b,a){
  if(a<30)return 0;
  if(r+g+b<40)return 0;
  if(r>220&&g>220&&b>220)return 0;
  let best=0,bestD=1e9;
  for(const p of NEXRAD_PAL){
    const d=(r-p.r)**2+(g-p.g)**2+(b-p.b)**2;
    if(d<bestD){bestD=d;best=p.dbz}
  }
  if(bestD>5000)return 0;
  return best;
}
const RV_UB=[
  {dbz:10,r:0xce,g:0xc0,b:0x87},{dbz:12,r:0xd6,g:0xc8,b:0x8f},
  {dbz:14,r:0xde,g:0xd0,b:0x97},{dbz:15,r:0x88,g:0xdd,b:0xee},
  {dbz:16,r:0x6c,g:0xd1,b:0xeb},{dbz:17,r:0x51,g:0xc5,b:0xe8},
  {dbz:18,r:0x36,g:0xba,b:0xe5},{dbz:19,r:0x1b,g:0xae,b:0xe2},
  {dbz:20,r:0x00,g:0xa3,b:0xe0},{dbz:22,r:0x00,g:0x91,b:0xca},
  {dbz:25,r:0x00,g:0x77,b:0xaa},{dbz:27,r:0x00,g:0x69,b:0x9c},
  {dbz:30,r:0x00,g:0x55,b:0x88},{dbz:32,r:0x00,g:0x4e,b:0x78},
  {dbz:34,r:0x00,g:0x47,b:0x68},{dbz:35,r:0xff,g:0xee,b:0x00},
  {dbz:37,r:0xff,g:0xd2,b:0x00},{dbz:39,r:0xff,g:0xb7,b:0x00},
  {dbz:40,r:0xff,g:0xaa,b:0x00},{dbz:42,r:0xff,g:0x95,b:0x00},
  {dbz:44,r:0xff,g:0x81,b:0x00},{dbz:45,r:0xff,g:0x44,b:0x00},
  {dbz:47,r:0xe6,g:0x28,b:0x00},{dbz:48,r:0xd9,g:0x1b,b:0x00},
  {dbz:50,r:0xc1,g:0x00,b:0x00},{dbz:52,r:0x8f,g:0x00,b:0x00},
  {dbz:54,r:0x5d,g:0x00,b:0x00},{dbz:55,r:0xff,g:0xaa,b:0xff},
  {dbz:57,r:0xff,g:0x95,b:0xff},{dbz:60,r:0xff,g:0x77,b:0xff},
  {dbz:63,r:0xff,g:0x58,b:0xff},{dbz:65,r:0xff,g:0xff,b:0xff},
  {dbz:10,r:0xbf,g:0xff,b:0xff},{dbz:15,r:0x9f,g:0xdf,b:0xff},
  {dbz:20,r:0x7f,g:0xbf,b:0xff},{dbz:25,r:0x5f,g:0x9f,b:0xff},
  {dbz:30,r:0x4f,g:0x8f,b:0xff},{dbz:35,r:0x3f,g:0x7f,b:0xff},
  {dbz:40,r:0x2f,g:0x6f,b:0xff},{dbz:45,r:0x1f,g:0x5f,b:0xff},
  {dbz:50,r:0x0f,g:0x4f,b:0xff},{dbz:55,r:0x00,g:0x3f,b:0xff}
];
function rvToDbz(r,g,b,a){
  if(a<20)return 0;
  let raw=0;
  if(r<10&&g>200&&b<10)raw=75;
  else if(r>240&&g>240&&b>240)raw=65;
  else if(r>200&&b>200&&g<r){
    raw=g>160?55:g>130?57:g>100?59:g>80?61:63;
  }
  else if(r>200&&g>60&&b<30){
    if(g>200)raw=35;else if(g>170)raw=37;else if(g>140)raw=39;
    else if(g>120)raw=40;else if(g>100)raw=42;else if(g>80)raw=44;
    else raw=45;
  }
  else if(r>80&&g<70&&b<30&&a>200){
    if(r>240)raw=45;else if(r>220)raw=47;else if(r>200)raw=48;
    else if(r>180)raw=50;else if(r>130)raw=52;else raw=54;
  }
  else if(b>150&&r<180&&g>150){
    if(r>120)raw=15;else if(g>200)raw=16;else if(g>180)raw=17;
    else raw=18;
  }
  else if(r<10&&g<180&&b>80){
    if(g>150)raw=20;else if(g>120)raw=22;else if(g>100)raw=25;
    else if(g>80)raw=28;else raw=30+Math.min(4,Math.floor((88-g)/10));
  }
  else if(a<150&&r>80&&g>70&&b>50&&r<230){
    raw=Math.min(14,Math.max(8,Math.round((a-20)/15)+8));
  }
  else if(b>200&&g>100&&r<150){
    if(g>200)raw=10;else if(g>160)raw=15;else if(g>100)raw=20;
    else raw=30;
  }
  else{
    let best=0,bestD=1e9;
    for(const p of RV_UB){
      const d=(r-p.r)**2+(g-p.g)**2+(b-p.b)**2;
      if(d<bestD){bestD=d;best=p.dbz}
    }
    raw=bestD<6000?best:0;
  }
  if(raw<=0)return 0;
  // v4.75: removed the legacy intensity "boost" multiplier (raw×1.10–1.29) that
  // pushed RainViewer dBZ up to ~15 dBZ above the NEXRAD scale (raw 50 read as
  // 65). The RV_UB palette + heuristic branches already decode the Universal
  // Blue scheme to true dBZ, so the raw value is returned directly so RainViewer
  // and NEXRAD report on the same scale. Clamp only to the 75 dBZ ceiling.
  return Math.min(75,raw);
}

// ---------------------------------------------------------------------------
// v6.56 shared thresholds — single source of truth for numbers BOTH the client
// and the scanner must agree on. These previously lived (and drifted) in
// per-side copies: the scanner's scan floor was still 15 after the client
// moved to 25 in v5.54, and the scanner sampled "overhead" at 2 mi while the
// client used 1.5 — together one cause of the false "rain now" push.
// ---------------------------------------------------------------------------
// App-wide rain/scan floor (dBZ). Rain DISPLAYS use the user setting
// getRainFloorDbz() (core.js), which defaults to this.
const STORM_MIN_DBZ=25;
// "Over you" radius (mi): a live echo within this of the user's spot counts as
// overhead — the same 1.5 the X-TRK direct tier and overhead poll use.
const OVERHEAD_MI=1.5;
// Below this storm speed (mph) motion is UNCERTAIN — never project ETAs or
// pass-durations from it. Same bar as the client's "motion uncertain" wording
// (storms.js mv.speed>=2). A 1-2 mph vector once stretched a clutter blob into
// "rain now, ends in an hour".
const MOTION_MIN_MPH=2;
// Clutter screen, 3 branches — the client's isClutterOnly (radar.js) hoisted
// here verbatim so the scanner can reject the same clutter scans the app hides.
function isClutterCells(cells){
  if(!cells||!cells.length)return false;
  const sig=cells.filter(s=>s.dbz>=31);
  if(sig.length>0)return false;
  const low=cells.filter(s=>s.dbz<22);
  if(low.length===cells.length&&cells.length<=12)return true;
  return cells.length<=8;
}

// Guarded CommonJS export — no-op in the browser (module is undefined), so the
// file stays a valid global-scope script. Node (scanner/detect.js via
// createRequire) picks up every shared symbol here.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    haversine, bearingDeg, degToDir,
    lonToTileX, latToTileY,
    DBZ_SCALE, pixelToDbz,
    NEXRAD_PAL, nexradToDbz,
    RV_UB, rvToDbz,
    STORM_MIN_DBZ, OVERHEAD_MI, MOTION_MIN_MPH, isClutterCells
  };
}
