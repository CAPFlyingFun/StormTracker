// ==========================================
// RADAR MAP (RainViewer) — full zoom support
// ==========================================
const _RI='img/radar/';
function _ri(name){return`<img src="${_RI}${name}.svg" alt="">`}
function _ris(id,name){const el=document.getElementById(id);if(!el)return;const img=el.querySelector('img');if(img)img.src=_RI+name+'.svg';else el.innerHTML=_ri(name)}
function refreshRadarLegend(){const bar=document.querySelector('.legend-bar');if(!bar)return;bar.innerHTML=DBZ_SCALE.filter(e=>e.min>=5).map((e,i,a)=>{const nx=a[i+1];const rng=nx?`${e.min}-${nx.min-1}`:`${e.min}+`;return`<span style="background:${e.color}" title="${rng} ${e.label}"></span>`}).join('');}
function initRadar(){
  if(!S.lat)return;
  const el=document.getElementById('page-radar');
  el.innerHTML=`
    <div class="card-title"><span class="icon">📡</span> ${tStr('Live Radar')}</div>
    <div class="map-container">
      <div id="radar-map"></div>
      <div class="radar-crosshair">
        <svg width="40" height="40" viewBox="0 0 40 40">
          <line x1="20" y1="0" x2="20" y2="16" stroke="#00e5ff" stroke-width="1.5" opacity="0.7"/>
          <line x1="20" y1="24" x2="20" y2="40" stroke="#00e5ff" stroke-width="1.5" opacity="0.7"/>
          <line x1="0" y1="20" x2="16" y2="20" stroke="#00e5ff" stroke-width="1.5" opacity="0.7"/>
          <line x1="24" y1="20" x2="40" y2="20" stroke="#00e5ff" stroke-width="1.5" opacity="0.7"/>
          <circle cx="20" cy="20" r="3" fill="none" stroke="#00e5ff" stroke-width="1" opacity="0.5"/>
        </svg>
      </div>
      <div class="radar-time-label" id="radar-time">Loading...</div>
      <div class="map-controls map-controls-left">
        <div class="map-ctrl-btn" id="radar-scan" title="Home location">${_ri('scan-home')}</div>
        <div class="map-ctrl-btn" id="radar-scan-view" title="Scan map center">${_ri('scan-view')}</div>
        <div class="map-ctrl-btn" id="radar-scan-hires" title="HD Scan (15mi zoom 12)">${_ri('scan-hires')}</div>
        <div class="map-ctrl-btn" id="radar-toggle-src" title="Toggle radar source">${_ri(S.radarSource==='nexrad'?'source-nex':'source-rv')}</div>
        <div class="map-ctrl-btn" id="radar-toggle-units" title="Toggle mi/km">${_ri(S.radarMetric?'units-km':'units')}</div>
        <div class="map-ctrl-btn" id="radar-toggle-airports" title="Toggle airports">${_ri('airports')}</div>
        <div class="map-ctrl-btn" id="radar-anim-btn" title="Animate radar">${_ri('play')}</div>
        <div class="map-ctrl-btn" id="btn-lightning" title="Toggle lightning strikes" onclick="toggleLightning()" style="opacity:${(typeof _ltgShown==='function'&&!_ltgShown())?0.4:1};font-size:15px;display:flex;align-items:center;justify-content:center">⚡</div>
      </div>
      <div class="map-controls map-controls-right">
        <div class="map-ctrl-btn" id="btn-layers-panel" title="Map layers" onclick="toggleLayersPanel()" style="font-size:14px;display:flex;align-items:center;justify-content:center">🗂️</div>
        <div class="map-ctrl-btn" id="btn-iso-3d" title="3D Storm Terrain" onclick="show3DView()">${_ri('terrain-3d')}</div>
        <div class="map-ctrl-btn" id="radar-clear-cone" title="Clear track" style="display:none" onclick="clearStormCone()">${_ri('clear')}</div>
        <div class="map-ctrl-btn" id="clutter-toggle" title="Clutter hidden (tap to show)" style="display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);border-color:#555" onclick="toggleClutter()">${_ri('clutter')}</div>
      </div>
      <div id="map-layers-panel" style="display:none;position:absolute;top:8px;right:52px;z-index:1002;width:178px;max-height:72%;overflow-y:auto;background:rgba(8,14,28,0.94);border:1px solid var(--border-subtle);border-radius:10px;padding:8px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)">${_layersPanelHTML()}</div>
      <div class="radar-anim-bar" id="radar-anim-bar" style="display:none">
        <input type="range" id="radar-anim-slider" min="0" max="0" value="0" class="flex-1">
        <span id="radar-anim-time" style="font-size:0.65em;color:var(--text-secondary);min-width:50px;text-align:right"></span>
      </div>
      <div class="map-legend">
        <span>dBZ</span>
        <div class="legend-bar">
          ${DBZ_SCALE.filter(e=>e.min>=5).map((e,i,a)=>{const nx=a[i+1];const rng=nx?`${e.min}-${nx.min-1}`:`${e.min}+`;return`<span style="background:${e.color}" title="${rng} ${e.label}"></span>`}).join('')}
        </div>
        <span>5 → 65+ dBZ</span>
        <div style="display:flex;gap:6px;margin-left:6px;font-size:0.6em;opacity:0.7">
          <span style="color:#00cc44">🌧Rain</span>
          <span style="color:#66aaff">❄Snow</span>
          <span style="color:#ff77cc">🧊Mix</span>
        </div>
      </div>
      </div>
    </div>
    <div id="scan-status-bar" style="display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;font-size:0.7em;color:var(--text-muted);padding:4px 8px;min-height:20px">
      <span id="scan-dot1" style="display:none"><span class="scan-dot" id="scan-dot1-c">⚫</span> <span id="scan-dot1-t">Winds</span></span>
      <span id="scan-dot2" style="display:none"><span class="scan-dot" id="scan-dot2-c">⚫</span> <span id="scan-dot2-t">Radar</span></span>
      <span id="scan-dot3" style="display:none"><span class="scan-dot" id="scan-dot3-c">⚫</span> <span id="scan-dot3-t">Storms</span></span>
      <span id="scan-refresh-timer" style="font-family:var(--font-mono);color:var(--accent-cyan);font-weight:600"></span>
    </div>
    <div id="radar-source-label" style="font-size:0.7em;color:var(--text-muted);text-align:center"></div>`;
  setTimeout(async()=>{
    S._radarAnimPlaying=false;S._radarAnimPaused=false;
    clearInterval(S._radarAnimTimer);S._radarAnimFrames=[];
    if(S.map){S.map.remove();S.map=null}
    const map=L.map('radar-map',{zoomControl:false,attributionControl:false,maxZoom:11,maxBoundsViscosity:1.0,bounceAtZoomLimits:false,zoomSnap:0.5,zoomDelta:0.5}).setView([S.lat,S.lon],8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:11}).addTo(map);
    S._rangeCircle=L.circle([S.lat,S.lon],{radius:S.scanRadius*1609.34,color:'#3b82f6',fill:false,weight:1,dashArray:'6 4'}).addTo(map);
    S._userMarker=L.circleMarker([S.lat,S.lon],{radius:5,color:'#3b82f6',fillColor:'#3b82f6',fillOpacity:1}).addTo(map);
    S.map=map;
    // v5.94: the map's UI overlays (button rails, legend, time chip, anim bar,
    // layers panel) sit ABOVE the Leaflet canvas. Without this, a touch that
    // starts on one of them and drags still reached the map and panned it — so
    // trying to press a button or swipe the page over that strip moved the map
    // instead. disableClickPropagation stops the drag/press from reaching the
    // map; disableScrollPropagation stops wheel-scroll from zooming it. The
    // browser is then free to scroll the PAGE when you swipe those strips, which
    // also gives back an easy way to scroll past the full-height map.
    if(L.DomEvent){
      ['.map-controls-left','.map-controls-right','.map-legend','.radar-time-label','.radar-anim-bar','#map-layers-panel'].forEach(sel=>{
        const ov=document.querySelector(sel);
        if(ov){L.DomEvent.disableClickPropagation(ov);L.DomEvent.disableScrollPropagation(ov);}
      });
    }
    let _zoomReplot=null,_lastZoom=map.getZoom();
    map.on('zoomend',()=>{
      const z=map.getZoom();
      if(z===_lastZoom||!S.storms.length)return;
      _lastZoom=z;
      clearTimeout(_zoomReplot);
      _zoomReplot=setTimeout(()=>plotStormMarkers(map),250);
    });
    map.on('movestart',()=>showCrosshair());
    map.on('moveend',()=>scheduleCrosshairHide());
    if(S._crosshairDelay==='on')hideCrosshair();
    else if(S._crosshairDelay!=='off')scheduleCrosshairHide();
    let _mpingMoveTimer=null;
    map.on('moveend',()=>{
      if(!S._mpingVisible)return;
      clearTimeout(_mpingMoveTimer);
      _mpingMoveTimer=setTimeout(()=>{
        S._mpingCache=null;S._mpingCacheTime=0;
        refreshMpingIfVisible();
      },800);
    });
    if(S._mpingPendingRestore){
      S._mpingPendingRestore=false;
      setTimeout(()=>toggleMping(),1500);
    }
    try{
      const rv=await fetch('https://api.rainviewer.com/public/weather-maps.json').then(r=>r.json());
      S.radarFrames=(rv.radar?.past||[]).concat(rv.radar?.nowcast||[]);
      if(S.radarFrames.length){
        const last=S.radarFrames[S.radarFrames.length-1];
        S._rvTilePath=last.path;
      }
    }catch(e){}
    showRadarLayer(map);
    document.getElementById('radar-scan').addEventListener('click',()=>{recenterMap()});
    document.getElementById('radar-scan-view').addEventListener('click',()=>{scanHere()});
    document.getElementById('radar-scan-hires').addEventListener('click',()=>{showHdScanDialog()});
    document.getElementById('radar-toggle-src').addEventListener('click',()=>{toggleRadarSource(map)});
    document.getElementById('radar-toggle-airports').addEventListener('click',()=>{toggleAirportMarkers(map)});
    document.getElementById('radar-toggle-units').addEventListener('click',()=>{
      S.radarMetric=!S.radarMetric;
      _ris('radar-toggle-units',S.radarMetric?'units-km':'units');
      let openIdx=-1;
      S.stormMarkers.forEach((m,i)=>{if(m.getPopup&&m.getPopup()&&m.isPopupOpen())openIdx=i});
      plotStormMarkers(map);
      if(openIdx>=0&&S.stormMarkers[openIdx]&&S.stormMarkers[openIdx].openPopup)S.stormMarkers[openIdx].openPopup();
      if(S.activePage==='storms')renderStorms();
    });
    document.getElementById('radar-anim-btn').addEventListener('click',()=>{toggleRadarAnim(map)});
    document.getElementById('radar-anim-slider').addEventListener('input',(e)=>{
      scrubRadarAnim(map,parseInt(e.target.value));
    });
    const zbtn=document.getElementById('btn-zones');if(zbtn)zbtn.style.opacity=S._showZones?'1':'0.4';
    const pbtn=document.getElementById('btn-points');
    if(pbtn){
      if(S._pointsMode==='inbound'){pbtn.style.opacity='1';_ris('btn-points','points-12');}
      else if(S._pointsMode==='all'){pbtn.style.opacity='1';_ris('btn-points','points');}
      else{pbtn.style.opacity='0.4';_ris('btn-points','points');}
    }
    const tkbtn=document.getElementById('btn-tracks');
    if(tkbtn){
      if(S._tracksMode==='inbound'){tkbtn.style.opacity='1';_ris('btn-tracks','tracks-12');}
      else if(S._tracksMode==='all'){tkbtn.style.opacity='1';_ris('btn-tracks','tracks');}
      else{tkbtn.style.opacity='0.4';_ris('btn-tracks','tracks');}
    }
    const rmbtn=document.getElementById('btn-relmotion');
    if(rmbtn){
      if(S._relMotionMode==='inbound'){rmbtn.style.opacity='1';rmbtn.textContent='∡12';}
      else if(S._relMotionMode==='all'){rmbtn.style.opacity='1';rmbtn.textContent='∡A';}
      else{rmbtn.style.opacity='0.4';rmbtn.textContent='∡';}
    }
    try{if(!map.getPane('storm-arrow-pane')){map.createPane('storm-arrow-pane');map.getPane('storm-arrow-pane').style.zIndex=410;}}catch(e){}
    try{if(!map.getPane('rel-motion-pane')){map.createPane('rel-motion-pane');map.getPane('rel-motion-pane').style.zIndex=445;}}catch(e){}
    const rbtn=document.getElementById('btn-radar-overlay');if(rbtn)rbtn.style.opacity=S._radarOverlayVisible?'1':'0.4';
    const pabtn=document.getElementById('btn-path-arrows');if(pabtn)pabtn.style.opacity=S._showPathArrows?'1':'0.4';
    const mpbtn=document.getElementById('btn-mping');if(mpbtn)mpbtn.style.opacity='0.4';
    if(S.storms.length){
      plotStormMarkers(map);
      buildStormZones(map,S._rawScanPts);
      if(S._rawScanPts.length&&S._pointsMode==='off'){
        S.stormMarkers.forEach(m=>{try{map.removeLayer(m)}catch(e){}});
      }
    }
    if(S._showPathArrows)buildPathArrows(map);
    if(S._nextRefreshAt)startScanRefreshTimer();
  },100);
}

function findNearestRadar(lat,lon){
  const sites=[
    {id:'BMX',lat:33.172,lon:-86.770},{id:'EOX',lat:31.460,lon:-85.459},
    {id:'MOB',lat:30.679,lon:-88.240},{id:'EVX',lat:30.565,lon:-85.921},
    {id:'TLH',lat:30.397,lon:-84.329},{id:'JAX',lat:30.485,lon:-81.702},
    {id:'LIX',lat:30.337,lon:-89.825},{id:'SHV',lat:32.451,lon:-93.841},
    {id:'POE',lat:31.156,lon:-92.976},{id:'LCH',lat:30.125,lon:-93.216},
    {id:'HGX',lat:29.472,lon:-95.079},{id:'CRP',lat:27.784,lon:-97.511},
    {id:'EWX',lat:29.704,lon:-98.029},{id:'SJT',lat:31.371,lon:-100.492},
    {id:'MAF',lat:31.943,lon:-102.189},{id:'LBB',lat:33.654,lon:-101.814},
    {id:'AMA',lat:35.233,lon:-101.709},{id:'FDR',lat:34.362,lon:-98.977},
    {id:'TLX',lat:35.333,lon:-97.278},{id:'INX',lat:36.175,lon:-95.564},
    {id:'SGF',lat:37.235,lon:-93.400},{id:'LSX',lat:38.699,lon:-90.683},
    {id:'EAX',lat:38.810,lon:-94.264},{id:'ICT',lat:37.655,lon:-97.443},
    {id:'DDC',lat:37.761,lon:-99.969},{id:'GLD',lat:39.367,lon:-101.700},
    {id:'UEX',lat:40.321,lon:-98.442},{id:'OAX',lat:41.320,lon:-96.367},
    {id:'ABR',lat:45.456,lon:-98.413},{id:'MPX',lat:44.849,lon:-93.565},
    {id:'DMX',lat:41.731,lon:-93.723},{id:'DVN',lat:41.612,lon:-90.581},
    {id:'LOT',lat:41.604,lon:-88.085},{id:'MKX',lat:42.968,lon:-88.551},
    {id:'GRB',lat:44.498,lon:-88.111},{id:'ARX',lat:43.823,lon:-91.191},
    {id:'DLH',lat:46.837,lon:-92.210},{id:'FGF',lat:47.528,lon:-97.093},
    {id:'BIS',lat:46.771,lon:-100.760},{id:'MBX',lat:48.393,lon:-100.865},
    {id:'GGW',lat:48.206,lon:-106.625},{id:'TFX',lat:47.460,lon:-111.385},
    {id:'MSX',lat:47.041,lon:-113.986},{id:'SFX',lat:43.106,lon:-112.686},
    {id:'CBX',lat:43.491,lon:-116.236},{id:'MTX',lat:41.263,lon:-112.448},
    {id:'GJX',lat:39.062,lon:-108.214},{id:'PUX',lat:38.460,lon:-104.181},
    {id:'FTG',lat:39.787,lon:-104.546},{id:'CYS',lat:41.152,lon:-104.806},
    {id:'RIW',lat:43.066,lon:-108.477},{id:'UNR',lat:44.125,lon:-105.100},
    {id:'ABX',lat:35.150,lon:-106.824},{id:'FDX',lat:34.635,lon:-103.630},
    {id:'EPZ',lat:31.873,lon:-106.698},{id:'HDX',lat:33.076,lon:-106.120},
    {id:'PHX',lat:33.422,lon:-112.166},{id:'IWA',lat:33.289,lon:-111.670},
    {id:'EMX',lat:31.894,lon:-110.630},{id:'YUX',lat:32.495,lon:-114.657},
    {id:'FSX',lat:34.574,lon:-111.198},{id:'TWX',lat:38.997,lon:-96.232},
    {id:'FWS',lat:32.573,lon:-97.303},{id:'DFX',lat:29.273,lon:-100.281},
    {id:'GRK',lat:30.722,lon:-97.383},{id:'DYX',lat:32.538,lon:-99.254},
    {id:'ATX',lat:48.195,lon:-122.496},{id:'LGX',lat:47.117,lon:-124.107},
    {id:'OTX',lat:47.681,lon:-117.627},{id:'PDT',lat:45.691,lon:-118.853},
    {id:'RTX',lat:45.715,lon:-122.965},{id:'MAX',lat:42.081,lon:-122.717},
    {id:'RGX',lat:39.754,lon:-119.462},{id:'ESX',lat:35.701,lon:-114.891},
    {id:'VBX',lat:34.836,lon:-120.397},{id:'HNX',lat:36.314,lon:-119.632},
    {id:'DAX',lat:38.501,lon:-121.678},{id:'MUX',lat:37.155,lon:-121.898},
    {id:'SOX',lat:33.818,lon:-117.636},{id:'NKX',lat:32.919,lon:-117.042},
    {id:'VTX',lat:34.412,lon:-119.179},{id:'BRO',lat:25.916,lon:-97.419},
    {id:'DTX',lat:42.700,lon:-83.472},{id:'APX',lat:44.907,lon:-84.720},
    {id:'GRR',lat:42.894,lon:-85.545},{id:'IWX',lat:41.359,lon:-85.700},
    {id:'IND',lat:39.708,lon:-86.280},{id:'VWX',lat:38.260,lon:-87.724},
    {id:'ILX',lat:40.151,lon:-89.337},{id:'CLE',lat:41.413,lon:-81.860},
    {id:'ILN',lat:39.420,lon:-83.822},{id:'JKL',lat:37.591,lon:-83.313},
    {id:'LMK',lat:38.178,lon:-85.791},{id:'HPX',lat:36.737,lon:-87.285},
    {id:'OHX',lat:36.247,lon:-86.563},{id:'MRX',lat:36.169,lon:-83.402},
    {id:'HTX',lat:34.931,lon:-86.084},{id:'GWX',lat:33.897,lon:-88.329},
    {id:'DGX',lat:32.280,lon:-89.984},{id:'JAN',lat:32.318,lon:-90.080},
    {id:'FFC',lat:33.363,lon:-84.566},{id:'GSP',lat:34.883,lon:-82.220},
    {id:'CLX',lat:32.656,lon:-81.042},{id:'CAE',lat:33.949,lon:-81.119},
    {id:'RAX',lat:35.665,lon:-78.490},{id:'MHX',lat:34.776,lon:-76.876},
    {id:'LTX',lat:33.989,lon:-78.429},{id:'AKQ',lat:36.984,lon:-77.007},
    {id:'LWX',lat:38.975,lon:-77.478},{id:'DOX',lat:38.826,lon:-75.440},
    {id:'PHI',lat:39.947,lon:-75.078},{id:'DIX',lat:39.947,lon:-74.411},
    {id:'OKX',lat:40.866,lon:-72.864},{id:'BOX',lat:41.956,lon:-71.137},
    {id:'ENX',lat:42.586,lon:-74.064},{id:'BGM',lat:42.200,lon:-75.985},
    {id:'BUF',lat:42.949,lon:-78.737},{id:'TYX',lat:43.756,lon:-75.680},
    {id:'GYX',lat:43.891,lon:-70.257},{id:'CXX',lat:44.511,lon:-73.166},
    {id:'CBW',lat:46.039,lon:-67.806},{id:'MLB',lat:28.113,lon:-80.654},
    {id:'AMX',lat:25.611,lon:-80.413},{id:'TBW',lat:27.706,lon:-82.402},
    {id:'BYX',lat:24.597,lon:-81.703},{id:'KEY',lat:24.553,lon:-81.781},
    {id:'TAE',lat:30.397,lon:-84.329},{id:'VAX',lat:30.890,lon:-83.002},
    {id:'JGX',lat:32.675,lon:-83.351},{id:'NQA',lat:35.345,lon:-89.873},
    {id:'LZK',lat:34.836,lon:-92.262},{id:'SRX',lat:35.290,lon:-94.362},
    {id:'KJK',lat:30.632,lon:-91.220}
  ];
  let best=sites[0],bestD=Infinity;
  for(const s of sites){const d=Math.hypot(lat-s.lat,lon-s.lon);if(d<bestD){bestD=d;best=s}}
  return best.id;
}
async function buildNexradFrames(lat,lon){
  const useLat=lat||S.lat,useLon=lon||S.lon;
  const site=findNearestRadar(useLat,useLon);
  const end=new Date();
  const start=new Date(end.getTime()-2*60*60*1000);
  const pad2=n=>String(n).padStart(2,'0');
  const fmtDt=d=>d.getUTCFullYear()+'-'+pad2(d.getUTCMonth()+1)+'-'+pad2(d.getUTCDate())+'T'+pad2(d.getUTCHours())+':'+pad2(d.getUTCMinutes())+':'+pad2(d.getUTCSeconds())+'Z';
  const products=['N0B','N0Q','N0R'];
  for(const prod of products){
    try{
      const apiUrl=`https://mesonet.agron.iastate.edu/json/radar.py?operation=list&radar=${site}&product=${prod}&start=${fmtDt(start)}&end=${fmtDt(end)}`;
      console.log('[NEXRAD-ANIM] site='+site+' prod='+prod+' api='+apiUrl);
      const resp=await fetch(apiUrl);
      const data=await resp.json();
      console.log('[NEXRAD-ANIM] '+prod+' response:',JSON.stringify(data).slice(0,500));
      const scans=data.scans||[];
      if(!scans.length)continue;
      const recent=scans.slice(-25);
      toast(`📡 K${site} — ${recent.length} ${prod} frames loaded`);
      return recent.map(scan=>{
        const dt=new Date(scan.ts);
        const time=Math.floor(dt.getTime()/1000);
        if(isNaN(time))return null;
        const tileTs=dt.getUTCFullYear()+pad2(dt.getUTCMonth()+1)+pad2(dt.getUTCDate())+pad2(dt.getUTCHours())+pad2(dt.getUTCMinutes());
        const tileUrl=`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::${site}-${prod}-${tileTs}/{z}/{x}/{y}.png`;
        return{time,type:'past',site,url:tileUrl};
      }).filter(Boolean);
    }catch(e){console.warn('[NEXRAD-ANIM] '+prod+' failed:',e)}
  }
  toast(`No NEXRAD scans found for K${site}`);
  return[];
}
async function toggleRadarAnim(map){
  if(S._radarAnimPlaying) return stopRadarAnim(map);
  const btn=document.getElementById('radar-anim-btn');
  _ris('radar-anim-btn','anim-loading');
  let animFrames=[];
  if(S.radarSource==='nexrad'){
    const center=map.getCenter();
    const aLat=center.lat,aLon=center.lng;
    const nearSite=findNearestRadar(aLat,aLon);
    toast(`📡 Nearest radar: K${nearSite} — fetching scans...`);
    animFrames=await buildNexradFrames(aLat,aLon);
    S._radarAnimSrc='nexrad';
    S._radarAnimSite=nearSite;
  }else{
    if(!S.radarFrames.length){toast('No radar frames available');_ris('radar-anim-btn','play');return}
    const pastCount=(S.radarFrames||[]).filter(f=>!f.path||!f.path.includes('/nowcast/')).length;
    animFrames=S.radarFrames.map((f,i)=>({
      time:f.time, type:i<pastCount?'past':'forecast',
      url:`https://tilecache.rainviewer.com${f.path}/256/{z}/{x}/{y}/2/1_1.png`
    }));
    S._radarAnimSrc='rainviewer';
  }
  if(!animFrames.length){toast('No radar frames available');_ris('radar-anim-btn','play');return}
  S._radarAnimFrames=animFrames;
  S._radarAnimPlaying=true;
  S._radarAnimPaused=true;
  _ris('radar-anim-btn','stop');btn.classList.add('active');
  const bar=document.getElementById('radar-anim-bar');
  bar.style.display='flex';
  const slider=document.getElementById('radar-anim-slider');
  slider.min=0;slider.max=animFrames.length-1;
  S._radarAnimIdx=0;
  slider.value=0;
  showRadarAnimFrame(map,0);
  startRadarAnimLoop(map);
}
function startRadarAnimLoop(map){
  clearInterval(S._radarAnimTimer);
  S._radarAnimTimer=setInterval(()=>{
    S._radarAnimIdx++;
    if(S._radarAnimIdx>=S._radarAnimFrames.length) S._radarAnimIdx=0;
    document.getElementById('radar-anim-slider').value=S._radarAnimIdx;
    showRadarAnimFrame(map,S._radarAnimIdx);
  },700);
}
function stopRadarAnim(map){
  S._radarAnimPlaying=false;
  S._radarAnimPaused=false;
  clearInterval(S._radarAnimTimer);
  S._radarAnimFrames=[];
  const btn=document.getElementById('radar-anim-btn');
  if(btn){_ris('radar-anim-btn','play');btn.classList.remove('active')}
  const bar=document.getElementById('radar-anim-bar');
  if(bar)bar.style.display='none';
  if(!map)return;
  if(S.radarLayer){map.removeLayer(S.radarLayer);S.radarLayer=null}
  if(S.radarSource==='rainviewer'){
    fetch('https://api.rainviewer.com/public/weather-maps.json').then(r=>r.json()).then(rv=>{
      const past=rv.radar?.past||[];const nowcast=rv.radar?.nowcast||[];
      S.radarFrames=past.concat(nowcast);
      showRadarLayer(map);
    }).catch(()=>showRadarLayer(map));
  }else{
    showRadarLayer(map);
  }
}
function scrubRadarAnim(map,idx){
  clearInterval(S._radarAnimTimer);
  S._radarAnimIdx=idx;
  showRadarAnimFrame(map,idx);
  startRadarAnimLoop(map);
}
function showRadarAnimFrame(map,idx){
  const frames=S._radarAnimFrames;
  if(!frames||!frames[idx])return;
  const frame=frames[idx];
  if(S.radarLayer){map.removeLayer(S.radarLayer);S.radarLayer=null}
  const maxNZ=S._radarAnimSrc==='nexrad'?8:7;
  S.radarLayer=L.tileLayer(frame.url,{opacity:0.7,maxZoom:11,maxNativeZoom:maxNZ}).addTo(map);
  if(S._showZones&&S._rawScanPts&&S._rawScanPts.length>0&&!S._radarOverlayVisible&&S._zoneOverlays&&S._zoneOverlays.length>0&&_shouldAutoHideRadar()&&map.hasLayer(S.radarLayer)){try{map.removeLayer(S.radarLayer)}catch(e){}}
  const t=new Date(frame.time*1000);
  const timeStr=fmtClock(t);
  const isFuture=frame.type==='forecast';
  const siteTag=frame.site||S._radarAnimSite||'';
  const srcTag=S._radarAnimSrc==='nexrad'?(siteTag?'K'+siteTag:'NEX'):'RV';
  const label=isFuture?'▸ '+timeStr+' (forecast)':'◂ '+timeStr;
  document.getElementById('radar-time').textContent=srcTag+' '+timeStr;
  document.getElementById('radar-anim-time').textContent=label;
  const slider=document.getElementById('radar-anim-slider');
  const pct=frames.length>1?idx/(frames.length-1):0;
  slider.style.setProperty('--pct',pct);
}

