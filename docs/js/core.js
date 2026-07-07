const S = {
  lat:null, lon:null, locName:'',
  tempUnit:0, windUnit:0, presUnit:0, visUnit:0, precipUnit:0,
  weather:null, forecast:null,
  storms:[], stormMarkers:[],
  alerts:[], station:null, stationId:null,
  map:null, radarLayer:null, radarFrames:[], radarIdx:0,
  radarPlaying:false, radarTimer:null, scanRadius:80, radarSource:'nexrad', nexradLayer:null, radarMetric:false,
  activePage:'weather', nearbyStations:[], stormMovement:null, scanTime:null, etaTimer:null, autoScanTimer:null, lastScanMs:0, _lastScanWasHiRes:false, _stormETAs:{}, _etaRescanInProgress:false, _radarAgeMs:null,
  travelMode:false, travelWatchId:null, travelLastUpdate:0, travelMarker:null,
  showClutter:false,
};
const TEMP_UNITS = ['°F','°C'];
const WIND_UNITS = ['mph','kts','km/h','m/s'];
const PRES_UNITS = ['inHg','mb','mmHg','kPa'];
const VIS_UNITS = ['mi','km'];
const PRECIP_UNITS = ['in','mm','cm'];
// v4.72: radar latency. Radar imagery (RainViewer/NEXRAD) is several minutes old
// by the time it reaches the app, but storm positions are frozen at that
// observation moment — so every ETA/arrival computed from "now" reads a few
// minutes late. RADAR_LATENCY_MS is the default assumed age (5 min); when a
// RainViewer past-frame timestamp is available we use the real measured age.
// computeRadarAgeMs() is called at scan time to store the canonical age in
// S._radarAgeMs; radarAgeMin() is the single value every consumer subtracts.
const RADAR_LATENCY_MS=5*60000;
function radarAgeMs(){
  let ms=(typeof S!=='undefined'&&S._radarAgeMs!=null)?S._radarAgeMs:RADAR_LATENCY_MS;
  if(!(ms>=0))ms=RADAR_LATENCY_MS;
  if(ms>30*60000)ms=30*60000;
  return ms;
}
function radarAgeMin(){return radarAgeMs()/60000;}
function computeRadarAgeMs(useNexrad){
  // Prefer the real age of the latest RainViewer PAST (observed) frame — nowcast
  // frames are forecasts (future) so they're filtered out. NEXRAD exposes no
  // timestamp here, so it falls back to the 5-min default. Clamped 0–30 min so a
  // bad timestamp can never produce an absurd shift.
  try{
    if(!useNexrad&&S.radarFrames&&S.radarFrames.length){
      const past=S.radarFrames.filter(f=>f&&f.time&&(!f.path||!f.path.includes('/nowcast/')));
      if(past.length){
        const latest=past[past.length-1];
        const a=Date.now()-latest.time*1000;
        if(a>=0&&a<=30*60000)return a;
      }
    }
  }catch(e){}
  return RADAR_LATENCY_MS;
}
let _timeFormat=localStorage.getItem('st_timeFormat')||'auto';
function _detectSystem24h(){
  try{
    const d=new Date(2020,0,1,13,0,0);
    const parts=new Intl.DateTimeFormat(undefined,{hour:'numeric'}).formatToParts(d);
    const hasDayPeriod=parts.some(p=>p.type==='dayPeriod');
    if(!hasDayPeriod)return true;
    const hourPart=parts.find(p=>p.type==='hour');
    if(hourPart&&parseInt(hourPart.value,10)>=13)return true;
    return false;
  }catch(e){
    try{
      const f=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'numeric'}).format(d);
      if(f.includes('13'))return true;
      const lo=f.toLowerCase();
      if(lo.includes('am')||lo.includes('pm'))return false;
      return true;
    }catch(e2){return false}
  }
}
function _is24h(){
  if(_timeFormat==='24h')return true;
  if(_timeFormat==='12h')return false;
  return _detectSystem24h();
}
function _pad2(n){return n<10?'0'+n:''+n}
function fmtClock(d,showSec){
  if(!(d instanceof Date)||isNaN(d))d=new Date(d);
  if(isNaN(d))return'--:--';
  const h=d.getHours(),m=d.getMinutes(),s=d.getSeconds();
  if(_is24h()){
    return _pad2(h)+':'+_pad2(m)+(showSec?':'+_pad2(s):'');
  }
  const hr12=h%12||12,ap=h>=12?'PM':'AM';
  return hr12+':'+_pad2(m)+(showSec?':'+_pad2(s):'')+' '+ap;
}
function fmtClockShort(d){
  if(!(d instanceof Date)||isNaN(d))d=new Date(d);
  if(isNaN(d))return'--:--';
  const h=d.getHours(),m=d.getMinutes();
  if(_is24h())return h+':'+_pad2(m);
  const hr12=h%12||12,ap=h>=12?'PM':'AM';
  return hr12+':'+_pad2(m)+' '+ap;
}
function reformatNwsTimes(text){
  if(!text)return text;
  function _fmt(h,mi,ap,tz){
    let h24=parseInt(h,10);const m=parseInt(mi,10);
    if(ap.toUpperCase()==='PM'&&h24<12)h24+=12;
    if(ap.toUpperCase()==='AM'&&h24===12)h24=0;
    if(_is24h())return _pad2(h24)+':'+_pad2(m)+' '+tz.toUpperCase();
    const hr12=h24%12||12;return hr12+':'+_pad2(m)+' '+(h24>=12?'PM':'AM')+' '+tz.toUpperCase();
  }
  text=text.replace(/(\d{1,2}):(\d{2})\s*(AM|PM)\s+(EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|AST)/gi,(m,hh,mm,ap,tz)=>_fmt(hh,mm,ap,tz));
  text=text.replace(/(\d{1,2})(\d{2})\s*(AM|PM)\s+(EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|AST)/gi,(m,hh,mm,ap,tz)=>_fmt(hh,mm,ap,tz));
  text=text.replace(/(?<![:\d])(\d{1,2})\s+(AM|PM)\s+(EST|EDT|CST|CDT|MST|MDT|PST|PDT|AKST|AKDT|HST|AST)/gi,(m,hh,ap,tz)=>_fmt(hh,'0',ap,tz));
  return text;
}
function fmtHrLabel(d){
  if(!(d instanceof Date)||isNaN(d))d=new Date(d);
  if(isNaN(d))return'--';
  if(_is24h()){return _pad2(d.getHours())+':00'}
  const hr=d.getHours(),ap=hr>=12?'p':'a';return(hr%12||12)+ap;
}
function setTimeFormat(fmt){
  _timeFormat=fmt;localStorage.setItem('st_timeFormat',fmt);
  syncTimeFmtBtns();reRenderActive();
}
function syncTimeFmtBtns(){
  document.querySelectorAll('.tf-btn').forEach(b=>{
    const active=b.dataset.tf===_timeFormat;
    b.style.background=active?'rgba(0,229,255,0.15)':'rgba(255,255,255,0.04)';
    b.style.borderColor=active?'var(--accent-cyan)':'var(--border-subtle)';
    b.style.color=active?'var(--accent-cyan)':'var(--text-muted)';
  });
}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function toast(msg,dur){
  if(S.travelMode&&!msg.startsWith('🧭')&&!msg.startsWith('📍')&&!msg.startsWith('Travel')){
    const bar=document.getElementById('travel-toast-bar');
    if(bar){bar.textContent=msg;bar.style.opacity='1';clearTimeout(S._travelToastFade);S._travelToastFade=setTimeout(()=>{bar.style.opacity='0'},dur||3000);}
    return;
  }
  const c=document.getElementById('toast-container');const el=document.createElement('div');el.className='toast';el.textContent=msg;c.appendChild(el);setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),250)},dur||3000);
}
function showSkel(el,n){el.innerHTML=Array.from({length:n},()=>`<div class="skeleton skel-line" style="width:${60+Math.random()*40}%"></div>`).join('')}
function degToDir(d){const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];return dirs[Math.round(d/22.5)%16]}

