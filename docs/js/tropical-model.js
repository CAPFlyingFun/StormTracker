// ═══════════════════════════════════════════════════════════════════════════
// ST MODEL — StormTracker's in-app tropical cyclone track model (v5.87)
//
// A BAM-style (Beta-and-Advection Model) steering forecast: the storm is
// advected by the deep-layer-mean environmental wind (Open-Meteo pressure-level
// forecast winds at 850/700/500/250 hPa, weighted by storm intensity — weak
// systems are steered by the low levels, majors by a deeper average) plus a
// small poleward/westward "beta drift" from the planetary-vorticity gradient.
// The first 18 h blend in the storm's OBSERVED motion (GDACS/NHC moveDir/
// moveSpeed) exactly the way operational BAMs are initialized, then hand over
// to the model steering. Integrated hourly out to 120 h; winds are re-fetched
// along the path whenever the storm moves ~120 mi from the last sample point,
// so the track follows the FORECAST flow at the storm's future place and time,
// not just today's winds at today's position.
//
// This is an EXPERIMENTAL in-app model — genuinely ours, honestly simple.
// It rides the same physics the old NHC BAM members used, but it is NOT a
// substitute for official forecasts. For any safety decision: NHC/JTWC cone.
//
// Rendering: drawSTModelTrack(storm, map) is called from plotNHCTracks() for
// the SELECTED storm only. Layers are pushed into S._nhcTrackLayers so the
// existing clear/redraw lifecycle owns them; S._nhcPlotGen guards against a
// stale async draw landing after the user re-plots or switches storms.
// ═══════════════════════════════════════════════════════════════════════════