function showRadarLayer(map){
  if(S.radarLayer){map.removeLayer(S.radarLayer);S.radarLayer=null}
  if(S.nexradLayer){map.removeLayer(S.nexradLayer);S.nexradLayer=null}
  const lbl=document.getElementById('radar-source-label');
  const btn=document.getElementById('radar-toggle-src');
  if(S.radarSource==='nexrad'){
    S.radarLayer=L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?t=${Date.now()}`,{opacity:0.7,maxZoom:11,maxNativeZoom:8}).addTo(map);
    if(btn){_ris('radar-toggle-src','source-nex');btn.style.background='var(--accent-blue)'}
    if(lbl)lbl.textContent='NEXRAD (US) \u00B7 📍 Home \u00B7 🔍 Scan here \u00B7 🔦 HD Scan';
    const t=new Date();
    const el=document.getElementById('radar-time');
    if(el)el.textContent=fmtClock(t);
  }else{
    if(S.radarFrames.length){
      S.radarIdx=S.radarFrames.length-1;
      const frame=S.radarFrames[S.radarIdx];
      S.radarLayer=L.tileLayer(`https://tilecache.rainviewer.com${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,{opacity:0.7,maxZoom:11,maxNativeZoom:7}).addTo(map);
      const t=new Date(frame.time*1000);
      const el=document.getElementById('radar-time');
      if(el)el.textContent=fmtClock(t);
    }
    if(btn){_ris('radar-toggle-src','source-rv');btn.style.background=''}
    if(lbl)lbl.textContent='RainViewer \u00B7 Updated every 10 min \u00B7 📍 Home \u00B7 🔍 Scan here \u00B7 🔦 HD Scan';
  }
  if(S._showZones&&S._rawScanPts&&S._rawScanPts.length>0&&!S._radarOverlayVisible&&S._zoneOverlays&&S._zoneOverlays.length>0&&_shouldAutoHideRadar()&&S.radarLayer&&map.hasLayer(S.radarLayer)){try{map.removeLayer(S.radarLayer)}catch(e){}}
}

function toggleRadarSource(map){
  if(S.radarSource==='nexrad'){
    S.radarSource='rainviewer';
    toast('Switched to RainViewer (global)');
  }else{
    if(!isUSLocation(S.lat,S.lon)){toast('NEXRAD only available for US locations');return}
    S.radarSource='nexrad';
    toast('Switched to NEXRAD (US)');
  }
  clearStormCone();
  clearStormZones();
  S.storms=[];if(typeof bumpStormScanId==='function')bumpStormScanId();S._topStorms=[];S._topStormAnalysis={inbound:[],overhead:[],nearby:[],allWithEta:[]};S._rawScanPts=[];S._sonarClusteredPts=[];S._approachData=null;S._arrowCells=[];
  S.stormMarkers.forEach(m=>map.removeLayer(m));
  S.stormMarkers=[];
  renderStorms();updateStormBadges();
  showRadarLayer(map);
  scanRadarForStorms();
}

function showScanOverlay(skipIfNoMap){
  if(skipIfNoMap&&!S.map)return;
  for(let i=1;i<=3;i++){
    const d=document.getElementById('scan-dot'+i);if(d)d.style.display='inline';
    const c=document.getElementById('scan-dot'+i+'-c');if(c)c.textContent='🔴';
  }
  const t1=document.getElementById('scan-dot1-t');if(t1)t1.textContent='Winds';
  const t2=document.getElementById('scan-dot2-t');if(t2)t2.textContent='Radar';
  const t3=document.getElementById('scan-dot3-t');if(t3)t3.textContent='Storms';
  const dc=document.getElementById('scan-dot1-c');if(dc)dc.textContent='🟡';
}
function scanStep(step,text){
  const prev=document.getElementById('scan-dot'+(step-1)+'-c');
  if(prev)prev.textContent='🟢';
  const cur=document.getElementById('scan-dot'+step+'-c');
  if(cur)cur.textContent='🟡';
  const txt=document.getElementById('scan-dot'+step+'-t');
  if(txt&&text)txt.textContent=text;
}
function hideScanOverlay(){
  const c3=document.getElementById('scan-dot3-c');if(c3)c3.textContent='🟢';
  if(!S.travelMode)scheduleAutoRefresh();
}
function startScanRefreshTimer(){
  if(S._scanRefreshTimer)clearInterval(S._scanRefreshTimer);
  S._lastScanTime=Date.now();
  let nextRefreshMs;
  if(S.travelMode){
    nextRefreshMs=(S.gpsInterval||300)*1000;
  }else{
    const mins=getAutoRefreshMin();
    nextRefreshMs=mins>0?mins*60*1000:0;
  }
  S._nextRefreshAt=nextRefreshMs>0?S._lastScanTime+nextRefreshMs:0;
  const el=document.getElementById('scan-refresh-timer');if(!el)return;
  if(!S._nextRefreshAt){el.textContent='🔄 Off';return;}
  function tick(){
    const remain=Math.max(0,Math.round((S._nextRefreshAt-Date.now())/1000));
    if(remain>=3600){
      const h=Math.floor(remain/3600),m=Math.floor((remain%3600)/60);
      el.textContent='🔄 '+h+'h'+String(m).padStart(2,'0')+'m';
    }else if(remain>=60){
      const m=Math.floor(remain/60),s=remain%60;
      el.textContent='🔄 '+m+':'+String(s).padStart(2,'0');
    }else{
      el.textContent='🔄 '+remain+'s';
    }
    if(remain<=0){el.textContent='🔄 now';clearInterval(S._scanRefreshTimer);}
  }
  tick();
  S._scanRefreshTimer=setInterval(tick,1000);
}

S._airportMarkers=[];
S._airportsVisible=false;
S._airportDataCache=null;
S._airportPlotId=0;

async function toggleAirportMarkers(map){
  const btn=document.getElementById('radar-toggle-airports');
  if(S._airportsVisible){
    clearAirportMarkers(map);
    btn.style.background='';
    btn.style.borderColor='';
    return;
  }
  btn.style.background='rgba(0,229,255,0.2)';
  btn.style.borderColor='var(--accent-cyan)';
  S._airportsVisible=true;
  if(S._airportDataCache&&S._airportDataCache.length){
    plotAirportMarkers(map,S._airportDataCache);
    return;
  }
  toast('Loading airports...');
  try{
    let stations=[];
    let nwsOk=false;
    try{
      if(!isNWSCoverage(S.lat,S.lon)){console.log('[non-US] Skipped: NWS airport lookup — using AWC/global');throw new Error('non-US')}
      const r=await fetch(`https://api.weather.gov/points/${S.lat.toFixed(4)},${S.lon.toFixed(4)}`,{...NWS_HDR,signal:AbortSignal.timeout(5000)});
      if(r.ok){
        const pt=await r.json();
        const stUrl=pt.properties?.observationStations;
        if(stUrl){
          const sr=await fetch(stUrl,{...NWS_HDR,signal:AbortSignal.timeout(5000)});
          if(sr.ok){
            const sd=await sr.json();
            const features=sd.features||[];
            if(features.length){
              stations=features.slice(0,15).map(f=>({icao:f.properties.stationIdentifier,name:f.properties.name||'',lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],dist:haversine(S.lat,S.lon,f.geometry.coordinates[1],f.geometry.coordinates[0])}));
              nwsOk=true;
              console.log('Map airports: NWS found',stations.length);
            }
          }
        }
      }
    }catch(e){console.log('Map airports: NWS error:',e.message)}
    if(!stations.length){
      const radii=[1.5,3.0,5.0];
      for(const deg of radii){
        try{
          const r2=await fetch(`https://aviationweather.gov/api/data/stationinfo?bbox=${(S.lat-deg).toFixed(2)},${(S.lon-deg).toFixed(2)},${(S.lat+deg).toFixed(2)},${(S.lon+deg).toFixed(2)}&format=json`,{signal:AbortSignal.timeout(8000)});
          if(r2.ok){
            const body=await r2.json();
            if(Array.isArray(body)){
              const mc=body.filter(s=>s.siteType&&(Array.isArray(s.siteType)?s.siteType.includes('METAR'):String(s.siteType).includes('METAR')));
              if(mc.length){
                stations=mc.map(s=>({icao:s.icaoId,name:s.site||s.icaoId,lat:s.lat,lon:s.lon,dist:haversine(S.lat,S.lon,s.lat,s.lon)})).sort((a,b)=>a.dist-b.dist).slice(0,15);
                console.log('Map airports: AWC stationinfo found',stations.length,'in ±'+deg+'°');
                break;
              }
            }
          }
        }catch(e){console.log('Map airports: AWC error ±'+deg+'°:',e.message)}
      }
    }
    if(!stations.length){
      const airports=await _loadGlobalAirports();
      stations=_nearestAirports(S.lat,S.lon,airports,200,15);
      if(stations.length)console.log('Map airports: global DB found',stations.length);
    }
    if(stations.length){
      S._airportDataCache=stations;
      plotAirportMarkers(map,stations,nwsOk);
    }else{
      toast('No airports found nearby');
      S._airportsVisible=false;
      btn.style.background='';btn.style.borderColor='';
    }
  }catch(e){
    console.error('Airport fetch:',e);
    toast('Could not load airports');
    S._airportsVisible=false;
    btn.style.background='';btn.style.borderColor='';
  }
}