function cToF(c){return(c*9/5+32).toFixed(1)}
function calcFeelsLike(tc,wKmh,rh){
  const tf=tc*9/5+32;const wMph=(wKmh||0)*0.621371;
  if(tf<=50&&wMph>3){const wc=35.74+0.6215*tf-35.75*Math.pow(wMph,0.16)+0.4275*tf*Math.pow(wMph,0.16);return(wc-32)*5/9}
  if(tf>=80&&rh!=null){const hi=-42.379+2.04901523*tf+10.14333127*rh-0.22475541*tf*rh-0.00683783*tf*tf-0.05481717*rh*rh+0.00122874*tf*tf*rh+0.00085282*tf*rh*rh-0.00000199*tf*tf*rh*rh;return(hi-32)*5/9}
  return tc;
}
function fmtTemp(c){return S.tempUnit===0?(cToF(c)+' °F'):(c.toFixed(1)+' °C')}
function fmtTempShort(c){return S.tempUnit===0?(cToF(c)+'°'):(c.toFixed(1)+'°')}
function fmtTempDiff(c){return S.tempUnit===0?((c*9/5).toFixed(1)+' °F'):(c.toFixed(1)+' °C')}
function fmtAlt(ft){return S.tempUnit===0?(Math.round(ft).toLocaleString()+' ft'):(Math.round(ft*0.3048).toLocaleString()+' m')}
function fmtAltVal(ft){return S.tempUnit===0?Math.round(ft):Math.round(ft*0.3048)}
function fmtAltUnit(){return S.tempUnit===0?'ft':'m'}

