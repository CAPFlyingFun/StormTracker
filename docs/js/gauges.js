// StormTracker — Wind Gauges, Sonar Config, Gyro Compass
let _windMinKmh=Infinity,_windMaxKmh=0;
// v6.27: sonar zoom-out now extends to match the user's Scan Range (Settings → 📡).
// Base detail levels always available; the wider levels appear only up to scanRadius.
const _SONAR_ZOOM_BASE=[15,20,30,40,50,60,70,80];
function _sonZoomLevels(){
  const max=(S&&S.scanRadius)||80;
  return _SONAR_ZOOM_BASE.concat([100,120,140,160,180,200].filter(v=>v<=max));
}
// Derived from the master DBZ_SCALE (core.js) so the sonar dot-size controls stay
// in lockstep with the radar palette. Covers rain-bearing bins (≥20 dBZ).
const _SONAR_DBZ_BINS=DBZ_SCALE.filter(e=>e.min>=20);
const _SONAR_DBZ_CLASSES=_SONAR_DBZ_BINS.map(e=>e.cls);
const _SONAR_DBZ_LABELS=Object.fromEntries(_SONAR_DBZ_BINS.map((e,i,a)=>{const nx=a[i+1];const rng=nx?`${e.min}-${nx.min-1}`:`${e.min}+`;return[e.cls,`${e.label} (${rng})`]}));
const _SONAR_DBZ_COLORS=Object.fromEntries(_SONAR_DBZ_BINS.map(e=>[e.cls,e.color]));
const _SONAR_DEFAULTS={dbzScale:{},sweepSpeed:40,fadeDur:2,alwaysOn:false,dotOpacity:100,glowInt:1,gridBright:100,dbzFloor:0,showStormArrows:true,showAloft:true,showLightning:true,showRelMotion:true};
let _sonarCfg=(function(){try{const s=JSON.parse(localStorage.getItem('st_sonarCfg'));if(s&&typeof s==='object')return Object.assign({},_SONAR_DEFAULTS,s)}catch(e){}return Object.assign({},_SONAR_DEFAULTS)})();
function _saveSonarCfg(){localStorage.setItem('st_sonarCfg',JSON.stringify(_sonarCfg))}
function _getDbzScale(cls){return _sonarCfg.dbzScale[cls]!=null?_sonarCfg.dbzScale[cls]:1}
function _setDbzScale(cls,v){_sonarCfg.dbzScale[cls]=v;_saveSonarCfg()}
function _toggleSonarSettings(){
  let p=document.getElementById('sonar-settings-panel');
  if(p){p.style.display=p.style.display==='none'?'block':'none';return}
  const wrap=document.getElementById('mini-sonar-wrap');if(!wrap)return;
  p=document.createElement('div');p.id='sonar-settings-panel';
  p.style.cssText='position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(10,14,20,0.92);z-index:20;border-radius:8px;padding:10px 14px;overflow-y:auto;backdrop-filter:blur(4px)';
  const sw=_sonarCfg,lb='font-size:0.55em;color:rgba(255,255,255,0.7)',tl='font-size:0.6em;color:#00eeff;font-weight:600',vl='font-size:0.5em;color:rgba(255,255,255,0.6);min-width:28px;text-align:right';
  const spdNames={20:'Slow',40:'Medium',60:'Fast',80:'Turbo'};
  const fadeNames={1:'Short',2:'Medium',3:'Long'};
  const glowNames={0:'None',1:'Subtle',2:'Intense'};
  let html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="color:#00eeff;font-weight:700;font-size:0.7em">⚙ Sonar Settings</span><button onclick="_toggleSonarSettings()" style="background:none;border:none;color:#00eeff;font-size:1em;cursor:pointer;padding:2px 6px">✕</button></div>';
  html+='<div class="sub-section-sep">';
  html+='<div style="'+tl+';margin-bottom:4px">Sweep</div>';
  html+='<div class="flex-between-mb3"><span style="'+lb+'">Speed</span><div class="flex-gap-3">';
  for(const spd of [20,40,60,80])html+=`<button onclick="_setSonarOpt('sweepSpeed',${spd})" id="ss-spd-${spd}" style="font-size:0.45em;padding:2px 5px;border-radius:3px;cursor:pointer;border:1px solid ${sw.sweepSpeed===spd?'#00eeff':'rgba(0,220,255,0.3)'};background:${sw.sweepSpeed===spd?'rgba(0,220,255,0.2)':'none'};color:${sw.sweepSpeed===spd?'#00eeff':'rgba(255,255,255,0.5)'}">${spdNames[spd]}</button>`;
  html+='</div></div>';
  html+='<div class="flex-between-mb3"><span style="'+lb+'">Fade</span><div class="flex-gap-3">';
  for(const fd of [1,2,3])html+=`<button onclick="_setSonarOpt('fadeDur',${fd})" id="ss-fade-${fd}" style="font-size:0.45em;padding:2px 5px;border-radius:3px;cursor:pointer;border:1px solid ${sw.fadeDur===fd?'#00eeff':'rgba(0,220,255,0.3)'};background:${sw.fadeDur===fd?'rgba(0,220,255,0.2)':'none'};color:${sw.fadeDur===fd?'#00eeff':'rgba(255,255,255,0.5)'}">${fadeNames[fd]}</button>`;
  html+='</div></div>';
  html+=`<div class="flex-between"><span style="${lb}">Always On (no sweep)</span><button onclick="_setSonarOpt('alwaysOn',!_sonarCfg.alwaysOn)" id="ss-always" style="font-size:0.45em;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid ${sw.alwaysOn?'#00ff88':'rgba(0,220,255,0.3)'};background:${sw.alwaysOn?'rgba(0,255,136,0.2)':'none'};color:${sw.alwaysOn?'#00ff88':'rgba(255,255,255,0.5)'}">${sw.alwaysOn?'ON':'OFF'}</button></div>`;
  html+='</div>';
  html+='<div class="sub-section-sep">';
  html+='<div style="'+tl+';margin-bottom:4px">Visual</div>';
  html+=`<div class="flex-between-mb3"><span style="${lb}">Dot Opacity</span><span id="ss-opac-v" style="${vl}">${sw.dotOpacity}%</span></div><input type="range" min="20" max="100" value="${sw.dotOpacity}" step="10" oninput="_setSonarSlider('dotOpacity',this.value,'ss-opac-v','%')" style="width:100%;height:14px;accent-color:#00eeff;cursor:pointer;margin-bottom:4px">`;
  html+='<div class="flex-between-mb3"><span style="'+lb+'">Glow</span><div class="flex-gap-3">';
  for(const gl of [0,1,2])html+=`<button onclick="_setSonarOpt('glowInt',${gl})" id="ss-glow-${gl}" style="font-size:0.45em;padding:2px 5px;border-radius:3px;cursor:pointer;border:1px solid ${sw.glowInt===gl?'#00eeff':'rgba(0,220,255,0.3)'};background:${sw.glowInt===gl?'rgba(0,220,255,0.2)':'none'};color:${sw.glowInt===gl?'#00eeff':'rgba(255,255,255,0.5)'}">${glowNames[gl]}</button>`;
  html+='</div></div>';
  html+=`<div class="flex-between-mb3"><span style="${lb}">Grid Brightness</span><span id="ss-grid-v" style="${vl}">${sw.gridBright}%</span></div><input type="range" min="0" max="200" value="${sw.gridBright}" step="20" oninput="_setSonarSlider('gridBright',this.value,'ss-grid-v','%')" style="width:100%;height:14px;accent-color:#00eeff;cursor:pointer;margin-bottom:4px">`;
  html+=`<div class="flex-between"><span style="${lb}">dBZ Floor (hide below)</span><span id="ss-floor-v" style="${vl}">${sw.dbzFloor}</span></div><input type="range" min="0" max="40" value="${sw.dbzFloor}" step="5" oninput="_setSonarSlider('dbzFloor',this.value,'ss-floor-v','')" style="width:100%;height:14px;accent-color:#00eeff;cursor:pointer">`;
  html+='</div>';
  html+='<div class="sub-section-sep">';
  html+='<div style="'+tl+';margin-bottom:4px">Overlays</div>';
  const togs=[['showStormArrows','Storm Arrows'],['showAloft','Aloft Wind'],['showRelMotion','Relative Motion (AI)'],['showLightning','⚡ Lightning (≥48 dBZ)']];
  for(const[key,lbl]of togs){
    const on=sw[key];
    html+=`<div class="flex-between-mb3"><span style="${lb}">${lbl}</span><button onclick="_setSonarOpt('${key}',!_sonarCfg.${key})" id="ss-${key}" style="font-size:0.45em;padding:2px 8px;border-radius:3px;cursor:pointer;border:1px solid ${on?'#00ff88':'rgba(0,220,255,0.3)'};background:${on?'rgba(0,255,136,0.2)':'none'};color:${on?'#00ff88':'rgba(255,255,255,0.5)'}">${on?'ON':'OFF'}</button></div>`;
  }
  html+='</div>';
  html+='<div style="margin-bottom:6px">';
  html+='<div style="'+tl+';margin-bottom:4px">Dot Size by dBZ</div>';
  for(const cls of _SONAR_DBZ_CLASSES){
    const val=Math.round(_getDbzScale(cls)*100);
    const col=(_SONAR_DBZ_BINS.find(b=>b.cls===cls)||{color:'#888'}).color;
    html+=`<div style="margin-bottom:5px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1px"><span style="font-size:0.5em;color:${col};font-weight:600">${_SONAR_DBZ_LABELS[cls]}</span><span id="sonar-dbz-val-${cls}" style="${vl}">${val}%</span></div><input type="range" min="50" max="200" value="${val}" step="10" id="sonar-dbz-${cls}" oninput="_onDbzSlider('${cls}',this.value)" style="width:100%;height:14px;accent-color:${col};cursor:pointer"></div>`;
  }
  html+='</div>';
  html+='<button onclick="_resetAllSonar()" style="background:none;border:1px solid rgba(0,220,255,0.3);color:rgba(0,220,255,0.6);font-size:0.5em;padding:3px 10px;border-radius:4px;cursor:pointer;width:100%">Reset All to Default</button>';
  p.innerHTML=html;
  wrap.style.position='relative';wrap.appendChild(p);
}
function _setSonarOpt(key,val){_sonarCfg[key]=val;_saveSonarCfg();const p=document.getElementById('sonar-settings-panel');if(p)p.remove();drawMiniSonar();setTimeout(()=>_toggleSonarSettings(),50)}
function _setSonarSlider(key,val,elId,suffix){_sonarCfg[key]=Number(val);_saveSonarCfg();const el=document.getElementById(elId);if(el)el.textContent=val+suffix;drawMiniSonar()}
function _onDbzSlider(cls,val){
  _setDbzScale(cls,val/100);
  const el=document.getElementById('sonar-dbz-val-'+cls);
  if(el)el.textContent=val+'%';
  drawMiniSonar();
}
function _resetAllSonar(){
  const fresh=JSON.parse(JSON.stringify(_SONAR_DEFAULTS));
  for(const k in _sonarCfg)delete _sonarCfg[k];
  Object.assign(_sonarCfg,fresh);
  _saveSonarCfg();
  const p=document.getElementById('sonar-settings-panel');
  if(p)p.remove();
  drawMiniSonar();
  setTimeout(()=>_toggleSonarSettings(),50);
}
let _sonarZoomMi=parseInt(localStorage.getItem('st_sonarZoom'))||80;
if(_sonarZoomMi<15)_sonarZoomMi=80;
function _sonNearestLevel(v){const L=_sonZoomLevels();let best=L[0];for(const x of L)if(Math.abs(x-v)<Math.abs(best-v))best=x;return best}
function sonarZoomIn(){const L=_sonZoomLevels();let i=L.indexOf(_sonarZoomMi);if(i<0)i=L.indexOf(_sonNearestLevel(_sonarZoomMi));if(i>0){_sonarZoomMi=L[i-1];localStorage.setItem('st_sonarZoom',_sonarZoomMi);S._sonarTotalSwept=0;S._sonarSweepAngle=0;_clusterSonarPoints();drawMiniSonar();_syncSonarZoomBtns()}}
function sonarZoomOut(){const L=_sonZoomLevels();let i=L.indexOf(_sonarZoomMi);if(i<0)i=L.indexOf(_sonNearestLevel(_sonarZoomMi));if(i<L.length-1){_sonarZoomMi=L[i+1];localStorage.setItem('st_sonarZoom',_sonarZoomMi);S._sonarTotalSwept=0;S._sonarSweepAngle=0;_clusterSonarPoints();drawMiniSonar();_syncSonarZoomBtns()}}
// Mobile sonar render budget: phones choke when the Weather-tab "Radar Sonar"
// draws many thousands of clustered dots (an HD deep scan can produce 15k+),
// stalling the sweep animation. On phones (screen < 1024px, via _isDesktop())
// we cap the rendered point count; desktops stay uncapped. We coarsen the grid
// until under budget so spatial spread is preserved, with an intensity backstop.
// Only the mini-sonar visual + its "N zones" label use _sonarClusteredPts —
// storm detection, hex zones and the Rain Clock keep the full raw scan points.
const SONAR_MOBILE_PT_CAP=800;
function _clusterSonarPoints(){
  const pts=S._rawScanPts;
  if(!pts||!pts.length){S._sonarClusteredPts=[];return}
  const viewR=_sonarZoomMi;
  const baseRes=viewR<=20?0.003:viewR<=40?0.005:0.01;
  const cap=(typeof _isDesktop==='function'&&_isDesktop())?Infinity:SONAR_MOBILE_PT_CAP;
  let res=baseRes,cells;
  for(let attempt=0;attempt<6;attempt++){
    const inv=1/res;
    cells=new Map();
    for(let i=0;i<pts.length;i++){
      const p=pts[i];
      const k=Math.floor(p.lat*inv)+','+Math.floor(p.lng*inv);
      const c=cells.get(k);
      if(c){c.sLat+=p.lat;c.sLng+=p.lng;if(p.dbz>c.dbz)c.dbz=p.dbz;c.n++}
      else{cells.set(k,{sLat:p.lat,sLng:p.lng,dbz:p.dbz,n:1})}
    }
    if(cells.size<=cap)break;
    // Cell count scales ~1/res^2, so jump res toward the target in one step
    // (min 1.3x so we always make progress); re-bin and re-check.
    res*=Math.max(1.3,Math.sqrt(cells.size/cap));
  }
  let out=new Array(cells.size);
  let idx=0;
  for(const c of cells.values()){out[idx++]={lat:c.sLat/c.n,lng:c.sLng/c.n,dbz:c.dbz,count:c.n}}
  // Backstop: if coarsening still left us over budget, keep the strongest cells.
  if(isFinite(cap)&&out.length>cap){out.sort((a,b)=>b.dbz-a.dbz);out.length=cap}
  S._sonarClusteredPts=out;
  if(typeof refreshRainClock==='function')try{refreshRainClock(true)}catch(e){}
}
function _syncSonarZoomBtns(){const L=_sonZoomLevels();const zi=document.getElementById('sonar-zoom-in');const zo=document.getElementById('sonar-zoom-out');if(zi)zi.style.opacity=_sonarZoomMi<=L[0]?'0.3':'0.8';if(zo)zo.style.opacity=_sonarZoomMi>=L[L.length-1]?'0.3':'0.8'}
let _gyroHeading=null,_gyroEnabled=false,_gyroRaw=null,_gyroSmooth=null;
function initGyroCompass(){
  if(_gyroEnabled)return;
  const handler=e=>{
    let h=null;
    if(e.webkitCompassHeading!=null)h=e.webkitCompassHeading;
    else if(e.absolute&&e.alpha!=null)h=(360-e.alpha)%360;
    else if(e.alpha!=null)h=(360-e.alpha)%360;
    if(h==null)return;
    _gyroRaw=h;
    if(_gyroSmooth==null){_gyroSmooth=h;_gyroHeading=h;return}
    let diff=h-_gyroSmooth;
    if(diff>180)diff-=360;if(diff<-180)diff+=360;
    _gyroSmooth=((_gyroSmooth+diff*0.15)%360+360)%360;
    _gyroHeading=Math.round(_gyroSmooth*10)/10;
  };
  if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
    DeviceOrientationEvent.requestPermission().then(r=>{
      if(r==='granted'){window.addEventListener('deviceorientation',handler,true);_gyroEnabled=true;localStorage.setItem('st_gyro','1')}
    }).catch(()=>{});
  }else{
    window.addEventListener('deviceorientationabsolute',handler,true);
    window.addEventListener('deviceorientation',handler,true);
    _gyroEnabled=true;localStorage.setItem('st_gyro','1');
  }
}
function disableGyro(){_gyroEnabled=false;_gyroHeading=null;_gyroRaw=null;_gyroSmooth=null;localStorage.removeItem('st_gyro')}
if(localStorage.getItem('st_gyro')==='1'){try{initGyroCompass()}catch(e){}}
function _resetMinMax(){_windMinKmh=Infinity;_windMaxKmh=0}
function _trackMinMax(kmh){if(kmh>0.1){if(kmh<_windMinKmh)_windMinKmh=kmh;if(kmh>_windMaxKmh)_windMaxKmh=kmh}}
function getGaugeStyle(){return localStorage.getItem('st_gaugeStyle')||'neon'}
function setGaugeStyle(s){localStorage.setItem('st_gaugeStyle',s);reRenderActive();syncGaugeStyleBtns()}
function _led7(num,color,sz,dec){
  const segs=[0x7E,0x30,0x6D,0x79,0x33,0x5B,0x5F,0x70,0x7F,0x7B];
  const str=num.toFixed(dec!=null?dec:1);const chars=str.split('');
  let svg='';let xOff=0;const w=sz*0.6,h=sz,g=sz*0.06,sw=sz*0.12;
  const onC=color||'#ff2222';const offC='rgba(255,255,255,0.04)';
  chars.forEach(ch=>{
    if(ch==='.'){svg+=`<circle cx="${xOff+sw}" cy="${h-sw/2}" r="${sw*0.6}" fill="${onC}"/>`;xOff+=sw*2;return}
    if(ch==='-'){svg+=`<rect x="${xOff+g}" y="${h/2-sw/2}" width="${w-2*g}" height="${sw}" rx="${sw*0.3}" fill="${onC}"/>`;xOff+=w+g;return}
    const d=parseInt(ch);if(isNaN(d)){xOff+=w+g;return}
    const bits=segs[d];
    const paths=[
      {x:g,y:0,w:w-2*g,h:sw,rx:sw*0.3},
      {x:w-sw,y:g,w:sw,h:h/2-g-sw/2,rx:sw*0.3},
      {x:w-sw,y:h/2+sw/2,w:sw,h:h/2-g-sw/2,rx:sw*0.3},
      {x:g,y:h-sw,w:w-2*g,h:sw,rx:sw*0.3},
      {x:0,y:h/2+sw/2,w:sw,h:h/2-g-sw/2,rx:sw*0.3},
      {x:0,y:g,w:sw,h:h/2-g-sw/2,rx:sw*0.3},
      {x:g,y:h/2-sw/2,w:w-2*g,h:sw,rx:sw*0.3}
    ];
    paths.forEach((p,i)=>{
      const on=bits&(1<<(6-i));
      svg+=`<rect x="${xOff+p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.rx}" fill="${on?onC:offC}"/>`;
    });
    xOff+=w+g;
  });
  return{svg,width:xOff};
}
function _getSimInterval(){const v=parseInt(localStorage.getItem('st_windSimInterval'),10);return(v>=5&&v<=30)?v*1000:5000;}
function _getGustWindow(){const v=parseInt(localStorage.getItem('st_gustWindow'),10);return[30,60,120,300].includes(v)?v*1000:30000;}
function _getAvgWindow(){const v=parseInt(localStorage.getItem('st_avgWindow'),10);return[10,30,60,120].includes(v)?v*1000:10000;}
function _fmtWindowLabel(ms){if(ms>=120000)return(ms/60000)+'m';if(ms>=60000)return'1m';return(ms/1000)+'s';}
function _trendArrowHtml(){
  if(Math.abs(_windTrend)<0.05)return'<span style="color:#94a3b8;font-size:0.6em;margin-left:2px">→</span>';
  if(_windTrend>=0.05)return'<span style="color:#22c55e;font-size:0.6em;margin-left:2px">↑</span>';
  return'<span style="color:#ef4444;font-size:0.6em;margin-left:2px">↓</span>';
}
function renderGaugeNeon(d){
  const{windSpd,wd,windDisp,gustDisp,gustRaw,windNum,windUnit,gustStr,bf,simActive}=d;
  const cx=50,cy=50,r=42,ri=36;
  const neonCyan='rgba(0,220,255,',neonOrange='rgba(255,160,0,';
  let g='';
  g+=`<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.5" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  g+=`<circle cx="${cx}" cy="${cy}" r="${ri}" fill="none" stroke="${neonCyan}0.08)" stroke-width="0.5"/>`;
  g+=`<circle cx="${cx}" cy="${cy}" r="${ri*0.55}" fill="none" stroke="${neonCyan}0.05)" stroke-width="0.3"/>`;
  const maxArcSpd=Math.max(5,Math.ceil(Math.max(windDisp,gustDisp)*2/5)*5);
  const segsPerUnit=maxArcSpd<=30?2:1;
  const segCount=maxArcSpd*segsPerUnit;
  const segGap=segCount<=20?4:segCount<=40?2.5:1.5;
  const segR=r+4,segRi=r+0.5;
  S._gaugeMaxSegs=segCount;S._gaugeSegsPerUnit=segsPerUnit;S._gaugeArcR=segR;S._gaugeMaxSpd=maxArcSpd;
  const segAngle=360/segCount,segArc=segAngle-segGap;
  g+=`<g id="gauge-seg-group" transform="translate(${cx},${cy})">`;
  for(let i=0;i<segCount;i++){
    const rotDeg=-90+i*segAngle,radEnd=segArc*Math.PI/180;
    const cosE=Math.cos(radEnd),sinE=Math.sin(radEnd);
    const d2=`M${segR},0 A${segR},${segR} 0 ${segArc>180?1:0} 1 ${(segR*cosE).toFixed(2)},${(segR*sinE).toFixed(2)} L${(segRi*cosE).toFixed(2)},${(segRi*sinE).toFixed(2)} A${segRi},${segRi} 0 ${segArc>180?1:0} 0 ${segRi},0 Z`;
    const segVal=i/segsPerUnit;
    let fill=segVal<windDisp?`${neonCyan}0.85)`:segVal<gustDisp?`${neonOrange}0.6)`:`${neonCyan}0.08)`;
    g+=`<path class="gauge-seg" d="${d2}" fill="${fill}" style="transform:rotate(${rotDeg}deg)"/>`;
  }
  g+=`</g>`;
  const spdStep=maxArcSpd<=10?2:maxArcSpd<=20?5:maxArcSpd<=50?5:maxArcSpd<=100?10:maxArcSpd<=150?25:50;
  g+=`<g id="gauge-tick-group">`;
  for(let s=0;s<maxArcSpd;s+=spdStep){
    const frac=s/maxArcSpd,deg=(-90+frac*360)*Math.PI/180;
    const lx=cx+Math.cos(deg)*(segR+4.5),ly=cy+Math.sin(deg)*(segR+4.5);
    g+=`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${neonCyan}0.5)" font-size="3.2" font-weight="700" text-anchor="middle" dominant-baseline="central">${s}</text>`;
  }
  g+=`</g>`;
  [0,30,60,90,120,150,180,210,240,270,300,330].forEach(deg=>{
    const a=(deg-90)*Math.PI/180,isMajor=deg%90===0;
    const x1=cx+Math.cos(a)*(ri-0.5),y1=cy+Math.sin(a)*(ri-0.5);
    const len=isMajor?5:3;
    const x2=cx+Math.cos(a)*(ri-0.5-len),y2=cy+Math.sin(a)*(ri-0.5-len);
    g+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${neonCyan}${isMajor?'0.45':'0.15'})" stroke-width="${isMajor?1.2:0.5}"/>`;
    if(!isMajor){
      const lx=cx+Math.cos(a)*(ri-8),ly=cy+Math.sin(a)*(ri-8);
      g+=`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${neonCyan}0.2)" font-size="3.5" text-anchor="middle" dominant-baseline="central">${deg||360}</text>`;
    }
  });
  for(let dd=0;dd<360;dd+=10){if(dd%30===0)continue;
    const a=(dd-90)*Math.PI/180;
    g+=`<line x1="${(cx+Math.cos(a)*(ri-0.5)).toFixed(1)}" y1="${(cy+Math.sin(a)*(ri-0.5)).toFixed(1)}" x2="${(cx+Math.cos(a)*(ri-2)).toFixed(1)}" y2="${(cy+Math.sin(a)*(ri-2)).toFixed(1)}" stroke="${neonCyan}0.08)" stroke-width="0.4"/>`;
  }
  const ptrAng=(wd-90)*Math.PI/180,pTip=r-1,pBase=10;
  const px=cx+Math.cos(ptrAng)*pTip,py=cy+Math.sin(ptrAng)*pTip;
  const pLx=cx+Math.cos(ptrAng-0.2)*pBase,pLy=cy+Math.sin(ptrAng-0.2)*pBase;
  const pRx=cx+Math.cos(ptrAng+0.2)*pBase,pRy=cy+Math.sin(ptrAng+0.2)*pBase;
  const pBx=cx+Math.cos(ptrAng+Math.PI)*5,pBy=cy+Math.sin(ptrAng+Math.PI)*5;
  const neonRed='rgba(255,70,70,';
  g+=`<polygon points="${px.toFixed(1)},${py.toFixed(1)} ${pLx.toFixed(1)},${pLy.toFixed(1)} ${pBx.toFixed(1)},${pBy.toFixed(1)} ${pRx.toFixed(1)},${pRy.toFixed(1)}" fill="${neonRed}0.85)" stroke="${neonRed}1)" stroke-width="0.3"/>`;
  g+=`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2" fill="#fff" stroke="${neonRed}1)" stroke-width="0.5"/>`;
  g+=`<circle cx="${cx}" cy="${cy}" r="3" fill="${neonRed}0.3)" stroke="${neonRed}0.5)" stroke-width="0.5"/>`;
  const dotCount=Math.max(3,Math.min(16,Math.round(windDisp/2)));
  for(let i=0;i<dotCount;i++){
    const ang=(wd-90+i*5-dotCount*2.5)*Math.PI/180,dr=ri-1;
    const dx=cx+Math.cos(ang)*dr,dy=cy+Math.sin(ang)*dr;
    g+=`<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="${(1+i*0.05).toFixed(1)}" fill="${neonRed}${(0.2+0.6*(i/dotCount)).toFixed(2)})"/>`;
  }
  const dirStr=simActive?degToDir(_windCurSim.dir)+' '+_windCurSim.dir.toFixed(0)+'°':degToDir(wd)+' '+wd.toFixed(0)+'°';
  return`<div class="wind-rose" style="cursor:pointer" data-gauge="neon">
    <svg viewBox="-12 -12 124 124">${g}</svg>
    <div class="wind-rose-labels"><span class="wr-n">N</span><span class="wr-s">S</span><span class="wr-e">E</span><span class="wr-w">W</span></div>
    <div class="wind-rose-center">
      <div class="wrc-speed"><span class="wrc-num">${windNum}</span><span class="wrc-unit">${windUnit}</span><span class="wrc-trend">${_trendArrowHtml()}</span></div>
      <div class="wrc-dir">${dirStr}</div>
      ${gustStr?`<div class="wrc-gust">${gustStr}</div>`:''}
      <div class="wrc-avg"></div>
      <div class="wrc-force">${_beaufortBar(d.windSpd)}</div>
    </div>
  </div>`;
}
function renderGaugeMarine(d){
  const{windSpd,wd,windDisp,gustDisp,windNum,windUnit,gustStr,bf,simActive}=d;
  const minDisp=_windMinKmh<Infinity?parseFloat(kmhTo(_windMinKmh,S.windUnit)):0;
  const maxDisp=_windMaxKmh>0?parseFloat(kmhTo(_windMaxKmh,S.windUnit)):0;
  const dirDeg=simActive?_windCurSim.dir:wd;
  const cx=100,cy=100,r=82,ri=70;
  let svg='';
  svg+=`<rect x="0" y="0" width="200" height="200" rx="8" fill="#0a0a0a" stroke="#333" stroke-width="1"/>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#222" stroke-width="1"/>`;
  const segCount=72;
  for(let i=0;i<segCount;i++){
    const ang=(i*5-90)*Math.PI/180;
    const diff=((i*5-dirDeg)%360+360)%360;
    const close=diff<20||diff>340;
    const fill=close?'#dddddd':'#555555';
    const iLen=close?12:8;
    const x1=cx+Math.cos(ang)*(r-1),y1=cy+Math.sin(ang)*(r-1);
    const x2=cx+Math.cos(ang)*(r-iLen),y2=cy+Math.sin(ang)*(r-iLen);
    const sw=close?3:1.5;
    svg+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${fill}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  const cardinals=[{a:0,l:'N'},{a:45,l:'NE'},{a:90,l:'E'},{a:135,l:'SE'},{a:180,l:'S'},{a:225,l:'SW'},{a:270,l:'W'},{a:315,l:'NW'}];
  cardinals.forEach(c=>{
    const a=(c.a-90)*Math.PI/180;
    const tx=cx+Math.cos(a)*(r+12),ty=cy+Math.sin(a)*(r+12);
    svg+=`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="#888" font-size="8" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace">${c.l}</text>`;
  });
  [0,30,60,90,120,150].forEach(v=>{
    const a=(v-90)*Math.PI/180;
    const tx=cx+Math.cos(a)*(r+22),ty=cy+Math.sin(a)*(r+22);
    const a2=(360-v-90)*Math.PI/180;
    const tx2=cx+Math.cos(a2)*(r+22),ty2=cy+Math.sin(a2)*(r+22);
    svg+=`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="#cc3333" font-size="7" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="monospace">${v}</text>`;
    if(v>0&&v<180)svg+=`<text x="${tx2.toFixed(1)}" y="${ty2.toFixed(1)}" fill="#cc3333" font-size="7" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="monospace">${v}</text>`;
  });
  svg+=`<text x="${cx}" y="${cy-32}" fill="#888" font-size="6" font-weight="600" text-anchor="middle" font-family="monospace">WIND SPEED</text>`;
  const spdLed=_led7(parseFloat(windNum),'#ff2222',18);
  svg+=`<g transform="translate(${cx-spdLed.width/2},${cy-30})">${spdLed.svg}</g>`;
  svg+=`<text x="${cx+spdLed.width/2+4}" y="${cy-18}" fill="#cc3333" font-size="5" text-anchor="start" font-family="monospace">${windUnit}</text>`;
  const _mtClr=Math.abs(_windTrend)<0.05?'#888':_windTrend>=0.05?'#22c55e':'#ff4444';
  const _mtSym=Math.abs(_windTrend)<0.05?'→':_windTrend>=0.05?'↑':'↓';
  svg+=`<text x="${cx+spdLed.width/2+4}" y="${cy-24}" fill="${_mtClr}" font-size="7" font-weight="700" text-anchor="start" font-family="monospace">${_mtSym}</text>`;
  svg+=`<text x="${cx}" y="${cy+2}" fill="#888" font-size="6" font-weight="600" text-anchor="middle" font-family="monospace">WIND FORCE</text>`;
  const bfBarW=120,bfBarX=cx-bfBarW/2,bfBarY=cy+5;
  for(let i=1;i<=12;i++){
    const bw=bfBarW/12;
    const fill=i<=bf?'#dddddd':'#333333';
    svg+=`<rect x="${bfBarX+(i-1)*bw+0.5}" y="${bfBarY}" width="${bw-1}" height="6" fill="${fill}" rx="1"/>`;
    svg+=`<text x="${bfBarX+(i-0.5)*bw}" y="${bfBarY+12}" fill="#777" font-size="4" text-anchor="middle" font-family="monospace">${i}</text>`;
  }
  svg+=`<text x="${cx}" y="${cy+28}" fill="#888" font-size="6" font-weight="600" text-anchor="middle" font-family="monospace">WIND DIRECTION</text>`;
  const dirLed=_led7(Math.round(dirDeg),'#ff2222',16,0);
  svg+=`<g transform="translate(${cx-dirLed.width/2},${cy+30})">${dirLed.svg}</g>`;
  svg+=`<text x="${cx+dirLed.width/2+2}" y="${cy+42}" fill="#cc3333" font-size="5" text-anchor="start" font-family="monospace">°</text>`;
  const mnLed=_led7(minDisp,'#ff2222',12);
  svg+=`<text x="16" y="14" fill="#888" font-size="6" font-weight="600" text-anchor="start" font-family="monospace">MIN</text>`;
  svg+=`<g transform="translate(10,17)">${mnLed.svg}</g>`;
  svg+=`<text x="${10+mnLed.width+2}" y="28" fill="#cc3333" font-size="4.5" text-anchor="start" font-family="monospace">${windUnit}</text>`;
  const mxLed=_led7(maxDisp,'#ff2222',12);
  svg+=`<text x="${200-16}" y="14" fill="#888" font-size="6" font-weight="600" text-anchor="end" font-family="monospace">MAX</text>`;
  svg+=`<g transform="translate(${200-10-mxLed.width},17)">${mxLed.svg}</g>`;
  svg+=`<text x="12" y="${cy}" fill="#555" font-size="7" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace" transform="rotate(-90,12,${cy})">PORT</text>`;
  svg+=`<text x="188" y="${cy}" fill="#555" font-size="7" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace" transform="rotate(90,188,${cy})">STBD</text>`;
  const pAng=(dirDeg-90)*Math.PI/180;
  svg+=`<polygon points="${(cx+Math.cos(pAng)*(ri-2)).toFixed(1)},${(cy+Math.sin(pAng)*(ri-2)).toFixed(1)} ${(cx+Math.cos(pAng-0.15)*18).toFixed(1)},${(cy+Math.sin(pAng-0.15)*18).toFixed(1)} ${(cx+Math.cos(pAng+0.15)*18).toFixed(1)},${(cy+Math.sin(pAng+0.15)*18).toFixed(1)}" fill="rgba(255,100,150,0.7)" stroke="#ff6699" stroke-width="0.5"/>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="4" fill="#222" stroke="#ff6699" stroke-width="1"/>`;
  return`<div class="wind-rose gauge-marine" data-gauge="marine" style="cursor:pointer;width:200px;height:200px;flex-shrink:0;position:relative">
    <svg viewBox="0 0 200 200" class="full-size">${svg}</svg>
  </div>`;
}
function renderGaugeMinimal(d){
  const{windSpd,wd,windDisp,gustDisp,windNum,windUnit,gustStr,bf,simActive}=d;
  const dirDeg=simActive?_windCurSim.dir:wd;
  const cx=50,cy=50,r=42;
  let svg='';
  svg+=`<circle cx="${cx}" cy="${cy}" r="${r+2}" fill="none" stroke="rgba(148,163,184,0.12)" stroke-width="0.8"/>`;
  const maxSpd=Math.max(10,Math.ceil(Math.max(windDisp,gustDisp)*1.3/5)*5);
  const sweepAngle=270,startAngle=135;
  const spdFrac=Math.min(1,windDisp/maxSpd);
  const gustFrac=Math.min(1,gustDisp/maxSpd);
  const endAngG=startAngle+gustFrac*sweepAngle;
  const endAngW=startAngle+spdFrac*sweepAngle;
  function arcPath(cx2,cy2,r2,a1,a2){
    const r1d=a1*Math.PI/180,r2d=a2*Math.PI/180;
    return`M${(cx2+Math.cos(r1d)*r2).toFixed(1)},${(cy2+Math.sin(r1d)*r2).toFixed(1)} A${r2},${r2} 0 ${a2-a1>180?1:0} 1 ${(cx2+Math.cos(r2d)*r2).toFixed(1)},${(cy2+Math.sin(r2d)*r2).toFixed(1)}`;
  }
  svg+=`<path d="${arcPath(cx,cy,r+2,startAngle,startAngle+sweepAngle)}" fill="none" stroke="rgba(148,163,184,0.08)" stroke-width="3" stroke-linecap="round"/>`;
  if(gustFrac>0.01)svg+=`<path d="${arcPath(cx,cy,r+2,startAngle,endAngG)}" fill="none" stroke="rgba(239,68,68,0.35)" stroke-width="3" stroke-linecap="round"/>`;
  if(spdFrac>0.01)svg+=`<path d="${arcPath(cx,cy,r+2,startAngle,endAngW)}" fill="none" stroke="rgba(148,163,184,0.6)" stroke-width="3" stroke-linecap="round"/>`;
  for(let s=0;s<=maxSpd;s+=maxSpd<=20?5:10){
    const frac=s/maxSpd;
    const a=(startAngle+frac*sweepAngle)*Math.PI/180;
    const x1=cx+Math.cos(a)*(r-2),y1=cy+Math.sin(a)*(r-2);
    const x2=cx+Math.cos(a)*(r+0.5),y2=cy+Math.sin(a)*(r+0.5);
    svg+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(148,163,184,0.25)" stroke-width="0.6"/>`;
    const tx=cx+Math.cos(a)*(r-5),ty=cy+Math.sin(a)*(r-5);
    svg+=`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="rgba(148,163,184,0.35)" font-size="3.5" text-anchor="middle" dominant-baseline="central">${s}</text>`;
  }
  const pAng=(dirDeg-90)*Math.PI/180;
  const pTip=r-8;
  svg+=`<line x1="${cx}" y1="${cy}" x2="${(cx+Math.cos(pAng)*pTip).toFixed(1)}" y2="${(cy+Math.sin(pAng)*pTip).toFixed(1)}" stroke="rgba(148,163,184,0.5)" stroke-width="1.5" stroke-linecap="round"/>`;
  svg+=`<circle cx="${(cx+Math.cos(pAng)*pTip).toFixed(1)}" cy="${(cy+Math.sin(pAng)*pTip).toFixed(1)}" r="1.5" fill="rgba(148,163,184,0.7)"/>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="2" fill="rgba(148,163,184,0.3)" stroke="rgba(148,163,184,0.4)" stroke-width="0.5"/>`;
  ['N','E','S','W'].forEach((l,i)=>{
    const a=(i*90-90)*Math.PI/180;
    const tx=cx+Math.cos(a)*(r-14),ty=cy+Math.sin(a)*(r-14);
    svg+=`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="rgba(148,163,184,0.3)" font-size="4" font-weight="600" text-anchor="middle" dominant-baseline="central">${l}</text>`;
  });
  const bfClr=_BFT_CLR[bf];
  const dirStr=degToDir(dirDeg)+' '+dirDeg.toFixed(0)+'°';
  return`<div class="wind-rose gauge-minimal" data-gauge="minimal" style="cursor:pointer;width:200px;height:200px;flex-shrink:0;position:relative">
    <svg viewBox="-8 -8 116 116" class="full-size">${svg}</svg>
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none">
      <div style="font-size:1.6em;font-weight:800;color:#e2e8f0;line-height:1"><span class="wrc-num">${windNum}</span>${_trendArrowHtml()}</div>
      <div style="font-size:0.55em;font-weight:600;color:#94a3b8;margin-top:1px" class="wrc-unit">${windUnit}</div>
      <div style="font-size:0.5em;color:#94a3b8;margin-top:2px" class="wrc-dir">${dirStr}</div>
      <div style="font-size:0.45em;color:#ef4444;margin-top:1px" class="wrc-gust">${gustStr||''}</div>
      <div style="display:inline-block;padding:1px 5px;border-radius:3px;background:${bfClr}22;border:1px solid ${bfClr}44;margin-top:2px">
        <span style="font-size:0.4em;font-weight:700;color:${bfClr}">F${bf}</span>
      </div>
    </div>
  </div>`;
}
function renderGaugeG1000(d){
  const{windSpd,wd,windDisp,gustDisp,windNum,windUnit,gustStr,bf,simActive,pressure}=d;
  const dirDeg=simActive?_windCurSim.dir:wd;
  const W=300,H=280,topBar=16,botBar=14;
  const tapeW=38,tapeTop=topBar+2,tapeBot=H-botBar-2,tapeH=tapeBot-tapeTop;
  const compassR=52,compassCx=W/2,compassCy=topBar+18+(tapeBot-topBar-36)/2;
  const green='#00ff00',cyan='#00ddff',magenta='#ff00ff',amber='#ffaa00',yellow='#ffff00';
  let svg='';
  svg+=`<rect x="0" y="0" width="${W}" height="${H}" rx="3" fill="#111318"/>`;
  svg+=`<rect x="0" y="0" width="${W}" height="${topBar}" rx="3" fill="#1a1a22"/>`;
  svg+=`<line x1="0" y1="${topBar}" x2="${W}" y2="${topBar}" stroke="#3a3e48" stroke-width="0.5"/>`;
  const storms=S.storms||[];
  const strongest=storms.length?storms.reduce((a,b)=>(b.dbz||0)>(a.dbz||0)?b:a,storms[0]):null;
  const mv=S.stormMovement;
  let topTxt='';
  if(strongest){
    topTxt+=`STM ${strongest.dbz||0}dBZ ${strongest.distance!=null?strongest.distance.toFixed(0):'--'}${S.radarMetric?'km':'mi'}`;
    if(mv&&mv.speed>=2)topTxt+=`  MVG ${degToDir(mv.direction)} (${Math.round(mv.direction)}°) ${mv.speed.toFixed(0)}${S.radarMetric?'km/h':'mph'}`;
  }else{topTxt='NO STORMS DETECTED'}
  svg+=`<text x="${W/2}" y="${topBar/2+1}" fill="${strongest?amber:'#5a6070'}" font-size="5" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="monospace">${topTxt}</text>`;
  svg+=`<rect x="0" y="${H-botBar}" width="${W}" height="${botBar}" rx="3" fill="#1a1a22"/>`;
  svg+=`<line x1="0" y1="${H-botBar}" x2="${W}" y2="${H-botBar}" stroke="#3a3e48" stroke-width="0.5"/>`;
  const tempC=S.weather?S.weather.temperature_2m:null;
  const oat=tempC!=null?`OAT ${S.tempUnit===0?cToF(tempC)+'°F':tempC.toFixed(1)+'°C'}`:'';
  svg+=`<text x="4" y="${H-botBar/2+1}" fill="${cyan}" font-size="4.5" font-weight="600" text-anchor="start" dominant-baseline="central" font-family="monospace">${oat}</text>`;
  const pMb=pressure||1013.25;
  const pDisp=S.presUnit===0?(pMb*0.02953).toFixed(2):pMb.toFixed(0);
  const pUnit=S.presUnit===0?'IN':'MB';
  svg+=`<text x="${W/2}" y="${H-botBar/2+1}" fill="${green}" font-size="4.5" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="monospace">BARO ${pDisp}${pUnit}</text>`;
  svg+=`<text x="${W-4}" y="${H-botBar/2+1}" fill="#8b95a5" font-size="4.5" font-weight="600" text-anchor="end" dominant-baseline="central" font-family="monospace">F${bf} ${_BFT_NAME[bf]}</text>`;
  svg+=`<rect x="1" y="${tapeTop}" width="${tapeW}" height="${tapeH}" fill="#0c0e14" stroke="#2a2e38" stroke-width="0.5"/>`;
  const maxTape=Math.max(20,Math.ceil(Math.max(windDisp,gustDisp)*1.5/10)*10);
  const tapeCenter=tapeTop+tapeH/2;
  const pxPerUnit=tapeH*0.8/maxTape;
  for(let s=0;s<=maxTape;s+=maxTape<=30?2:5){
    const yy=tapeCenter-(s-windDisp)*pxPerUnit;
    if(yy<tapeTop+4||yy>tapeBot-4)continue;
    const major=s%(maxTape<=30?10:20)===0;
    svg+=`<line x1="1" y1="${yy.toFixed(1)}" x2="${1+(major?10:5)}" y2="${yy.toFixed(1)}" stroke="${major?'#5a6070':'#2a2e38'}" stroke-width="${major?1:0.5}"/>`;
    if(major)svg+=`<text x="13" y="${yy.toFixed(1)}" fill="#e2e8f0" font-size="6.5" font-weight="600" text-anchor="start" dominant-baseline="central" font-family="monospace">${s}</text>`;
  }
  if(gustDisp>windDisp){
    const gustY=tapeCenter-(gustDisp-windDisp)*pxPerUnit;
    if(gustY>tapeTop+4&&gustY<tapeBot-4){
      svg+=`<line x1="1" y1="${gustY.toFixed(1)}" x2="${tapeW}" y2="${gustY.toFixed(1)}" stroke="red" stroke-width="1.8"/>`;
      svg+=`<text x="${tapeW+2}" y="${gustY.toFixed(1)}" fill="#ff3333" font-size="4.5" font-weight="700" text-anchor="start" dominant-baseline="central" font-family="monospace">G${parseFloat(kmhTo(d.gustRaw,S.windUnit)).toFixed(0)}</text>`;
    }
  }
  const avgKmh=(_windMinKmh<Infinity&&_windMaxKmh>0)?(_windMinKmh+_windMaxKmh)/2:0;
  if(avgKmh>0){
    const avgDisp=parseFloat(kmhTo(avgKmh,S.windUnit));
    const avgY=tapeCenter-(avgDisp-windDisp)*pxPerUnit;
    if(avgY>tapeTop+4&&avgY<tapeBot-4){
      svg+=`<polygon points="${tapeW},${(avgY-4).toFixed(1)} ${tapeW+8},${avgY.toFixed(1)} ${tapeW},${(avgY+4).toFixed(1)}" fill="${cyan}" stroke="${cyan}" stroke-width="0.5"/>`;
      svg+=`<text x="${tapeW+10}" y="${avgY.toFixed(1)}" fill="${cyan}" font-size="4" font-weight="600" text-anchor="start" dominant-baseline="central" font-family="monospace">A${avgDisp.toFixed(0)}</text>`;
    }
  }
  const maxKmhDisp=_windMaxKmh>0?parseFloat(kmhTo(_windMaxKmh,S.windUnit)):0;
  if(maxKmhDisp>0){
    const maxY=tapeCenter-(maxKmhDisp-windDisp)*pxPerUnit;
    if(maxY>tapeTop+4&&maxY<tapeBot-4){
      svg+=`<line x1="1" y1="${maxY.toFixed(1)}" x2="${tapeW}" y2="${maxY.toFixed(1)}" stroke="${amber}" stroke-width="1" stroke-dasharray="3,2"/>`;
    }
  }
  svg+=`<polygon points="${tapeW},${(tapeCenter-7).toFixed(1)} ${tapeW+13},${(tapeCenter-7).toFixed(1)} ${tapeW+17},${tapeCenter.toFixed(1)} ${tapeW+13},${(tapeCenter+7).toFixed(1)} ${tapeW},${(tapeCenter+7).toFixed(1)}" fill="#111" stroke="${green}" stroke-width="1"/>`;
  svg+=`<text x="${tapeW+8}" y="${tapeCenter.toFixed(1)}" fill="${green}" font-size="8" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace">${parseFloat(windNum).toFixed(0)}</text>`;
  const _gtClr=Math.abs(_windTrend)<0.05?'#5a6070':_windTrend>=0.05?'#22c55e':'#ff4444';
  const _gtSym=Math.abs(_windTrend)<0.05?'→':_windTrend>=0.05?'↑':'↓';
  svg+=`<text x="${tapeW+8}" y="${(tapeCenter-12).toFixed(1)}" fill="${_gtClr}" font-size="7" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace">${_gtSym}</text>`;
  svg+=`<text x="${tapeW/2+1}" y="${tapeTop+8}" fill="${cyan}" font-size="5" font-weight="600" text-anchor="middle" font-family="monospace">${windUnit.toUpperCase()}</text>`;
  svg+=`<rect x="${W-tapeW-1}" y="${tapeTop}" width="${tapeW}" height="${tapeH}" fill="#0c0e14" stroke="#2a2e38" stroke-width="0.5"/>`;
  const pMax=S.presUnit===0?31.5:1060;const pMin=S.presUnit===0?28.5:960;
  const pVal=S.presUnit===0?pMb*0.02953:pMb;
  const pRange=pMax-pMin;
  const pTapeCenter=tapeTop+tapeH/2;
  const ppxPerUnit=tapeH*0.8/pRange;
  for(let p=Math.floor(pMin*10)/10;p<=pMax;p+=S.presUnit===0?0.5:10){
    const yy=pTapeCenter-(p-pVal)*ppxPerUnit;
    if(yy<tapeTop+4||yy>tapeBot-4)continue;
    const major=S.presUnit===0?Math.abs(p*2-Math.round(p*2))<0.01&&Math.round(p)===p:(p%50===0);
    const x0=W-tapeW-1;
    svg+=`<line x1="${(x0+tapeW-1-(major?10:5)).toFixed(1)}" y1="${yy.toFixed(1)}" x2="${(x0+tapeW-1).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${major?'#5a6070':'#2a2e38'}" stroke-width="${major?1:0.5}"/>`;
    if(major)svg+=`<text x="${(x0+tapeW-13).toFixed(1)}" y="${yy.toFixed(1)}" fill="#e2e8f0" font-size="5.5" font-weight="600" text-anchor="end" dominant-baseline="central" font-family="monospace">${S.presUnit===0?p.toFixed(1):p}</text>`;
  }
  const pPtrR=W-tapeW-1,pPtrW=S.presUnit===0?36:26;
  svg+=`<polygon points="${pPtrR.toFixed(1)},${(pTapeCenter+7).toFixed(1)} ${(pPtrR-4).toFixed(1)},${(pTapeCenter+7).toFixed(1)} ${(pPtrR-4-pPtrW).toFixed(1)},${(pTapeCenter+7).toFixed(1)} ${(pPtrR-4-pPtrW-4).toFixed(1)},${pTapeCenter.toFixed(1)} ${(pPtrR-4-pPtrW).toFixed(1)},${(pTapeCenter-7).toFixed(1)} ${(pPtrR-4).toFixed(1)},${(pTapeCenter-7).toFixed(1)} ${pPtrR.toFixed(1)},${(pTapeCenter-7).toFixed(1)}" fill="#111" stroke="${green}" stroke-width="1"/>`;
  svg+=`<text x="${(pPtrR-4-pPtrW/2).toFixed(1)}" y="${pTapeCenter.toFixed(1)}" fill="${green}" font-size="${S.presUnit===0?'6':'7'}" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace">${pDisp}</text>`;
  svg+=`<text x="${W-tapeW/2-1}" y="${tapeTop+8}" fill="${cyan}" font-size="5" font-weight="600" text-anchor="middle" font-family="monospace">${pUnit}</text>`;
  const hasStorm=!!(strongest&&strongest.distance<80);
  const rotOff=(_gyroEnabled&&_gyroHeading!=null)?_gyroHeading:0;
  svg+=`<circle cx="${compassCx}" cy="${compassCy}" r="${compassR}" fill="none" stroke="${green}" stroke-width="1"/>`;
  for(let dd=0;dd<360;dd+=10){
    const a=((dd-rotOff)-90)*Math.PI/180;
    const major=dd%30===0;
    const r1=compassR-1,r2=compassR-(major?8:3);
    svg+=`<line x1="${(compassCx+Math.cos(a)*r1).toFixed(1)}" y1="${(compassCy+Math.sin(a)*r1).toFixed(1)}" x2="${(compassCx+Math.cos(a)*r2).toFixed(1)}" y2="${(compassCy+Math.sin(a)*r2).toFixed(1)}" stroke="${major?'#e2e8f0':'#3a3e48'}" stroke-width="${major?1.2:0.5}"/>`;
    if(dd%30===0){
      const lbl=dd===0?'N':dd===90?'E':dd===180?'S':dd===270?'W':String(dd/10);
      const tx=compassCx+Math.cos(a)*(compassR-14),ty=compassCy+Math.sin(a)*(compassR-14);
      svg+=`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="${dd%90===0?'#ffffff':'#e2e8f0'}" font-size="${dd%90===0?'7':'5.5'}" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace">${lbl}</text>`;
    }
  }
  const drawArrow=(deg,color,label,dashed,len)=>{
    const ang=((deg-rotOff)-90)*Math.PI/180;
    const aLen=len||compassR-18;
    if(dashed){
      svg+=`<line x1="${(compassCx+Math.cos(ang+Math.PI)*6).toFixed(1)}" y1="${(compassCy+Math.sin(ang+Math.PI)*6).toFixed(1)}" x2="${(compassCx+Math.cos(ang)*aLen).toFixed(1)}" y2="${(compassCy+Math.sin(ang)*aLen).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,3"/>`;
    }else{
      svg+=`<line x1="${(compassCx+Math.cos(ang+Math.PI)*6).toFixed(1)}" y1="${(compassCy+Math.sin(ang+Math.PI)*6).toFixed(1)}" x2="${(compassCx+Math.cos(ang)*aLen).toFixed(1)}" y2="${(compassCy+Math.sin(ang)*aLen).toFixed(1)}" stroke="${color}" stroke-width="1.8"/>`;
    }
    svg+=`<polygon points="${(compassCx+Math.cos(ang)*aLen).toFixed(1)},${(compassCy+Math.sin(ang)*aLen).toFixed(1)} ${(compassCx+Math.cos(ang-0.2)*(aLen-7)).toFixed(1)},${(compassCy+Math.sin(ang-0.2)*(aLen-7)).toFixed(1)} ${(compassCx+Math.cos(ang+0.2)*(aLen-7)).toFixed(1)},${(compassCy+Math.sin(ang+0.2)*(aLen-7)).toFixed(1)}" fill="${color}" opacity="0.85"/>`;
    const lx=compassCx+Math.cos(ang)*(aLen+8),ly=compassCy+Math.sin(ang)*(aLen+8);
    if(lx>compassCx-compassR+10&&lx<compassCx+compassR-10&&ly>compassCy-compassR+5&&ly<compassCy+compassR-5){
      svg+=`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${color}" font-size="3.5" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace">${label}</text>`;
    }
  };
  drawArrow(dirDeg,magenta,'WIND',false,compassR-18);
  const upperDir=S._upperWindDir!=null?S._upperWindDir:null;
  if(upperDir!=null)drawArrow((upperDir+180)%360,yellow,'ALOFT',true,compassR-20);
  let stmEta=null,stmImpact=0,stmClosing=0;
  if(hasStorm){
    stmEta=calcStormETA(strongest);
    stmImpact=stmEta?stmEta.impact:0;
    stmClosing=stmEta?stmEta.closingSpeed:0;
    drawArrow(strongest.bearing,cyan,'STORM',false,compassR-16);
  }
  svg+=`<circle cx="${compassCx}" cy="${compassCy}" r="3.5" fill="#222" stroke="${green}" stroke-width="1"/>`;
  svg+=`<circle cx="${compassCx}" cy="${compassCy}" r="1.2" fill="${green}"/>`;
  const infoTop=compassCy-compassR-16;
  const infoBot=compassCy+compassR+4;
  const gyroLabel=(_gyroEnabled&&_gyroHeading!=null)?`GYRO ${Math.round(_gyroHeading)}°`:'N UP';
  svg+=`<rect x="${compassCx-22}" y="${infoTop}" width="44" height="12" rx="2" fill="#111" stroke="${green}" stroke-width="0.8"/>`;
  svg+=`<text x="${compassCx}" y="${infoTop+6}" fill="${green}" font-size="5.5" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace">${gyroLabel}</text>`;
  const legItems=[[magenta,`WIND ${dirDeg.toFixed(0)}°`,false]];
  if(upperDir!=null)legItems.push([yellow,`ALOFT ${Math.round((upperDir+180)%360)}°`,true]);
  if(hasStorm)legItems.push([cyan,`STM ${Math.round(strongest.bearing)}°`,false]);
  const legX0=tapeW+3;
  const legY0=tapeTop+4;
  legItems.forEach((it,i)=>{
    const ly=legY0+i*9;
    if(it[2]){svg+=`<line x1="${legX0}" y1="${(ly+4).toFixed(1)}" x2="${(legX0+10).toFixed(1)}" y2="${(ly+4).toFixed(1)}" stroke="${it[0]}" stroke-width="1.2" stroke-dasharray="3,2"/>`}
    else{svg+=`<line x1="${legX0}" y1="${(ly+4).toFixed(1)}" x2="${(legX0+10).toFixed(1)}" y2="${(ly+4).toFixed(1)}" stroke="${it[0]}" stroke-width="1.5"/>`}
    svg+=`<text x="${(legX0+13).toFixed(1)}" y="${(ly+4).toFixed(1)}" fill="${it[0]}" font-size="4" font-weight="600" text-anchor="start" dominant-baseline="central" font-family="monospace">${it[1]}</text>`;
  });
  if(hasStorm){
    const distStr=strongest.distance<10?strongest.distance.toFixed(1):strongest.distance.toFixed(0);
    const distUnit=S.radarMetric?'km':'mi';
    svg+=`<rect x="${compassCx-28}" y="${infoBot}" width="56" height="12" rx="2" fill="#111" stroke="#3a3e48" stroke-width="0.6"/>`;
    svg+=`<text x="${compassCx}" y="${infoBot+6}" fill="#e2e8f0" font-size="5" font-weight="600" text-anchor="middle" dominant-baseline="central" font-family="monospace">${distStr}${distUnit} ${strongest.dbz||0}dBZ</text>`;
    const impColor=stmImpact>=80?'#ef4444':stmImpact>=50?amber:stmImpact>=20?'#eab308':green;
    svg+=`<text x="${compassCx}" y="${infoBot+18}" fill="${impColor}" font-size="5" font-weight="700" text-anchor="middle" font-family="monospace">${stmImpact}% IMPACT</text>`;
    if(stmEta&&stmEta.eta!=null){
      const _stmAdj=Math.max(0,stmEta.eta-radarAgeMin());
      const etaStr=_stmAdj<60?_stmAdj.toFixed(0)+'m':(_stmAdj/60).toFixed(1)+'h';
      svg+=`<text x="${compassCx}" y="${infoBot+26}" fill="${amber}" font-size="4.5" font-weight="600" text-anchor="middle" font-family="monospace">ETA ${etaStr} · ${stmClosing.toFixed(0)}mph closing</text>`;
    }
  }else{
    svg+=`<text x="${compassCx}" y="${infoBot+6}" fill="#5a6070" font-size="5" text-anchor="middle" font-family="monospace">NORTH UP · NO STORMS</text>`;
  }
  return`<div class="wind-rose gauge-g1000" data-gauge="g1000" style="cursor:pointer;width:300px;height:280px;flex-shrink:0;position:relative">
    <svg viewBox="0 0 ${W} ${H}" class="full-size">${svg}</svg>
  </div>`;
}
function renderGaugeSpeedo(d){
  const{windSpd,wd,windDisp,gustDisp,windNum,windUnit,gustStr,bf,simActive}=d;
  const dirDeg=simActive?_windCurSim.dir:wd;
  const cx=100,cy=95,r=80;
  const startAng=220,endAng=-40,sweep=startAng-endAng;
  const maxSpd=Math.max(10,Math.ceil(Math.max(windDisp,gustDisp)*1.3/5)*5);
  let svg='';
  svg+=`<defs>
    <radialGradient id="speedo-bg" cx="50%" cy="45%"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="100%" stop-color="#0a0a15"/></radialGradient>
    <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#888"/><stop offset="50%" stop-color="#444"/><stop offset="100%" stop-color="#666"/></linearGradient>
  </defs>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="${r+10}" fill="url(#chrome)" stroke="#222" stroke-width="1"/>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="${r+7}" fill="url(#speedo-bg)"/>`;
  svg+=`<path d="${arcPathFull(cx,cy,r+3,endAng,startAng)}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>`;
  if(gustDisp>windDisp){
    const windFrac=Math.min(1,windDisp/maxSpd);
    const gustFrac=Math.min(1,gustDisp/maxSpd);
    const windAngDeg=startAng-windFrac*sweep;
    const gustAngDeg=Math.max(endAng,startAng-gustFrac*sweep);
    const rr=r+3;
    const wa=windAngDeg*Math.PI/180,ga=gustAngDeg*Math.PI/180;
    const wx=cx+Math.cos(wa)*rr,wy=cy-Math.sin(wa)*rr;
    const gx=cx+Math.cos(ga)*rr,gy=cy-Math.sin(ga)*rr;
    const angSpan=windAngDeg-gustAngDeg;
    svg+=`<path d="M${wx.toFixed(1)},${wy.toFixed(1)} A${rr},${rr} 0 ${angSpan>180?1:0} 1 ${gx.toFixed(1)},${gy.toFixed(1)}" fill="none" stroke="rgba(255,50,50,0.25)" stroke-width="8"/>`;
  }
  const step=maxSpd<=15?1:maxSpd<=30?2:maxSpd<=60?5:10;
  for(let s=0;s<=maxSpd;s+=step){
    const frac=s/maxSpd;
    const ang=(startAng-frac*sweep)*Math.PI/180;
    const major=s%(step*5===0?step*5:step<=2?10:step<=5?10:step<=10?20:50)===0||s===0;
    const x1=cx+Math.cos(ang)*(r-2),y1=cy-Math.sin(ang)*(r-2);
    const x2=cx+Math.cos(ang)*(r-(major?12:6)),y2=cy-Math.sin(ang)*(r-(major?12:6));
    svg+=`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${major?'#ddd':'#666'}" stroke-width="${major?1.5:0.8}"/>`;
    if(major){
      const tx=cx+Math.cos(ang)*(r-18),ty=cy-Math.sin(ang)*(r-18);
      svg+=`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" fill="#ccc" font-size="7" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${s}</text>`;
    }
  }
  const needleFrac=Math.min(1,windDisp/maxSpd);
  const needleAng=(startAng-needleFrac*sweep)*Math.PI/180;
  const nx=cx+Math.cos(needleAng)*(r-6),ny=cy-Math.sin(needleAng)*(r-6);
  const nLx=cx+Math.cos(needleAng+0.08)*12,nLy=cy-Math.sin(needleAng+0.08)*12;
  const nRx=cx+Math.cos(needleAng-0.08)*12,nRy=cy-Math.sin(needleAng-0.08)*12;
  const nBx=cx+Math.cos(needleAng+Math.PI)*8,nBy=cy-Math.sin(needleAng+Math.PI)*8;
  svg+=`<polygon points="${nx.toFixed(1)},${ny.toFixed(1)} ${nLx.toFixed(1)},${nLy.toFixed(1)} ${nBx.toFixed(1)},${nBy.toFixed(1)} ${nRx.toFixed(1)},${nRy.toFixed(1)}" fill="rgba(255,40,40,0.9)" stroke="#ff2222" stroke-width="0.5"/>`;
  svg+=`<circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="1.5" fill="#ff6666"/>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="5" fill="#333" stroke="#888" stroke-width="1"/>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="2.5" fill="#ff3333"/>`;
  const _stClr=Math.abs(_windTrend)<0.05?'#888':_windTrend>=0.05?'#22c55e':'#ff4444';
  const _stSym=Math.abs(_windTrend)<0.05?'→':_windTrend>=0.05?'↑':'↓';
  svg+=`<text x="${cx}" y="${cy-22}" fill="#00ddff" font-size="6" font-weight="600" text-anchor="middle" font-family="sans-serif">${windUnit.toUpperCase()}</text>`;
  svg+=`<text x="${cx+20}" y="${cy-22}" fill="${_stClr}" font-size="7" font-weight="700" text-anchor="start" font-family="sans-serif">${_stSym}</text>`;
  svg+=`<rect x="${cx-30}" y="${cy+12}" width="60" height="16" rx="3" fill="#0a0a15" stroke="#444" stroke-width="0.8"/>`;
  svg+=`<text x="${cx}" y="${cy+21}" fill="#00ff00" font-size="7.5" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace" class="wrc-dir">${degToDir(dirDeg)} ${dirDeg.toFixed(0)}°</text>`;
  const bfClr=_BFT_CLR[bf];
  svg+=`<rect x="${cx-14}" y="${cy+32}" width="28" height="10" rx="2" fill="#111" stroke="${bfClr}66" stroke-width="0.5"/>`;
  svg+=`<text x="${cx}" y="${cy+37}" fill="${bfClr}" font-size="5" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="monospace">F${bf}</text>`;
  if(gustDisp>windDisp){
    svg+=`<text x="${cx+38}" y="${cy+37}" fill="#ff4444" font-size="4.5" font-weight="600" text-anchor="start" font-family="monospace">G${parseFloat(kmhTo(d.gustRaw,S.windUnit)).toFixed(0)}</text>`;
  }
  return`<div class="wind-rose gauge-speedo" data-gauge="speedo" style="cursor:pointer;width:200px;height:200px;flex-shrink:0;position:relative">
    <svg viewBox="0 0 200 200" class="full-size">${svg}</svg>
  </div>`;
}
function arcPathFull(cx,cy,r,a1Deg,a2Deg){
  const a1=a2Deg*Math.PI/180,a2=a1Deg*Math.PI/180;
  const x1=cx+Math.cos(a1)*r,y1=cy-Math.sin(a1)*r;
  const x2=cx+Math.cos(a2)*r,y2=cy-Math.sin(a2)*r;
  const sweep=a2Deg-a1Deg;
  const large=Math.abs(sweep)>180?1:0;
  return`M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 0 ${x2.toFixed(1)},${y2.toFixed(1)}`;
}
function renderWindGauge(d){
  const style=getGaugeStyle();
  if(style==='marine')return renderGaugeMarine(d);
  if(style==='minimal')return renderGaugeMinimal(d);
  if(style==='g1000')return renderGaugeG1000(d);
  if(style==='speedo')return renderGaugeSpeedo(d);
  return renderGaugeNeon(d);
}
function syncGaugeStyleBtns(){
  const cur=getGaugeStyle();
  document.querySelectorAll('.gauge-style-btn').forEach(b=>{
    const s=b.dataset.style;
    const active=s===cur;
    b.style.background=active?'rgba(0,229,255,0.15)':'rgba(255,255,255,0.04)';
    b.style.borderColor=active?'var(--accent-cyan)':'var(--border-subtle)';
    b.style.color=active?'var(--accent-cyan)':'var(--text-muted)';
  });
}

function toggleGyroCompass(){
  if(_gyroEnabled){disableGyro();syncGyroBtn();reRenderActive();return}
  initGyroCompass();
  setTimeout(()=>{syncGyroBtn();reRenderActive()},300);
}
function syncGyroBtn(){
  const btn=document.getElementById('gyro-toggle-btn');
  if(!btn)return;
  if(_gyroEnabled){btn.textContent='✅ Gyro Compass ON';btn.style.background='rgba(0,229,255,0.15)';btn.style.borderColor='var(--accent-cyan)';btn.style.color='var(--accent-cyan)'}
  else{btn.textContent='🔄 Enable Gyro Compass';btn.style.background='rgba(255,255,255,0.04)';btn.style.borderColor='var(--border-subtle)';btn.style.color='var(--text-muted)'}
}


let _gaugeCurrentMax=10;
let _gaugeTargetMax=10;
let _gaugeLastGustFlash=0;
let _gaugePrevGust=0;
let _gaugeAvgSamples=[];
let _gaugeAvg=0;
let _gaugePrevAvg=0;
let _gaugeAvgHistory=[];
function updateGaugeSegments(windVal,gustVal){
  const g=document.getElementById('gauge-seg-group');
  if(!g)return;
  const now=Date.now();
  _gaugeAvgSamples.push({t:now,v:windVal});
  while(_gaugeAvgSamples.length&&now-_gaugeAvgSamples[0].t>_getAvgWindow())_gaugeAvgSamples.shift();
  if(_gaugeAvgSamples.length>0){
    _gaugePrevAvg=_gaugeAvg;
    _gaugeAvg=_gaugeAvgSamples.reduce((s,p)=>s+p.v,0)/_gaugeAvgSamples.length;
  }
  if(now-(_gaugeAvgHistory.length?_gaugeAvgHistory[_gaugeAvgHistory.length-1].t:0)>=200){
    _gaugeAvgHistory.push({t:now,v:_gaugeAvg});
    while(_gaugeAvgHistory.length>10)_gaugeAvgHistory.shift();
  }
  const peak=Math.max(_gaugeAvg,gustVal,1);
  const newMax=Math.max(5,Math.ceil(peak*2/5)*5);
  if(newMax!==_gaugeTargetMax)_gaugeTargetMax=newMax;
  const maxDelta=_gaugeTargetMax-_gaugeCurrentMax;
  if(Math.abs(maxDelta)>0.5){
    const rate=maxDelta>0?0.15:0.04;
    _gaugeCurrentMax+=(maxDelta*rate);
  }else _gaugeCurrentMax=_gaugeTargetMax;
  const maxSpd=Math.max(5,Math.round(_gaugeCurrentMax));
  S._gaugeMaxSpd=maxSpd;
  const isGustSpike=gustVal>_gaugePrevGust*1.15&&gustVal>windVal*1.2;
  if(isGustSpike)_gaugeLastGustFlash=now;
  _gaugePrevGust=gustVal;
  const flashActive=now-_gaugeLastGustFlash<800;
  const breathPhase=Math.sin(now*0.003)*0.08;
  const segs=g.querySelectorAll('.gauge-seg');
  const spu=S._gaugeSegsPerUnit||1;
  const avgDisp=_gaugeAvg;
  segs.forEach((s,i)=>{
    const segVal=(i/spu)*(maxSpd/(S._gaugeMaxSegs/spu||maxSpd));
    const nextSegVal=((i+1)/spu)*(maxSpd/(S._gaugeMaxSegs/spu||maxSpd));
    if(avgDisp>=segVal&&avgDisp<nextSegVal){
      s.setAttribute('fill','rgba(255,0,255,0.9)');
    }else if(segVal<windVal){
      const alpha=0.8+breathPhase;
      s.setAttribute('fill',`rgba(0,255,0,${Math.min(0.95,Math.max(0.6,alpha)).toFixed(2)})`);
    }else if(segVal<gustVal){
      const gAlpha=flashActive?1.0:0.7;
      s.setAttribute('fill',`rgba(255,0,0,${gAlpha})`);
    }else{
      s.setAttribute('fill','rgba(0,220,255,0.08)');
    }
  });
  const tickG=document.getElementById('gauge-tick-group');
  if(tickG){
    const spdStep=maxSpd<=10?2:maxSpd<=20?5:maxSpd<=50?5:maxSpd<=100?10:maxSpd<=150?25:50;
    let tickHtml='';
    for(let spd=0;spd<maxSpd;spd+=spdStep){
      const frac=spd/maxSpd;
      const deg=(-90+frac*360)*Math.PI/180;
      const lx=50+Math.cos(deg)*58.5,ly=50+Math.sin(deg)*58.5;
      tickHtml+=`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="rgba(0,220,255,0.5)" font-size="3.2" font-weight="700" text-anchor="middle" dominant-baseline="central">${spd}</text>`;
    }
    tickG.innerHTML=tickHtml;
  }
  const avgEl=document.querySelector('.wrc-avg');
  if(avgEl)avgEl.textContent='A'+avgDisp.toFixed(1)+' '+WIND_UNITS[S.windUnit]+' ('+_fmtWindowLabel(_getAvgWindow())+')';
  const trendEl=document.querySelector('.wrc-trend');
  if(trendEl)trendEl.innerHTML=_trendArrowHtml();
}
function windSweepAnim(){
  if(_windSweepRaf){cancelAnimationFrame(_windSweepRaf);_windSweepRaf=null}
  _windSweepPaused=true;
  const targetSpd=_windCurSim.spd;
  const targetGust=_windCurSim.gust;
  const numEl=document.querySelector('.wrc-num');
  const gustEl=document.querySelector('.wrc-gust');
  if(numEl)numEl.textContent=kmhTo(targetSpd,S.windUnit);
  if(gustEl)gustEl.textContent=targetGust>0?'G'+fmtWind(targetGust)+' ('+_fmtWindowLabel(_getGustWindow())+')':'';
  updateGaugeSegments(parseFloat(kmhTo(targetSpd,S.windUnit)),parseFloat(kmhTo(targetGust,S.windUnit)));
  _windSweepRaf=null;
  _windSweepPaused=false;
}