async function plotAirportMarkers(map,stations,useNWS){
  clearAirportMarkers(map);
  S._airportsVisible=true;
  const plotId=++S._airportPlotId;
  toast('✈️ Loading airports...');
  let results;
  if(useNWS){
    results=await Promise.allSettled(stations.map(async st=>{
      const or=await fetch(`https://api.weather.gov/stations/${st.icao}/observations/latest`,NWS_HDR);
      if(!or.ok)return null;
      const od=await or.json();const p=od.properties||{};
      return{st,tc:p.temperature?.value,wKmh:p.windSpeed?.value,wDir:p.windDirection?.value,
        visMi:p.visibility?.value!=null?(p.visibility.value/1609.34):null,
        clouds:(p.cloudLayers||[]).map(l=>({amount:l.amount,base:l.base}))};
    }));
  }else{
    const ids=stations.map(s=>s.icao).join(',');
    let metars=[];
    try{
      const mr=await fetch(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=json&hours=3`,{signal:AbortSignal.timeout(10000)});
      if(mr.ok)metars=await mr.json();
    }catch(e){console.log('Map airports AWC metar batch error:',e.message)}
    const metarMap=new Map();
    if(Array.isArray(metars))metars.forEach(m=>{if(m.icaoId&&!metarMap.has(m.icaoId))metarMap.set(m.icaoId,m)});
    results=stations.map(st=>{
      const m=metarMap.get(st.icao);
      if(m){
        const wKts=m.wspd!=null?m.wspd:null;
        const wKmh=wKts!=null?wKts*1.852:null;
        const gKts=m.wgst!=null?m.wgst:null;
        const visMi=m.visib!=null?m.visib:null;
        const clouds=(m.clouds||[]).map(c=>({amount:c.cover,base:c.base!=null?{value:c.base/0.3048}:null}));
        return{status:'fulfilled',value:{st,tc:m.temp!=null?m.temp:null,wKmh,wDir:m.wdir,visMi,clouds}};
      }
      return{status:'fulfilled',value:{st,tc:null,wKmh:null,wDir:null,visMi:null,clouds:[]}};
    });
  }
  if(S._airportPlotId!==plotId)return;
  const valid=results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value);
  for(const d of valid){
    const{st,tc,wKmh,wDir,visMi,clouds}=d;
    const fltCat=getFltCat(visMi,{clouds:clouds||[]});
    const fltColor=fltCat==='VFR'?'#22c55e':fltCat==='MVFR'?'#3b82f6':fltCat==='IFR'?'#ef4444':'#d946ef';
    const icon=L.divIcon({
      className:'',
      html:`<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto">
        <div style="background:${fltColor};color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,0.6)">${st.icao}</div>
        <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:5px solid ${fltColor}"></div>
      </div>`,
      iconSize:[50,26],iconAnchor:[25,26]
    });
    const tempStr=tc!=null?fmtTemp(tc):'--';
    const windStr=wKmh!=null?(fmtWind(wKmh)+' '+(wDir!=null?degToDir(wDir):'VRB')):'Calm';
    const visStr=visMi!=null?fmtVis(visMi):'--';
    const skyStr=formatClouds({clouds:clouds||[]});
    const popup=L.popup({className:'storm-popup',maxWidth:220,closeButton:true}).setContent(`
      <div style="font-size:0.8em;line-height:1.5">
        <div style="font-weight:700;color:${fltColor};margin-bottom:4px">✈️ ${st.icao} — ${st.name}</div>
        <div style="display:inline-block;background:${fltColor};color:#fff;padding:0 6px;border-radius:3px;font-size:0.85em;font-weight:600;margin-bottom:4px">${fltCat}</div>
        <span style="color:var(--text-muted);font-size:0.85em;margin-left:4px">${st.dist.toFixed(1)} mi</span>
        <div>🌡️ ${tempStr}</div>
        <div>💨 ${windStr}</div>
        <div>👁️ Vis: ${visStr}</div>
        <div>☁️ ${skyStr}</div>
      </div>
    `);
    const marker=L.marker([st.lat,st.lon],{icon,zIndexOffset:500}).addTo(map).bindPopup(popup);
    S._airportMarkers.push(marker);
  }
  toast(`✈️ ${valid.length} airports loaded`);
}

function clearAirportMarkers(map){
  const m=map||S.map;
  S._airportPlotId++;
  S._airportMarkers.forEach(mk=>{try{if(m)m.removeLayer(mk)}catch(e){}});
  S._airportMarkers=[];
  S._airportsVisible=false;
}

function clearViewScanCircle(){
  if(S._viewScanCircle&&S.map){S.map.removeLayer(S._viewScanCircle);S._viewScanCircle=null}
  if(S._viewScanCenter&&S.map){S.map.removeLayer(S._viewScanCenter);S._viewScanCenter=null}
  if(S._viewScanLabel){S._viewScanLabel.remove();S._viewScanLabel=null}
}
function showViewScanCircle(map,lat,lng,radiusMi,count){
  clearViewScanCircle();
  S._viewScanCircle=L.circle([lat,lng],{radius:radiusMi*1609.34,color:'#00e5ff',fill:false,weight:1.5,dashArray:'8 4'}).addTo(map);
  S._viewScanCenter=L.circleMarker([lat,lng],{radius:4,color:'#00e5ff',fillColor:'#00e5ff',fillOpacity:0.9,weight:1}).addTo(map);
  let label=document.getElementById('view-scan-label');
  if(!label){
    label=document.createElement('div');
    label.id='view-scan-label';
    label.style.cssText='position:absolute;bottom:12px;left:10px;z-index:500;background:rgba(17,24,39,0.92);backdrop-filter:blur(10px);border-radius:6px;padding:4px 10px;font-size:0.65em;color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.2)';
    document.querySelector('.map-container')?.appendChild(label);
  }
  const rLabel=radiusMi>=10?Math.round(radiusMi):radiusMi.toFixed(1);
  label.textContent=`⭕ ${rLabel} mi radius · ${count.toLocaleString()} points`;
  S._viewScanLabel=label;
}

// ==========================================
// UNIFIED RADAR SCAN ENGINE (Phase 2 consolidation)
// One engine for all four scan paths (scanRadarForStorms, scanRadarForView,
// scanRadarHiRes, pollOverheadRain). Center coords are ALWAYS explicit, so the
// old S.lat/S.lon overwrite hack (a known race in view/HiRes) is gone. Owns
// weather-maps.json fetching behind a 60s TTL cache. Returns raw points plus
// scan metadata; each caller's post-pipeline (spacingFilter, hook echoes,
// badges, zones, rain clock, scan snapshot, radar-age bookkeeping) stays in its
// own thin wrapper so per-caller behavior is preserved byte-for-byte.
//   runRadarScan({lat, lon, radiusMi, zoom, step, minDbz, source,
//                 forceRVRefresh, keepStaleTilePath, cacheBustNexrad})
//     -> { points, frames, tilePath, radarAgeMs, zoom } | null
//   Returns null when RainViewer is selected but no usable tile path exists
//   (caller runs its own "no radar data" fallback).
// ==========================================
let _rvScanFramesCache={ts:0,frames:null,tilePath:null};
const _RV_SCAN_FRAMES_TTL_MS=60000;
async function _fetchRvScanFrames(forceRefresh){
  // Returns {frames, tilePath} on a successful fetch (tilePath null if the API
  // returned no frames), or null if the fetch itself threw. A 60s TTL cache
  // stops the four scan paths each hammering weather-maps.json; the overhead
  // poll passes forceRefresh to always pull a fresh no-store copy.
  if(!forceRefresh&&_rvScanFramesCache.tilePath&&(Date.now()-_rvScanFramesCache.ts)<_RV_SCAN_FRAMES_TTL_MS){
    return{frames:_rvScanFramesCache.frames,tilePath:_rvScanFramesCache.tilePath};
  }
  try{
    const opts=forceRefresh?{cache:'no-store'}:{signal:AbortSignal.timeout(6000)};
    const rv=await fetch('https://api.rainviewer.com/public/weather-maps.json',opts).then(r=>r.json());
    const past=rv.radar?.past||[];
    const nowcast=rv.radar?.nowcast||[];
    const frames=past.concat(nowcast);
    const tilePath=frames.length?frames[frames.length-1].path:null;
    if(tilePath)_rvScanFramesCache={ts:Date.now(),frames,tilePath};
    return{frames,tilePath};
  }catch(e){return null}
}
async function runRadarScan(opts){
  const lat=opts.lat,lon=opts.lon;
  const radiusMi=opts.radiusMi!=null?opts.radiusMi:80;
  const source=opts.source||'nexrad';
  const useNexrad=source==='nexrad';
  const minDbz=opts.minDbz!=null?opts.minDbz:15;
  const step=opts.step; // undefined => scanTileForPoints falls back to S._scanStep
  const forceRVRefresh=!!opts.forceRVRefresh;
  const keepStaleTilePath=!!opts.keepStaleTilePath;
  const cacheBustNexrad=!!opts.cacheBustNexrad;
  // Zoom: explicit (fixed) when provided; otherwise auto from radius, then the
  // >48-tile guard walks it down — the guard only runs in the auto path so it
  // matches storms/view exactly while hi-res/overhead keep their fixed zoom.
  const autoZoom=(opts.zoom==null);
  let zoom=autoZoom?(useNexrad?(radiusMi<=15?11:radiusMi<=30?10:radiusMi<=50?9:8):(radiusMi<=30?8:7)):opts.zoom;
  const radiusDeg=radiusMi/69.0;
  const northLat=lat+radiusDeg,southLat=lat-radiusDeg;
  const eastLon=lon+radiusDeg/Math.cos(lat*Math.PI/180);
  const westLon=lon-radiusDeg/Math.cos(lat*Math.PI/180);
  let minTX=lonToTileX(westLon,zoom),maxTX=lonToTileX(eastLon,zoom);
  let minTY=latToTileY(northLat,zoom),maxTY=latToTileY(southLat,zoom);
  if(autoZoom){
    while((maxTX-minTX+1)*(maxTY-minTY+1)>48&&zoom>(useNexrad?8:7)){
      zoom--;minTX=lonToTileX(westLon,zoom);maxTX=lonToTileX(eastLon,zoom);
      minTY=latToTileY(northLat,zoom);maxTY=latToTileY(southLat,zoom);
    }
  }
  let frames=S.radarFrames,tilePath=S._rvTilePath;
  if(!useNexrad){
    const rvRes=await _fetchRvScanFrames(forceRVRefresh);
    if(rvRes&&rvRes.tilePath){
      frames=rvRes.frames;tilePath=rvRes.tilePath;S._rvTilePath=tilePath;
    }else if(keepStaleTilePath&&S._rvTilePath){
      // overhead poll: fetch failed or returned no frames — reuse the last
      // known tile path instead of aborting the quick rain check.
      tilePath=S._rvTilePath;if(rvRes&&rvRes.frames)frames=rvRes.frames;
    }else{
      if(!keepStaleTilePath)S._rvTilePath=null;
      if(!S._rvTilePath)return null;
    }
  }
  const colorFn=useNexrad?nexradToDbz:rvToDbz;
  const ts=Date.now();
  const tilePromises=[];
  for(let tx=minTX;tx<=maxTX;tx++){
    for(let ty=minTY;ty<=maxTY;ty++){
      const url=useNexrad
        ?`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/${zoom}/${tx}/${ty}.png${cacheBustNexrad?`?t=${ts}`:''}`
        :`https://tilecache.rainviewer.com${tilePath}/256/${zoom}/${tx}/${ty}/2/1_1.png`;
      tilePromises.push(scanTileForPoints(url,tx,ty,zoom,colorFn,minDbz,radiusMi,step,lat,lon));
    }
  }
  const tileResults=await Promise.all(tilePromises);
  const points=tileResults.flat();
  const radarAgeMs=(typeof computeRadarAgeMs==='function')?computeRadarAgeMs(useNexrad,frames):RADAR_LATENCY_MS;
  return{points,frames,tilePath,radarAgeMs,zoom};
}

// ---------------------------------------------------------------------------
// v5.46: unified post-scan commit pipeline (Phase 3 of the scan consolidation).
// ONE place that commits engine results into app state and notifies every
// consumer (storm cards, badges, mini-sonar, hero zone, rain clock, ISO grid,
// map markers/zones, threat ticker) so the four scan paths can't drift apart.
// Caller-specific UI (toasts, overlays, SPC/NWS polygons, view circles,
// setView, path arrows, tiered hi-res, cell alerts, winds retry) stays in the
// callers, after this returns.
//
// opts:
//   useNexrad       fallback radar-age bookkeeping when radarAgeMs is absent
//   radarAgeMs      engine-computed age from runRadarScan (preferred)
//   hiRes           hi-res spacingFilter flag + sets S._lastScanWasHiRes
//   sonarZoomReset  hi-res: force sonar zoom to 15 mi before re-clustering
//   fullDetect      full home scan only: hook echoes + NWS-warning rotation
//   plotLabel       n => label for scanStep(3, ...); omitted = no scanStep
//   abortCheck      called after the 300ms plot pause; return false to abort
//                   (commit returns false; caller hides overlay and bails)
//   map             Leaflet map for markers/zones (defaults to S.map)
//   spliceRadiusMi + center {lat,lon}: overhead-poll mode — splice-merge the
//                   new points into S._rawScanPts inside the radius and
//                   refresh hero card + rain clock ONLY (no storm rebuild).
// Returns true when committed (false only when abortCheck failed).
async function commitScanResults(rawPoints,opts){
  opts=opts||{};
  // --- overhead-poll splice mode ---
  if(opts.spliceRadiusMi!=null){
    const c=opts.center;
    const kept=(S._rawScanPts||[]).filter(p=>haversine(c.lat,c.lon,p.lat,p.lng)>opts.spliceRadiusMi);
    S._rawScanPts=kept.concat(rawPoints);
    if(typeof refreshHeroFromZone==='function')refreshHeroFromZone();
    if(typeof refreshRainClock==='function')refreshRainClock(true);
    return true;
  }
  // --- full commit ---
  S._rawScanPts=rawPoints;
  if(opts.sonarZoomReset){_sonarZoomMi=15;localStorage.setItem('st_sonarZoom',15);S._sonarTotalSwept=0;S._sonarSweepAngle=0;_syncSonarZoomBtns();}
  // NOTE: _clusterSonarPoints fires refreshRainClock(true) internally
  // (gauges.js), so the rain clock briefly redraws with fresh raw points and
  // the PRIOR storm list; the explicit refresh after the 300ms pause below
  // converges it — same transient storms/view scans always had in v5.45.
  _clusterSonarPoints();
  S.storms=spacingFilter(rawPoints,!!opts.hiRes).sort((a,b)=>a.distance-b.distance);
  if(typeof bumpStormScanId==='function')bumpStormScanId();
  if(opts.fullDetect){
    console.log('[SCAN] after spacingFilter: '+S.storms.length+' storms');
    detectHookEchoes(rawPoints,S.storms);
    detectWarningRotation(S.storms); // v4.82: rotation gated on active NWS Tornado Warning
  }
  S.scanTime=Date.now();S.lastScanMs=Date.now();S._lastScanWasHiRes=!!opts.hiRes;
  S._radarAgeMs=(opts.radarAgeMs!=null)?opts.radarAgeMs:((typeof computeRadarAgeMs==='function')?computeRadarAgeMs(!!opts.useNexrad):RADAR_LATENCY_MS);
  computeTopStorms();
  recordScanSnapshot();
  if(opts.plotLabel)scanStep(3,opts.plotLabel(S.storms.length));
  await new Promise(r=>setTimeout(r,300));
  if(opts.abortCheck&&!opts.abortCheck())return false;
  renderStorms();updateStormBadges();drawMiniSonar();
  if(typeof refreshHeroFromZone==='function')refreshHeroFromZone();
  if(typeof refreshRainClock==='function')refreshRainClock(true);
  if(typeof ISO!=='undefined'&&ISO.open){ISO._grid=buildTerrainGrid();ISO._dirty=true;}
  const map=opts.map||S.map;
  if(map){
    plotStormMarkers(map);
    if(rawPoints.length>0){autoActivateZones()}
    else{clearStormZones();if(S.radarLayer&&!map.hasLayer(S.radarLayer))try{S.radarLayer.addTo(map)}catch(e){}}
    // v5.72: plot live-lightning LAST (after zones) so the dots sit on top, and
    // self-clear stale dots when ltgLive() has gone false (key removed / expired).
    if(typeof plotLightningStrikes==='function')plotLightningStrikes(map);
  }
  updateThreatTicker();
  // v5.69: live lightning rides the scan pipeline (non-blocking — internally
  // throttled + no-op without a WarPulse key). Re-plots map/sonar on arrival.
  if(typeof refreshLightningStrikes==='function')refreshLightningStrikes();
  return true;
}

// v5.69: real WarPulse strikes on the radar map. Age-faded dots (bright yellow
// <5 min, orange 5-10, dim 10-15); capped at 400 for mobile perf. Cleared and
// redrawn on every scan commit + every successful strike fetch. When live data
// is fresh, the radar-derived ⚡ estimates on storm cells are suppressed.
// v5.73: lightning layer toggle (⚡ button, left radar controls). Default ON.
function _ltgShown(){try{return localStorage.getItem('st_showLtg')!=='0'}catch(e){return true}}
function toggleLightning(){
  const on=!_ltgShown();
  try{localStorage.setItem('st_showLtg',on?'1':'0')}catch(e){}
  const btn=document.getElementById('btn-lightning');if(btn)btn.style.opacity=on?1:0.4;
  if(S.map&&typeof plotLightningStrikes==='function')plotLightningStrikes(S.map);
  if(typeof plotStormMarkers==='function'&&S.map)plotStormMarkers(S.map);
  if(typeof drawMiniSonar==='function')drawMiniSonar();
  if(typeof toast==='function')toast(on?'⚡ Lightning shown':'⚡ Lightning hidden');
}
if(typeof window!=='undefined'){window.toggleLightning=toggleLightning;window._ltgShown=_ltgShown;}
function plotLightningStrikes(map){
  if(!S.ltgMarkers)S.ltgMarkers=[];
  S.ltgMarkers.forEach(m=>{try{map.removeLayer(m)}catch(e){}});
  S.ltgMarkers=[];
  if(typeof _ltgShown==='function'&&!_ltgShown())return;
  if(typeof ltgLive!=='function'||!ltgLive())return;
  // v5.70: draw on a dedicated top pane (z above the hex/zone overlay so strikes
  // are never buried), and make the dots bigger with a dark halo so they read
  // against bright radar returns — the old 2.5 px stroke-less dots vanished.
  try{if(!map.getPane('ltgPane')){map.createPane('ltgPane');const p=map.getPane('ltgPane');if(p){p.style.zIndex=620;p.style.pointerEvents='none';}}}catch(e){}
  const havePane=(()=>{try{return !!map.getPane('ltgPane')}catch(e){return false}})();
  const now=Date.now();
  // v5.74: show strikes as ⚡ bolts (not plain dots that blend into the radar).
  // Cluster into ~0.03° (~2 mi) cells so it's one bolt per cell with a count,
  // like the sonar — keeps it readable and the marker count low on mobile.
  const cells=new Map();
  for(const f of S._ltgStrikes.flashes){
    if(typeof f.lat!=='number'||typeof f.lon!=='number')continue;
    const qk=Math.round(f.lat/0.03)+'_'+Math.round(f.lon/0.03);
    const ageMin=f.t?(now-f.t)/60000:15;
    let c=cells.get(qk);
    if(!c){c={latSum:0,lonSum:0,n:0,minAge:ageMin};cells.set(qk,c);}
    c.latSum+=f.lat;c.lonSum+=f.lon;c.n++;if(ageMin<c.minAge)c.minAge=ageMin;
  }
  const arr=[...cells.values()].sort((a,b)=>a.minAge-b.minAge).slice(0,220);
  for(const c of arr){
    const lat=c.latSum/c.n,lon=c.lonSum/c.n,ageMin=c.minAge;
    const op=ageMin<5?1:ageMin<10?0.8:0.5;
    // real strikes PULSE (fresh <10 min) so they read as live vs the solid estimate.
    const cls=ageMin<10?'ltg-strike-real':'';
    const cnt=c.n>1?`<span style="font-size:8px;font-weight:800;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000;margin-left:-1px;vertical-align:super">${c.n>99?'99+':c.n}</span>`:'';
    const html=`<div class="${cls}" style="opacity:${op};font-size:15px;line-height:1;text-shadow:0 0 3px #000,0 0 4px #000;white-space:nowrap">⚡${cnt}</div>`;
    try{
      const m=L.marker([lat,lon],{icon:L.divIcon({className:'ltg-bolt',html,iconSize:[22,18],iconAnchor:[8,9]}),interactive:false,keyboard:false,pane:havePane?'ltgPane':'markerPane'});
      m.addTo(map);S.ltgMarkers.push(m);
    }catch(e){}
  }
}

async function scanRadarForView(){
  if(S._radarAnimPlaying)stopRadarAnim(S.map);
  if(!S.map)return;
  const center=S.map.getCenter();
  const cLat=center.lat,cLng=center.lng;
  const useNexrad=S.radarSource==='nexrad';
  const radius=S.scanRadius;
  showScanOverlay();
  // v4.76: gate on winds aloft before scanning/rendering points.
  const _vReqId=S._locReqId;
  const _waOk=await ensureWindsAloft(cLat,cLng,_vReqId);
  if(_vReqId!==S._locReqId){hideScanOverlay();return}
  if(!_waOk)toast('⚠️ Winds aloft unavailable — storm motion & ETAs may be limited');
  scanStep(2,'Scanning radar tiles...');
  try{
    // v5.44: thin wrapper over the unified runRadarScan engine — center coords
    // are passed explicitly so the old S.lat/S.lon overwrite hack is gone.
    const result=await runRadarScan({
      lat:cLat,lon:cLng,
      radiusMi:radius,
      minDbz:15,
      source:useNexrad?'nexrad':'rainviewer'
    });
    if(!result){hideScanOverlay();toast('No radar data');return}
    if(!useNexrad)S.radarFrames=result.frames;
    const rawPoints=result.points;

    // v5.46: unified commit pipeline — view-scan extras (scan circle, toast)
    // remain below. No abortCheck: view scans never had a post-plot recheck.
    await commitScanResults(rawPoints,{
      useNexrad,
      radarAgeMs:result.radarAgeMs,
      plotLabel:n=>`Plotting ${n.toLocaleString()} storm points...`
    });
    const srcLabel=useNexrad?'NEXRAD':'RainViewer';
    if(S.map)showViewScanCircle(S.map,cLat,cLng,radius,S.storms.length);
    hideScanOverlay();
    toast(`${S.storms.length.toLocaleString()} cells in ${radius} mi radius (${srcLabel})`);
    scheduleAutoScan();
    setTimeout(()=>{checkStormCellAlerts()},600);
    if(!S._windCache||(Date.now()-S._windCache.ts)>32*60000){
      console.log('[WindsAloft] Timed out — scheduling auto-retry in 4s...');
      setTimeout(async()=>{
        await fetchWindsAloft(cLat,cLng);
        if(S._windCache&&(Date.now()-S._windCache.ts)<6000&&S.storms.length){
          if(typeof refreshStormViewsForWinds==='function')refreshStormViewsForWinds();
          console.log('[WindsAloft] All storm surfaces refreshed with fresh winds');
        }
      },4000);
    }
  }catch(e){hideScanOverlay();toast('View scan failed: '+e.message);console.error('ViewScan error:',e)}
}

async function scanRadarHiRes(map,fromHome){
  if(S._radarAnimPlaying){stopRadarAnim(map);}
  if(!map)return;
  if(!S._etaRescanInProgress)S._stormETAs={};
  const center=fromHome?{lat:S.lat,lng:S.lon}:map.getCenter();
  const cLat=center.lat,cLng=center.lng;
  const useNexrad=S.radarSource==='nexrad';
  const HIRES_RADIUS=15;
  const hiZoom=useNexrad?10:7;
  showScanOverlay();
  // v4.76: gate on winds aloft before scanning/rendering points.
  const _hReqId=S._locReqId;
  const _waOk=await ensureWindsAloft(cLat,cLng,_hReqId);
  if(_hReqId!==S._locReqId){hideScanOverlay();return}
  if(!_waOk)toast('⚠️ Winds aloft unavailable — storm motion & ETAs may be limited');
  scanStep(2,'Hi-Res scanning (step=1)...');
  try{
    // v5.44: thin wrapper over the unified runRadarScan engine — fixed hi-res
    // zoom + step=1 + 15 mi radius, explicit center (no S.lat/S.lon hack).
    const result=await runRadarScan({
      lat:cLat,lon:cLng,
      radiusMi:HIRES_RADIUS,
      zoom:hiZoom,
      step:1,
      minDbz:10,
      source:useNexrad?'nexrad':'rainviewer'
    });
    if(!result){hideScanOverlay();toast('No radar data');return}
    if(!useNexrad)S.radarFrames=result.frames;
    const rawPoints=result.points;

    // v5.46: unified commit pipeline — hiRes flag drives the spacingFilter
    // hi-res mode + S._lastScanWasHiRes; sonarZoomReset snaps sonar to 15 mi
    // before re-clustering (every hi-res call site passes map===S.map).
    await commitScanResults(rawPoints,{
      useNexrad,
      radarAgeMs:result.radarAgeMs,
      hiRes:true,
      sonarZoomReset:true,
      map,
      plotLabel:n=>`Hi-Res: ${n.toLocaleString()} points in ${HIRES_RADIUS} mi`
    });
    const srcLabel=useNexrad?'NEXRAD':'RainViewer';
    showViewScanCircle(map,cLat,cLng,HIRES_RADIUS,S.storms.length);
    if(S.map&&S._showPathArrows)setTimeout(()=>buildPathArrows(S.map),150);
    map.setView([cLat,cLng],11,{animate:true,duration:0.5});
    hideScanOverlay();
    toast(`Hi-Res: ${S.storms.length.toLocaleString()} cells in ${HIRES_RADIUS} mi (${srcLabel})`);
    scheduleAutoScan();
    setTimeout(()=>{checkStormCellAlerts()},600);
    if(!S._windCache||(Date.now()-S._windCache.ts)>32*60000){
      console.log('[WindsAloft] Timed out — scheduling auto-retry in 4s...');
      setTimeout(async()=>{
        await fetchWindsAloft(cLat,cLng);
        if(S._windCache&&(Date.now()-S._windCache.ts)<6000&&S.storms.length){
          if(typeof refreshStormViewsForWinds==='function')refreshStormViewsForWinds();
          console.log('[WindsAloft] All storm surfaces refreshed with fresh winds');
        }
      },4000);
    }
  }catch(e){hideScanOverlay();toast('Hi-Res scan failed: '+e.message);console.error('HiRes error:',e)}
}

function stormArrowSvg(deg,color,size){
  return`<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="transform:rotate(${deg}deg)">
    <polygon points="20,4 30,30 20,24 10,30" fill="${color}" fill-opacity="0.85" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}

function destPoint(lat,lon,bearing,distMi){
  const R=3958.8;const d=distMi/R;
  const br=bearing*Math.PI/180;
  const lat1=lat*Math.PI/180,lon1=lon*Math.PI/180;
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));
  const lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1),Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
  return[lat2*180/Math.PI,lon2*180/Math.PI];
}
function showStormCone(map,storm){
  const sk=stormKey(storm);
  if(S._activeConeKey===sk){clearStormCone();return}
  clearStormCone();
  const mv=(typeof getHybridMovement==='function'?getHybridMovement(storm):null)||S.stormMovement;
  if(!mv||mv.speed<2)return;
  const range=Math.min(60,Math.max(storm.distance*1.5,20));
  const color=dbzHex(storm.dbz);
  const baseWidthMi=Math.max(0,Math.min(3,(storm.dbz-20)/15));
  const dir=mv.direction;
  const perpL=(dir-90+360)%360;
  const perpR=(dir+90)%360;
  let pts;
  if(baseWidthMi>0.1){
    const bL=destPoint(storm.lat,storm.lng,perpL,baseWidthMi);
    const bR=destPoint(storm.lat,storm.lng,perpR,baseWidthMi);
    const fL=destPoint(bL[0],bL[1],dir-15,range);
    const fC=destPoint(storm.lat,storm.lng,dir,range);
    const fR=destPoint(bR[0],bR[1],dir+15,range);
    pts=[bL,fL,fC,fR,bR];
  }else{
    const fL=destPoint(storm.lat,storm.lng,dir-15,range);
    const fC=destPoint(storm.lat,storm.lng,dir,range);
    const fR=destPoint(storm.lat,storm.lng,dir+15,range);
    pts=[[storm.lat,storm.lng],fL,fC,fR,[storm.lat,storm.lng]];
  }
  S._activeCone=L.polygon(pts,{color,fillColor:color,fillOpacity:0.1,weight:1.5,dashArray:'6,4',interactive:false}).addTo(map);
  S._activeConeKey=sk;
  if(mv.source&&mv.source!=='aloft'){
    const _cpct=Math.round((mv.confidence||0)*100);
    const _clbl=mv.source==='observed'?'📡 Observed':'📡 Hybrid';
    const _ccol=mv.source==='observed'?'#22d3ee':'#a3e635';
    S._activeConeLabel=L.marker([storm.lat,storm.lng],{interactive:false,icon:L.divIcon({className:'',html:`<div style="font-size:10px;font-weight:700;color:${_ccol};background:rgba(0,0,0,0.7);padding:1px 5px;border-radius:4px;white-space:nowrap;transform:translate(8px,-50%)">${_clbl} ${_cpct}%</div>`,iconSize:[1,1],iconAnchor:[0,0]})}).addTo(map);
  }
  S.stormMarkers.forEach(m=>{
    if(m._stormTrackKey&&m._stormTrackKey!==sk){
      if(m._map||m._container)try{map.removeLayer(m)}catch(e){}
      m._trackHidden=true;
    }
  });
  const btn=document.getElementById('radar-clear-cone');
  if(btn)btn.style.display='flex';
}
function clearStormCone(){
  if(S._activeCone&&S.map){S.map.removeLayer(S._activeCone);S._activeCone=null}
  if(S._activeConeLabel&&S.map){try{S.map.removeLayer(S._activeConeLabel)}catch(e){}S._activeConeLabel=null}
  S._activeConeKey=null;
  if(S.map){
    S.stormMarkers.forEach(m=>{
      if(m._stormTrackKey&&m._trackHidden){
        try{m.addTo(S.map)}catch(e){}
        m._trackHidden=false;
      }
    });
  }
  const btn=document.getElementById('radar-clear-cone');
  if(btn)btn.style.display='none';
}
function flyToStormAlert(lat,lng){
  if(lat==null||lng==null)return;
  const dist=haversine(S.lat,S.lon,lat,lng);
  if(dist>100){toast('Storm alert location is too far from current position');return;}
  switchPage('radar');
  setTimeout(()=>{
    if(!S.map)return;
    S.map.flyTo([lat,lng],11,{duration:0.8});
    if(S._alertHighlight){S.map.removeLayer(S._alertHighlight);S._alertHighlight=null}
    const ring=L.circleMarker([lat,lng],{radius:22,color:'#00eeff',weight:3,fillColor:'#00eeff',fillOpacity:0.1,interactive:false,className:'alert-highlight-ring'});
    ring.addTo(S.map);
    S._alertHighlight=ring;
    let pulseCount=0;
    const pulseTimer=setInterval(()=>{
      pulseCount++;
      const op=pulseCount%2===0?0.12:0.25;
      try{ring.setStyle({fillOpacity:op,weight:pulseCount%2===0?2:3.5})}catch(e){}
      if(pulseCount>=10){clearInterval(pulseTimer);try{S.map.removeLayer(ring)}catch(e){};S._alertHighlight=null}
    },500);
  },300);
}
function flyToStorm(lat,lng){
  if(lat==null||lng==null)return;
  switchPage('radar');
  setTimeout(()=>{
    if(!S.map)return;
    S.map.flyTo([lat,lng],11,{duration:0.8});
    const storm=(S.storms||[]).find(s=>Math.abs(s.lat-lat)<0.01&&Math.abs(s.lng-lng)<0.01);
    if(storm)setTimeout(()=>showStormCone(S.map,storm),900);
    else{
      if(S._alertHighlight){S.map.removeLayer(S._alertHighlight);S._alertHighlight=null}
      const ring=L.circleMarker([lat,lng],{radius:22,color:'#00eeff',weight:3,fillColor:'#00eeff',fillOpacity:0.1,interactive:false});
      ring.addTo(S.map);S._alertHighlight=ring;
      setTimeout(()=>{try{S.map.removeLayer(ring)}catch(e){};S._alertHighlight=null},5000);
    }
  },300);
}
function isClutterOnly(){
  if(!S.storms||!S.storms.length)return false;
  const sig=S.storms.filter(s=>s.dbz>=31);
  if(sig.length>0)return false;
  const low=S.storms.filter(s=>s.dbz<22);
  if(low.length===S.storms.length&&S.storms.length<=12)return true;
  return S.storms.length<=8;
}
function getVisibleStormList(){
  if(!S.storms||!S.storms.length)return[];
  if(isClutterOnly()&&!S.showClutter)return[];
  return S.storms;
}
function toggleClutter(){
  S.showClutter=!S.showClutter;
  const btn=document.getElementById('clutter-toggle');
  if(btn){
    btn.style.background=S.showClutter?'rgba(250,204,21,0.3)':'rgba(0,0,0,0.5)';
    btn.style.borderColor=S.showClutter?'#facc15':'#555';
    btn.title=S.showClutter?'Showing clutter (tap to hide)':'Clutter hidden (tap to show)';
  }
  if(S.map){
    S.stormMarkers.forEach(m=>S.map.removeLayer(m));S.stormMarkers=[];
  }
  renderStormMarkers();
  if(S.activePage==='storms')renderStorms();
  updateStormBadges();
  drawMiniSonar();
  if(typeof ISO!=='undefined'&&ISO.open){ISO._grid=buildTerrainGrid();ISO._dirty=true;}
}
function updateClutterButton(){
  const btn=document.getElementById('clutter-toggle');
  if(!btn)return;
  const clutter=isClutterOnly();
  btn.style.display=clutter?'flex':'none';
  if(clutter){
    btn.style.background=S.showClutter?'rgba(250,204,21,0.3)':'rgba(0,0,0,0.5)';
    btn.style.borderColor=S.showClutter?'#facc15':'#555';
    btn.title=S.showClutter?'Showing clutter (tap to hide)':'Clutter hidden (tap to show)';
  }
}
function zoomScale(map){
  const z=map.getZoom();
  return z>=10?1.4:z>=9?1.2:z>=8?1.0:z>=7?0.7:z>=6?0.45:z>=5?0.3:0.2;
}

function plotStormMarkers(map){
  S.stormMarkers.forEach(m=>map.removeLayer(m));S.stormMarkers=[];
  clearStormCone();
  clearStormTracks();
  updateClutterButton();
  const stormList=getVisibleStormList();
  if(!stormList.length)return;
  const mv=(typeof getSteeringMv==='function')?getSteeringMv():(S.stormMovement&&S.stormMovement.speed>=2?S.stormMovement:null);
  const sc=zoomScale(map);
  const pending=[];
  let visibleStorms=stormList;
  if(S._pointsMode==='inbound'){
    if(S._topStorms&&S._topStorms.length){
      visibleStorms=S._topStorms;
    }else{
      const inbound=[];
      for(const st of stormList){
        const eta=calcStormETA(st);
        if(!(eta&&eta.approaching&&eta.eta))continue;
        const k=(st._brief&&st._brief.classification)||(typeof calcStormETAForBriefing==='function'?(calcStormETAForBriefing(st)||{}).classification:null);
        if(k==='direct'||k==='near_direct'||k==='near_miss')inbound.push({storm:st,eta});
      }
      inbound.sort((a,b)=>a.storm.dbz===b.storm.dbz?(a.eta.eta-b.eta.eta):(b.storm.dbz-a.storm.dbz));
      visibleStorms=inbound.slice(0,12).map(i=>i.storm);
    }
  }
  const visibleSet=new Set(visibleStorms);
  stormList.forEach(storm=>{
    const cat=stormCat(storm.dbz);
    const _stormTier=storm._rotation?'hook':storm.dbz>=65?'extreme':storm.dbz>=60?'severe':storm.dbz>=52?'strong':'';
    const color=_stormTier==='hook'?'#ff1744':_stormTier==='extreme'?'#ff00ff':_stormTier==='severe'?'#ff1744':_stormTier==='strong'?'#c2410c':dbzHex(storm.dbz);
    const _tierBoost=_stormTier==='extreme'?1.35:_stormTier==='severe'?1.2:_stormTier==='strong'?1.1:1.0;
    const r=Math.max(4,Math.round(Math.max(10,storm.dbz/4)*sc*_tierBoost));
    const eta=calcStormETA(storm);
    const _smv=(typeof getHybridMovement==='function'?getHybridMovement(storm):null)||mv;
    const popupId='pop_'+Math.random().toString(36).slice(2,8);
    let mvHtml='';
    if(_smv&&_smv.speed>=2){
      const spdStr=S.radarMetric?Math.round(_smv.speed*1.60934)+' km/h':_smv.speed+' mph';
      const imp=impactLabel(eta?eta.impact:0);
      const _srcB=(typeof _movSourceBadge==='function')?_movSourceBadge(_smv):'';
      mvHtml=`<div style="font-size:0.75em;color:#8cf;margin-top:6px;padding-top:6px;border-top:1px solid #333">→ ${degToDir(_smv.direction)} (${Math.round(_smv.direction)}°) ${tStr('at')} ${spdStr}${_srcB}</div>`;
      if(eta&&eta.proximity){
        mvHtml+=`<div style="font-size:0.75em;color:#f97316;margin-top:2px;font-weight:700">⚠️ ${tStr('Overhead · Moving away')}</div>`;
        mvHtml+=`<div style="font-size:0.85em;font-weight:700;color:${imp.color};margin-top:2px">${eta.impact}% ${tStr(imp.text)}</div>`;
      }else if(eta&&eta.approaching&&eta.impact>0){
        const sk=stormKey(storm);
        let targetMs;
        if(S._stormETAs[sk]&&S._stormETAs[sk]>Date.now()){
          targetMs=S._stormETAs[sk];
        }else{
          const elapsedMin=S.scanTime?(Date.now()-S.scanTime)/60000:0;
          const remainMin=Math.max(0,eta.eta-elapsedMin-radarAgeMin());
          targetMs=Date.now()+remainMin*60000;
          S._stormETAs[sk]=targetMs;
        }
        const remainSec=Math.max(0,Math.round((targetMs-Date.now())/1000));
        const remainMin=(targetMs-Date.now())/60000;
        const arrTime=fmtArrivalTime(remainMin);
        mvHtml+=`<div style="margin-top:4px;padding:4px 8px;background:rgba(0,0,0,0.3);border-radius:6px;border:1px solid ${imp.color}44">
          <div style="font-size:0.7em;color:#aaa">⏱ ${tStr('Countdown')}</div>
          <div style="font-size:1.1em;font-weight:700;color:${imp.color};font-family:monospace" class="popup-countdown" data-target="${Math.round(targetMs)}">${fmtCountdown(remainSec)}</div>
          <div style="font-size:0.7em;color:#bbb;margin-top:2px">${tStr('Arrives')} ~${arrTime}</div>
        </div>`;
        mvHtml+=`<div style="font-size:0.85em;font-weight:700;color:${imp.color};margin-top:4px">${eta.impact}% ${tStr(imp.text)}</div>`;
      }else{
        mvHtml+=`<div style="font-size:0.7em;color:#6b7;margin-top:2px">${tStr('Nearby · Not approaching')}</div>`;
      }
    }
    const hookInfo=storm._rotation?`<div style="font-size:0.8em;font-weight:700;color:#ff1744;margin-top:4px;padding:3px 8px;background:rgba(255,23,68,0.15);border:1px solid rgba(255,23,68,0.3);border-radius:6px;animation:tornado-pulse 1.8s ease-in-out infinite">🌪️ Tornado Warning — Rotation</div>`:'';
    const popupHtml=`<div style="text-align:center;font-family:system-ui;min-width:155px">
      <div style="font-size:1.3em;font-weight:700;color:${color}">${storm.dbz} dBZ</div>
      <div style="font-size:0.8em;margin:2px 0">${tStr(cat.label)}</div>
      <div style="font-size:0.7em;color:#aaa">${cat.rain||''}</div>
      ${hookInfo}
      <div style="font-size:0.8em;color:#ccc;margin-top:4px">${fmtStormDist(storm.distance)} ${degToDir(storm.bearing)}</div>
      ${mvHtml}
      <div style="font-size:0.65em;color:#777;margin-top:6px">${storm.lat.toFixed(3)}°, ${Math.abs(storm.lng).toFixed(3)}° · ${storm.pixels} returns</div>
    </div>`;
    const popupOpts={closeButton:true,className:'storm-popup'};
    const stormRef=storm;
    if(_smv&&_smv.speed>=2){
      const dbzScale=Math.max(0.4,Math.min(1.0,(storm.dbz-20)/45+0.4));
      const baseSz=Math.max(24,storm.dbz/2)*sc;
      const sz=Math.max(10,Math.round(baseSz*dbzScale));
      const svgHtml=stormArrowSvg(_smv.direction,color,sz);
      pending.push({type:'arrow',lat:storm.lat,lng:storm.lng,sz,svgHtml,popupHtml,popupOpts,stormRef,_dbz:storm.dbz});
    }else{
      pending.push({type:'circle',lat:storm.lat,lng:storm.lng,r,color,popupHtml,popupOpts,stormRef,_dbz:storm.dbz});
    }
    if(eta&&eta.approaching&&visibleSet.has(storm)){
      const ringRadiusM=Math.max(800,Math.min(5000,(storm.dbz-15)*80));
      pending.push({type:'ring',lat:storm.lat,lng:storm.lng,ringRadiusM,color,dbz:storm.dbz,stormRef,_dbz:storm.dbz});
    }
    if(storm.dbz>=40&&(typeof _ltgShown!=='function'||_ltgShown())&&!(typeof ltgLive==='function'&&ltgLive())){
      // radar-derived ⚡ estimate — suppressed while real WarPulse strikes are fresh
      pending.push({type:'lightning',lat:storm.lat,lng:storm.lng,stormRef,_dbz:storm.dbz});
    }
    if(S._stormAlertHistory&&S._stormAlertHistory.length){
      const hasAlert=S._stormAlertHistory.some(h=>{
        if(h.lat==null)return false;
        const dlat=Math.abs(h.lat-storm.lat),dlng=Math.abs(h.lng-storm.lng);
        return dlat<0.05&&dlng<0.05&&(Date.now()-h.ts<600000);
      });
      if(hasAlert)pending.push({type:'alertBadge',lat:storm.lat,lng:storm.lng,stormRef:storm});
    }
    if(storm._rotation){
      pending.push({type:'tornado',lat:storm.lat,lng:storm.lng,stormRef:storm});
    }
    
  });
  const offscreen=document.createElement('div');
  offscreen.style.cssText='position:absolute;left:-9999px;top:-9999px;visibility:hidden';
  document.body.appendChild(offscreen);
  const arrowItems=pending.filter(p=>p.type==='arrow');
  arrowItems.forEach(p=>{
    const el=document.createElement('div');
    el.innerHTML=p.svgHtml;
    offscreen.appendChild(el);
  });
  requestAnimationFrame(()=>{requestAnimationFrame(()=>{
    document.body.removeChild(offscreen);
    const _typeOrder={ring:0,circle:1,arrow:2,lightning:3,alertBadge:4,tornado:5};
    pending.sort((a,b)=>{const da=(a._dbz||0),db=(b._dbz||0);return da!==db?da-db:(_typeOrder[a.type]||0)-(_typeOrder[b.type]||0)});
    const mode=S._pointsMode;
    pending.forEach(p=>{
      const isVisible=(mode==='all')||(mode==='inbound'&&visibleSet.has(p.stormRef));
      if(p.type==='arrow'){
        const arrow=L.marker([p.lat,p.lng],{pane:map.getPane('storm-arrow-pane')?'storm-arrow-pane':undefined,icon:L.divIcon({className:'storm-arrow-icon',html:p.svgHtml,iconSize:[p.sz,p.sz],iconAnchor:[p.sz/2,p.sz/2]})});
        if(isVisible)arrow.addTo(map);
        arrow.bindPopup(p.popupHtml,p.popupOpts);
        arrow.on('click',()=>showStormCone(map,p.stormRef));
        arrow._stormRef=p.stormRef;
        S.stormMarkers.push(arrow);
      }else if(p.type==='circle'){
        const marker=L.circleMarker([p.lat,p.lng],{radius:p.r,color:p.color,fillColor:p.color,fillOpacity:0.6,weight:2});
        if(isVisible)marker.addTo(map);
        marker.bindPopup(p.popupHtml,p.popupOpts);
        marker.on('click',()=>showStormCone(map,p.stormRef));
        marker._stormRef=p.stormRef;
        S.stormMarkers.push(marker);
      }else if(p.type==='ring'){
        const _dbz=p.dbz||30;
        const _isHook=p.stormRef&&p.stormRef._rotation;
        const _tier=_isHook?'hook':_dbz>=65?'extreme':_dbz>=60?'severe':_dbz>=52?'strong':'';
        const _baseDur=4.5-(_dbz/20);
        const _sinVal=Math.sin(p.lat*1000+p.lng*7777);
        const _jitter=(_sinVal+1)/2*0.6-0.3;
        let _dur;
        if(_tier==='hook')_dur='1.40';
        else if(_tier==='extreme')_dur='1.00';
        else if(_tier==='severe')_dur='1.60';
        else if(_tier==='strong')_dur='2.40';
        else _dur=Math.max(1.0,Math.min(4.0,_baseDur+_jitter)).toFixed(2);
        const _cls=_tier?('tier-'+_tier):(_dbz>55?'ring-shrink':_dbz>=41?'ring-pulse':'ring-grow');
        const _tierColor=_tier==='hook'?'#ff1744':_tier==='extreme'?'#ff00ff':_tier==='severe'?'#ff1744':_tier==='strong'?'#c2410c':p.color;
        const _border=_tier==='extreme'?5:(_tier==='severe'||_tier==='hook')?4:3;
        const _glow=_tier==='extreme'?`0 0 14px ${_tierColor},0 0 28px ${_tierColor}`:_tier==='severe'?`0 0 10px ${_tierColor},0 0 20px ${_tierColor}`:_tier==='hook'?`0 0 10px ${_tierColor},0 0 18px ${_tierColor}`:_tier==='strong'?`0 0 8px ${_tierColor}`:`0 0 8px ${_tierColor}`;
        function _ringPx(lat,radiusM,mp){const pt=mp.latLngToLayerPoint([lat,0]);const pt2=mp.latLngToLayerPoint([lat+radiusM/111320,0]);return Math.max(20,Math.abs(pt.y-pt2.y)*2);}
        const sz0=_ringPx(p.lat,p.ringRadiusM,map);
        const ring=L.marker([p.lat,p.lng],{interactive:false,icon:L.divIcon({className:'',html:`<div class="storm-ring ${_cls}" style="width:${sz0}px;height:${sz0}px;border:${_border}px solid ${_tierColor};box-shadow:${_glow};animation-duration:${_dur}s"></div>`,iconSize:[sz0,sz0],iconAnchor:[sz0/2,sz0/2]})});
        ring._ringData={lat:p.lat,radiusM:p.ringRadiusM,color:_tierColor,cls:_cls,dur:_dur,border:_border,glow:_glow};
        if(isVisible)ring.addTo(map);
        ring._stormRef=p.stormRef;
        S.stormMarkers.push(ring);
      }else if(p.type==='lightning'){
        const lightning=L.marker([p.lat,p.lng],{interactive:false,icon:L.divIcon({className:'storm-lightning-icon',html:`<div style="font-size:18px;text-shadow:0 0 6px #fff">⚡</div>`,iconSize:[20,20],iconAnchor:[10,10]})});
        if(isVisible)lightning.addTo(map);
        lightning._stormRef=p.stormRef;
        S.stormMarkers.push(lightning);
      }else if(p.type==='alertBadge'){
        const badge=L.marker([p.lat,p.lng],{interactive:false,icon:L.divIcon({className:'',html:`<div style="font-size:10px;font-weight:700;color:#fff;background:#e53935;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 0 4px #e53935;pointer-events:none">⚠</div>`,iconSize:[16,16],iconAnchor:[-4,-4]})});
        if(isVisible)badge.addTo(map);
        badge._stormRef=p.stormRef;
        S.stormMarkers.push(badge);
      }else if(p.type==='tornado'){
        const torIcon=L.marker([p.lat,p.lng],{interactive:false,icon:L.divIcon({className:'',html:`<div style="font-size:22px;text-shadow:0 0 10px #ff1744,0 0 20px #ff1744;animation:tornado-pulse 1.8s ease-in-out infinite;pointer-events:none">🌪️</div>`,iconSize:[26,26],iconAnchor:[13,-8]})});
        if(isVisible)torIcon.addTo(map);
        torIcon._stormRef=p.stormRef;
        S.stormMarkers.push(torIcon);
      }
    });
    if(S._tracksMode!=='off')plotStormTracks(map);
    if(S._relMotionMode!=='off')buildRelMotionLayers(map);
  })});
}

S._stormZoneLayers=[];
S._rawScanPts=[];
S._sonarClusteredPts=[];
S._showZones=true;
S._showPathArrows=true;
S._pathArrowStyle='chevron';
S._pathArrowLayers=[];
S._pathArrowAnimInterval=null;
S._pathArrowsDirty=false;
const DBZ_BINS=DBZ_SCALE.filter(e=>e.min>=15);
S._radarGridLayers=[];
function clearRadarGrid(){
  S._radarGridLayers.forEach(l=>{try{S.map.removeLayer(l)}catch(e){}});
  S._radarGridLayers=[];
}
function gridNeonColor(){
  return'#00F8FF';
}
function hexToRgba(hex,a){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return`rgba(${r},${g},${b},${a})`;
}
function _hexRingCoords(ring){
  const dirs=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  if(ring===0)return[[0,0]];
  const coords=[];
  let q=-ring,r=ring;
  for(let d=0;d<6;d++){
    for(let s=0;s<ring;s++){
      coords.push([q,r]);
      q+=dirs[d][0];r+=dirs[d][1];
    }
  }
  return coords;
}
function drawRadarGrid(map,maxRadiusMi){
  clearRadarGrid();
  if(!map||!S._showZones)return;
  const gridPane='radar-grid-pane';
  if(!map.getPane(gridPane)){
    map.createPane(gridPane);
    map.getPane(gridPane).style.zIndex=340;
    map.getPane(gridPane).style.pointerEvents='none';
  }
  const gc=gridNeonColor();
  const maxRing=Math.ceil(maxRadiusMi/HEX_FLAT_MI);
  const allLines=[];
  for(let ring=0;ring<=maxRing;ring++){
    const coords=_hexRingCoords(ring);
    for(const[q,r] of coords){
      const[cx,cy]=_hexCenter(q,r);
      const hDist=Math.sqrt(cx*cx+cy*cy);
      if(hDist>maxRadiusMi+HEX_SIZE_MI)continue;
      const verts=[];
      for(let i=0;i<=6;i++){
        const ang=Math.PI/3*(i%6);
        verts.push(_xyToLL(cx+HEX_SIZE_MI*Math.cos(ang),cy+HEX_SIZE_MI*Math.sin(ang),S.lat,S.lon));
      }
      allLines.push(verts);
    }
  }
  if(allLines.length){
    const hexGrid=L.polyline(allLines,{
      color:hexToRgba(gc,0.12),weight:0.3,
      pane:gridPane,interactive:false
    }).addTo(map);
    S._radarGridLayers.push(hexGrid);
  }
  const outerCircle=L.circle([S.lat,S.lon],{
    radius:maxRadiusMi*1609.34,
    color:gc,fillOpacity:0,fill:false,
    weight:1.5,dashArray:'8 4',
    pane:gridPane,interactive:false
  }).addTo(map);
  S._radarGridLayers.push(outerCircle);
  const cardinals=[{a:0,l:'N'},{a:90,l:'E'},{a:180,l:'S'},{a:270,l:'W'}];
  for(const c of cardinals){
    const pt=destPt(S.lat,S.lon,maxRadiusMi+3,c.a);
    const marker=L.marker(pt,{
      icon:L.divIcon({
        className:'',
        html:`<div style="color:${hexToRgba(gc,0.5)};font-size:10px;font-weight:700;text-align:center;text-shadow:0 0 3px #000">${c.l}</div>`,
        iconSize:[16,16],iconAnchor:[8,8]
      }),
      pane:gridPane,interactive:false
    }).addTo(map);
    S._radarGridLayers.push(marker);
  }
}
function clearStormZones(){
  if(S._gridEtaInterval){clearInterval(S._gridEtaInterval);S._gridEtaInterval=null;}
  if(S._approachArrowInterval){clearInterval(S._approachArrowInterval);S._approachArrowInterval=null;}
  S._gridEtaTimers=[];
  S._stormZoneLayers.forEach(l=>{try{S.map.removeLayer(l)}catch(e){}});
  S._stormZoneLayers=[];
  clearRadarGrid();
}
const HEX_SIZE_MI=3/Math.sqrt(3); // center-to-vertex ~1.732 mi
const HEX_FLAT_MI=3; // flat-to-flat width = 3 mi
function destPt(lat1,lng1,distMi,bearDeg){
  const R=3958.8;
  const d=distMi/R;
  const b=bearDeg*Math.PI/180;
  const la=lat1*Math.PI/180,lo=lng1*Math.PI/180;
  const la2=Math.asin(Math.sin(la)*Math.cos(d)+Math.cos(la)*Math.sin(d)*Math.cos(b));
  const lo2=lo+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(la),Math.cos(d)-Math.sin(la)*Math.sin(la2));
  return[la2*180/Math.PI,lo2*180/Math.PI];
}
function _llToXY(lat,lon,cLat,cLon){
  const dy=(lat-cLat)*69.172;
  const dx=(lon-cLon)*69.172*Math.cos(cLat*Math.PI/180);
  return[dx,dy];
}
function _xyToLL(x,y,cLat,cLon){
  return[cLat+y/69.172,cLon+x/(69.172*Math.cos(cLat*Math.PI/180))];
}
function _pxToHex(x,y){
  const s=HEX_SIZE_MI;
  const fq=(2/3*x)/s;
  const fr=(-1/3*x+Math.sqrt(3)/3*y)/s;
  const fs=-fq-fr;
  let rq=Math.round(fq),rr=Math.round(fr),rs=Math.round(fs);
  const dq=Math.abs(rq-fq),dr=Math.abs(rr-fr),ds=Math.abs(rs-fs);
  if(dq>dr&&dq>ds)rq=-rr-rs;
  else if(dr>ds)rr=-rq-rs;
  return[rq,rr];
}
function _hexCenter(q,r){
  const s=HEX_SIZE_MI;
  return[s*3/2*q,s*Math.sqrt(3)*(r+q/2)];
}
function hexPoly(cLat,cLng,q,r){
  const[cx,cy]=_hexCenter(q,r);
  const s=HEX_SIZE_MI;
  const verts=[];
  for(let i=0;i<6;i++){
    const ang=Math.PI/3*i;
    verts.push(_xyToLL(cx+s*Math.cos(ang),cy+s*Math.sin(ang),cLat,cLng));
  }
  verts.push(verts[0]);
  return verts;
}
function hexGridBin(rawPts,cLat,cLng,maxRadiusMi){
  const cells=new Map();
  for(const p of rawPts){
    const[x,y]=_llToXY(p.lat,p.lng,cLat,cLng);
    const dist=Math.sqrt(x*x+y*y);
    if(dist>maxRadiusMi)continue;
    const[q,r]=_pxToHex(x,y);
    const key=q+','+r;
    if(cells.has(key)){
      const c=cells.get(key);
      if(p.dbz>c.maxDbz)c.maxDbz=p.dbz;
      c.sumDbz+=p.dbz;
      c.count++;
    }else{
      const[hx,hy]=_hexCenter(q,r);
      const hDist=Math.sqrt(hx*hx+hy*hy);
      const hBear=(Math.atan2(hx,hy)*180/Math.PI+360)%360;
      cells.set(key,{q,r,maxDbz:p.dbz,sumDbz:p.dbz,count:1,dist:hDist,bearing:hBear});
    }
  }
  return cells;
}
function dbzColor(dbz){return _dbzEntry(dbz)}
function gridArrowSvg(deg,color,size){
  return`<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="transform:rotate(${deg}deg)">
    <polygon points="20,6 28,28 20,22 12,28" fill="${color}" fill-opacity="0.9" stroke="rgba(0,0,0,0.4)" stroke-width="1"/>
  </svg>`;
}
function _scanMaxDbz(){return(S._rawScanPts||[]).reduce((mx,p)=>Math.max(mx,p.dbz||0),0)}
function _shouldAutoHideRadar(){return _scanMaxDbz()>=40}
function buildStormZones(map,rawPts){
  clearStormZones();
  S._arrowCells=[];
  const maxR=S._lastScanWasHiRes?15:S.scanRadius||80;
  if(!map||!rawPts||!rawPts.length||!S._showZones){
    if(map&&S.radarLayer&&!map.hasLayer(S.radarLayer)){S.radarLayer.addTo(map)}
    return;
  }
  drawRadarGrid(map,maxR);
  if(!S._radarOverlayVisible&&S.radarLayer&&map.hasLayer(S.radarLayer)&&_shouldAutoHideRadar()){try{map.removeLayer(S.radarLayer)}catch(e){}}
  const t0=performance.now();
  const cells=hexGridBin(rawPts,S.lat,S.lon,maxR);
  const paneName='zone-pane';
  if(!map.getPane(paneName)){
    map.createPane(paneName);
    map.getPane(paneName).style.zIndex=355;
  }
  const arrowPane='zone-arrow-pane';
  if(!map.getPane(arrowPane)){
    map.createPane(arrowPane);
    map.getPane(arrowPane).style.zIndex=360;
  }
  const mv=(typeof getSteeringMv==='function')?getSteeringMv():S.stormMovement;
  let approachCount=0;
  let approachSumLat=0,approachSumLon=0,approachSumDbz=0,approachMaxDbz=0,approachMinDbz=999;
  const approachBearings=[];
  let approachMaxDist=0;
  if(S._gridEtaInterval){clearInterval(S._gridEtaInterval);S._gridEtaInterval=null;}
  if(S._approachArrowInterval){clearInterval(S._approachArrowInterval);S._approachArrowInterval=null;}
  S._gridEtaTimers=[];
  const sortedCells=[...cells.values()].sort((a,b)=>a.maxDbz-b.maxDbz);
  const rowS='display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:0.78em;';
  const lblS='color:#8899aa;white-space:nowrap;margin-right:6px;';
  const valS='color:#e0e0e0;font-weight:500;text-align:right;';
  for(const cell of sortedCells){
    const bin=dbzColor(cell.maxDbz);
    const verts=hexPoly(S.lat,S.lon,cell.q,cell.r);
    const avgDbz=Math.round(cell.sumDbz/cell.count);
    const maxDbz=Math.round(cell.maxDbz);
    const cat=stormCat(maxDbz);
    const midDist=cell.dist;
    const midBear=cell.bearing;
    const isCenter=cell.q===0&&cell.r===0;
    let isApproaching=false;
    let etaSec=null;
    let arrivalStr='--:--';
    let mvDir='--';
    let mvBear='--';
    let mvSpd='--';
    let statusHtml='';
    const cellId='hc'+cell.q+'_'+cell.r;
    let impactPct=0;
    let impactTier='none';
    if(mv&&mv.speed>=2){
      const bearToUser=(midBear+180)%360;
      const diff=Math.abs(((mv.direction-bearToUser+180)%360)-180);
      const closing=mv.speed*Math.cos(Math.min(diff,60)*Math.PI/180);
      const baseWidthMi=Math.max(0,Math.min(3,(maxDbz-20)/15));
      const widthAngle=midDist>0.5?Math.atan2(baseWidthMi,midDist)*180/Math.PI:15;
      const coneHalf=15+widthAngle;
      mvDir=degToDir(mv.direction);
      mvBear=mv.direction+'°';
      mvSpd=S.radarMetric?Math.round(mv.speed*1.60934)+' km/h':mv.speed+' mph';
      if(diff<=coneHalf*0.6&&closing>1){impactTier='high';impactPct=80+Math.round(((coneHalf*0.6)-diff)/(coneHalf*0.6)*20);}
      else if(diff<=coneHalf&&closing>0.5){impactTier='medium';impactPct=31+Math.round((coneHalf-diff)/(coneHalf*0.4)*49);}
      else if(diff<=coneHalf+10){impactTier='low';impactPct=Math.max(5,Math.round((coneHalf+10-diff)/10*30));}
      isApproaching=(impactTier==='high'||impactTier==='medium');
      if(isApproaching&&midDist>1){
        etaSec=Math.max(0,Math.round(midDist/Math.max(closing,0.5)*3600)-Math.round(radarAgeMin()*60));
        const now=new Date();
        const arrival=new Date(now.getTime()+etaSec*1000);
        arrivalStr=fmtClockShort(arrival);
        approachCount++;
        const cellPt=destPt(S.lat,S.lon,midDist,midBear);
        approachSumLat+=cellPt[0]*maxDbz;
        approachSumLon+=cellPt[1]*maxDbz;
        approachSumDbz+=maxDbz;
        if(maxDbz>approachMaxDbz)approachMaxDbz=maxDbz;
        if(maxDbz<approachMinDbz)approachMinDbz=maxDbz;
        approachBearings.push(midBear);
        if(midDist>approachMaxDist)approachMaxDist=midDist;
        S._gridEtaTimers.push({id:cellId,etaSec,startTime:Date.now()});
      }
      const tierColors={high:'#eab308',medium:'#06b6d4',low:'#ec4899',none:'#22c55e'};
      const tierLabels={high:'🟡 High ('+impactPct+'%)',medium:'🔵 Medium ('+impactPct+'%)',low:'🟣 Low ('+impactPct+'%)',none:'✓ Not in path'};
      const tc=tierColors[impactTier]||'#22c55e';
      if(isCenter){
        statusHtml=`<div style="text-align:center;margin-top:4px;padding:3px 6px;background:rgba(239,68,68,0.15);border-radius:4px;color:#ef4444;font-size:0.8em;font-weight:600">🚨 OVERHEAD</div>`;
      }else{
        statusHtml=`<div style="text-align:center;margin-top:4px;padding:3px 6px;background:${tc}18;border:1px solid ${tc}44;border-radius:4px;color:${tc};font-size:0.78em;font-weight:600">${tierLabels[impactTier]}</div>`;
      }
    }else{
      if(isCenter){
        statusHtml=`<div style="text-align:center;margin-top:4px;padding:3px 6px;background:rgba(239,68,68,0.15);border-radius:4px;color:#ef4444;font-size:0.8em;font-weight:600">🚨 OVERHEAD</div>`;
      }else{
        statusHtml=`<div style="text-align:center;margin-top:4px;color:#666;font-size:0.75em">No movement data</div>`;
      }
    }
    const fmtGridEta=(sec)=>{if(!sec||sec<=0)return'NOW';const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h>0?h+'h:'+String(m).padStart(2,'0')+'m:'+String(s).padStart(2,'0')+'s':m+'m:'+String(s).padStart(2,'0')+'s';};
    const fmtEtaInit=etaSec?fmtGridEta(etaSec):'--m:--s';
    const distUnit=S.radarMetric?'km':'mi';
    const distVal=S.radarMetric?(midDist*1.60934).toFixed(1):midDist.toFixed(1);
    const popup=`<div style="font-family:system-ui;min-width:175px;padding:2px">
      <div style="text-align:center;margin-bottom:5px">
        <span style="font-size:1.2em;font-weight:700;color:${bin.color}">${cat.label}</span>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:4px">
        <div style="${rowS}"><span style="${lblS}">☔ Intensity:</span><span style="${valS}color:${bin.color}">${cat.label} @ ${maxDbz} dBZ max</span></div>
        <div style="${rowS}"><span style="${lblS}">📊 Avg:</span><span style="${valS}">${avgDbz} dBZ · ${cat.rain}</span></div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:3px;padding-top:4px">
        <div style="${rowS}"><span style="${lblS}">⛈️ Movement:</span><span style="${valS}">${mvDir} (${mvBear}) @ ${mvSpd}</span></div>
        <div style="${rowS}"><span style="${lblS}">⏱️ ETA:</span><span style="${valS}" id="eta-${cellId}">${fmtEtaInit}</span><span style="${lblS}margin-left:8px;">Arrival:</span><span style="${valS}white-space:nowrap;">${arrivalStr}</span></div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:3px;padding-top:4px">
        <div style="${rowS}"><span style="${lblS}">📍 Location:</span><span style="${valS}">${distVal} ${distUnit} ${degToDir(midBear)} (${Math.round(midBear)}°) of you</span></div>
      </div>
      ${statusHtml}
      <div style="text-align:center;font-size:0.6em;color:#555;margin-top:4px">⬡ ${cell.count} return${cell.count>1?'s':''} · hex (${cell.q},${cell.r}) · ${distVal} ${distUnit}</div>
    </div>`;
    const borderWeight=isApproaching?1.5:0.5;
    const poly=L.polygon(verts,{
      color:bin.color,fillColor:bin.color,
      fillOpacity:bin.opacity,weight:borderWeight,opacity:isApproaching?0.9:0.5,pane:paneName
    }).addTo(map);
    poly.bindPopup(popup,{closeButton:true,className:'storm-popup',maxWidth:280});
    S._stormZoneLayers.push(poly);
    if(isApproaching){
      poly.on('add',function(){const e=this.getElement&&this.getElement();if(e)e.classList.add('grid-pulse');});
      const el=poly.getElement&&poly.getElement();
      if(el)el.classList.add('grid-pulse');
    }
    if(mv&&mv.speed>=2){
      if(!S._arrowCells)S._arrowCells=[];
      S._arrowCells.push({q:cell.q,r:cell.r,midDist,midBear,maxDbz,binIdx:bin.idx,color:bin.color,dir:mv.direction,speed:mv.speed});
    }
  }
  if(S._arrowCells)S._arrowCells=[];
  S._approachData={count:approachCount,maxDbz:approachMaxDbz,minDbz:approachMinDbz,maxDist:approachMaxDist,bearings:approachBearings,sumDbz:approachSumDbz};
  if(S.map&&S._showPathArrows)buildPathArrows(S.map);
  if(S._gridEtaTimers.length>0){
    const fmtGE=(sec)=>{if(!sec||sec<=0)return'NOW';const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h>0?h+'h:'+String(m).padStart(2,'0')+'m:'+String(s).padStart(2,'0')+'s':m+'m:'+String(s).padStart(2,'0')+'s';};
    S._gridEtaInterval=setInterval(()=>{
      const now=Date.now();
      for(const t of S._gridEtaTimers){
        const elapsed=Math.floor((now-t.startTime)/1000);
        const remain=Math.max(0,t.etaSec-elapsed);
        const el=document.getElementById('eta-'+t.id);
        if(el)el.textContent=fmtGE(remain);
        if(remain<=0&&el)el.style.color='#ef4444';
      }
    },1000);
  }
  const ms=Math.round(performance.now()-t0);
  console.log(`Hex grid: ${rawPts.length} pts → ${cells.size} cells (${HEX_FLAT_MI}mi hexes) in ${ms}ms`);
}
function _tickerWeatherPool(){
  const pool=[];
  const w=S.weather;
  const fc=S.forecast;
  const stormCount=S.storms?S.storms.length:0;
  if(stormCount===0){
    pool.push('✅ No storms detected nearby. Clear skies and smooth sailing! 🌤️');
    pool.push('✅ All clear! No storm activity in your area. Perfect time to enjoy the weather. ☀️');
    pool.push('✅ Radar is clean! No precipitation detected in your scan area. Relax and enjoy. 😎');
    pool.push('✅ No storms detected! Let\'s keep it that way... unless you\'re looking for something to track. 📊');
  }
  if(w){
    const tc=w.temperature_2m;const fc2=w.apparent_temperature;
    if(tc!=null){
      const desc=wmoDesc(w.weather_code||0,w.is_day===1);
      pool.push(`🌡️ Currently ${fmtTemp(tc)} — ${desc}${S.locName?' in '+S.locName:''}.`);
      if(fc2!=null&&Math.abs(tc-fc2)>=2)pool.push(`🌡️ Temperature ${fmtTemp(tc)} but feels like ${fmtTemp(fc2)}${Math.abs(tc-fc2)>=5?' — dress accordingly!':'. Not bad out there.'}`);
      if(tc>35)pool.push('🔥 It\'s scorching hot out there! Stay hydrated and avoid prolonged sun exposure. 💦');
      else if(tc>30)pool.push('☀️ Warm and sunny! Great beach weather but don\'t forget sunscreen. 🧴');
      else if(tc>20)pool.push('😊 Pleasant temperatures right now. Perfect weather for outdoor activities! 🌿');
      else if(tc>10)pool.push('🧥 A bit cool out. You might want a light jacket if heading outdoors.');
      else if(tc>0)pool.push('🥶 It\'s quite cold outside. Bundle up and stay warm! 🧣');
      else pool.push('❄️ Below freezing! Watch for ice on roads and walkways. Stay safe! 🧊');
    }
    const wSpd=w.wind_speed_10m;const wDir=w.wind_direction_10m;const wGust=w.wind_gusts_10m;
    if(wSpd!=null){
      const dir=wDir!=null?degToDir(wDir):'';
      if(wSpd<5)pool.push(`🍃 Winds are calm right now${dir?' from the '+dir:''}. Peaceful conditions. 😌`);
      else if(wSpd<20)pool.push(`💨 ${dir?'Winds from the '+dir+' at ':'Winds at '}${fmtWind(wSpd)}${wGust>wSpd+10?', gusting to '+fmtWind(wGust):''}. Comfortable breeze.`);
      else if(wSpd<40)pool.push(`💨 Breezy! ${dir?'Winds '+dir+' at ':'Winds at '}${fmtWind(wSpd)}${wGust?' with gusts to '+fmtWind(wGust):''}. Hold onto your hat! 🎩`);
      else pool.push(`🌬️ Strong winds! ${dir?dir+' at ':''}${fmtWind(wSpd)}${wGust?' gusting '+fmtWind(wGust):''}. Use caution outdoors. ⚠️`);
    }
    const rh=w.relative_humidity_2m;
    if(rh!=null){
      if(rh>85)pool.push(`💧 Humidity is high at ${rh}% — the air feels thick. Stay cool and hydrated. 💦`);
      else if(rh>60)pool.push(`💧 Humidity at ${rh}%. Moderate moisture in the air — fairly comfortable conditions.`);
      else if(rh>30)pool.push(`💧 Humidity at ${rh}%. Nice and comfortable out there. Enjoy! 🌟`);
      else pool.push(`💧 Very dry air — humidity only ${rh}%. Stay hydrated and moisturize. 🏜️`);
    }
    const pres=w.pressure_msl;
    if(pres!=null){
      pool.push(`📊 Barometric pressure ${fmtPres(pres)}${pres>1020?' — high pressure, typically fair weather.':pres<1005?' — low pressure system in the area. Watch for changes.':'. Steady atmospheric conditions.'}`);
    }
    if(S._nwsVisM!=null){
      const visMi=S._nwsVisM/1609.34;
      if(visMi>=10)pool.push(`👁️ Visibility excellent at ${fmtVis(visMi)} — crystal clear conditions all around. 🔭`);
      else if(visMi>=5)pool.push(`👁️ Visibility is good at ${fmtVis(visMi)}. Clear enough for safe travel. 🚗`);
      else pool.push(`🌫️ Reduced visibility at ${fmtVis(visMi)}. Use caution while driving. 🚦`);
    }
    const cc=w.cloud_cover;
    if(cc!=null){
      const _skyLbl=w._nwsDesc||cloudCategory(cc);
      if(cc<=10)pool.push(`☀️ ${_skyLbl} skies right now — ${cc}% cloud cover. Pure sunshine! 🌞`);
      else if(cc<=30)pool.push(`⛅ ${_skyLbl} with ${cc}% cloud cover. Enjoy the sunshine breaking through! 🌤️`);
      else if(cc<=70)pool.push(`🌥️ ${_skyLbl} — ${cc}% cloud cover. A nice mix of sun and clouds.`);
      else if(cc<90)pool.push(`☁️ ${_skyLbl} — ${cc}% cloud cover. The clouds are putting on a show today.`);
      else pool.push(`☁️ ${_skyLbl} — ${cc}% cloud cover. Thick cloud deck overhead.`);
    }
  }
  if(fc&&fc.daily){
    const d=fc.daily;
    if(d.sunrise&&d.sunrise[0]){
      const sr=new Date(d.sunrise[0]);const ss=new Date(d.sunset[0]);
      const now=new Date();
      const srStr=fmtClockShort(sr);
      const ssStr=fmtClockShort(ss);
      if(now<sr)pool.push(`🌅 Sunrise at ${srStr} · Sunset at ${ssStr}. Dawn is coming! 🌄`);
      else if(now<ss){
        const minsLeft=Math.round((ss-now)/60000);
        const hrsLeft=Math.floor(minsLeft/60);const mLeft=minsLeft%60;
        pool.push(`🌇 Sunset at ${ssStr} — ${hrsLeft>0?hrsLeft+'h '+mLeft+'m':mLeft+' minutes'} of daylight remaining. ☀️`);
      }else pool.push(`🌙 Sun has set. Sunrise tomorrow at ${srStr}. Enjoy the night! ✨`);
    }
    if(d.temperature_2m_max&&d.temperature_2m_max[0]!=null){
      pool.push(`📈 Today's forecast: High ${fmtTemp(d.temperature_2m_max[0])} / Low ${fmtTemp(d.temperature_2m_min[0])}${d.precipitation_probability_max&&d.precipitation_probability_max[0]>0?' · '+d.precipitation_probability_max[0]+'% rain chance 🌧️':' · No rain expected 🌞'}`);
    }
    if(d.temperature_2m_max&&d.temperature_2m_max[1]!=null){
      const tmrwDay=new Date();tmrwDay.setDate(tmrwDay.getDate()+1);
      const dayName=tmrwDay.toLocaleDateString(_curLang||'en',{weekday:'long'});
      pool.push(`📅 Tomorrow (${dayName}): High ${fmtTemp(d.temperature_2m_max[1])} / Low ${fmtTemp(d.temperature_2m_min[1])}${d.precipitation_probability_max&&d.precipitation_probability_max[1]>20?' · '+d.precipitation_probability_max[1]+'% rain chance':''}`);
    }
  }
  if(S.scanTime){
    const ago=Math.round((Date.now()-S.scanTime)/60000);
    const src=S.radarSource==='nexrad'?'NEXRAD':'RainViewer';
    const rad=S.radarMetric?Math.round(S.scanRadius*1.60934)+' km':S.scanRadius+' mi';
    pool.push(`📡 ${src} radar scan · ${rad} radius · Last update ${ago<1?'just now':ago+' min ago'}. Monitoring conditions. 🛰️`);
  }
  if(S.station){
    const st=S.station;
    if(st.fltCat){
      pool.push(`✈️ ${S.stationId||'Nearest station'} reporting ${st.fltCat}${st.fltCat==='VFR'?' — clear for flight ops!':st.fltCat==='MVFR'?' — marginal visual conditions':' — instrument conditions in effect'}`);
    }
    if(st.rawOb)pool.push(`📋 Latest METAR: ${escHtml(st.rawOb.substring(0,80))}${st.rawOb.length>80?'...':''}`);
  }
  pool.push('✅ StormTracker is actively monitoring your area. We\'ll alert you the moment conditions change. 🛡️');
  pool.push('✅ All quiet on the weather front. Sit back and relax — we\'re watching the skies for you. 🌌');
  pool.push('✅ No significant weather activity right now. Great conditions for whatever you have planned today! 🎯');
  pool.push('📚 Did you know? dBZ measures radar reflectivity: 20-30 = light rain, 30-45 = moderate, 45-55 = heavy, 55+ = severe/hail. 🌧️');
  pool.push('📚 NEXRAD is a network of 160 Doppler radar stations across the US, scanning the atmosphere every 4-10 minutes. 📡');
  pool.push('📚 Lightning heats the air to 30,000°C — 5x hotter than the sun\'s surface! That explosive expansion creates thunder. ⚡');
  pool.push('📚 The dew point is the temperature at which moisture condenses. Above 65°F (18°C) it feels muggy; above 75°F (24°C) is oppressive. 💧');
  pool.push('📚 A wall cloud is a lowering beneath a thunderstorm\'s base — if it rotates, it can produce a tornado. Stay alert during severe weather! 🌪️');
  pool.push('📚 The Eye of a hurricane is calm and clear, but surrounded by the most violent winds. Never assume the storm is over! 🌀');
  pool.push('📚 Radar returns can bounce off buildings, mountains, and even bugs — that\'s why low dBZ returns are often false positives. 🏔️');
  pool.push('📚 The 30-30 rule: if lightning-to-thunder is 30 seconds or less, go indoors. Wait 30 minutes after the last thunder before going back out. ⚡');
  pool.push('📚 VFR means Visual Flight Rules — pilots can fly by sight. IFR (Instrument Flight Rules) means relying on cockpit instruments due to poor visibility. ✈️');
  pool.push('📚 Virga is precipitation that evaporates before reaching the ground. It shows up on radar but you won\'t feel a drop! 🌫️');
  return pool;
}
function _tickerNearbyPool(sigStormCount){
  const pool=[];
  pool.push(`🔔 ${sigStormCount} storm ☔️ area${sigStormCount>1?'s':''} detected, but currently not on track to your location. Keep an eye 👁️ out and monitor conditions.`);
  pool.push(`🔔 ${sigStormCount} precipitation cell${sigStormCount>1?'s':''} in your area — none currently heading your way. Stay aware, weather can shift quickly. 🌦️`);
  pool.push(`🔔 Tracking ${sigStormCount} storm cell${sigStormCount>1?'s':''} nearby. None approaching at this time, but keep monitoring. 🌩️`);
  const w=S.weather;
  if(w){
    const tc=w.temperature_2m;
    if(tc!=null)pool.push(`🔔 ${sigStormCount} cell${sigStormCount>1?'s':''} detected nearby · Currently ${fmtTemp(tc)} and ${wmoDesc(w.weather_code||0,w.is_day===1)}. Storms not approaching. 📊`);
    const wSpd=w.wind_speed_10m;
    if(wSpd!=null&&wSpd>5)pool.push(`🔔 ${sigStormCount} cell${sigStormCount>1?'s':''} in area · Winds ${degToDir(w.wind_direction_10m||0)} at ${fmtWind(wSpd)}. Storms holding position or drifting away. 💨`);
  }
  if(S.scanTime){
    const ago=Math.round((Date.now()-S.scanTime)/60000);
    pool.push(`🔔 ${sigStormCount} storm${sigStormCount>1?'s':''} on radar · Last scan ${ago<1?'just now':ago+' min ago'}. None approaching — continuing to monitor. 📡`);
  }
  pool.push(`🔔 Storm activity nearby but no threats heading your way. Weather changes fast — we\'ll alert you if anything shifts. 👀`);
  pool.push(`🔔 Radar shows ${sigStormCount} cell${sigStormCount>1?'s':''} in range. All moving away or stationary. Keeping watch for you. 🛰️`);
  return pool;
}
function updateThreatTicker(){
  const bar=document.getElementById('threat-ticker');
  const inner=document.getElementById('threat-ticker-inner');
  if(!bar||!inner)return;
  function showTicker(html,color,borderColor,bg,dur){
    inner.innerHTML=html;
    const textLen=inner.textContent?inner.textContent.length:60;
    const autoDur=Math.max(18,Math.round(textLen*0.322));
    const tickerSpeed=parseInt(localStorage.getItem('st_tickerSpeed'))||100;
    const speedMult=Math.max(50,Math.min(200,tickerSpeed))/100;
    inner.style.animationDuration=Math.round((dur||autoDur)/speedMult)+'s';
    bar.style.display='block';
    bar.style.borderColor=borderColor;
    bar.style.background=bg;
  }
  if(S.alerts&&S.alerts.length){
    const cycleMin=Math.floor(Date.now()/60000);
    const alertPhase=S._alertsShownOnce===false||(cycleMin%3)!==2;
    if(alertPhase){
      const nwsMsgs=[];
      const now=Date.now();
      const _tickerAlerts=(typeof _sortAlertsByDate==='function')?_sortAlertsByDate(S.alerts):S.alerts;
      for(const a of _tickerAlerts){
        const p=a.properties||a;
        const ev=p.event||p.headline||'Weather Alert';
        const sev=(p.severity||'').toLowerCase();
        const startVal=p.onset||p.effective;
        const endVal=p.ends||p.expires;
        const startMs=startVal?new Date(startVal).getTime():NaN;
        const endMs=endVal?new Date(endVal).getTime():NaN;
        let timeLabel='';
        if(!isNaN(startMs)&&startMs>now){
          const cdStart=`<span class="ticker-cd" data-target="${startMs}"></span>`;
          if(!isNaN(endMs)&&endMs>startMs){
            const cdEnd=`<span class="ticker-cd" data-target="${endMs}"></span>`;
            timeLabel=` — starts in ${cdStart}, ends in ${cdEnd}`;
          }else{
            timeLabel=` — starts in ${cdStart}`;
          }
        }else if(!isNaN(endMs)&&endMs>now){
          const cdEnd=`<span class="ticker-cd" data-target="${endMs}"></span>`;
          if((endMs-now)<=1800000)timeLabel=` — ending soon — expires in ${cdEnd}`;
          else timeLabel=` — in effect — ends in ${cdEnd}`;
        }else if(!isNaN(endMs)){
          timeLabel=' — expired';
        }else{
          timeLabel=' — in effect';
        }
        const icon=typeof getAlertIcon==='function'?getAlertIcon(ev,sev):(sev==='extreme'?'🔴':sev==='severe'?'🟠':sev==='moderate'?'🟡':'🔵');
        nwsMsgs.push(`${icon} NWS: ${escHtml(ev)}${timeLabel}`);
      }
      if(nwsMsgs.length){
        const sep='<span style="color:#664400;margin:0 40px">│</span>';
        const html=nwsMsgs.map(m=>`<span style="color:#fbbf24">${m}</span>`).join(sep);
        showTicker(html,'#fbbf24','rgba(251,191,36,0.3)','linear-gradient(90deg,rgba(30,20,0,0.95),rgba(45,30,5,0.95),rgba(30,20,0,0.95))');
        _startTickerCountdown();
        S._alertsShownOnce=true;
        return;
      }
    }
  }
  const _sf=S._stormFilter||{minDbz:0,maxDist:0,approachOnly:false,sort1:'threat',sort2:'eta'};
  const _allStorms=S.storms||[];
  const _filteredStorms=(typeof _applyStormFilter==='function')?_applyStormFilter([..._allStorms],_sf):_allStorms;
  const sigStormCount=_filteredStorms.length;
  const _tierCounts={direct:0,near_direct:0,near_miss:0,miss:0,distant:0,far:0,passing:0,moving_away:0};
  for(const s of _filteredStorms){const k=(s._brief&&s._brief.classification)||(typeof calcStormETAForBriefing==='function'?(calcStormETAForBriefing(s)||{}).classification:null);if(k&&_tierCounts[k]!=null)_tierCounts[k]++;}
  const _approachCount=_tierCounts.direct+_tierCounts.near_direct;
  const _nearMissCount=_tierCounts.near_miss;
  const _trackingCount=_tierCounts.miss+_tierCounts.distant+_tierCounts.far;
  const _filteredInbound=_filteredStorms.filter(s=>{
    const e=s._eta||calcStormETA(s);
    if(!(e&&e.approaching&&e.impact>0&&e.eta!=null))return false;
    const k=(s._brief&&s._brief.classification)||(typeof calcStormETAForBriefing==='function'?(calcStormETAForBriefing(s)||{}).classification:null);
    return k==='direct'||k==='near_direct'||k==='near_miss';
  });
  if(typeof _stormSortFn==='function'){
    _filteredInbound.sort((a,b)=>{const r=_stormSortFn(a,b,_sf.sort1);return r!==0?r:_stormSortFn(a,b,_sf.sort2)});
  }
  const topStorms=_filteredInbound.slice(0,12);
  let gridZoneCount=0,gridZoneMaxDbz=0;
  if(S._rawScanPts&&S._rawScanPts.length&&S.lat!=null){
    const gzCells=hexGridBin(S._rawScanPts,S.lat,S.lon,S.scanRadius||80);
    gridZoneCount=gzCells.size;
    for(const[,c]of gzCells){if(c.maxDbz>gridZoneMaxDbz)gridZoneMaxDbz=c.maxDbz}
  }
  const stormCount=_filteredStorms.length;
  if(sigStormCount===0){
    const pool=_tickerWeatherPool();
    if(stormCount>0){
      const maxClutter=Math.max(..._filteredStorms.map(s=>s.dbz));
      pool.unshift(`✅ ${stormCount} minor radar return${stormCount>1?'s':''} detected (max ${maxClutter} dBZ) — likely ground clutter, not real precipitation. All clear! 🌤️`);
      pool.unshift(`✅ Light radar reflectivity picked up (${stormCount} return${stormCount>1?'s':''}, peak ${maxClutter} dBZ). Nothing significant — enjoy your day! ☀️`);
      pool.unshift(`✅ Minor clutter on radar — ${stormCount} point${stormCount>1?'s':''} below 31 dBZ. No meaningful weather activity. 😎`);
    }else if(gridZoneCount>0){
      if(gridZoneMaxDbz>=40){
        pool.unshift(`⚠️ ${gridZoneCount} radar grid zone${gridZoneCount>1?'s':''} detected (peak ${gridZoneMaxDbz} dBZ). Strong returns — not moving toward you currently. 🌧️`);
        pool.unshift(`⚠️ Radar shows ${gridZoneCount} zone${gridZoneCount>1?'s':''} with up to ${gridZoneMaxDbz} dBZ returns. Active weather nearby but not approaching. 🛰️`);
        pool.unshift(`⚠️ ${gridZoneCount} active zone${gridZoneCount>1?'s':''} on radar (${gridZoneMaxDbz} dBZ peak). Storms present but not inbound. Monitoring. 👀`);
      }else if(gridZoneMaxDbz>=31){
        pool.unshift(`📡 ${gridZoneCount} radar grid zone${gridZoneCount>1?'s':''} showing returns (peak ${gridZoneMaxDbz} dBZ). Light to moderate activity, not approaching. 🌥️`);
        pool.unshift(`📡 Radar picks up ${gridZoneCount} zone${gridZoneCount>1?'s':''} (max ${gridZoneMaxDbz} dBZ). Mild returns — keeping an eye on it. 🛰️`);
      }else{
        pool.unshift(`✅ ${gridZoneCount} radar grid zone${gridZoneCount>1?'s':''} showing faint returns (peak ${gridZoneMaxDbz} dBZ) — likely ground clutter or atmospheric noise. 🌤️`);
        pool.unshift(`✅ Minor radar reflectivity in ${gridZoneCount} grid sector${gridZoneCount>1?'s':''} (max ${gridZoneMaxDbz} dBZ). Below storm threshold — probably clutter. 😎`);
        pool.unshift(`✅ Grid scan picked up ${gridZoneCount} faint zone${gridZoneCount>1?'s':''} (${gridZoneMaxDbz} dBZ peak). Not significant weather activity. ☀️`);
      }
    }
    const peakDbz=stormCount>0?Math.max(..._filteredStorms.map(s=>s.dbz)):gridZoneMaxDbz;
    const msg=pool[Math.floor(Date.now()/60000)%pool.length];
    if(peakDbz>=40){
      showTicker(`<span style="color:#fbbf24">${msg}</span>`,'#fbbf24','rgba(251,191,36,0.2)','linear-gradient(90deg,rgba(30,20,0,0.95),rgba(40,28,5,0.95),rgba(30,20,0,0.95))',Math.max(15,Math.round(msg.length*0.18)));
    }else if(peakDbz>=31){
      showTicker(`<span style="color:#60c0e8">${msg}</span>`,'#60c0e8','rgba(96,192,232,0.15)','linear-gradient(90deg,rgba(5,15,25,0.95),rgba(8,22,35,0.95),rgba(5,15,25,0.95))',Math.max(15,Math.round(msg.length*0.18)));
    }else{
      showTicker(`<span style="color:#4ade80">${msg}</span>`,'#4ade80','rgba(74,222,128,0.2)','linear-gradient(90deg,rgba(0,20,5,0.95),rgba(5,30,10,0.95),rgba(0,20,5,0.95))',Math.max(15,Math.round(msg.length*0.18)));
    }
    return;
  }
  const allApproaching=topStorms.map(s=>({storm:s,eta:s._eta||calcStormETA(s)}));
  const severeApproaching=allApproaching.filter(t=>t.storm.dbz>=46);
  const _tierBreakdown=[];
  if(_nearMissCount>0)_tierBreakdown.push(`🟡 ${_nearMissCount} near-miss (6-12 mi)`);
  if(_trackingCount>0)_tierBreakdown.push(`🔵 ${_trackingCount} tracking (12-48 mi)`);
  const _tierBreakdownStr=_tierBreakdown.length?` · ${_tierBreakdown.join(' · ')}`:'';
  if(allApproaching.length===0){
    if(_nearMissCount>0||_trackingCount>0){
      const msg=`📡 No storms on direct course (≤6 mi miss). Tracking ${_nearMissCount+_trackingCount} cell${(_nearMissCount+_trackingCount)>1?'s':''} further out${_tierBreakdownStr.replace(' · ',': ')}.`;
      showTicker(`<span style="color:#60a5fa">${msg}</span>`,'#60a5fa','rgba(96,165,250,0.2)','linear-gradient(90deg,rgba(0,5,20,0.95),rgba(5,10,30,0.95),rgba(0,5,20,0.95))',Math.max(15,Math.round(msg.length*0.2)));
      return;
    }
    const pool=_tickerNearbyPool(sigStormCount);
    const msg=pool[Math.floor(Date.now()/60000)%pool.length];
    showTicker(`<span style="color:#60a5fa">${msg}</span>`,'#60a5fa','rgba(96,165,250,0.2)','linear-gradient(90deg,rgba(0,5,20,0.95),rgba(5,10,30,0.95),rgba(0,5,20,0.95))',Math.max(15,Math.round(msg.length*0.2)));
    return;
  }
  const spdUnit=S.radarMetric?'km/h':'mph';
  const spdVal=(v)=>S.radarMetric?Math.round(v*1.60934):v;
  function _stormMv(storm){
    const h=typeof getHybridMovement==='function'?getHybridMovement(storm):null;
    if(h&&h.speed>=2){const fd=(h.direction+180)%360;return{dir:degToDir(fd)+' ('+String(Math.round(fd)).padStart(3,'0')+'°)',spd:spdVal(h.speed)}}
    return{dir:'',spd:0};
  }
  function fmtEtaLive(etaMin){
    const targetMs=Date.now()+Math.round(Math.max(0,etaMin-radarAgeMin())*60)*1000;
    const arrival=new Date(targetMs);
    const arrStr=fmtClockShort(arrival);
    const cdSpan=`<span class="ticker-cd" data-target="${targetMs}"></span>`;
    return{cdSpan,arrStr};
  }
  function _tickerCdFmt(remain){
    if(remain<=0)return'NOW';
    const h=Math.floor(remain/3600),m=Math.floor((remain%3600)/60),s=remain%60;
    return h>0?h+'h:'+String(m).padStart(2,'0')+'m:'+String(s).padStart(2,'0')+'s':m+'m:'+String(s).padStart(2,'0')+'s';
  }
  function _tickerThreatScore(t){
    const dbzNorm=Math.min((t.storm.dbz-30)/30,1);
    const impNorm=Math.min((t.eta.impact||0)/100,1);
    const etaPen=Math.min(t.eta.eta/60,1)*0.2;
    return dbzNorm*0.5+impNorm*0.35-etaPen;
  }
  if(severeApproaching.length>0){
    severeApproaching.sort((a,b)=>_tickerThreatScore(b)-_tickerThreatScore(a));
    const msgs=severeApproaching.map(t=>{
      const s=t.storm;const{cdSpan,arrStr}=fmtEtaLive(t.eta.eta);const _m=_stormMv(s);const fromDir=_m.dir;const spd=_m.spd;
      if(s.dbz>=61)return`<span style="color:#FF00F5">🚨 WARNING: Extremely dangerous storm (${s.dbz} dBZ) approaching from the ${fromDir} at ${spd} ${spdUnit}. ETA ⏱️${cdSpan} (${arrStr}). Seek shelter immediately. 🚨</span>`;
      if(s.dbz>=52)return`<span style="color:#FF0200">🚨 SEVERE WEATHER ALERT: Dangerous storm (${s.dbz} dBZ) approaching from the ${fromDir} at ${spd} ${spdUnit}. ETA ⏱️${cdSpan} (${arrStr}). Use extreme caution. 🚨</span>`;
      return`<span style="color:#FFB200">⚠️ Strong storm (${s.dbz} dBZ) approaching from the ${fromDir} at ${spd} ${spdUnit}. ETA ⏱️${cdSpan} (${arrStr}). Use caution and be prepared. ⚠️</span>`;
    });
    const sep='<span style="color:#444;margin:0 40px">│</span>';
    const html=msgs.join(sep);
    const topDbz=severeApproaching[0].storm.dbz;
    showTicker(html,topDbz>=61?'#FF00F5':topDbz>=52?'#FF0200':'#FFB200',
      topDbz>=61?'rgba(255,0,245,0.5)':topDbz>=52?'rgba(255,2,0,0.4)':'rgba(255,178,0,0.3)',
      topDbz>=61?'linear-gradient(90deg,rgba(30,0,0,0.95),rgba(50,5,5,0.95),rgba(30,0,0,0.95))':topDbz>=52?'linear-gradient(90deg,rgba(30,10,0,0.95),rgba(50,15,5,0.95),rgba(30,10,0,0.95))':'linear-gradient(90deg,rgba(30,25,0,0.95),rgba(45,35,5,0.95),rgba(30,25,0,0.95))');
    _startTickerCountdown();
    return;
  }
  allApproaching.sort((a,b)=>_tickerThreatScore(b)-_tickerThreatScore(a));
  const closest=allApproaching[0];
  const{cdSpan,arrStr}=fmtEtaLive(closest.eta.eta);
  const _mTop=_stormMv(closest.storm);const fromDir=_mTop.dir;const spd=_mTop.spd;
  const maxDbz=Math.max(...allApproaching.map(a=>a.storm.dbz));
  const label=maxDbz>=30?'moderate rain':'light rain';
  const lightMsgs=[
    `🌧️ ${allApproaching.length} ${label} cell${allApproaching.length>1?'s':''} heading your way from the ${fromDir} at ${spd} ${spdUnit}. Strongest (${maxDbz} dBZ) ETA ⏱️${cdSpan} (~${arrStr}). Might want to grab an umbrella! ☂️`,
    `🌦️ Light precipitation approaching — ${allApproaching.length} cell${allApproaching.length>1?'s':''} inbound (${maxDbz} dBZ max). ETA ⏱️${cdSpan} (~${arrStr}). Nothing severe, but stay dry! 💧`,
    `☔ Heads up! ${allApproaching.length} rain area${allApproaching.length>1?'s':''} moving toward you (${maxDbz} dBZ). Top-threat ETA ⏱️${cdSpan} (~${arrStr}). Not dangerous, just wet. 🌂`
  ];
  const msg=lightMsgs[Math.floor(Date.now()/60000)%lightMsgs.length]+_tierBreakdownStr;
  showTicker(`<span style="color:#7dd3fc">${msg}</span>`,'#7dd3fc','rgba(125,211,252,0.2)','linear-gradient(90deg,rgba(0,8,25,0.95),rgba(5,15,35,0.95),rgba(0,8,25,0.95))');
  _startTickerCountdown();
}
let _tickerCdTimer=0;
function _startTickerCountdown(){
  if(_tickerCdTimer)clearInterval(_tickerCdTimer);
  _tickTickerCd();
  _tickerCdTimer=setInterval(_tickTickerCd,1000);
}
function _tickTickerCd(){
  const spans=document.querySelectorAll('.ticker-cd');
  if(!spans.length){if(_tickerCdTimer){clearInterval(_tickerCdTimer);_tickerCdTimer=0;}return;}
  const now=Date.now();
  spans.forEach(sp=>{
    const t=parseInt(sp.dataset.target)||0;
    const remain=Math.max(0,Math.floor((t-now)/1000));
    const h=Math.floor(remain/3600),m=Math.floor((remain%3600)/60),s=remain%60;
    sp.textContent=remain<=0?'NOW':h>0?h+'h:'+String(m).padStart(2,'0')+'m:'+String(s).padStart(2,'0')+'s':m+'m:'+String(s).padStart(2,'0')+'s';
  });
}
function autoActivateZones(){
  if(!S._rawScanPts||!S._rawScanPts.length)return;
  if(!S._showZones){
    S._showZones=true;
    try{localStorage.setItem('st_zones','1')}catch(e){}
    const btn=document.getElementById('btn-zones');
    if(btn)btn.style.opacity='1';
  }
  if(S._pointsMode==='all'){
    S._pointsMode='off';S._showPoints=false;
    try{localStorage.setItem('st_pointsMode','off')}catch(e){}
    S.stormMarkers.forEach(m=>{try{S.map.removeLayer(m)}catch(e){}});
    const btn=document.getElementById('btn-points');
    if(btn){btn.style.opacity='0.4';_ris('btn-points','points');}
  }
  if(!S._radarOverlayVisible&&S.radarLayer&&S.map){
    if(_shouldAutoHideRadar()){try{S.map.removeLayer(S.radarLayer)}catch(e){}}
    else{try{if(!S.map.hasLayer(S.radarLayer))S.radarLayer.addTo(S.map)}catch(e){}}
  }
  if(S.map)buildStormZones(S.map,S._rawScanPts);
}
// v5.49: ONE canonical "what dBZ is at this spot right now" oracle. "Over you"
// means a live radar echo genuinely ON your location — within OVERHEAD_MI. Every
// "now" surface — hero card, rain-clock minute 0, overhead/drizzle alerts,
// Storms-tab zone banner — derives from THIS (via rainOverUserNow /
// checkUserInZone); advection is only ever used for FUTURE projection.
//
// PRIOR BUG (v5.47 consolidation): this hex-binned the scan and, when YOUR 3-mi
// hex was empty, fell back to the 6 neighbor hexes whose CENTERS were ≤5mi — so
// rain sitting in the next hex over (nearest echo up to ~4.7mi away) read as
// "raining now over you." Reported by a user whose own hex was clear while rain
// filled the hex to the north. Now it is a direct proximity test on the raw scan
// points: max dBZ among echoes within OVERHEAD_MI. Rain in the 1.5–6mi band is
// "nearby" (surfaced as the Rain Clock's "Nearest Precipitation" line), not overhead.
const OVERHEAD_MI=1.5;   // ≤ this from your spot counts as "over you"
function dbzAtLocation(lat,lon){
  const pts=S._rawScanPts;
  if(!pts||!pts.length||lat==null||lon==null)return null;
  // Measure the TRUE distance from this spot to each echo's own lat/lng. We do
  // NOT trust p.dist: it is each echo's distance from the scan center that
  // produced it, and S._rawScanPts can MIX centers — the overhead-poll splice
  // (commitScanResults) keeps far points from an earlier, differently-centered
  // scan. A stale small p.dist on a genuinely-distant echo is exactly what made
  // rain a few miles away read as "overhead" again. This runs only on scan
  // commit / hero refresh (not per frame), so the extra haversines are cheap.
  let mx=-999;
  for(const p of pts){
    if(haversine(lat,lon,p.lat,p.lng)<=OVERHEAD_MI&&p.dbz>mx)mx=p.dbz;
  }
  return mx>-999?{maxDbz:mx,source:'overhead'}:null;
}
function checkUserInZone(){
  const z=dbzAtLocation(S.lat,S.lon);
  return z?[Object.assign({},dbzColor(z.maxDbz),{maxDbz:z.maxDbz,source:z.source})]:null;
}
function isOverheadPollEnabled(){
  try{return localStorage.getItem('st_overheadPoll')!=='0'}catch(e){return true}
}
function _getOverheadPollMs(){
  // v5.53: adaptive — poll the overhead radar less often on slow links (the speed
  // monitor's netTier), on top of the browser Network Info API + Data Saver checks.
  try{ if(typeof netIsVerySlow==='function'&&netIsVerySlow())return 300000; }catch(e){}
  try{ if(typeof netIsSlow==='function'&&netIsSlow())return 180000; }catch(e){}
  try{
    const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(c){
      if(c.saveData===true)return 300000;
      const et=c.effectiveType;
      if(et==='slow-2g'||et==='2g'||et==='3g')return 300000;
    }
  }catch(e){}
  return 90000;
}
S._overheadPollMs=_getOverheadPollMs();
S._overheadPollBusy=false;
S._overheadPollLast=0;
async function pollOverheadRain(){
  if(!isOverheadPollEnabled())return;
  if(S._overheadPollBusy)return;
  if(S._fullScanActive)return;
  if(document.hidden)return;
  if(S.lat==null||S.lon==null)return;
  S._overheadPollMs=_getOverheadPollMs();
  if(Date.now()-S._overheadPollLast<S._overheadPollMs-2000)return;
  S._overheadPollBusy=true;
  S._overheadPollLast=Date.now();
  try{
    const cLat=S.lat,cLon=S.lon;
    const useNexrad=S.radarSource==='nexrad'&&isUSLocation(cLat,cLon);
    const POLL_RADIUS_MI=3;
    // v5.44: thin wrapper over the unified runRadarScan engine — quick 3 mi
    // overhead check. forceRVRefresh (no-store) + cacheBustNexrad keep it fresh;
    // keepStaleTilePath reuses the last RV path instead of aborting on a hiccup.
    const result=await runRadarScan({
      lat:cLat,lon:cLon,
      radiusMi:POLL_RADIUS_MI,
      zoom:useNexrad?11:8,
      step:1,
      minDbz:5,
      source:useNexrad?'nexrad':'rainviewer',
      forceRVRefresh:true,
      keepStaleTilePath:true,
      cacheBustNexrad:true
    });
    if(!result)return;
    if(S.lat!==cLat||S.lon!==cLon){console.log('[OverheadPoll] location changed mid-poll, discarding');return}
    const newPts=result.points;
    const maxDbz=newPts.reduce((m,p)=>p.dbz>m?p.dbz:m,-999);
    console.log('[OverheadPoll]',useNexrad?'NEX':'RV','newPts=',newPts.length,'maxDbz=',maxDbz>-999?maxDbz:'none');
    // v5.46: splice-merge + hero/rain-clock refresh via the unified commit
    // pipeline (spliceRadiusMi mode) — no storm-list rebuild on quick polls.
    await commitScanResults(newPts,{spliceRadiusMi:POLL_RADIUS_MI,center:{lat:cLat,lon:cLon}});
  }catch(e){console.log('[OverheadPoll] failed:',e.message)}
  finally{S._overheadPollBusy=false}
}
function stopOverheadPoll(){
  if(S._overheadPollTimer){clearInterval(S._overheadPollTimer);S._overheadPollTimer=null}
  if(S._overheadPollVisListener){
    document.removeEventListener('visibilitychange',S._overheadPollVisListener);
    S._overheadPollVisListener=null;
  }
  if(S._overheadPollNetListener){
    try{
      const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
      if(c&&c.removeEventListener)c.removeEventListener('change',S._overheadPollNetListener);
    }catch(e){}
    S._overheadPollNetListener=null;
  }
}
function _rearmOverheadPoll(){
  if(!S._overheadPollTimer)return;
  const newMs=_getOverheadPollMs();
  if(newMs===S._overheadPollMs)return;
  S._overheadPollMs=newMs;
  clearInterval(S._overheadPollTimer);
  S._overheadPollTimer=setInterval(pollOverheadRain,S._overheadPollMs);
}
function startOverheadPoll(){
  stopOverheadPoll();
  if(!isOverheadPollEnabled())return;
  S._overheadPollMs=_getOverheadPollMs();
  pollOverheadRain();
  S._overheadPollTimer=setInterval(pollOverheadRain,S._overheadPollMs);
  S._overheadPollVisListener=()=>{if(!document.hidden)pollOverheadRain()};
  document.addEventListener('visibilitychange',S._overheadPollVisListener);
  try{
    const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(c&&c.addEventListener){
      S._overheadPollNetListener=()=>_rearmOverheadPoll();
      c.addEventListener('change',S._overheadPollNetListener);
    }
  }catch(e){}
}
function toggleOverheadPoll(){
  const cur=isOverheadPollEnabled();
  try{localStorage.setItem('st_overheadPoll',cur?'0':'1')}catch(e){}
  if(cur){
    stopOverheadPoll();
    if(typeof toast==='function')toast('🌧️ Live overhead rain check disabled');
  }else{
    startOverheadPoll();
    if(typeof toast==='function'){
      const ms=_getOverheadPollMs();
      toast(ms>=300000?'🌧️ Live overhead rain check enabled (slow connection — every 5m)':'🌧️ Live overhead rain check enabled');
    }
  }
  if(typeof syncSettingsPanel==='function')syncSettingsPanel();
}
function toggleStormZones(){
  S._showZones=!S._showZones;
  try{localStorage.setItem('st_zones',S._showZones?'1':'0')}catch(e){}
  if(S._showZones&&S._rawScanPts.length&&S.map){
    buildStormZones(S.map,S._rawScanPts);
  }else{
    clearStormZones();
    if(S.radarLayer&&S.map&&!S.map.hasLayer(S.radarLayer)){try{S.radarLayer.addTo(S.map)}catch(e){}}
  }
  const btn=document.getElementById('btn-zones');
  if(btn)btn.style.opacity=S._showZones?'1':'0.4';
}
S._radarOverlayVisible=false;
function toggleRadarOverlay(){
  S._radarOverlayVisible=!S._radarOverlayVisible;
  if(S._radarOverlayVisible&&S.radarLayer&&S.map){
    if(!S.map.hasLayer(S.radarLayer))S.radarLayer.addTo(S.map);
  }else if(!S._radarOverlayVisible&&S.radarLayer&&S.map){
    if(S.map.hasLayer(S.radarLayer))S.map.removeLayer(S.radarLayer);
  }
  const btn=document.getElementById('btn-radar-overlay');
  if(btn)btn.style.opacity=S._radarOverlayVisible?'1':'0.4';
}