function calcCloudBase(spreadC){return spreadC*400}
function getObserverElevM(){
  if(S._gpsAltitude!=null)return S._gpsAltitude;
  if(S._terrainData&&S._terrainData.userElev!=null)return S._terrainData.userElev;
  if(S.station&&S.station.elev!=null)return S.station.elev;
  return 0;
}
function getMetarCeilingFt(s){
  if(!s||!s.clouds||!s.clouds.length)return null;
  let lowest=null;
  for(const c of s.clouds){
    const amt=(c.amount||c.cover||'').toUpperCase();
    if(amt!=='BKN'&&amt!=='OVC'&&amt!=='VV')continue;
    let baseFt=null;
    if(c.base!=null&&typeof c.base==='object'&&c.base.value!=null)baseFt=Math.round(c.base.value*3.281);
    else if(typeof c.base==='number')baseFt=Math.round(c.base*3.281);
    if(baseFt!=null&&(lowest===null||baseFt<lowest))lowest=baseFt;
  }
  return lowest;
}
function adjustCloudBaseForUser(baseFtAglStation){
  const stationElevM=S.station&&S.station.elev!=null?S.station.elev:null;
  const userElevM=getObserverElevM();
  if(stationElevM==null)return baseFtAglStation;
  const diffFt=(stationElevM-userElevM)*3.281;
  return baseFtAglStation+diffFt;
}
function calcPressureAlt(elevFt,altInHg){return(29.92-altInHg)*1000+elevFt}
function calcDensityAlt(elevFt,altInHg,tempC){
  const pa=calcPressureAlt(elevFt,altInHg);
  const isaTemp=15-((pa/1000)*1.98);
  const dev=tempC-isaTemp;
  return pa+(120*dev);
}
function getSpreadLabel(spreadC){
  if(spreadC<=2)return'Fog/mist likely';
  if(spreadC<=4)return'High humidity, fog possible';
  if(spreadC<=8)return'Moderate humidity';
  return'Dry air, low fog risk';
}
function getFogRisk(spreadC,windKt,isDaytime,cloudPct){
  if(spreadC>8)return{level:'Unlikely',color:'var(--accent-green)',desc:'Spread too large for fog formation'};
  let score=0;
  let fogType='';
  if(spreadC<=2){score+=4;fogType='saturation'}
  else if(spreadC<=4){score+=2;fogType='high moisture'}
  if(!isDaytime){score+=2;if(cloudPct!=null&&cloudPct<30){score+=1;fogType=fogType?fogType+'/radiation':'radiation'}}
  if(windKt!=null){
    if(windKt<5){score+=1;if(!isDaytime&&cloudPct!=null&&cloudPct<30)fogType='radiation'}
    else if(windKt<=15){score+=1;fogType=fogType?fogType+'/advection':'advection'}
    else{score-=2;fogType=''}
  }
  if(score>=5)return{level:'High',color:'var(--accent-red)',desc:fogType?`${fogType.charAt(0).toUpperCase()+fogType.slice(1)} fog likely`:'Fog likely'};
  if(score>=3)return{level:'Moderate',color:'var(--accent-orange)',desc:fogType?`${fogType.charAt(0).toUpperCase()+fogType.slice(1)} fog possible`:'Fog possible'};
  if(score>=1)return{level:'Low',color:'var(--accent-yellow)',desc:'Low fog risk'};
  return{level:'Unlikely',color:'var(--accent-green)',desc:'Fog unlikely'};
}
function getStabilityLabel(spreadC,humidity,tempC){
  let score=0;
  if(tempC>25)score+=2;else if(tempC>15)score+=1;
  if(humidity>70)score+=2;else if(humidity>50)score+=1;
  if(spreadC<=4)score+=2;else if(spreadC<=8)score+=1;
  if(score>=5)return{label:'Unstable',color:'var(--accent-red)',desc:'Warm, moist air — convection likely'};
  if(score>=3)return{label:'Cond. Unstable',color:'var(--accent-orange)',desc:'Conditionally unstable — storms possible with lifting'};
  return{label:'Stable',color:'var(--accent-green)',desc:'Cool/dry air — convection unlikely'};
}
function detectInversion(spreadC,windKt,isDaytime,cloudPct){
  if(spreadC<=2&&(windKt==null||windKt<5)&&!isDaytime&&(cloudPct==null||cloudPct<25)){
    return{detected:true,text:'Possible surface inversion — fog/haze/trapped pollutants likely'};
  }
  return{detected:false,text:''};
}
function getFlightCatBadge(visSM,station){
  let effCeil=99999;
  if(station.clouds&&station.clouds.length){
    for(const c of station.clouds){
      const amt=(c.amount||c.cover||'').toUpperCase();
      const baseFt=(c.base!=null&&typeof c.base==='object'&&c.base.value!=null)?c.base.value*3.281:(typeof c.base==='number'?c.base:null);
      if((amt==='BKN'||amt==='OVC'||amt==='VV')&&baseFt!=null){effCeil=Math.min(effCeil,baseFt);break}
    }
  }
  const ceilLim=effCeil<99999;
  const visLim=visSM!=null;
  if((visLim&&visSM<1)||effCeil<500){
    const r=[];if(effCeil<500)r.push('Ceiling '+fmtAlt(effCeil));if(visLim&&visSM<1)r.push('Vis '+fmtVis(visSM));
    return{cat:'LIFR',reason:r.join(', ')||'Low IFR conditions'};
  }
  if((visLim&&visSM<3)||effCeil<1000){
    const r=[];if(effCeil<1000)r.push('Ceiling '+fmtAlt(effCeil));if(visLim&&visSM<3)r.push('Vis '+fmtVis(visSM));
    return{cat:'IFR',reason:r.join(', ')||'IFR conditions'};
  }
  if((visLim&&visSM<=5)||effCeil<=3000){
    const r=[];if(ceilLim&&effCeil<=3000)r.push('Ceiling '+fmtAlt(effCeil));if(visLim&&visSM<=5)r.push('Vis '+fmtVis(visSM));
    return{cat:'MVFR',reason:r.join(', ')||'Marginal VFR'};
  }
  return{cat:'VFR',reason:ceilLim?'Ceiling '+fmtAlt(effCeil):'Clear'};
}
function _stationCloudPct(station){
  if(!station||!station.clouds||!station.clouds.length)return null;
  let maxPct=0;
  for(const c of station.clouds){
    const amt=(c.amount||c.cover||'').toUpperCase();
    if(amt==='OVC'||amt==='VV')maxPct=Math.max(maxPct,100);
    else if(amt==='BKN')maxPct=Math.max(maxPct,75);
    else if(amt==='SCT')maxPct=Math.max(maxPct,50);
    else if(amt==='FEW')maxPct=Math.max(maxPct,25);
  }
  return maxPct;
}
function _isDaytimeNow(){
  const f=S.forecast;
  if(f&&f.current&&f.current.is_day!=null)return f.current.is_day===1;
  if(f&&f.daily&&f.daily.sunrise&&f.daily.sunset){
    const now=Date.now();
    const sr=new Date(f.daily.sunrise[0]).getTime();
    const ss=new Date(f.daily.sunset[0]).getTime();
    return now>=sr&&now<=ss;
  }
  const h=new Date().getHours();
  return h>=6&&h<20;
}

function kmhTo(kmh,unit){
  if(unit===0) return (kmh/1.609).toFixed(1);
  if(unit===1) return (kmh/1.852).toFixed(1);
  if(unit===2) return kmh.toFixed(1);
  return (kmh/3.6).toFixed(1);
}
function fmtWind(kmh){return kmhTo(kmh,S.windUnit)+' '+WIND_UNITS[S.windUnit]}
function ktsTo(kts,unit){
  if(unit===0) return (kts*1.151).toFixed(0);
  if(unit===1) return kts.toFixed(0);
  if(unit===2) return (kts*1.852).toFixed(0);
  return (kts*0.5144).toFixed(1);
}
function fmtWindKts(kts){return ktsTo(kts,S.windUnit)+' '+WIND_UNITS[S.windUnit]}
const _BFT_KMH=[1,6,12,20,29,39,50,62,75,89,103,118,1000];
const _BFT_NAME=['Calm','Light Air','Light Breeze','Gentle Breeze','Mod Breeze','Fresh Breeze','Strong Breeze','Near Gale','Gale','Strong Gale','Storm','Violent Storm','Hurricane'];
const _BFT_CLR=['#88ccff','#66ddaa','#44cc88','#33bb66','#aadd44','#ddcc33','#ffaa22','#ff7722','#ff4444','#dd2222','#bb1155','#991177','#770099'];
function beaufortFromKmh(kmh){for(let i=0;i<_BFT_KMH.length;i++){if(kmh<_BFT_KMH[i])return i}return 12}
function _beaufortBar(kmh){
  const bf=beaufortFromKmh(kmh);
  let bars='';
  for(let i=0;i<=12;i++){
    const fill=i<=bf?_BFT_CLR[i]:'rgba(255,255,255,0.08)';
    bars+=`<div style="flex:1;height:4px;border-radius:2px;background:${fill}"></div>`;
  }
  return`<div style="width:100%;margin-top:1px"><div style="display:flex;gap:1px;margin-bottom:1px">${bars}</div><div style="font-size:0.38em;color:${_BFT_CLR[bf]};font-weight:600;text-align:center;line-height:1">F${bf} ${_BFT_NAME[bf]}</div></div>`;
}


function fmtPres(mb){
  if(S.presUnit===0) return (mb*0.02953).toFixed(2)+' inHg';
  if(S.presUnit===1) return mb.toFixed(0)+' mb';
  if(S.presUnit===2) return (mb*0.75006).toFixed(0)+' mmHg';
  return (mb*0.1).toFixed(1)+' kPa';
}

function fmtVis(sm){
  if(S.visUnit===0) return sm.toFixed(1)+' mi';
  return (sm*1.609).toFixed(1)+' km';
}