(function(){
const _ST_LEVELS=[850,700,500,250];   // hPa steering levels fetched from Open-Meteo
const _ST_MAX_HR=120;                 // forecast horizon (h)
const _ST_REFETCH_MI=150;             // re-sample winds after this much track distance
const _ST_MAX_FETCH=10;               // soft cap on Open-Meteo calls per model run —
                                      // past it we keep integrating on the LAST
                                      // sample (time-correct, spatially stale)
                                      // rather than truncating the track
const _ST_BETA_MPH=2.2;               // beta-drift magnitude (~1 kt), NW-ward in NH
const _ST_BLEND_HR=18;                // hours over which observed motion fades into steering
const _ST_COLOR='#00D4FF';            // v5.89: neon blue (user-picked) — the amber
                                      // original vanished into the 50 kt rings + GDACS orange
// ── v5.89 intensity (SHIPS-lite) ── the same run now carries an estimated Vmax
// along the track: sea-surface temperature sets a potential-intensity ceiling,
// deep-layer shear (|250−850 hPa wind|) lowers it, land forces decay, and the
// storm relaxes toward that ceiling with realistic e-folding times. Honest
// roughness: intensity is MUCH harder than track — treat it as a trend line.
const _ST_POT=[[25,40],[26,75],[27,100],[28,125],[29,150],[30,170]]; // SST °C → max potential Vmax (mph)
const _ST_SHEAR_FREE=12;              // mph of deep shear a storm shrugs off
const _ST_SHEAR_COST=2.0;             // mph of ceiling lost per mph of excess shear
// v5.91: tuned DOWN after the model called "Cat 1 within 15 h" from a fresh TD
// (user: "wind speeds seem too high too quick" — correct; that was rapid
// intensification as the DEFAULT). Disorganized systems (<64 mph) now spin up
// slowly (real TDs take ~a day to close off a core), organized ones faster,
// and gain is hard-capped at +2 mph/h (~48 mph/day — still genuine RI, but as
// the ceiling, not the norm).
const _ST_K_UP_WEAK=0.012;            // /h toward ceiling while still organizing (<64 mph)
const _ST_K_UP_ORG=0.02;              // /h once an organized core exists (≥64 mph)
const _ST_RI_CAP=2.0;                 // max mph gained per hour
const _ST_K_DOWN=0.06;                // /h over-water decay when above ceiling
const _ST_K_LAND=0.08;                // /h inland decay (Kaplan–DeMaria-ish) toward 27 mph
const _ST_FRONT_MI=250;               // within this of a surface front = hostile environment
const _ST_FRONT_CAP=20;               // mph knocked off the ceiling near a front (dry air + baroclinic shear)
const _COMPASS={N:0,NNE:22.5,NE:45,ENE:67.5,E:90,ESE:112.5,SE:135,SSE:157.5,S:180,SSW:202.5,SW:225,WSW:247.5,W:270,WNW:292.5,NW:315,NNW:337.5};

// Deep-layer-mean weights by intensity (mph). Weak storms are shallow and ride
// the low-level flow; intense storms feel the whole troposphere. Mirrors the
// shallow/medium/deep BAM family.
function _stWeights(maxWind){
  const w=(maxWind!=null&&isFinite(maxWind))?maxWind:35;
  if(w<39)  return {850:0.45,700:0.35,500:0.20,250:0.00}; // TD — shallow
  if(w<74)  return {850:0.30,700:0.30,500:0.28,250:0.12}; // TS — medium
  if(w<111) return {850:0.20,700:0.28,500:0.32,250:0.20}; // Cat 1-2 — deep
  return       {850:0.15,700:0.25,500:0.35,250:0.25};     // Major — deepest
}

// Spherical destination point: from (lat,lon) go distMi along bearing brg.
function _stDest(lat,lon,brg,distMi){
  const R=3958.8,d=distMi/R,th=brg*Math.PI/180;
  const la1=lat*Math.PI/180,lo1=lon*Math.PI/180;
  const la2=Math.asin(Math.sin(la1)*Math.cos(d)+Math.cos(la1)*Math.sin(d)*Math.cos(th));
  const lo2=lo1+Math.atan2(Math.sin(th)*Math.sin(d)*Math.cos(la1),Math.cos(d)-Math.sin(la1)*Math.sin(la2));
  return {lat:la2*180/Math.PI,lon:((lo2*180/Math.PI+540)%360)-180};
}

// One Open-Meteo pressure-level fetch at a point: 6 days hourly, mph, UTC.
async function _stFetchWinds(lat,lon){
  const vars=_ST_LEVELS.map(p=>`wind_speed_${p}hPa,wind_direction_${p}hPa`).join(',');
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&hourly=${vars}&forecast_days=6&wind_speed_unit=mph&timezone=UTC`;
  const r=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('winds HTTP '+r.status);
  const j=await r.json();
  if(!j.hourly||!j.hourly.time||!j.hourly.time.length)throw new Error('no hourly winds');
  // timezone=UTC returns ISO stamps without a Z — append so Date parses as UTC.
  const t0=new Date(j.hourly.time[0]+(String(j.hourly.time[0]).endsWith('Z')?'':'Z')).getTime();
  if(isNaN(t0))throw new Error('bad wind timestamps');
  // j.elevation ≈ 0 over open water; meaningfully >0 inland → drives land decay.
  return {lat,lon,t0,hourly:j.hourly,elev:(typeof j.elevation==='number'?j.elevation:0)};
}

// v5.89: sea-surface temperature at a sample point (Open-Meteo Marine API,
// cell_selection=sea snaps coastal points to the nearest ocean cell). Returns
// null over land / on failure — the intensity step then treats it as no-ocean.
async function _stFetchMarine(lat,lon){
  try{
    const url=`https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&hourly=sea_surface_temperature&forecast_days=6&cell_selection=sea&timezone=UTC`;
    const r=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;
    const j=await r.json();
    if(!j.hourly||!j.hourly.time||!j.hourly.sea_surface_temperature)return null;
    const t0=new Date(j.hourly.time[0]+(String(j.hourly.time[0]).endsWith('Z')?'':'Z')).getTime();
    if(isNaN(t0))return null;
    return {t0,sst:j.hourly.sea_surface_temperature};
  }catch(e){return null}
}
function _stSstAt(marine,tMs){
  if(!marine||!marine.sst)return null;
  const idx=Math.min(marine.sst.length-1,Math.max(0,Math.round((tMs-marine.t0)/3600000)));
  const v=marine.sst[idx];
  return (v==null||!isFinite(v))?null:v;
}
// Deep-layer shear: |V(250) − V(850)| in mph at time tMs, from the SAME fetch.
function _stShearAt(fp,tMs){
  const idx=Math.min(fp.hourly.time.length-1,Math.max(0,Math.round((tMs-fp.t0)/3600000)));
  const comp=p=>{
    const s=fp.hourly['wind_speed_'+p+'hPa'],d=fp.hourly['wind_direction_'+p+'hPa'];
    if(!s||!d||s[idx]==null||d[idx]==null)return null;
    const to=(d[idx]+180)*Math.PI/180;
    return {u:s[idx]*Math.sin(to),v:s[idx]*Math.cos(to)};
  };
  const lo=comp(850),hi=comp(250);
  if(!lo||!hi)return null;
  return Math.sqrt((hi.u-lo.u)**2+(hi.v-lo.v)**2);
}
// SST °C → potential-intensity ceiling (mph), linear between table rows.
function _stPotential(sstC){
  const T=_ST_POT;
  if(sstC<=T[0][0])return T[0][1];
  for(let i=1;i<T.length;i++){
    if(sstC<=T[i][0]){
      const f=(sstC-T[i-1][0])/(T[i][0]-T[i-1][0]);
      return T[i-1][1]+f*(T[i][1]-T[i-1][1]);
    }
  }
  return T[T.length-1][1];
}
// Category label + color for a Vmax (mirrors the app's TD…Cat5 scale colors).
function _stCat(mph){
  if(mph>=157)return{label:'Cat 5',color:'#ff1744'};
  if(mph>=130)return{label:'Cat 4',color:'#ff5722'};
  if(mph>=111)return{label:'Cat 3',color:'#ff9800'};
  if(mph>=96) return{label:'Cat 2',color:'#ffc107'};
  if(mph>=74) return{label:'Cat 1',color:'#ffeb3b'};
  if(mph>=39) return{label:'TS',color:'#4fc3f7'};
  return{label:'TD',color:'#90caf9'};
}

// ═══ v5.91: SURFACE FRONTS (NOAA/WPC surface analysis) ═══
// Drawn with the 🌀 overlays and consumed by the intensity model: within
// ~250 mi of a front the environment is hostile (dry-air intrusion +
// baroclinic shear) so the ceiling drops. NOTE deliberately NOT a push/pull
// force on the track — a front's pressure gradient IS a wind-field feature,
// so its steering influence already arrives through the 850–250 hPa winds the
// model integrates. Adding it again would double-count the physics.
const _FRONT_KINDS=[
  {re:/cold/i,      color:'#3b82f6', label:'Cold front'},
  {re:/warm/i,      color:'#ef4444', label:'Warm front'},
  {re:/stnry|station/i, color:'#a855f7', dash:'8,5', label:'Stationary front'},
  {re:/occl|ocfnt/i,color:'#d946ef', label:'Occluded front'},
  {re:/trof|trough/i,color:'#94a3b8', dash:'3,6', label:'Trough'}
];
async function _stEnsureFronts(){
  const c=S._frontsData;
  if(c&&Date.now()-c.at<30*60000)return c;
  try{
    const url='https://mapservices.weather.noaa.gov/vector/rest/services/obs/surface_fronts/MapServer/0/query?where=1%3D1&outFields=*&f=geojson';
    const r=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const j=await r.json();
    if(!j.features||!Array.isArray(j.features))throw new Error('no features');
    const fronts=[],flat=[];
    for(const f of j.features){
      const propStr=JSON.stringify(f.properties||{});
      const kind=_FRONT_KINDS.find(k=>k.re.test(propStr));
      if(!kind)continue;
      const g=f.geometry||{};
      const rawLines=g.type==='MultiLineString'?g.coordinates:(g.type==='LineString'?[g.coordinates]:[]);
      const lines=[];
      for(const ln of rawLines){
        if(!ln||ln.length<2)continue;
        const ll=ln.map(c2=>[c2[1],c2[0]]);
        lines.push(ll);
        for(let i=0;i<ll.length;i+=2)flat.push({lat:ll[i][0],lng:ll[i][1]}); // every 2nd vertex for distance checks
      }
      if(lines.length)fronts.push({color:kind.color,dash:kind.dash||null,label:kind.label,lines});
    }
    S._frontsData={at:Date.now(),fronts,flat};
    console.log('[fronts]',fronts.length,'front features loaded');
    return S._frontsData;
  }catch(e){
    console.log('[fronts] fetch failed:',e&&e.message);
    // short-TTL empty cache so a dead service isn't hammered every render
    S._frontsData={at:Date.now()-25*60000,fronts:[],flat:[]};
    return S._frontsData;
  }
}
// Min distance (mi) from a point to any front vertex, or null when no data.
function _stNearFrontMi(lat,lon){
  const d=S._frontsData;
  if(!d||!d.flat||!d.flat.length)return null;
  let mn=Infinity;
  for(const p of d.flat){
    const dd=haversine(lat,lon,p.lat,p.lng);
    if(dd<mn){mn=dd;if(mn<50)break}
  }
  return mn;
}
// Draw fronts into the 🌀 overlay group (async; gen-guarded like the ST line).
async function drawFronts(map){
  try{
    if(typeof L==='undefined'||!map)return;
    const gen=S._nhcPlotGen;
    const data=await _stEnsureFronts();
    if(!data||!data.fronts.length||gen!==S._nhcPlotGen)return;
    for(const f of data.fronts){
      let longest=null;
      for(const line of f.lines){
        const pl=L.polyline(line,{color:f.color,weight:2,opacity:0.7,dashArray:f.dash,interactive:false});
        pl.addTo(map);S._nhcTrackLayers.push(pl);
        if(!longest||line.length>longest.length)longest=line;
      }
      if(longest&&longest.length>3){
        const mid=longest[Math.floor(longest.length/2)];
        const lbl=L.marker(mid,{interactive:false,icon:L.divIcon({className:'',
          html:'<div style="font-size:8px;font-weight:600;color:'+f.color+';text-shadow:0 0 3px #000;white-space:nowrap;opacity:0.85">'+f.label+'</div>',
          iconAnchor:[20,4]})});
        lbl.addTo(map);S._nhcTrackLayers.push(lbl);
      }
    }
  }catch(e){console.log('[fronts] draw failed:',e&&e.message)}
}

// ═══ v5.91: SELF-SCORING ═══ each fresh model run is stored (compact, 6-h
// resolution, ≥3 h apart, 16 kept ≈ 2 days) so later runs can be verified
// against where the storm ACTUALLY is: "24 h err ~41 mi" on the map label.
function _stSaveRun(key,pts){
  try{
    const all=JSON.parse(localStorage.getItem('st_stRuns')||'{}');
    const arr=all[key]=all[key]||[];
    if(arr.length&&Date.now()-arr[arr.length-1].at<3*3600000)return; // keep runs ≥3 h apart
    arr.push({at:Date.now(),pts:pts.filter(p=>p.hr%6===0).map(p=>({hr:p.hr,lat:+p.lat.toFixed(2),lon:+p.lon.toFixed(2)}))});
    const cut=Date.now()-6*86400000;
    all[key]=arr.filter(r=>r.at>cut).slice(-16);
    localStorage.setItem('st_stRuns',JSON.stringify(all));
  }catch(e){}
}
function _stVerify(key,storm){
  try{
    if(!storm||storm.lat==null)return null;
    const arr=(JSON.parse(localStorage.getItem('st_stRuns')||'{}'))[key]||[];
    let best=null;
    for(const r of arr){
      const ageH=(Date.now()-r.at)/3600000;
      if(ageH<18||ageH>36)continue; // score the ~24 h forecast window
      if(!best||Math.abs(ageH-24)<Math.abs(best.ageH-24))best={ageH,r};
    }
    if(!best)return null;
    let lo=null,hi=null;
    for(const p of best.r.pts){if(p.hr<=best.ageH)lo=p;if(p.hr>=best.ageH){hi=p;break}}
    if(!lo||!hi)return null;
    const f=hi.hr===lo.hr?0:(best.ageH-lo.hr)/(hi.hr-lo.hr);
    const plat=lo.lat+f*(hi.lat-lo.lat),plon=lo.lon+f*(hi.lon-lo.lon);
    return {ageH:Math.round(best.ageH),errMi:Math.round(haversine(plat,plon,storm.lat,storm.lon))};
  }catch(e){return null}
}

// ═══ v5.91: PARTICLE-FLOW STEERING VISUALIZATION ═══ streaming particles
// advected by the model's own sampled steering field (IDW-interpolated from
// the run's fetch points), so you can SEE the river the storm is riding.
// Auto-starts when the ST line draws; self-stops when the storm is
// deselected, overlays toggle off, or you leave the radar tab.
let _flowState=null;
function startSTFlow(map){
  try{
    if(typeof L==='undefined'||!map)return;
    try{if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return}catch(e){}
    const F=S._stFlowField;
    if(!F||!F.samples||F.samples.length<2)return;
    stopSTFlow();
    const cont=map.getContainer();
    const cv=document.createElement('canvas');
    cv.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:450';
    cv.width=cont.clientWidth;cv.height=cont.clientHeight;
    cont.appendChild(cv);
    const ctx=cv.getContext('2d');
    const P=[],N=260;
    const spawn=p=>{const b=map.getBounds();p.lat=b.getSouth()+Math.random()*(b.getNorth()-b.getSouth());p.lng=b.getWest()+Math.random()*(b.getEast()-b.getWest());p.life=40+Math.random()*80};
    for(let i=0;i<N;i++){const p={};spawn(p);p.life*=Math.random();P.push(p)}
    const vel=(lat,lng)=>{let su=0,sv=0,sw=0;for(const s of F.samples){const d=Math.max(4,haversine(lat,lng,s.lat,s.lon));const w=1/(d*d);su+=w*s.u;sv+=w*s.v;sw+=w}return{u:su/sw,v:sv/sw}};
    const step=()=>{
      if(!document.body.contains(cv))return;
      if(S.activePage!=='radar'||!S._nhcSelectedStorm||!S._showNHCTracks||(typeof _nhcOpt==='function'&&_nhcOpt('flow')==='off')){stopSTFlow();return}
      if(cv.width!==cont.clientWidth||cv.height!==cont.clientHeight){cv.width=cont.clientWidth;cv.height=cont.clientHeight}
      ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,0.10)';ctx.fillRect(0,0,cv.width,cv.height);
      ctx.globalCompositeOperation='source-over';ctx.strokeStyle='rgba(0,212,255,0.5)';ctx.lineWidth=1;
      for(const p of P){
        const v=vel(p.lat,p.lng);
        const k=0.00045; // mph → deg/frame (visual time-lapse)
        const nlat=p.lat+v.v*k,nlng=p.lng+v.u*k/Math.max(0.2,Math.cos(p.lat*Math.PI/180));
        const a=map.latLngToContainerPoint([p.lat,p.lng]),b2=map.latLngToContainerPoint([nlat,nlng]);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b2.x,b2.y);ctx.stroke();
        p.lat=nlat;p.lng=nlng;p.life--;
        const bb=map.getBounds();
        if(p.life<=0||p.lat<bb.getSouth()||p.lat>bb.getNorth()||p.lng<bb.getWest()||p.lng>bb.getEast())spawn(p);
      }
      _flowState.raf=requestAnimationFrame(step);
    };
    _flowState={cv,raf:requestAnimationFrame(step)};
  }catch(e){console.log('[ST flow] failed:',e&&e.message)}
}
function stopSTFlow(){
  try{
    if(_flowState){cancelAnimationFrame(_flowState.raf);if(_flowState.cv&&_flowState.cv.parentNode)_flowState.cv.parentNode.removeChild(_flowState.cv);_flowState=null}
  }catch(e){}
}

// Deep-layer-mean steering vector (u=east, v=north, mph) at absolute time tMs
// from a fetched point. Meteorological direction is where wind comes FROM; the
// advecting motion is toward FROM+180.
function _stWindAt(fp,tMs,maxWind){
  const idx=Math.min(fp.hourly.time.length-1,Math.max(0,Math.round((tMs-fp.t0)/3600000)));
  const wts=_stWeights(maxWind);
  let u=0,v=0,wsum=0;
  for(const p of _ST_LEVELS){
    const w=wts[p]||0; if(w<=0)continue;
    const sArr=fp.hourly['wind_speed_'+p+'hPa'],dArr=fp.hourly['wind_direction_'+p+'hPa'];
    const spd=sArr?sArr[idx]:null,dir=dArr?dArr[idx]:null;
    if(spd==null||dir==null)continue;
    const to=(dir+180)*Math.PI/180;
    u+=w*spd*Math.sin(to); v+=w*spd*Math.cos(to); wsum+=w;
  }
  if(wsum<=0)return null;
  return {u:u/wsum,v:v/wsum};
}

// Integrate the track. Returns [{hr,lat,lon,t,windMph}] hourly, or null if
// unusable. Cached 30 min per storm. v5.90: IN-FLIGHT DEDUPE — plotNHCTracks
// re-runs every radar refresh, and each re-run used to kick off its OWN slow
// model run whose result was then discarded as stale (gen mismatch), so on a
// busy radar tab the line could never land. Now concurrent callers share one
// promise: the newest plot pass awaits the same run and draws it the moment
// it resolves.
async function computeSTModelTrack(storm){
  if(!storm||storm.lat==null||storm.lon==null)return null;
  const key=String(storm.id||storm.name||'');
  const cache=S._stModelCache=S._stModelCache||{};
  const hit=cache[key];
  if(hit&&Date.now()-hit.at<30*60000)return hit.pts;
  const inflight=S._stModelInflight=S._stModelInflight||{};
  if(inflight[key])return inflight[key];
  const p=_stRunModel(storm,key,cache);
  inflight[key]=p;
  try{return await p}finally{delete inflight[key]}
}
async function _stRunModel(storm,key,cache){
  try{await _stEnsureFronts()}catch(e){} // fronts inform the intensity ceiling (cached 30 min)
  const flowSamples=[]; // steering samples captured at each fetch point (particle viz)
  let _fDist=null;      // distance to nearest front, refreshed every 3 model hours
  let lat=storm.lat,lon=storm.lon;
  const startMs=Date.now();
  const betaBrg=lat<0?225:315; // beta drift: poleward+westward in each hemisphere
  // Observed initial motion (compass text + mph from GDACS/NHC/JTWC merge).
  let obsU=null,obsV=null;
  const obsBrg=_COMPASS[String(storm.moveDir||'').toUpperCase().trim()];
  const obsSpd=parseFloat(storm.moveSpeed);
  if(obsBrg!=null&&isFinite(obsSpd)&&obsSpd>0){
    const th=obsBrg*Math.PI/180;
    obsU=obsSpd*Math.sin(th); obsV=obsSpd*Math.cos(th);
  }
  let fp=null,fetches=0;
  // v5.89: intensity state — starts at the observed Vmax and evolves hourly.
  let V=(storm.maxWind!=null&&isFinite(storm.maxWind))?storm.maxWind:35;
  const pts=[{hr:0,lat,lon,t:startMs,windMph:Math.round(V)}];
  for(let hr=1;hr<=_ST_MAX_HR;hr++){
    const tMs=startMs+hr*3600000;
    const needFetch=!fp||haversine(lat,lon,fp.lat,fp.lon)>_ST_REFETCH_MI;
    if(needFetch&&fetches<_ST_MAX_FETCH){
      try{
        // v5.90: winds + SST fetched in PARALLEL — serial fetching doubled run
        // time in v5.89 and made runs miss the re-plot window entirely.
        const [wf,mf]=await Promise.all([_stFetchWinds(lat,lon),_stFetchMarine(lat,lon)]);
        fp=wf; fp.marine=mf; fetches++;
        // capture a steering sample here for the particle-flow visualization
        const _s0=_stWindAt(fp,tMs,V);
        if(_s0)flowSamples.push({lat:fp.lat,lon:fp.lon,u:_s0.u,v:_s0.v});
      }
      catch(e){
        console.log('[ST Model] winds fetch failed:',e&&e.message);
        S._stModelLastError=String(e&&e.message||e);
        if(!fp)break; // no winds at all → no model; else ride the last sample
      }
    }
    if(!fp)break;
    // Steering depth follows the EVOLVING intensity (a storm our model deepens
    // to Cat 2 is steered by a deeper layer than the TD it started as).
    const st=_stWindAt(fp,tMs,V);
    if(!st)break;
    let u=st.u+_ST_BETA_MPH*Math.sin(betaBrg*Math.PI/180);
    let v=st.v+_ST_BETA_MPH*Math.cos(betaBrg*Math.PI/180);
    if(obsU!=null){
      const bw=Math.max(0,1-hr/_ST_BLEND_HR); // 1→0 over the first 18 h
      u=bw*obsU+(1-bw)*u; v=bw*obsV+(1-bw)*v;
    }
    const spd=Math.sqrt(u*u+v*v);
    if(spd>0.1){
      const brg=(Math.atan2(u,v)*180/Math.PI+360)%360;
      const np=_stDest(lat,lon,brg,spd); // dt = 1 h → distance = speed·1
      lat=np.lat; lon=np.lon;
    }
    // ── v5.89 intensity step ── relax Vmax toward the environment's ceiling:
    // SST sets the potential, excess deep shear lowers it, land forces decay.
    let _nearFront=false;
    {
      const sst=_stSstAt(fp.marine,tMs);
      const overLand=(fp.elev>10)||(sst==null);
      if(hr%3===1||_fDist==null)_fDist=_stNearFrontMi(lat,lon); // refresh every 3 h
      _nearFront=(_fDist!=null&&_fDist<_ST_FRONT_MI);
      if(overLand){
        V=V+_ST_K_LAND*(27-V);
      }else{
        let cap=_stPotential(sst);
        const sh=_stShearAt(fp,tMs);
        if(sh!=null&&sh>_ST_SHEAR_FREE)cap-=_ST_SHEAR_COST*(sh-_ST_SHEAR_FREE);
        // v5.91: frontal zone = hostile (dry air + baroclinic shear). The
        // front's steering push/pull is NOT added here — the pressure gradient
        // is already in the 850–250 hPa winds the track integrates.
        if(_nearFront)cap-=_ST_FRONT_CAP;
        cap=Math.max(25,cap);
        // v5.91: organization lag + RI cap (was one hot 0.03 rate for all).
        const kUp=V<64?_ST_K_UP_WEAK:_ST_K_UP_ORG;
        let dV=(V<cap?kUp:_ST_K_DOWN)*(cap-V);
        if(dV>_ST_RI_CAP)dV=_ST_RI_CAP;
        V=V+dV;
      }
      V=Math.min(200,Math.max(20,V));
    }
    pts.push({hr,lat,lon,t:tMs,windMph:Math.round(V),nearFront:_nearFront});
  }
  if(pts.length<12)return null; // <12 h of track isn't a forecast
  cache[key]={at:Date.now(),pts};
  _stSaveRun(key,pts); // v5.91: archive for later self-scoring vs reality
  if(flowSamples.length>=2)S._stFlowField={at:Date.now(),samples:flowSamples};
  return pts;
}

// Draw the ST Model line + hour markers for the selected storm. Async: winds
// are fetched on demand; S._nhcPlotGen (bumped by plotNHCTracks) makes sure a
// slow run can't paint onto a map that has since been re-plotted.
async function drawSTModelTrack(storm,map){
  try{
    if(!storm||!map||typeof L==='undefined')return;
    const gen=S._nhcPlotGen;
    const pts=await computeSTModelTrack(storm);
    if(!pts){
      // v5.90: say WHY there's no line instead of silently drawing nothing.
      console.log('[ST Model] no track for',storm.name,'—',S._stModelLastError||'winds unavailable');
      const nk='_stNoted_'+(storm.id||storm.name);
      if(!S[nk]&&typeof toast==='function'){S[nk]=true;toast('🧪 ST Model: winds aloft unavailable for '+storm.name+' — will retry on next refresh');}
      return;
    }
    if(gen!==S._nhcPlotGen)return; // a newer plot pass owns the map now — it will draw this run from cache instantly
    const line=L.polyline(pts.map(p=>[p.lat,p.lon]),{
      color:_ST_COLOR,weight:2.5,opacity:0.95,dashArray:'2,6',interactive:false});
    line.addTo(map); S._nhcTrackLayers.push(line);
    // v5.89: tap-point cadence follows forward speed — fast movers (>10 mph mean
    // over the first 24 h) get a dot every 3 h, slower ones every 6 h. Dots at
    // 24 h multiples render slightly larger for hierarchy; each dot's FILL is
    // the category color of the model's estimated intensity at that hour, and
    // the tooltip carries time + ~Vmax + category.
    let fwd=0;
    const _pRef=pts.find(q=>q.hr===24)||pts[pts.length-1];
    if(_pRef&&_pRef.hr>0)fwd=haversine(pts[0].lat,pts[0].lon,_pRef.lat,_pRef.lon)/_pRef.hr;
    if(!(fwd>0)){const os=parseFloat(storm.moveSpeed);if(isFinite(os))fwd=os;}
    const stepH=fwd>10?3:6;
    for(const p of pts){
      if(p.hr===0||p.hr%stepH!==0)continue;
      const major=p.hr%24===0;
      const d=new Date(p.t);
      const when=d.toLocaleDateString(undefined,{weekday:'short'})+' '+fmtClockShort(d);
      const cat=(p.windMph!=null)?_stCat(p.windMph):null;
      const dot=L.circleMarker([p.lat,p.lon],{
        radius:major?4.5:3,color:_ST_COLOR,
        fillColor:cat?cat.color:_ST_COLOR,fillOpacity:0.95,weight:1,interactive:false});
      dot.addTo(map); S._nhcTrackLayers.push(dot);
      // v5.92: big invisible hit circle — the visible dots were too small to tap
      const hit=L.circleMarker([p.lat,p.lon],{radius:12,stroke:false,fillColor:'#000',fillOpacity:0.02});
      hit.bindTooltip('ST +'+p.hr+'h · '+when+(cat?' · ~'+p.windMph+' mph ('+cat.label+')':'')+(p.nearFront?' · ≈front':''),{direction:'top'});
      hit.addTo(map); S._nhcTrackLayers.push(hit);
    }
    let peak=null;
    for(const p of pts){if(p.windMph!=null&&(!peak||p.windMph>peak.windMph))peak=p;}
    // v5.91: self-score — how far off was our ~24 h-old run vs where the storm
    // actually is now? Only shows once the app has runs old enough to grade.
    const ver=_stVerify(String(storm.id||storm.name||''),storm);
    const last=pts[pts.length-1];
    const lbl=L.marker([last.lat,last.lon],{interactive:false,icon:L.divIcon({className:'',
      html:'<div style="font-size:9px;font-weight:700;color:'+_ST_COLOR+';text-shadow:0 0 3px #000;white-space:nowrap" title="StormTracker in-app steering model — experimental, not for safety decisions">ST Model'+(peak&&peak.windMph?' · peak ~'+peak.windMph+' mph ('+_stCat(peak.windMph).label+')':'')+(ver?' · '+ver.ageH+'h err ~'+ver.errMi+' mi':'')+'</div>',
      iconAnchor:[-6,4]})});
    lbl.addTo(map); S._nhcTrackLayers.push(lbl);
    if(typeof _nhcOpt!=='function'||_nhcOpt('flow')!=='off')startSTFlow(map); // particle-flow viz (self-stops on deselect)
    console.log('[ST Model]',storm.name,'—',pts.length-1,'h track, dots every '+stepH+'h, peak',peak&&peak.windMph,'mph',ver?('· '+ver.ageH+'h err '+ver.errMi+' mi'):'');
  }catch(e){console.log('[ST Model] draw failed:',e&&e.message)}
}

if(typeof window!=='undefined'){
  window.computeSTModelTrack=computeSTModelTrack;
  window.drawSTModelTrack=drawSTModelTrack;
  window.drawFronts=drawFronts;
  window.startSTFlow=startSTFlow;
  window.stopSTFlow=stopSTFlow;
}
})();