S._mpingMarkers=[];
S._mpingVisible=false;
S._mpingCache=null;
S._mpingCacheTime=0;
S._mpingPlotId=0;

const MPING_ICONS={
  'Rain':'🌧️','Heavy Rain':'🌧️','Drizzle':'🌦️',
  'Freezing Rain':'🧊','Freezing Drizzle':'🧊',
  'Ice Pellets/Sleet':'🧊','Ice Pellets':'🧊',
  'Snow':'❄️','Heavy Snow':'❄️','Wet Snow':'❄️','Snow and/or Graupel':'❄️',
  'Rain/Snow':'🌨️','Mixed Rain and Snow':'🌨️',
  'Hail':'⚪','Small Hail':'⚪',
  'Wind Damage':'💨','Non-Precipitation':'🌫️',
  'Tornado':'🌪️','Funnel Cloud':'🌪️',
  'Flooding':'🌊','Flash Flooding':'🌊',
  'Thunder':'⚡','Lightning':'⚡',
  'Fog':'🌫️','Blowing Snow':'🌬️','Dust/Sand':'🏜️'
};

const MPING_COLORS={
  'Rain':'#4fc3f7','Heavy Rain':'#0288d1','Drizzle':'#81d4fa',
  'Freezing Rain':'#e040fb','Freezing Drizzle':'#ce93d8',
  'Ice Pellets/Sleet':'#ba68c8','Ice Pellets':'#ba68c8',
  'Snow':'#e0e0e0','Heavy Snow':'#bdbdbd','Wet Snow':'#b0bec5','Snow and/or Graupel':'#90a4ae',
  'Rain/Snow':'#80cbc4','Mixed Rain and Snow':'#80cbc4',
  'Hail':'#ff5252','Small Hail':'#ff8a80',
  'Wind Damage':'#ff9800','Non-Precipitation':'#78909c',
  'Tornado':'#d50000','Funnel Cloud':'#ff1744',
  'Flooding':'#1565c0','Flash Flooding':'#0d47a1',
  'Thunder':'#ffd600','Lightning':'#ffea00',
  'Fog':'#78909c','Blowing Snow':'#b0bec5','Dust/Sand':'#a1887f'
};