function fmtPrecip(mm){
  if(S.precipUnit===0) return (mm/25.4).toFixed(2)+' in';
  if(S.precipUnit===1) return mm.toFixed(1)+' mm';
  return (mm/10).toFixed(2)+' cm';
}

function cycleUnit(key){
  const maxes={tempUnit:2,windUnit:4,presUnit:4,visUnit:2,precipUnit:3};
  S[key]=(S[key]+1)%maxes[key];
  try{localStorage.setItem('st_units',JSON.stringify({t:S.tempUnit,w:S.windUnit,p:S.presUnit,v:S.visUnit,pr:S.precipUnit}))}catch(e){}
  if(key==='windUnit'&&_windCurSim.spd>0&&S.activePage==='weather'){
    _windSweepAfterRender=true;
  }
  S._skipWindRestart=true;
  reRenderActive();
  S._skipWindRestart=false;
  if(typeof syncPushAlerts==='function')syncPushAlerts();
}

function loadUnits(){
  const mode=localStorage.getItem('st_unitMode');
  try{
    const u=JSON.parse(localStorage.getItem('st_units'));
    if(u!=null&&mode&&mode!=='auto'){S.tempUnit=u.t||0;S.windUnit=u.w||0;S.presUnit=u.p||0;S.visUnit=u.v||0;S.precipUnit=u.pr||0;return}
  }catch(e){console.warn('Unit prefs parse error:',e)}
  autoDetectUnits();
}
const IMPERIAL_CC=['US','LR','MM','PR','GU','VI','AS','MP','FM','MH','PW'];
function autoDetectUnits(){
  let cc='';
  try{
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';
    const tzCountry={'America/New_York':'US','America/Chicago':'US','America/Denver':'US','America/Los_Angeles':'US','America/Anchorage':'US','America/Phoenix':'US','Pacific/Honolulu':'US','America/Indianapolis':'US','America/Detroit':'US','America/Boise':'US','America/Juneau':'US','America/Adak':'US','Pacific/Guam':'GU','Pacific/Pago_Pago':'AS','Pacific/Palau':'PW','Pacific/Majuro':'MH','Pacific/Chuuk':'FM','Africa/Monrovia':'LR','Asia/Yangon':'MM'};
    cc=tzCountry[tz]||'';
    if(!cc&&tz.startsWith('America/')){
      const usZones=['New_York','Chicago','Denver','Los_Angeles','Anchorage','Phoenix','Honolulu','Indianapolis','Detroit','Boise','Juneau','Adak','Kentucky','North_Dakota','Menominee','Nome','Sitka','Yakutat','Metlakatla'];
      const city=tz.split('/').pop();
      if(usZones.includes(city))cc='US';
    }
    if(!cc){
      const loc=navigator.language||navigator.userLanguage||'';
      const parts=loc.split('-');
      if(parts.length>=2)cc=parts[parts.length-1].toUpperCase();
    }
  }catch(e){console.warn('Auto-detect units error:',e)}
  applyUnitsForCountry(cc);
  console.log('[Units] Auto-detected: '+(IMPERIAL_CC.includes(cc)?'Imperial':'Metric')+' ('+cc+')');
}
function applyUnitsForCountry(cc){
  const isImperial=IMPERIAL_CC.includes(cc);
  S.tempUnit=isImperial?0:1;
  S.windUnit=isImperial?0:2;
  S.presUnit=isImperial?0:1;
  S.visUnit=isImperial?0:1;
  S.precipUnit=isImperial?0:1;
  S.radarMetric=!isImperial;
  S._lastDetectedCC=cc;
}
function checkLocationUnits(countryCode){
  if(!countryCode)return;
  const cc=countryCode.toUpperCase();
  const mode=localStorage.getItem('st_unitMode')||'auto';
  if(mode!=='auto')return;
  const locIsImperial=IMPERIAL_CC.includes(cc);
  const curIsImperial=S.tempUnit===0;
  if(locIsImperial===curIsImperial)return;
  applyUnitsForCountry(cc);
  saveUnits();
  const miBtn=document.getElementById('radar-toggle-units');
  if(miBtn)miBtn.textContent=S.radarMetric?'KM':'MI';
  reRenderActive();
  toast('📐 Switched to '+(locIsImperial?'Imperial (°F, mph)':'Metric (°C, km/h)')+' for this region');
}
function applyUnitPreset(mode){
  localStorage.setItem('st_unitMode',mode);
  if(mode==='imperial'){applyUnitsForCountry('US');saveUnits()}
  else if(mode==='metric'){applyUnitsForCountry('BR');saveUnits()}
  else if(mode==='custom'){
    try{
      const saved=JSON.parse(localStorage.getItem('st_customUnits'));
      if(saved){S.tempUnit=saved.t;S.windUnit=saved.w;S.presUnit=saved.p;S.visUnit=saved.v;S.precipUnit=saved.pr;saveUnits()}
    }catch(e){}
  }
  else if(mode==='auto'){autoDetectUnits();saveUnits()}
  syncUnitSelects();
  reRenderActive();
  const miBtn=document.getElementById('radar-toggle-units');
  if(miBtn)miBtn.textContent=S.radarMetric?'KM':'MI';
}
function saveCustomUnits(){
  const obj={t:S.tempUnit,w:S.windUnit,p:S.presUnit,v:S.visUnit,pr:S.precipUnit};
  localStorage.setItem('st_customUnits',JSON.stringify(obj));
  localStorage.setItem('st_unitMode','custom');
  syncUnitSelects();
  toast('💾 Custom units saved');
}
function setIndividualUnit(key,val){
  S[key]=parseInt(val,10);
  saveUnits();
  const mode=localStorage.getItem('st_unitMode')||'auto';
  if(mode==='auto')localStorage.setItem('st_unitMode','custom');
  syncUnitSelects();
  reRenderActive();
  const miBtn=document.getElementById('radar-toggle-units');
  if(miBtn)miBtn.textContent=S.radarMetric?'KM':'MI';
}
function _ubtn(containerId,options,curVal,key){
  const c=document.getElementById(containerId);if(!c)return;
  c.innerHTML=options.map((o,i)=>{
    const active=i===curVal;
    return`<button onclick="setIndividualUnit('${key}',${i})" style="padding:3px 7px;font-size:0.68em;font-weight:${active?'700':'500'};border-radius:5px;cursor:pointer;border:1px solid ${active?'var(--accent-cyan)':'var(--border-subtle)'};background:${active?'rgba(0,229,255,0.15)':'rgba(255,255,255,0.04)'};color:${active?'var(--accent-cyan)':'var(--text-muted)'};transition:all 0.15s">${o}</button>`;
  }).join('');
}
function syncUnitSelects(){
  const mode=localStorage.getItem('st_unitMode')||'auto';
  document.querySelectorAll('.unit-preset-btn').forEach(b=>{
    const id=b.id.replace('up-','');
    const active=id===mode;
    b.style.background=active?'rgba(0,229,255,0.15)':'rgba(255,255,255,0.04)';
    b.style.borderColor=active?'var(--accent-cyan)':'var(--border-subtle)';
    b.style.color=active?'var(--accent-cyan)':'var(--text-muted)';
  });
  const desc=document.getElementById('unit-preset-desc');
  if(desc){
    const msgs={auto:'Auto mode switches units when you change location',imperial:'US standard: °F, mph, inHg, mi, in',metric:'International: °C, km/h, mb, km, mm',custom:'Your saved custom unit combination'};
    desc.textContent=msgs[mode]||'';
  }
  _ubtn('ubg-temp',['°F','°C'],S.tempUnit,'tempUnit');
  _ubtn('ubg-wind',['mph','kts','km/h','m/s'],S.windUnit,'windUnit');
  _ubtn('ubg-pres',['inHg','mb','mmHg','kPa'],S.presUnit,'presUnit');
  _ubtn('ubg-vis',['mi','km'],S.visUnit,'visUnit');
  _ubtn('ubg-precip',['in','mm','cm'],S.precipUnit,'precipUnit');
  const saveRow=document.getElementById('unit-save-row');
  if(saveRow)saveRow.style.display=(mode!=='auto')?'':'none';
}