function _mpingCat(desc){
  if(!desc)return'Other';
  const d=desc.toLowerCase();
  if(d.includes('tornado')||d.includes('funnel'))return'Severe';
  if(d.includes('hail'))return'Hail';
  if(d.includes('wind damage'))return'Severe';
  if(d.includes('flood'))return'Flood';
  if(d.includes('freezing')||d.includes('ice pellet')||d.includes('sleet'))return'Ice';
  if(d.includes('snow')||d.includes('graupel')||d.includes('blowing snow'))return'Snow';
  if(d.includes('rain')||d.includes('drizzle'))return'Rain';
  if(d.includes('thunder')||d.includes('lightning'))return'Thunder';
  return'Other';
}

async function fetchMpingReports(){
  const map=S.map;if(!map)return[];
  const now=Date.now();
  if(S._mpingCache&&(now-S._mpingCacheTime)<300000)return S._mpingCache;
  const bounds=map.getBounds();
  const ets=new Date();
  const sts=new Date(ets.getTime()-3*3600000);
  const fmt=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}T${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:00Z`;
  const url=`https://mesonet.agron.iastate.edu/geojson/mping.geojson?sts=${fmt(sts)}&ets=${fmt(ets)}`;
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const data=await r.json();
    const features=(data.features||[]).filter(f=>{
      if(!f.geometry||!f.geometry.coordinates)return false;
      const[lng,lat]=f.geometry.coordinates;
      return lat>=bounds.getSouth()&&lat<=bounds.getNorth()&&lng>=bounds.getWest()&&lng<=bounds.getEast();
    });
    S._mpingCache=features;
    S._mpingCacheTime=now;
    return features;
  }catch(e){
    console.error('mPING fetch error:',e);
    return S._mpingCache||[];
  }
}