function reRenderActive(){
  if(S.forecast) renderWeather(S.forecast);
  if(S.station) renderStation();
  renderStorms();
  if(S.map){const el=document.getElementById('radar-time');if(el)el.textContent=fmtClock(new Date())}
  if(_curLang!=='en')setTimeout(quickTranslate,300);
}

function haversine(lat1,lon1,lat2,lon2){const R=3959,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function bearingDeg(lat1,lon1,lat2,lon2){const dLon=(lon2-lon1)*Math.PI/180;const y=Math.sin(dLon)*Math.cos(lat2*Math.PI/180);const x=Math.cos(lat1*Math.PI/180)*Math.sin(lat2*Math.PI/180)-Math.sin(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.cos(dLon);return((Math.atan2(y,x)*180/Math.PI)+360)%360}

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
// User color overrides for the palette (keyed by bin min dBZ, localStorage
// 'st_dbzColors'). Applied IN PLACE onto DBZ_SCALE.color so every consumer
// (radar tiles, sonar, storm cells, 3D, legend, AI tags) picks them up live.
const DBZ_DEFAULT_COLORS=DBZ_SCALE.map(e=>e.color);
function _loadDbzColors(){try{const o=JSON.parse(localStorage.getItem('st_dbzColors'));return(o&&typeof o==='object')?o:{}}catch(e){return{}}}
function applyDbzColorOverrides(){const o=_loadDbzColors();DBZ_SCALE.forEach((e,i)=>{const ov=o[e.min];e.color=(typeof ov==='string'&&/^#[0-9a-fA-F]{6}$/.test(ov))?ov:DBZ_DEFAULT_COLORS[i];});}
function setDbzColor(min,hex){const o=_loadDbzColors();if(typeof hex==='string'&&/^#[0-9a-fA-F]{6}$/.test(hex))o[min]=hex;else delete o[min];localStorage.setItem('st_dbzColors',JSON.stringify(o));applyDbzColorOverrides();}
function resetDbzColor(min){const o=_loadDbzColors();delete o[min];localStorage.setItem('st_dbzColors',JSON.stringify(o));applyDbzColorOverrides();}
function resetAllDbzColors(){localStorage.removeItem('st_dbzColors');applyDbzColorOverrides();}
function isDbzColorCustom(min){return typeof _loadDbzColors()[min]==='string';}
function dbzDefaultColor(min){const i=DBZ_SCALE.findIndex(e=>e.min===min);return i>=0?DBZ_DEFAULT_COLORS[i]:'#ffffff';}
applyDbzColorOverrides();
function _dbzEntry(dbz){for(let i=DBZ_SCALE.length-1;i>=0;i--){if(dbz>=DBZ_SCALE[i].min)return DBZ_SCALE[i]}return DBZ_SCALE[0]}
function stormCat(dbz){
  const e=_dbzEntry(dbz);
  const m=S.radarMetric;
  const rainMap={0:m?'trace':'trace',5:m?'<0.25 mm/hr':'<0.01 in/hr',15:m?'0.25 mm/hr':'0.01 in/hr',20:m?'0.6 mm/hr':'0.02 in/hr',25:m?'1.3 mm/hr':'0.05 in/hr',30:m?'2.7 mm/hr':'0.10 in/hr',35:m?'6.4 mm/hr':'0.25 in/hr',40:m?'1.1 cm/hr':'0.45 in/hr',45:m?'2.3 cm/hr':'0.92 in/hr',50:m?'3.8 cm/hr':'1.5 in/hr',55:m?'5 cm/hr':'2 in/hr',60:m?'10 cm/hr':'4 in/hr',65:m?'>20 cm/hr':'>8 in/hr'};
  return{label:e.label,cls:e.cls,color:e.color,rain:rainMap[e.min]||'trace'};
}
function dbzHex(dbz){return _dbzEntry(dbz).color}
function dbzColor(dbz){return _dbzEntry(dbz)}
const PERP_TIERS=[
  {key:'direct',     min:0,  max:3,  label:'DIRECT',     aiPhrase:'APPROACHING DIRECTLY', color:'#ef4444', emoji:'🔴'},
  {key:'near_direct',min:3,  max:6,  label:'NEAR DIRECT',aiPhrase:'NEAR DIRECT HIT',      color:'#f97316', emoji:'🟠'},
  {key:'near_miss',  min:6,  max:12, label:'NEAR MISS',  aiPhrase:'NEAR MISS',            color:'#eab308', emoji:'🟡'},
  {key:'miss',       min:12, max:24, label:'MISS',       aiPhrase:'GLANCING / MISS',      color:'#06b6d4', emoji:'🔵'},
  {key:'distant',    min:24, max:48, label:'DISTANT',    aiPhrase:'DISTANT, TRACKING',    color:'#a3a3a3', emoji:'⚪'},
  {key:'far',        min:48, max:60, label:'FAR',        aiPhrase:'FAR (60 mi+ edge)',    color:'#737373', emoji:'⚫'}
];
function perpTier(missMi){if(missMi==null||isNaN(missMi))return null;for(const t of PERP_TIERS)if(missMi>=t.min&&missMi<t.max)return t;return null}
const STORM_CLASS={
  direct:     {key:'direct',     short:'Direct',      label:'Direct Hit',  aiPhrase:'APPROACHING DIRECTLY', color:'#ef4444', opacity:0.85, badge:'🔴 DIRECT',      coneMin:0.85, showPct:true},
  near_direct:{key:'near_direct',short:'Near Direct', label:'Near Direct', aiPhrase:'NEAR DIRECT HIT',      color:'#f97316', opacity:0.85, badge:'🟠 NEAR DIRECT', coneMin:0.65, showPct:true},
  near_miss:  {key:'near_miss',  short:'Near Miss',   label:'Near Miss',   aiPhrase:'NEAR MISS',            color:'#eab308', opacity:0.80, badge:'🟡 NEAR MISS',   coneMin:0.45, showPct:true},
  miss:       {key:'miss',       short:'Miss',        label:'Glancing/Miss',aiPhrase:'GLANCING MISS',       color:'#06b6d4', opacity:0.70, badge:'🔵 MISS',        coneMin:null, showPct:true},
  distant:    {key:'distant',    short:'Distant',     label:'Distant',     aiPhrase:'DISTANT, TRACKING',    color:'#a3a3a3', opacity:0.55, badge:'⚪ DISTANT',     coneMin:null, showPct:true},
  far:        {key:'far',        short:'Far',         label:'Far',         aiPhrase:'FAR EDGE',             color:'#737373', opacity:0.45, badge:'⚫ FAR',         coneMin:null, showPct:false},
  nearby:     {key:'nearby',     short:'Nearby',      label:'Nearby',      aiPhrase:'NEARBY',               color:'#06b6d4', opacity:0.75, badge:'🔵 NEARBY',      coneMin:null, showPct:true},
  passing:    {key:'passing',    short:'Passing',     label:'Passing By',  aiPhrase:'PASSING TO YOUR',      color:'#eab308', opacity:0.85, badge:'🟡 PASSING',     coneMin:null, showPct:false},
  moving_away:{key:'moving_away',short:'Moving Away', label:'Moving Away', aiPhrase:'MOVING AWAY',          color:'#22c55e', opacity:0.4,  badge:'🟢 MOVING AWAY', coneMin:null, showPct:false},
  unknown:    {key:'unknown',    short:'',            label:'Unknown',     aiPhrase:'motion unknown',       color:'#888888', opacity:0.4,  badge:'',               coneMin:null, showPct:false}
};
const INBOUND_TIER_KEYS=['direct','near_direct','near_miss','miss','distant','far'];
const APPROACHING_TIER_KEYS=['direct','near_direct'];
// v4.65: single shared minimum-dBZ floor, set to MATCH the Storms tab's
// long-standing detection floor (15 dBZ). The Storms tab is the source of
// truth for "what counts as a cell"; this constant feeds the radar scan
// floor (storms.js) and the Rain Clock (weather.js) so the Rain Clock agrees
// with the cards instead of using a stricter, separate cutoff. (Earlier
// v4.63/v4.64 set this to 20 and pushed the cards up to match the Rain Clock,
// which hid inbound cards — reverted here.)
const STORM_MIN_DBZ=15;
if(typeof window!=='undefined'){window.STORM_MIN_DBZ=STORM_MIN_DBZ}
// v5.33: the storm-track cone floor, the in-app Storm Cell Alerts "Intensity"
// gate, and the Background Storm Alerts push threshold are ONE SHARED NUMBER —
// stored in st_stormThresholds.stormDbz.val and edited from the single control
// at Settings → 📡 Background Storm Alerts → Min strength. The floor gates BOTH
// the "you are in N cones" count (storms.js) and the cones drawn on the map
// (radar.js). Default 40; the control offers 20-60 in 5 dBZ steps. We read the
// value regardless of whether the in-app notification toggle itself is on,
// since the cone floor is a display gate.
const CONE_MIN_DBZ_DEFAULT=40;
function getConeMinDbz(){
  try{
    const s=localStorage.getItem('st_stormThresholds');
    if(s){const o=JSON.parse(s);if(o&&o.stormDbz&&o.stormDbz.val!=null){let v=parseFloat(o.stormDbz.val);if(!isNaN(v)){if(v<20)v=20;if(v>60)v=60;return v;}}}
  }catch(e){}
  return CONE_MIN_DBZ_DEFAULT;
}
if(typeof window!=='undefined'){window.getConeMinDbz=getConeMinDbz}
function isInboundTier(k){return INBOUND_TIER_KEYS.indexOf(k)>=0}
function isApproachingTier(k){return APPROACHING_TIER_KEYS.indexOf(k)>=0}
function bumpStormScanId(){if(!S._stormScanId)S._stormScanId=0;S._stormScanId++;return S._stormScanId}
if(typeof window!=='undefined'){window.bumpStormScanId=bumpStormScanId}
function stormClass(key){return STORM_CLASS[key]||STORM_CLASS.unknown}
if(typeof window!=='undefined'){window.PERP_TIERS=PERP_TIERS;window.perpTier=perpTier;window.STORM_CLASS=STORM_CLASS;window.stormClass=stormClass;window.INBOUND_TIER_KEYS=INBOUND_TIER_KEYS;window.APPROACHING_TIER_KEYS=APPROACHING_TIER_KEYS;window.isInboundTier=isInboundTier;window.isApproachingTier=isApproachingTier}
function fmtStormDist(mi){return S.radarMetric?(mi*1.60934).toFixed(1)+' km':mi.toFixed(1)+' mi'}
function fmtCountdown(totalSec){
  if(totalSec<=0)return'NOW';
  const h=Math.floor(totalSec/3600),m=Math.floor((totalSec%3600)/60),s=totalSec%60;
  if(h>0)return h+'h:'+String(m).padStart(2,'0')+'m:'+String(s).padStart(2,'0')+'s';
  return m+'m:'+String(s).padStart(2,'0')+'s';
}
function fmtArrivalTime(etaMin){
  return fmtClockShort(new Date(Date.now()+etaMin*60000));
}
function formatStormEta(etaMin){
  if(etaMin==null||etaMin<=0)return'NOW';
  const totalSec=Math.round(etaMin*60);
  const h=Math.floor(totalSec/3600),m=Math.floor((totalSec%3600)/60),s=totalSec%60;
  if(h>0)return _pad2(h)+'h:'+_pad2(m)+'m';
  return _pad2(m)+'m:'+_pad2(s)+'s';
}
function stormKey(s){return s.lat.toFixed(3)+','+s.lng.toFixed(3)}
function autoScanInterval(){
  const n=S.storms.length;
  if(n>=4)return 10*60*1000;
  if(n>=1)return 15*60*1000;
  return 30*60*1000;
}
function scheduleAutoScan(){
  if(S.autoScanTimer)clearTimeout(S.autoScanTimer);
  const interval=autoScanInterval();
  const elapsed=Date.now()-S.lastScanMs;
  const wait=Math.max(0,interval-elapsed);
  S.autoScanTimer=setTimeout(()=>{
    if(S.lat!=null){
      if(S._lastScanWasHiRes&&S.map)scanRadarHiRes(S.map,true);
      else scanRadarForStorms();
      updateAutoScanUI();
    }
  },wait);
  updateAutoScanUI();
}
function updateAutoScanUI(){
  const el=document.getElementById('auto-scan-status');
  if(!el)return;
  const interval=autoScanInterval();
  const n=S.storms.length;
  const mins=Math.round(interval/60000);
  el.textContent=n?`Auto-scan: ${mins}m (${n} storm${n>1?'s':''})`:`Auto-scan: ${mins}m`;
}
function startEtaCountdowns(){
  if(S.etaTimer)clearInterval(S.etaTimer);
  S.etaTimer=setInterval(()=>{
    const now=Date.now();
    let expiredKeys=[];
    document.querySelectorAll('[data-eta-sec]').forEach(el=>{
      const target=parseInt(el.getAttribute('data-eta-sec'));
      const key=el.getAttribute('data-storm-key');
      const remain=Math.max(0,Math.round((target-now)/1000));
      if(remain<=0){
        if(key)expiredKeys.push(key);
      }else{
        el.textContent=fmtCountdown(remain);
      }
    });
    if(expiredKeys.length&&!S._etaRescanInProgress){
      const sinceLastScan=now-S.lastScanMs;
      if(sinceLastScan<30000){
        expiredKeys.forEach(k=>{delete S._stormETAs[k]});
        S.storms=S.storms.filter(s=>!expiredKeys.includes(stormKey(s)));if(typeof bumpStormScanId==='function')bumpStormScanId();
        computeTopStorms();
        renderStorms();updateStormBadges();
        if(S.map)plotStormMarkers(S.map);
        return;
      }
      expiredKeys.forEach(k=>{delete S._stormETAs[k]});
      S.storms=S.storms.filter(s=>!expiredKeys.includes(stormKey(s)));
      computeTopStorms();
      renderStorms();updateStormBadges();
      if(S.map)plotStormMarkers(S.map);
      S._etaRescanInProgress=true;
      const doScan=async()=>{
        if(S.lat!=null){
          if(S._lastScanWasHiRes&&S.map)await scanRadarHiRes(S.map,true);
          else await scanRadarForStorms();
        }
        S._etaRescanInProgress=false;
      };
      doScan();
    }
    document.querySelectorAll('.popup-countdown').forEach(el=>{
      const target=parseInt(el.getAttribute('data-target'));
      const remain=Math.max(0,Math.round((target-now)/1000));
      el.textContent=fmtCountdown(remain);
    });
    document.querySelectorAll('.tier-eta-cd').forEach(el=>{
      const target=parseInt(el.getAttribute('data-tier-target'));
      if(!target||isNaN(target))return;
      const remain=Math.max(0,Math.round((target-now)/1000));
      const cd=fmtCountdown(remain);
      const arr=fmtClockShort(new Date(target));
      el.innerHTML='<b>'+cd+'</b> ('+arr+')';
    });
    document.querySelectorAll('[data-dist-mi]').forEach(el=>{
      const closSpd=parseFloat(el.getAttribute('data-closing-mph')||'0');
      const targetMs=parseInt(el.getAttribute('data-target-ms')||'0');
      if(!closSpd||!targetMs)return;
      const remainHrs=Math.max(0,(targetMs-now)/3600000);
      const curDist=remainHrs*closSpd;
      el.textContent=S.radarMetric?(curDist*1.60934).toFixed(2)+' km':curDist.toFixed(2)+' mi';
    });
  },1000);
}
function toggleStormUnits(){
  S.radarMetric=!S.radarMetric;
  const btn=document.getElementById('radar-toggle-units');
  if(btn)btn.textContent=S.radarMetric?'KM':'MI';
  renderStorms();
  if(S.map)plotStormMarkers(S.map);
}
function calcDewC(tc,rh){const a=17.27,b=237.7,g=(a*tc)/(b+tc)+Math.log(Math.min(100,rh)/100);return Math.min(tc,(b*g)/(a-g))}

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

// ==========================================
// NAVIGATION
// ==========================================
function _isDesktop(){return window.innerWidth>=1024}

document.querySelectorAll('.nav-item').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const page=btn.dataset.page;
    switchPage(page);
  });
});

let _desktopInitDone=false;
function initDesktopMode(){
  if(_desktopInitDone||!S.lat)return;
  _desktopInitDone=true;
  document.querySelectorAll('.section-page').forEach(p=>p.classList.add('visible'));
  if(!S.map)initRadar();
  startSonarSweep();
  if(!S.station||S._stationLocKey!==S.lat+','+S.lon)fetchStation();
  renderStorms();
  setTimeout(()=>{
    if(S.map)S.map.invalidateSize();
    startSonarSweep();
  },500);
  setTimeout(()=>{if(S.map)S.map.invalidateSize()},1500);
  _initScrollSpy();
  _initDesktopSonarKeepAlive();
}

function _initDesktopSonarKeepAlive(){
  setInterval(()=>{
    if(!_isDesktop()||!S.lat)return;
    if(!_sonarAnimId&&document.getElementById('mini-sonar-canvas'))startSonarSweep();
  },2000);
}

function _initScrollSpy(){
  const pages=['weather','radar','storms','station','3d','alerts'];
  let _scrollSpyActive=true;
  const obs=new IntersectionObserver((entries)=>{
    if(!_isDesktop()||!_scrollSpyActive)return;
    let topId=null,topRatio=0;
    entries.forEach(e=>{
      if(e.isIntersecting&&e.intersectionRatio>topRatio){topRatio=e.intersectionRatio;topId=e.target.id.replace('page-','');}
    });
    if(topId)document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===topId));
  },{threshold:[0.1,0.3,0.5],rootMargin:'-60px 0px -30% 0px'});
  pages.forEach(p=>{const el=document.getElementById('page-'+p);if(el)obs.observe(el)});
}

// ==========================================
// LOCATION

function toggleLocOverlay(open){
  const el=document.getElementById('loc-overlay');
  if(open){
    if(typeof hideSuggestions==='function')hideSuggestions();
    el.classList.add('open');
    setTimeout(()=>{document.getElementById('location-input').focus();if(typeof _syncClearBtn==='function')_syncClearBtn()},100);
    const tb=document.getElementById('travel-btn');
    if(S.travelMode){tb.textContent='⏹ Stop Travel Mode';tb.classList.add('active')}
    else{tb.textContent='🧭 Travel Mode — Follow GPS Live';tb.classList.remove('active')}
    const intRow=document.getElementById('gps-interval-row');
    if(intRow)intRow.style.display=S.travelMode?'block':'none';
    if(S.travelMode){const intSel=document.getElementById('gps-interval-sel');if(intSel)intSel.value=String(S.gpsInterval||5);}
    renderFavorites();
    const saveBtn=document.getElementById('fav-save-btn');
    if(saveBtn)saveBtn.style.display=S.lat?'':'none';
  }
  else{
    if(typeof hideSuggestions==='function')hideSuggestions();
    el.classList.remove('open');
  }
}
var _3dLoaded=false,_3dLoading=false;
function _ensure3DLoaded(){
  if(_3dLoaded){activate3DView();return;}
  if(_3dLoading)return;
  _3dLoading=true;
  var c=document.getElementById('view3d-container');
  if(c)c.innerHTML='<div style="display:flex;justify-content:center;align-items:center;height:100%;color:var(--text-secondary);font-size:1.1em;letter-spacing:0.02em">Loading 3D…</div>';
  function _ld(src,cb){var s=document.createElement('script');s.src=src;s.onload=cb;s.onerror=function(){console.error('[3D] failed to load:',src);_3dLoading=false;var c2=document.getElementById('view3d-container');if(c2)c2.innerHTML='<div style="display:flex;justify-content:center;align-items:center;height:100%;color:var(--accent-red,#f55)">Failed to load 3D. Check connection.</div>';};document.head.appendChild(s);}
  var CDN='https://cdn.jsdelivr.net/npm/three@0.128.0/';
  _ld(CDN+'build/three.min.js',function(){
    _ld(CDN+'examples/js/controls/OrbitControls.js',function(){
      _ld(CDN+'examples/js/utils/BufferGeometryUtils.js',function(){
        _ld('js/view3d.js?v=638',function(){
          _3dLoaded=true;_3dLoading=false;
          if(typeof activate3DView==='function')activate3DView();
        });
      });
    });
  });
}
function switchPage(page){
  if(_isDesktop()){
    const target=document.getElementById('page-'+page);
    if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    S.activePage=page;
    if(page==='radar'&&S.lat&&S.map){
      setTimeout(()=>{S.map.invalidateSize();if(S._showZones&&S._rawScanPts.length)buildStormZones(S.map,S._rawScanPts);if(S._showPathArrows)buildPathArrows(S.map)},200);
    }
    if(page==='3d'){_ensure3DLoaded();}else{if(typeof deactivate3DView==='function')deactivate3DView();}
    if(_curLang!=='en'){setTimeout(()=>quickTranslate(),200);setTimeout(()=>quickTranslate(),800)}
    return;
  }
  document.querySelectorAll('.nav-item').forEach(b=>{b.classList.toggle('active',b.dataset.page===page)});
  document.querySelectorAll('.section-page').forEach(p=>{p.classList.toggle('visible',p.id==='page-'+page)});
  S.activePage=page;
  if(page==='radar'&&S.lat){
    if(S.map){setTimeout(()=>{S.map.invalidateSize();if(S._showZones&&S._rawScanPts.length)buildStormZones(S.map,S._rawScanPts);if(S._showPathArrows)buildPathArrows(S.map)},150);if(S._nextRefreshAt)startScanRefreshTimer()}
    else{initRadar()}
  }
  if(page==='weather'){startSonarSweep();if(typeof refreshRainClock==='function')refreshRainClock(true)}else{stopSonarSweep()}
  if(page==='station'){const navBtn=document.getElementById('nav-station');if(navBtn&&navBtn.style.display==='none'){switchPage('weather');return}if(S.lat&&(!S.station||S._stationLocKey!==S.lat+','+S.lon))fetchStation()}
  if(page==='alerts'&&S.lat){fetchAlerts();fetchHazards()}
  if(page==='storms'&&S.lat)renderStorms();
  if(page==='3d'){_ensure3DLoaded();}else{if(typeof deactivate3DView==='function')deactivate3DView();}
  if(_curLang!=='en'){setTimeout(()=>quickTranslate(),200);setTimeout(()=>quickTranslate(),800)}
}
function updateStormBadges(){
  // v4.67: the pill mirrors the Storms-tab "inbound" cards (S._inboundShown,
  // the filtered+capped inbound set) so the header number matches the cards and
  // honors the user's active storm filter. Falls back to the unfiltered
  // top-storms list only before the Storms tab has rendered once.
  const _inboundArr=Array.isArray(S._inboundShown)?S._inboundShown:(S._topStorms||[]);
  const inbound=_inboundArr.length;
  const maxDbz=_inboundArr.length?Math.max(..._inboundArr.map(s=>s.dbz)):0;
  const sevIcon=maxDbz>=61?'‼️':maxDbz>=52?'🚨':maxDbz>=46?'⚠️':maxDbz>=41?'🟡':maxDbz>=20?'🟢':'🔵';
  const sevBg=maxDbz>0?dbzHex(maxDbz):'#6b7280';
  const hdr=document.getElementById('header-storm-count');
  const nav=document.getElementById('nav-storm-badge');
  if(hdr){
    hdr.textContent=inbound?`${sevIcon} ${inbound} inbound`:'🌪️ 0';
    hdr.style.background=inbound?sevBg:'#6b7280';
  }
  if(nav){
    nav.textContent=inbound.toString();
    nav.style.background=inbound?sevBg:'#6b7280';
  }
  const navIcon=document.getElementById('nav-storms-icon');
  if(navIcon)navIcon.textContent=inbound>0?sevIcon:'🌪️';
  const hdrLightning=document.getElementById('header-lightning');
  if(hdrLightning)hdrLightning.className=inbound>0?'lightning-active':'';
}