function plotMpingMarkers(reports){
  const map=S.map;if(!map)return;
  clearMpingMarkers();
  S._mpingVisible=true;
  const plotId=++S._mpingPlotId;
  for(const f of reports){
    if(S._mpingPlotId!==plotId)return;
    const[lng,lat]=f.geometry.coordinates;
    const props=f.properties||{};
    const desc=props.description||props.type_text||props.category||'Unknown';
    const icon=MPING_ICONS[desc]||'📍';
    const color=MPING_COLORS[desc]||'#4fc3f7';
    const ts=props.valid||props.utc_valid||'';
    let timeAgo='';
    if(ts){
      const t=new Date(ts.replace(' ','T')+(ts.includes('Z')?'':'Z'));
      const mins=Math.round((Date.now()-t.getTime())/60000);
      timeAgo=mins<60?`${mins}m ago`:`${Math.floor(mins/60)}h ${mins%60}m ago`;
    }
    const cat=_mpingCat(desc);
    const divIcon=L.divIcon({
      className:'mping-marker',
      html:`<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto">
        <div style="background:${color};font-size:14px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,0.7);box-shadow:0 0 6px ${color}80;cursor:pointer">${icon}</div>
      </div>`,
      iconSize:[26,26],iconAnchor:[13,13]
    });
    const popup=L.popup({className:'storm-popup mping-popup',maxWidth:220,closeButton:true}).setContent(`
      <div style="font-size:0.82em;line-height:1.5">
        <div style="font-weight:700;color:${color};margin-bottom:4px">${icon} ${desc}</div>
        <div style="display:inline-block;background:${color}30;color:${color};padding:1px 8px;border-radius:10px;font-size:0.8em;font-weight:600;margin-bottom:4px">${cat}</div>
        ${timeAgo?`<div class="c-muted-85">🕐 ${timeAgo}</div>`:''}
        <div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-subtle);font-size:0.75em;color:var(--text-muted)">
          📡 mPING citizen report<br>
          <a href="https://mping.nssl.noaa.gov/" target="_blank" rel="noopener" style="color:var(--accent-cyan);text-decoration:none">What is mPING?</a> · 
          <a href="https://apps.apple.com/us/app/mping/id577882748" target="_blank" rel="noopener" style="color:var(--accent-cyan);text-decoration:none">iOS</a> · 
          <a href="https://play.google.com/store/apps/details?id=edu.ou.nssl.mping" target="_blank" rel="noopener" style="color:var(--accent-cyan);text-decoration:none">Android</a>
        </div>
      </div>
    `);
    const marker=L.marker([lat,lng],{icon:divIcon,zIndexOffset:600}).addTo(map).bindPopup(popup);
    S._mpingMarkers.push(marker);
  }
}

function clearMpingMarkers(){
  const m=S.map;
  S._mpingPlotId++;
  S._mpingMarkers.forEach(mk=>{try{if(m)m.removeLayer(mk)}catch(e){}});
  S._mpingMarkers=[];
}

async function toggleMping(){
  const btn=document.getElementById('btn-mping');
  if(S._mpingVisible){
    clearMpingMarkers();
    S._mpingVisible=false;
    if(btn){btn.style.opacity='0.4';btn.style.background='';btn.style.borderColor=''}
    try{localStorage.setItem('st_mping','0')}catch(e){}
    return;
  }
  if(btn){btn.style.opacity='1';btn.style.background='rgba(79,195,247,0.2)';btn.style.borderColor='#4fc3f7'}
  S._mpingVisible=true;
  try{localStorage.setItem('st_mping','1')}catch(e){}
  toast('Loading mPING reports...');
  S._mpingCache=null;S._mpingCacheTime=0;
  const reports=await fetchMpingReports();
  if(!S._mpingVisible)return;
  if(reports.length===0){
    toast('No mPING reports in this area (last 3h)');
    return;
  }
  plotMpingMarkers(reports);
  toast(`📡 ${reports.length} mPING report${reports.length!==1?'s':''} loaded`);
}

async function refreshMpingIfVisible(){
  if(!S._mpingVisible||!S.map)return;
  S._mpingCache=null;S._mpingCacheTime=0;
  const reports=await fetchMpingReports();
  if(!S._mpingVisible)return;
  plotMpingMarkers(reports);
}

try{
  const resetKey='st_defaults_v230e';
  if(!localStorage.getItem(resetKey)){
    localStorage.removeItem('st_pathArrows');
    localStorage.removeItem('st_pointsMode');
    localStorage.setItem(resetKey,'1');
  }
}catch(e){}
try{const zv=localStorage.getItem('st_zones');if(zv==='0')S._showZones=false}catch(e){}
try{const pa=localStorage.getItem('st_pathArrows');if(pa==='0')S._showPathArrows=false}catch(e){}
try{const ps=localStorage.getItem('st_arrowStyle');if(ps==='pointer')S._pathArrowStyle='pointer'}catch(e){}
S._showPoints=true;
S._pointsMode='inbound';
try{const pv=localStorage.getItem('st_pointsMode');if(pv){S._pointsMode=pv;S._showPoints=(pv!=='off')}}catch(e){}
S._relMotionMode='off';
try{const rv=localStorage.getItem('st_relMotionMode');if(rv)S._relMotionMode=rv}catch(e){}
S._relMotionLayers=[];
S._tracksMode='off';
S._trackCones=[];
try{const tv=localStorage.getItem('st_tracksMode');if(tv)S._tracksMode=tv}catch(e){}
S._crosshairDelay=3;
try{const cv=localStorage.getItem('st_crosshairDelay');if(cv!=null)S._crosshairDelay=cv==='off'?'off':cv==='on'?'on':parseInt(cv)||3}catch(e){}
S._crosshairTimer=null;
function _crosshairEl(){return document.querySelector('.radar-crosshair')}
function showCrosshair(){
  clearTimeout(S._crosshairTimer);
  if(S._crosshairDelay==='on')return;
  const el=_crosshairEl();if(el)el.classList.remove('ch-fade');
}
function hideCrosshair(){
  const el=_crosshairEl();if(el)el.classList.add('ch-fade');
}
function scheduleCrosshairHide(){
  clearTimeout(S._crosshairTimer);
  if(S._crosshairDelay==='off')return;
  if(S._crosshairDelay==='on'){hideCrosshair();return}
  const ms=(parseInt(S._crosshairDelay)||3)*1000;
  S._crosshairTimer=setTimeout(hideCrosshair,ms);
}
function setCrosshairDelay(val){
  S._crosshairDelay=val==='off'?'off':val==='on'?'on':parseInt(val)||3;
  try{localStorage.setItem('st_crosshairDelay',String(S._crosshairDelay))}catch(e){}
  if(val==='off'){showCrosshair();return}
  if(val==='on'){hideCrosshair();return}
  showCrosshair();scheduleCrosshairHide();
}
try{const mv=localStorage.getItem('st_mping');if(mv==='1')S._mpingPendingRestore=true}catch(e){}

function clearPathArrows(){
  if(S._pathArrowAnimInterval){clearInterval(S._pathArrowAnimInterval);S._pathArrowAnimInterval=null}
  if(S._pathArrowZoomHandler&&S.map){try{S.map.off('zoomend',S._pathArrowZoomHandler)}catch(e){}}
  S._pathArrowZoomHandler=null;
  S._pathArrowLayers.forEach(l=>{try{S.map.removeLayer(l)}catch(e){}});
  S._pathArrowLayers=[];
}
function togglePathArrows(){
  S._showPathArrows=!S._showPathArrows;
  try{localStorage.setItem('st_pathArrows',S._showPathArrows?'1':'0')}catch(e){}
  if(S._showPathArrows){buildPathArrows(S.map)}else{clearPathArrows()}
  const btn=document.getElementById('btn-path-arrows');
  if(btn)btn.style.opacity=S._showPathArrows?'1':'0.4';
}
function setPathArrowStyle(style){
  S._pathArrowStyle=style;
  try{localStorage.setItem('st_arrowStyle',style)}catch(e){}
  if(S._showPathArrows)buildPathArrows(S.map);
  const cBtn=document.getElementById('pa-style-chevron');
  const pBtn=document.getElementById('pa-style-pointer');
  if(cBtn){cBtn.style.background=style==='chevron'?'rgba(0,229,255,0.2)':'rgba(255,255,255,0.05)';cBtn.style.borderColor=style==='chevron'?'var(--accent-cyan)':'var(--border-subtle)';}
  if(pBtn){pBtn.style.background=style==='pointer'?'rgba(0,229,255,0.2)':'rgba(255,255,255,0.05)';pBtn.style.borderColor=style==='pointer'?'var(--accent-cyan)':'var(--border-subtle)';}
}
function pathArrowNeonColor(maxDbz){
  if(maxDbz<15)return'#ffffff';
  return _dbzEntry(maxDbz).color;
}
function buildPathArrows(map,_retries){
  clearPathArrows();
  if(!map||!S._showPathArrows)return;
  const mv=(typeof getSteeringMv==='function')?getSteeringMv():(S.stormMovement&&S.stormMovement.speed>=1?S.stormMovement:null);
  if(!mv){
    const r=(_retries||0);
    if(r<5){setTimeout(()=>{if(S._showPathArrows)buildPathArrows(map,r+1)},800)}
    return;
  }
  const mvDir=mv.direction;
  const fromBear=(mvDir+180)%360;
  const ad=S._approachData||{count:0,bearings:[],maxDist:0,sumDbz:0,maxDbz:0,minDbz:999};
  const hasInbound=ad.count>0&&ad.sumDbz>0;
  const centerColor=hasInbound?pathArrowNeonColor(ad.maxDbz):'#ffffff';
  const edgeColor=hasInbound?pathArrowNeonColor(ad.minDbz):'#ff3355';
  const tailColor=hasInbound?centerColor:'#ffffff';
  const avgBearDeg=fromBear;
  let halfAngle=15;
  const farthestStorm=hasInbound&&ad.maxDist>0?ad.maxDist:S.scanRadius||30;
  const coneDist=Math.max(15,Math.min(farthestStorm+10,120));
  if(hasInbound){
    let bearSpread=0;
    for(const b of ad.bearings){
      const d=Math.abs(((b-fromBear)+540)%360-180);
      if(d>bearSpread)bearSpread=d;
    }
    halfAngle=Math.max(8,Math.min(bearSpread+5,30));
  }
  const pane='path-arrow-pane';
  if(!map.getPane(pane)){map.createPane(pane);map.getPane(pane).style.zIndex=440}
  const ilsCount=Math.max(12,Math.min(Math.round(coneDist/4),25));
  const tailMi=Math.max(10,Math.min(coneDist*0.3,40));
  const tailCount=Math.max(6,Math.round(tailMi/5));
  const totalCenter=ilsCount+tailCount;
  const ilsCenterDots=[];
  const ilsLeftDots=[];
  const ilsRightDots=[];
  for(let i=0;i<ilsCount;i++){
    const f=(i+1)/(ilsCount+1);
    const d=coneDist*(1-f);
    const spread=halfAngle*(1-f);
    const cPt=destPt(S.lat,S.lon,d,avgBearDeg);
    const sz=Math.max(3,6-f*3);
    const dot=L.marker(cPt,{
      icon:L.divIcon({className:'',html:`<div class="ils-dot" style="width:${sz}px;height:${sz}px;background:${centerColor};box-shadow:0 0 ${sz+3}px ${centerColor};opacity:0.15"></div>`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]}),
      pane:pane,interactive:false
    }).addTo(map);
    ilsCenterDots.push(dot);
    S._pathArrowLayers.push(dot);
    if(spread>2){
      const lPt=destPt(S.lat,S.lon,d,avgBearDeg-spread);
      const rPt=destPt(S.lat,S.lon,d,avgBearDeg+spread);
      const barSz=Math.min(4,Math.max(2,sz-1));
      const lDot=L.marker(lPt,{
        icon:L.divIcon({className:'',html:`<div class="ils-dot" style="width:${barSz}px;height:${barSz}px;background:${edgeColor};box-shadow:0 0 ${barSz+2}px ${edgeColor};opacity:0.15"></div>`,iconSize:[barSz,barSz],iconAnchor:[barSz/2,barSz/2]}),
        pane:pane,interactive:false
      }).addTo(map);
      const rDot=L.marker(rPt,{
        icon:L.divIcon({className:'',html:`<div class="ils-dot" style="width:${barSz}px;height:${barSz}px;background:${edgeColor};box-shadow:0 0 ${barSz+2}px ${edgeColor};opacity:0.15"></div>`,iconSize:[barSz,barSz],iconAnchor:[barSz/2,barSz/2]}),
        pane:pane,interactive:false
      }).addTo(map);
      ilsLeftDots.push(lDot);
      ilsRightDots.push(rDot);
      S._pathArrowLayers.push(lDot);
      S._pathArrowLayers.push(rDot);
    }
  }
  for(let i=0;i<tailCount;i++){
    const f=(i+1)/(tailCount+1);
    const tPt=destPt(S.lat,S.lon,tailMi*f,mvDir);
    const fadeOp=Math.max(0.05,0.15*(1-f));
    const sz=Math.max(2,5-f*3);
    const dot=L.marker(tPt,{
      icon:L.divIcon({className:'',html:`<div class="ils-dot" style="width:${sz}px;height:${sz}px;background:${tailColor};box-shadow:0 0 ${sz+2}px ${tailColor};opacity:${fadeOp}"></div>`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]}),
      pane:pane,interactive:false
    }).addTo(map);
    ilsCenterDots.push(dot);
    S._pathArrowLayers.push(dot);
  }
  const vanePt=destPt(S.lat,S.lon,tailMi*0.92,mvDir);
  const vaneSz=16;
  const vaneArrow=L.marker(vanePt,{
    icon:L.divIcon({className:'',html:`<svg width="${vaneSz}" height="${vaneSz}" viewBox="0 0 40 40" style="transform:rotate(${mvDir}deg);filter:drop-shadow(0 0 4px ${tailColor})"><polygon points="20,4 30,30 20,24 10,30" fill="${tailColor}" fill-opacity="0.7"/></svg>`,iconSize:[vaneSz,vaneSz],iconAnchor:[vaneSz/2,vaneSz/2]}),
    pane:pane,interactive:false
  }).addTo(map);
  S._pathArrowLayers.push(vaneArrow);
  let cFrame=0,sFrame=0;
  const animDots=(dots,frame)=>{
    const len=dots.length;
    for(let i=0;i<len;i++){
      const el=dots[i].getElement();
      if(!el)continue;
      const ch=el.firstChild;
      if(!ch)continue;
      const pos=(frame-i+len)%len;
      if(pos<3){
        ch.style.opacity=String(pos===0?0.9:pos===1?0.5:0.25);
        ch.style.transform=pos===0?'scale(1.2)':'scale(1)';
      }else{
        ch.style.opacity='0.15';
        ch.style.transform='scale(1)';
      }
    }
  };
  const sideLen=ilsLeftDots.length||1;
  S._pathArrowAnimInterval=setInterval(()=>{
    animDots(ilsCenterDots,cFrame);
    animDots(ilsLeftDots,sFrame);
    animDots(ilsRightDots,sFrame);
    cFrame=(cFrame+1)%totalCenter;
    sFrame=(sFrame+1)%sideLen;
  },150);
}
function toggleStormPoints(){
  const modes=['off','inbound','all'];
  const cur=modes.indexOf(S._pointsMode);
  S._pointsMode=modes[(cur+1)%3];
  S._showPoints=(S._pointsMode!=='off');
  try{localStorage.setItem('st_pointsMode',S._pointsMode)}catch(e){}
  const btn=document.getElementById('btn-points');
  if(S._pointsMode==='off'){
    S.stormMarkers.forEach(m=>{try{S.map.removeLayer(m)}catch(e){}});
    if(btn){btn.style.opacity='0.4';_ris('btn-points','points');}
  }else if(S._pointsMode==='inbound'){
    if(S.map)plotStormMarkers(S.map);
    if(btn){btn.style.opacity='1';_ris('btn-points','points-12');}
  }else{
    if(S.map)plotStormMarkers(S.map);
    if(btn){btn.style.opacity='1';_ris('btn-points','points');}
  }
}

function clearStormTracks(){
  if(!S._trackCones)S._trackCones=[];
  S._trackCones.forEach(l=>{try{if(S.map)S.map.removeLayer(l)}catch(e){}});
  S._trackCones=[];
}
function _coneRainStats(pts){
  const raw=S._rawScanPts;
  if(!pts||pts.length<3||!raw||!raw.length)return{count:0,maxDbz:0};
  let minLat=90,maxLat=-90,minLng=180,maxLng=-180;
  for(const p of pts){if(p[0]<minLat)minLat=p[0];if(p[0]>maxLat)maxLat=p[0];if(p[1]<minLng)minLng=p[1];if(p[1]>maxLng)maxLng=p[1];}
  let count=0,maxDbz=0;
  for(let k=0;k<raw.length;k++){
    const rp=raw[k];const y=rp.lat,x=rp.lng;
    if(y<minLat||y>maxLat||x<minLng||x>maxLng)continue;
    let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const yi=pts[i][0],xi=pts[i][1],yj=pts[j][0],xj=pts[j][1];
      if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))inside=!inside;
    }
    if(inside){count++;if((rp.dbz||0)>maxDbz)maxDbz=rp.dbz||0;}
  }
  return{count,maxDbz};
}
function plotStormTracks(map){
  clearStormTracks();
  if(S._tracksMode==='off'||!map)return;
  const _mv=(typeof getSteeringMv==='function')?getSteeringMv():(S.stormMovement&&S.stormMovement.speed>=2?S.stormMovement:null);
  if(!_mv||_mv.speed<2)return;
  let storms=getVisibleStormList();
  if(!storms.length)return;
  if(S._tracksMode==='inbound'){
    if(S._topStorms&&S._topStorms.length){
      storms=storms.filter(s=>S._topStorms.includes(s));
    }else{
      storms.forEach(s=>{if(!s._eta)s._eta=calcStormETA(s)});
      storms=storms.filter(s=>{
        if(!(s._eta&&s._eta.approaching&&s._eta.impact>0))return false;
        const k=(s._brief&&s._brief.classification)||(typeof calcStormETAForBriefing==='function'?(calcStormETAForBriefing(s)||{}).classification:null);
        return k==='direct'||k==='near_direct'||k==='near_miss';
      }).sort((a,b)=>(b._eta.impact||0)-(a._eta.impact||0)).slice(0,12);
    }
  }
  const _coneFloor=(typeof getConeMinDbz==='function')?getConeMinDbz():30;
  storms.forEach(s=>{
    if((s.dbz||0)<_coneFloor)return;
    const _smv=(typeof getHybridMovement==='function'?getHybridMovement(s):null)||_mv;
    if(!_smv||_smv.speed<2)return;
    const pts=(typeof buildStormCone==='function')?buildStormCone(s,_smv):null;
    if(!pts)return;
    const color=dbzHex(s.dbz);
    let _imp=0.3;
    try{
      const _b=(typeof calcStormETAForBriefing==='function')?calcStormETAForBriefing(s):null;
      if(_b&&_b.impactScore!=null)_imp=_b.impactScore;
    }catch(e){}
    const fillOpa=0.08*Math.max(0.3,_imp);
    const poly=L.polygon(pts,{color,fillColor:color,fillOpacity:fillOpa,weight:1,dashArray:'4,4',opacity:0.5,interactive:false}).addTo(map);
    S._trackCones.push(poly);
    // v4.83: the per-cone 💧 "count · max dBZ" text label used to be drawn here, but with many
    // overlapping cones near the user the labels piled up unreadably. The same in-path rain
    // coverage now shows on each storm's card in the Storms tab (getStormConeRain in storms.js).
  });
}
function clearRelMotionLayers(){
  if(!S._relMotionLayers)S._relMotionLayers=[];
  S._relMotionLayers.forEach(l=>{try{if(S.map)S.map.removeLayer(l)}catch(e){}});
  S._relMotionLayers=[];
}
function buildRelMotionLayers(map){
  clearRelMotionLayers();
  if(!map||S._relMotionMode==='off'||typeof calcStormETAForBriefing!=='function')return;
  const pane=map.getPane('rel-motion-pane')?'rel-motion-pane':undefined;
  let storms=getVisibleStormList?getVisibleStormList():S.storms;
  if(!storms||!storms.length)return;
  if(S._relMotionMode==='inbound'){
    if(S._topStorms&&S._topStorms.length){storms=storms.filter(s=>S._topStorms.includes(s))}
    else storms=storms.slice(0,12);
  }
  storms.forEach(s=>{
    let b;try{b=calcStormETAForBriefing(s)}catch(e){return}
    if(!b||b.classification==='unknown')return;
    const sc=stormClass(b.classification);
    const col=sc.color;
    const opa=sc.opacity;
    if(b.closingMph>0){
      const projMi=Math.min(s.distance,Math.max(2,b.closingMph*30/60));
      const ep=destPoint(S.lat,S.lon,s.bearing,projMi);
      const line=L.polyline([[S.lat,S.lon],ep],{pane,color:col,weight:2.5,opacity:opa,dashArray:'6,4',interactive:false}).addTo(map);
      S._relMotionLayers.push(line);
      const tip=L.circleMarker(ep,{pane,radius:4,color:col,fillColor:col,fillOpacity:opa,weight:1,interactive:false}).addTo(map);
      S._relMotionLayers.push(tip);
      const pctStr=(sc.showPct&&b.impactScore!=null)?` ${Math.round(b.impactScore*100)}%`:'';
      const _rmEta=(b.etaMin!=null)?Math.round(Math.max(0,b.etaMin-radarAgeMin())):null;
      const lbl=(b.classification==='direct'||b.classification==='near_direct')?`${sc.badge}${pctStr} · ≈${b.closingMph} mph · ETA ${_rmEta}m`
               :(b.classification==='near_miss'||b.classification==='miss'||b.classification==='distant'||b.classification==='far')?`${sc.badge}${pctStr} · ≈${b.closingMph} mph`
               :`${sc.badge}`;
      const tag=L.marker(ep,{pane,interactive:false,icon:L.divIcon({className:'',html:`<div style="font-size:10px;font-weight:700;color:${col};text-shadow:0 0 4px #000,0 0 2px #000;white-space:nowrap;transform:translate(6px,-50%)">${lbl}</div>`,iconSize:[1,1],iconAnchor:[0,0]})}).addTo(map);
      S._relMotionLayers.push(tag);
    }
    if(b.perpMissMi!=null&&b.perpMissMi>0&&b.classification!=='direct'&&b.sideBearing!=null){
      const cp=destPoint(S.lat,S.lon,b.sideBearing,b.perpMissMi);
      const perpDir1=(b.sideBearing+90)%360, perpDir2=(b.sideBearing+270)%360;
      const t1=destPoint(cp[0],cp[1],perpDir1,0.6);
      const t2=destPoint(cp[0],cp[1],perpDir2,0.6);
      const tick=L.polyline([t1,t2],{pane,color:col,weight:2.5,opacity:opa,interactive:false}).addTo(map);
      S._relMotionLayers.push(tick);
      const missMi=S.radarMetric?(b.perpMissMi*1.60934).toFixed(1)+' km':b.perpMissMi.toFixed(0)+' mi';
      const missLbl=`miss ${missMi} ${degToDir(b.sideBearing)}`;
      const missTag=L.marker(cp,{pane,interactive:false,icon:L.divIcon({className:'',html:`<div style="font-size:9px;font-weight:600;color:${col};text-shadow:0 0 3px #000;white-space:nowrap;transform:translate(8px,-50%)">${missLbl}</div>`,iconSize:[1,1],iconAnchor:[0,0]})}).addTo(map);
      S._relMotionLayers.push(missTag);
    }
  });
}
function toggleRelMotion(){
  const modes=['off','inbound','all'];
  const cur=modes.indexOf(S._relMotionMode);
  S._relMotionMode=modes[(cur+1)%3];
  try{localStorage.setItem('st_relMotionMode',S._relMotionMode)}catch(e){}
  const btn=document.getElementById('btn-relmotion');
  if(S._relMotionMode==='off'){clearRelMotionLayers();if(btn){btn.style.opacity='0.4';btn.textContent='∡'}}
  else if(S._relMotionMode==='inbound'){if(S.map)buildRelMotionLayers(S.map);if(btn){btn.style.opacity='1';btn.textContent='∡12'}}
  else{if(S.map)buildRelMotionLayers(S.map);if(btn){btn.style.opacity='1';btn.textContent='∡A'}}
}
function toggleStormTracks(){
  const modes=['off','inbound','all'];
  const cur=modes.indexOf(S._tracksMode);
  S._tracksMode=modes[(cur+1)%3];
  try{localStorage.setItem('st_tracksMode',S._tracksMode)}catch(e){}
  const btn=document.getElementById('btn-tracks');
  if(S._tracksMode==='off'){
    clearStormTracks();
    if(btn){btn.style.opacity='0.4';_ris('btn-tracks','tracks');}
  }else if(S._tracksMode==='inbound'){
    if(S.map)plotStormTracks(S.map);
    if(btn){btn.style.opacity='1';_ris('btn-tracks','tracks-12');}
  }else{
    if(S.map)plotStormTracks(S.map);
    if(btn){btn.style.opacity='1';_ris('btn-tracks','tracks');}
  }
}


// ═══ v5.92: MAP LAYERS PANEL ═══ groups the former right-side button pile into
// collapsible sections (mirrors the Storms tab's accordion feel). Legacy toggle
// buttons keep their original ids so every existing toggle function still
// styles them; the panel re-renders after each tap so mode icons stay fresh,
// preserving each section's open/closed state.
function _lpLegacyRow(id,iconHtml,label,fn,extra){
  return `<div style="display:flex;align-items:center;gap:8px;padding:2px 2px;cursor:pointer" onclick="_lpDo('${fn}')">`+
    `<div class="map-ctrl-btn" id="${id}" style="pointer-events:none;${extra||''}">${iconHtml}</div>`+
    `<span style="font-size:0.68em;color:var(--text-secondary)">${label}</span></div>`;
}
function _lpSeg(label,key,opts){
  const cur=(typeof _nhcOpt==='function')?_nhcOpt(key):null;
  return `<div style="padding:3px 2px"><div style="font-size:0.6em;color:var(--text-muted);margin-bottom:2px">${label}</div><div style="display:flex;gap:3px">`+
    opts.map(o=>`<span onclick="setNHCLayerOpt('${key}','${o.v}')" style="flex:1;text-align:center;font-size:0.6em;padding:3px 2px;border-radius:6px;cursor:pointer;border:1px solid ${cur===o.v?'var(--accent-cyan)':'var(--border-subtle)'};background:${cur===o.v?'rgba(0,229,255,0.15)':'transparent'};color:${cur===o.v?'var(--accent-cyan)':'var(--text-muted)'};font-weight:600">${o.l}</span>`).join('')+
    `</div></div>`;
}
function _lpHurrOpts(){
  return _lpSeg('Tracks & cones','tracks',[{v:'all',l:'All'},{v:'off',l:'Off'}])
    +_lpSeg('Wind fields','wind',[{v:'all',l:'All'},{v:'h64',l:'64kt'},{v:'off',l:'Off'}])
    +_lpSeg('Fronts','fronts',[{v:'on',l:'On'},{v:'off',l:'Off'}])
    +_lpSeg('ST Model','st',[{v:'on',l:'On'},{v:'off',l:'Off'}])
    +_lpSeg('Flow particles','flow',[{v:'on',l:'On'},{v:'off',l:'Off'}])
    +_lpSeg('History dots','dots',[{v:'on',l:'On'},{v:'off',l:'Off'}]);
}
function _layersPanelHTML(){
  const sec=(title,open,body)=>`<details ${open?'open':''} style="margin-bottom:4px"><summary style="font-size:0.7em;font-weight:700;color:var(--text-primary);cursor:pointer;padding:4px 2px">${title}</summary>${body}</details>`;
  const storms=
    _lpLegacyRow('btn-zones',_ri('zones'),'Storm zones','toggleStormZones')+
    _lpLegacyRow('btn-points',_ri(S._pointsMode==='inbound'?'points-12':'points'),'Storm points','toggleStormPoints')+
    _lpLegacyRow('btn-tracks',_ri(S._tracksMode==='inbound'?'tracks-12':'tracks'),'Track cones','toggleStormTracks')+
    _lpLegacyRow('btn-path-arrows',_ri('path-arrows'),'Path arrows','togglePathArrows')+
    _lpLegacyRow('btn-relmotion',(S._relMotionMode==='all'?'∡A':S._relMotionMode==='inbound'?'∡12':'∡'),'Motion vectors','toggleRelMotion','font-weight:700;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center');
  const radar=
    _lpLegacyRow('btn-radar-overlay',_ri('radar-overlay'),'Radar overlay','toggleRadarOverlay')+
    _lpLegacyRow('btn-mping',_ri('mping'),'mPING reports','toggleMping')+
    _lpLegacyRow('btn-alert-polys',_ri('alert-polys'),'NWS alert areas','toggleAlertPolygons');
  const hurr=
    _lpLegacyRow('btn-nhc-tracks','🌀','All 🌀 overlays','_lpToggleNHC','font-size:15px;display:flex;align-items:center;justify-content:center;opacity:'+(S._showNHCTracks?1:0.4))+
    `<div id="lp-hurr-opts">${_lpHurrOpts()}</div>`;
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0 2px 6px"><span style="font-size:0.7em;font-weight:800;letter-spacing:0.06em;color:var(--accent-cyan)">MAP LAYERS</span><span onclick="toggleLayersPanel()" style="cursor:pointer;color:var(--text-muted);padding:0 4px;font-size:0.85em">✕</span></div>`
    +sec('⛈️ Storms',true,storms)+sec('📡 Radar',false,radar)+sec('🌀 Hurricane',true,hurr);
}
function _lpToggleNHC(){toggleNHCTracks(!S._showNHCTracks)}
function _lpDo(fn){try{if(typeof window[fn]==='function')window[fn]()}catch(e){console.warn('[layers]',fn,e&&e.message)}_syncLayersPanel()}
function _syncLayersPanel(){
  const p=document.getElementById('map-layers-panel');
  if(!p||p.style.display==='none')return;
  const states=[...p.querySelectorAll('details')].map(d=>d.open);
  p.innerHTML=_layersPanelHTML();
  [...p.querySelectorAll('details')].forEach((d,i)=>{if(states[i]!=null)d.open=states[i]});
}
function toggleLayersPanel(){
  const p=document.getElementById('map-layers-panel');
  if(!p)return;
  const open=p.style.display!=='none';
  p.style.display=open?'none':'block';
  if(!open)p.innerHTML=_layersPanelHTML();
}
