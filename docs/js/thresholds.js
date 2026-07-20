// StormTracker — Weather Alerts, Storm Cell Alerts, Rain Alerts
const _WX_ALERT_DEFS=[
  {key:'windMax',label:'Wind Speed',icon:'💨',unit:'speed',defVal:25,defOn:false,check:(c,th)=>{const kmh=c.wind_speed_10m;if(kmh==null)return null;const v=parseFloat(kmhTo(kmh,S.windUnit));return v>=th?{val:v,u:WIND_UNITS[S.windUnit],msg:`🔔 Wind speed at ${v} ${WIND_UNITS[S.windUnit]} — above your ${th} ${WIND_UNITS[S.windUnit]} threshold`}:null}},
  {key:'gustMax',label:'Wind Gusts',icon:'🌬️',unit:'speed',defVal:35,defOn:false,check:(c,th)=>{const kmh=c.wind_gusts_10m;if(kmh==null)return null;const v=parseFloat(kmhTo(kmh,S.windUnit));return v>=th?{val:v,u:WIND_UNITS[S.windUnit],msg:`🔔 Wind gusts detected at ${v} ${WIND_UNITS[S.windUnit]} — above your ${th} ${WIND_UNITS[S.windUnit]} threshold`}:null}},
  {key:'tempHigh',label:'Temp High',icon:'🌡️↑',unit:'temp',defVal:95,defOn:false,check:(c,th)=>{const tc=c.temperature_2m;if(tc==null)return null;const v=S.tempUnit===0?parseFloat(cToF(tc)):parseFloat(tc.toFixed(1));return v>=th?{val:v,u:TEMP_UNITS[S.tempUnit],msg:`🔔 Temperature reached ${v}${TEMP_UNITS[S.tempUnit]} — above your ${th}${TEMP_UNITS[S.tempUnit]} high threshold`}:null}},
  {key:'tempLow',label:'Temp Low',icon:'🌡️↓',unit:'temp',defVal:32,defOn:false,dir:'below',check:(c,th)=>{const tc=c.temperature_2m;if(tc==null)return null;const v=S.tempUnit===0?parseFloat(cToF(tc)):parseFloat(tc.toFixed(1));return v<=th?{val:v,u:TEMP_UNITS[S.tempUnit],msg:`🔔 Temperature dropped to ${v}${TEMP_UNITS[S.tempUnit]} — below your ${th}${TEMP_UNITS[S.tempUnit]} low threshold`}:null}},
  {key:'pressureDrop',label:'Pressure Drop (3hr)',icon:'📉',unit:'pressure',defVal:0.10,defOn:false,step:0.01,check:(c,th)=>{const drop=S._baroTrendMb!=null?-S._baroTrendMb:null;if(drop==null||drop<=0)return null;const dropInhg=drop*0.02953;const v=S.presUnit===0?parseFloat(dropInhg.toFixed(2)):parseFloat(drop.toFixed(1));const u=S.presUnit===0?'inHg':'mb';return v>=th?{val:v,u,msg:`🔔 Rapidly falling pressure — dropped ${v} ${u} over the last 3 hours (threshold: ${th} ${u})`}:null}},
  {key:'rainMax',label:'Rainfall Rate',icon:'🌧️',unit:'precip',defVal:1.0,defOn:false,step:0.1,check:(c,th)=>{const mmh=c.precipitation;if(mmh==null||mmh<=0)return null;let v,u;if(S.precipUnit===0){v=parseFloat((mmh/25.4).toFixed(2));u='in/hr'}else if(S.precipUnit===2){v=parseFloat((mmh/10).toFixed(2));u='cm/hr'}else{v=parseFloat(mmh.toFixed(1));u='mm/hr'}return v>=th?{val:v,u,msg:`🔔 Rainfall rate at ${v} ${u} — above your ${th} ${u} threshold`}:null}},
  {key:'humidHigh',label:'Humidity High',icon:'💧↑',unit:'%',defVal:90,defOn:false,check:(c,th)=>{const v=c.relative_humidity_2m;if(v==null)return null;return v>=th?{val:v,u:'%',msg:`🔔 Humidity at ${v}% — above your ${th}% high threshold`}:null}},
  {key:'humidLow',label:'Humidity Low',icon:'💧↓',unit:'%',defVal:20,defOn:false,dir:'below',check:(c,th)=>{const v=c.relative_humidity_2m;if(v==null)return null;return v<=th?{val:v,u:'%',msg:`🔔 Humidity at ${v}% — below your ${th}% low threshold`}:null}},
  {key:'visMin',label:'Visibility Low',icon:'👁️',unit:'vis',defVal:1.0,defOn:false,dir:'below',check:(c,th)=>{const vm=S._nwsVisM;if(vm==null)return null;let v,u;if(S.visUnit===0){v=parseFloat((vm/1609.34).toFixed(1));u='mi'}else{v=parseFloat((vm/1000).toFixed(1));u='km'}return v<=th?{val:v,u,msg:`🔔 Visibility dropped to ${v} ${u} — below your ${th} ${u} threshold`}:null}},
  {key:'uvMax',label:'UV Index',icon:'☀️',unit:'uv',defVal:8,defOn:false,check:(c,th)=>{const uv=S._uvIndex;if(uv==null)return null;return uv>=th?{val:uv,u:'',msg:`🔔 UV Index at ${uv} — above your ${th} threshold (high exposure risk)`}:null}}
];
const _WX_ALERT_COOLDOWN=(function(){try{const s=localStorage.getItem('st_wxAlertCooldown');if(s){const o=JSON.parse(s);const now=Date.now();Object.keys(o).forEach(k=>{if(now-o[k]>900000)delete o[k]});return o}}catch(e){}return{}})();
function _getAlertExpiryMs(){const v=parseInt(localStorage.getItem('st_alertExpiry'),10);return[30,60,120,240,360].includes(v)?v*60000:120*60000}
function setAlertExpiry(val){const n=parseInt(val,10);if([30,60,120,240,360].includes(n)){localStorage.setItem('st_alertExpiry',n);_pruneExpiredAlerts()}}
let _wxCheckedOnce=false;
function _pruneExpiredAlerts(){
  const ex=_getAlertExpiryMs();const now=Date.now();
  const sLen=_stormAlertHistory.length;
  _stormAlertHistory=_stormAlertHistory.filter(a=>now-a.time<ex);
  if(_stormAlertHistory.length!==sLen)_saveStormAlertHistory();
  const wLen=_wxAlertHistory.length;
  _wxAlertHistory=_wxAlertHistory.filter(a=>{
    if(a.fellBelowTime)return now-a.fellBelowTime<ex;
    if(_wxCheckedOnce)return true;
    return now-a.time<ex;
  });
  if(_wxAlertHistory.length!==wLen)_saveWxAlertHistory();
  if(S.activePage==='alerts')renderAlerts();
}
let _wxAlertHistory=JSON.parse(localStorage.getItem('st_wxAlertHistory')||'[]');
function _loadWxThresholds(){
  try{const s=localStorage.getItem('st_wxThresholds');if(s)return JSON.parse(s)}catch(e){}
  const d={};_WX_ALERT_DEFS.forEach(a=>{d[a.key]={on:a.defOn,val:a.defVal}});return d;
}
function _saveWxThresholds(th){try{localStorage.setItem('st_wxThresholds',JSON.stringify(th))}catch(e){}}
function _saveWxAlertHistory(){
  if(_wxAlertHistory.length>50)_wxAlertHistory=_wxAlertHistory.slice(-50);
  try{localStorage.setItem('st_wxAlertHistory',JSON.stringify(_wxAlertHistory))}catch(e){}
}
function checkWeatherThresholds(){
  if(!S.weather)return;
  const th=_loadWxThresholds();
  const now=Date.now();
  let histDirty=false;
  _WX_ALERT_DEFS.forEach(def=>{
    const cfg=th[def.key];
    if(!cfg||!cfg.on){
      _wxAlertHistory.forEach(a=>{if(a.key===def.key&&!a.fellBelowTime){a.fellBelowTime=now;histDirty=true}});
      return;
    }
    const result=def.check(S.weather,cfg.val);
    if(!result){
      _wxAlertHistory.forEach(a=>{if(a.key===def.key&&!a.fellBelowTime){a.fellBelowTime=now;histDirty=true}});
      return;
    }
    const lastFired=_WX_ALERT_COOLDOWN[def.key]||0;
    if(now-lastFired<900000)return;
    _WX_ALERT_COOLDOWN[def.key]=now;
    try{localStorage.setItem('st_wxAlertCooldown',JSON.stringify(_WX_ALERT_COOLDOWN))}catch(e){}
    toast(result.msg,6000);
    _wxAlertHistory.push({key:def.key,label:def.label,icon:def.icon,msg:result.msg,val:result.val,u:result.u,time:now});
    histDirty=true;
    _sendBrowserNotification(def.label,result.msg);
    if(S.activePage==='alerts')renderAlerts();
  });
  if(histDirty)_saveWxAlertHistory();
  _wxCheckedOnce=true;
  _pruneExpiredAlerts();
  checkRainAlert();
  checkRainOverheadAlert();
}
function _sendBrowserNotification(title,body,logBody){
  // v5.96: record EVERY alert in the 📢 Notifications log first — before the
  // permission/visibility guards below — so the history captures alerts whether
  // or not a browser notification actually gets shown (app open, permission off,
  // etc.). Every real weather/storm/hurricane/lightning alert routes through here.
  // v5.97: `body` is the SHORT text the phone/browser shows (which truncates);
  // the optional `logBody` is the FULL detailed version stored in the 📢 panel.
  if(typeof logNotification==='function')logNotification(logBody||body);
  if(!('Notification' in window))return;
  if(Notification.permission!=='granted')return;
  if(document.visibilityState==='visible')return;
  try{
    if(navigator.serviceWorker&&navigator.serviceWorker.controller){
      navigator.serviceWorker.controller.postMessage({type:'WX_THRESHOLD_ALERT',title:'StormTracker: '+title,body:body.replace(/🔔\s*/,'')});
    }else{
      new Notification('StormTracker: '+title,{body:body.replace(/🔔\s*/,''),icon:'/StormTracker/icons/icon-192x192.png',tag:'wx-threshold-'+title,renotify:true});
    }
  }catch(e){console.log('Browser notification error:',e.message)}
}
function requestNotifPermission(){
  if(!('Notification' in window))return;
  if(Notification.permission==='granted')return;
  if(Notification.permission==='default')_showNotifPermissionModal();
}
function renderWxAlertSettings(){
  const th=_loadWxThresholds();
  let html='';
  _WX_ALERT_DEFS.forEach(def=>{
    const cfg=th[def.key]||{on:def.defOn,val:def.defVal};
    const step=def.step||1;
    html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:6px">
      <label style="display:flex;align-items:center;gap:4px;font-size:0.7em;color:var(--text-muted);flex:1;min-width:0;cursor:pointer">
        <input type="checkbox" ${cfg.on?'checked':''} onchange="toggleWxAlert('${def.key}',this.checked)" class="accent-cyan-check">
        <span style="white-space:nowrap">${def.icon} ${def.label}</span>
      </label>
      <input type="number" value="${cfg.val}" step="${step}" min="0" style="width:60px;font-size:0.7em;padding:3px 4px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;text-align:center;font-family:var(--font-mono)" onchange="setWxAlertVal('${def.key}',this.value)" ${cfg.on?'':'disabled'}>
    </div>`;
  });
  return html;
}
function toggleWxAlert(key,on){
  const th=_loadWxThresholds();
  if(!th[key]){const def=_WX_ALERT_DEFS.find(d=>d.key===key);th[key]={on,val:def?def.defVal:0}}
  else th[key].on=on;
  _saveWxThresholds(th);
  if(on)requestNotifPermission();
  const el=document.getElementById('wx-alert-settings');
  if(el)el.innerHTML=renderWxAlertSettings();
  if(typeof syncPushAlerts==='function')syncPushAlerts();
}
function setWxAlertVal(key,val){
  const n=parseFloat(val);if(isNaN(n)||n<0)return;
  const th=_loadWxThresholds();
  if(!th[key])th[key]={on:false,val:n};
  else th[key].val=n;
  _saveWxThresholds(th);
  if(typeof syncPushAlerts==='function')syncPushAlerts();
}
function clearWxAlertHistory(){_wxAlertHistory=[];_saveWxAlertHistory();if(S.activePage==='alerts')renderAlerts();}

const _STORM_ALERT_DEFS=[
  {key:'stormDist',label:'Projected Miss',icon:'📏',unit:'mi',defVal:6,defOn:false,dir:'below',step:1,
    check:(storm,th)=>{const b=storm._brief||(typeof calcStormETAForBriefing==='function'?calcStormETAForBriefing(storm):null);const miss=(b&&b.perpMissMi!=null)?b.perpMissMi:storm.distance;if(miss==null)return null;const tier=(typeof perpTier==='function')?perpTier(miss):null;const cls=b&&b.classification;if(typeof isApproachingTier==='function'){const tierKey=cls||(tier&&tier.key);if(!tierKey||!isApproachingTier(tierKey))return null}else if(cls&&typeof isInboundTier==='function'&&!isInboundTier(cls))return null;const v=S.radarMetric?parseFloat((miss*1.60934).toFixed(1)):parseFloat(miss.toFixed(1));const u=S.radarMetric?'km':'mi';const tierLbl=tier?tier.label:(cls?cls.replace('_',' ').toUpperCase():'');return miss<=th?{val:v,u,msg:`🌩️ Storm cell approaching — projected to pass ${v} ${u} from you (${storm.dbz} dBZ${tierLbl?', '+tierLbl:''})`}:null}},
  {key:'stormDbz',label:'Intensity (dBZ)',icon:'📡',unit:'dBZ',defVal:40,defOn:false,step:5,min:20,max:60,
    check:(storm,th)=>{const v=storm.dbz;if(v==null)return null;if(v<th)return null;const b=storm._brief||(typeof calcStormETAForBriefing==='function'?calcStormETAForBriefing(storm):null);const cls=b&&b.classification;if(cls&&typeof isInboundTier==='function'&&!isInboundTier(cls))return null;const miss=(b&&b.perpMissMi!=null)?b.perpMissMi:storm.distance;const tier=(miss!=null&&typeof perpTier==='function')?perpTier(miss):null;const tierLbl=tier?', '+tier.label:'';return{val:v,u:'dBZ',msg:`🌩️ Storm cell at ${v} dBZ — above your ${th} dBZ intensity threshold (${parseFloat(storm.distance.toFixed(1))} mi away${tierLbl})`}}},
  {key:'stormImpact',label:'Impact Score',icon:'🎯',unit:'%',defVal:50,defOn:false,step:5,
    check:(storm,th)=>{const v=storm.impactPct;if(v==null||v<=0)return null;if(v<th)return null;const b=storm._brief||(typeof calcStormETAForBriefing==='function'?calcStormETAForBriefing(storm):null);const cls=b&&b.classification;if(cls&&typeof isInboundTier==='function'&&!isInboundTier(cls))return null;const miss=(b&&b.perpMissMi!=null)?b.perpMissMi:storm.distance;const tier=(miss!=null&&typeof perpTier==='function')?perpTier(miss):null;const tierLbl=tier?', '+tier.label:'';return{val:v,u:'%',msg:`🌩️ Storm cell impact ${v}% — above your ${th}% threshold (${storm.dbz} dBZ, ${parseFloat(storm.distance.toFixed(1))} mi, tier: ${storm.impactTier}${tierLbl})`}}}
];
const _STORM_ALERT_COOLDOWN=(function(){try{const s=localStorage.getItem('st_stormAlertCooldown');if(s){const o=JSON.parse(s);const now=Date.now();Object.keys(o).forEach(k=>{if(now-o[k]>7200000)delete o[k]});return o}}catch(e){}return{}})();
let _stormAlertHistory=JSON.parse(localStorage.getItem('st_stormAlertHistory')||'[]');
function _loadStormThresholds(){
  try{const s=localStorage.getItem('st_stormThresholds');if(s)return JSON.parse(s)}catch(e){}
  const d={};_STORM_ALERT_DEFS.forEach(a=>{d[a.key]={on:a.defOn,val:a.defVal}});return d;
}
function _saveStormThresholds(th){try{localStorage.setItem('st_stormThresholds',JSON.stringify(th))}catch(e){}}
// v5.32: stormDbz is a SHARED value (storm-track cone floor + notification
// intensity), constrained to 20-60 dBZ in 5 dBZ steps. Normalize any preexisting
// out-of-range / non-multiple stored value once so the stored value,
// getConeMinDbz() and notification firing all agree.
(function _normalizeStormDbz(){
  try{
    const def=_STORM_ALERT_DEFS.find(d=>d.key==='stormDbz');if(!def)return;
    const th=_loadStormThresholds();
    if(th&&th.stormDbz&&th.stormDbz.val!=null){
      let v=parseFloat(th.stormDbz.val);if(isNaN(v))return;
      const step=def.step||5;let nv=Math.round(v/step)*step;
      if(def.min!=null&&nv<def.min)nv=def.min;if(def.max!=null&&nv>def.max)nv=def.max;
      if(nv!==v){th.stormDbz.val=nv;_saveStormThresholds(th);}
    }
  }catch(e){}
})();
function _saveStormAlertHistory(){
  if(_stormAlertHistory.length>50)_stormAlertHistory=_stormAlertHistory.slice(-50);
  try{localStorage.setItem('st_stormAlertHistory',JSON.stringify(_stormAlertHistory))}catch(e){}
}
// v5.99: the old cone-angle _calcStormImpact model was DELETED — impact now
// comes from the single X-TRK master record (stormMaster in storms.js), the same
// one the cards use, so the alerts and the cards can never disagree again.
function checkStormCellAlerts(){
  _pruneExpiredAlerts();
  if(!S._topStorms||!S._topStorms.length)return;
  const stormList=S._topStorms;
  const th=_loadStormThresholds();
  const anyOn=_STORM_ALERT_DEFS.some(d=>{const c=th[d.key];return c&&c.on});
  if(!anyOn)return;
  const now=Date.now();
  const batch=[];
  stormList.forEach(storm=>{
    const _m=(typeof stormMaster==='function')?stormMaster(storm):null;
    storm.impactPct=_m?_m.impactPct:0;
    storm.impactTier=_m?_m.impactTier:'none';
    const bandKey=bandForDbz(storm.dbz);
    if(!bandKey||!bandEnabled(bandKey))return;
    const cellKey='sc_'+Math.round(storm.bearing/10)+'_'+Math.round(storm.distance/3);
    const lastFired=_STORM_ALERT_COOLDOWN[cellKey]||0;
    if(now-lastFired<bandCadenceMin(bandKey)*60000)return;
    let allMatch=true;let bestMsg=null;
    _STORM_ALERT_DEFS.forEach(def=>{
      const cfg=th[def.key];
      if(!cfg||!cfg.on)return;
      const result=def.check(storm,cfg.val);
      if(!result){allMatch=false;return}
      if(!bestMsg)bestMsg=result;
    });
    if(!allMatch||!bestMsg)return;
    // v5.97: build the alert text from the SAME X-TRK/ETA math as the storm cards
    // (via _stormNotifMsg) instead of the old cone-angle impact %. `short` feeds
    // the phone notification, `full` the 📢 panel.
    // v5.98: ONLY a DIRECT impact (projected path within 1.5 mi X-TRK) fires an
    // alert — nearby (1.5–6 mi) and passing (>6 mi) cells are suppressed (they
    // still appear on the radar and Storms tab, just no push). Build the message
    // first to read its tier, then gate; the fallback key is 'direct' so a
    // missing helper can never silently mute every alert. Cooldown is set AFTER
    // the gate so a suppressed cell can still alert later if it turns direct.
    const nm=(typeof _stormNotifMsg==='function')?_stormNotifMsg(storm):{short:`🌩️ ${storm.dbz} dBZ storm cell`,full:`🌩️ ${storm.dbz} dBZ storm cell`,key:'direct',etaMin:null,arrMs:null};
    if(nm.key!=='direct')return;
    _STORM_ALERT_COOLDOWN[cellKey]=now;
    const etaMin=nm.etaMin,arrivalMs=nm.arrMs;
    let closingMph=0;try{const se=storm._eta||calcStormETA(storm);if(se)closingMph=se.closingSpeed||0}catch(e){}
    batch.push({storm,etaMin,arrivalMs,closingMph,short:nm.short,full:nm.full,key:nm.key});
    _stormAlertHistory.push({key:'stormCell',label:'Storm Cell',icon:'🌩️',msg:nm.full,val:storm.dbz,u:'dBZ',distance:storm.distance,impactPct:storm.impactPct||0,impactTier:storm.impactTier||'none',time:now,etaMin:etaMin,arrivalMs:arrivalMs,closingMph:closingMph,lat:storm.lat,lng:storm.lng,bearing:storm.bearing});
  });
  if(!batch.length)return;
  try{localStorage.setItem('st_stormAlertCooldown',JSON.stringify(_STORM_ALERT_COOLDOWN))}catch(e){}
  _saveStormAlertHistory();
  // v5.97: no more auto-popping toast — the alert goes straight to the phone
  // notification (short) and the 📢 log (full detail). App-open case: the bell
  // badge increments and the entry lands in the panel.
  if(batch.length===1){
    _sendBrowserNotification('Storm Cell Alert',batch[0].short,batch[0].full);
  }else{
    const topDbz=Math.max(...batch.map(b=>b.storm.dbz));
    const closestDist=Math.min(...batch.map(b=>b.storm.distance));
    const distStr=S.radarMetric?parseFloat((closestDist*1.60934).toFixed(1))+' km':parseFloat(closestDist.toFixed(1))+' mi';
    const bearings=batch.map(b=>b.storm.bearing);
    const avgBear=Math.round(Math.atan2(bearings.reduce((s,b)=>s+Math.sin(b*Math.PI/180),0)/bearings.length,bearings.reduce((s,b)=>s+Math.cos(b*Math.PI/180),0)/bearings.length)*180/Math.PI+360)%360;
    const dirFrom=degToDir(avgBear);
    const mv=(typeof getSteeringMv==='function')?getSteeringMv():S.stormMovement;
    let moveStr='';
    if(mv&&mv.speed>=2){
      const travelDir=degToDir(mv.direction);
      const spdU=S.radarMetric?'km/h':'mph';
      const spdV=S.radarMetric?Math.round(mv.speed*1.60934):Math.round(mv.speed);
      moveStr=` moving ${travelDir} (${Math.round(mv.direction)}°) ~${spdV} ${spdU}`;
    }
    // Lead with the most threatening cell (direct → nearby → passing, then
    // closest) and append its full detail so the panel entry is actionable.
    const rank={direct:0,nearby:1,passing:2};
    const lead=batch.slice().sort((a,b)=>((rank[a.key]!=null?rank[a.key]:3)-(rank[b.key]!=null?rank[b.key]:3))||a.storm.distance-b.storm.distance)[0];
    const shortMsg=`🌩️ ${batch.length} storm cells from the ${dirFrom} — strongest ${topDbz} dBZ, closest ${distStr}`;
    const fullMsg=`🌩️ ${batch.length} storm cells approaching from the ${dirFrom}${moveStr}. Strongest ${topDbz} dBZ; closest ${distStr} away.\nLead cell → ${lead.full.replace(/^🌩️\s*/,'')}`;
    _sendBrowserNotification('Storm Cell Alert',shortMsg,fullMsg);
  }
  if(S.activePage==='alerts')renderAlerts();
}
function renderStormCellAlertSettings(){
  const th=_loadStormThresholds();
  let html='';
  _STORM_ALERT_DEFS.forEach(def=>{
    const cfg=th[def.key]||{on:def.defOn,val:def.defVal};
    // stormDbz is the SHARED min-strength number, edited ONLY in 📡 Background
    // Storm Alerts → Min strength. Keep just the on/off toggle for the in-app
    // intensity alert here and show the shared value read-only, so there is a
    // single editable dBZ control. getConeMinDbz() is the source of truth.
    if(def.key==='stormDbz'){
      const shared=(typeof getConeMinDbz==='function')?getConeMinDbz():cfg.val;
      html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:6px">
        <label style="display:flex;align-items:center;gap:4px;font-size:0.7em;color:var(--text-muted);flex:1;min-width:0;cursor:pointer">
          <input type="checkbox" ${cfg.on?'checked':''} onchange="toggleStormAlert('stormDbz',this.checked)" class="accent-cyan-check">
          <span style="white-space:nowrap">${def.icon} ${def.label}</span>
        </label>
        <span style="font-size:0.68em;color:var(--text-muted);font-family:var(--font-mono);white-space:nowrap" title="Set in 📡 Background Storm Alerts → Min strength">≥ ${shared} dBZ</span>
      </div>`;
      return;
    }
    const step=def.step||1;
    const mn=(def.min!=null)?def.min:0;
    const maxAttr=(def.max!=null)?` max="${def.max}"`:'';
    let dispVal=cfg.val;
    if(def.min!=null&&dispVal<def.min)dispVal=def.min;
    if(def.max!=null&&dispVal>def.max)dispVal=def.max;
    html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:6px">
      <label style="display:flex;align-items:center;gap:4px;font-size:0.7em;color:var(--text-muted);flex:1;min-width:0;cursor:pointer">
        <input type="checkbox" ${cfg.on?'checked':''} onchange="toggleStormAlert('${def.key}',this.checked)" class="accent-cyan-check">
        <span style="white-space:nowrap">${def.icon} ${def.label}</span>
      </label>
      <input type="number" value="${dispVal}" step="${step}" min="${mn}"${maxAttr} style="width:60px;font-size:0.7em;padding:3px 4px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;text-align:center;font-family:var(--font-mono)" onchange="setStormAlertVal('${def.key}',this.value)" ${cfg.on?'':'disabled'}>
    </div>`;
  });
  return html;
}
function toggleStormAlert(key,on){
  const th=_loadStormThresholds();
  if(!th[key]){const def=_STORM_ALERT_DEFS.find(d=>d.key===key);th[key]={on,val:def?def.defVal:0}}
  else th[key].on=on;
  _saveStormThresholds(th);
  if(on)requestNotifPermission();
  const el=document.getElementById('storm-alert-settings');
  if(el)el.innerHTML=renderStormCellAlertSettings();
}
function setStormAlertVal(key,val){
  let n=parseFloat(val);if(isNaN(n)||n<0)return;
  const def=_STORM_ALERT_DEFS.find(d=>d.key===key);
  if(def&&(def.min!=null||def.max!=null)){
    const step=def.step||1;
    n=Math.round(n/step)*step;
    if(def.min!=null&&n<def.min)n=def.min;
    if(def.max!=null&&n>def.max)n=def.max;
  }
  const th=_loadStormThresholds();
  if(!th[key])th[key]={on:false,val:n};
  else th[key].val=n;
  _saveStormThresholds(th);
  // The shared min-strength dBZ (getConeMinDbz reads stormDbz.val) drives the
  // storm-track cone floor, so refresh the cones, the "in N cones" count and
  // this panel (to show the snapped value) when it changes.
  if(key==='stormDbz'){
    const sa=document.getElementById('storm-alert-settings');
    if(sa&&typeof renderStormCellAlertSettings==='function')sa.innerHTML=renderStormCellAlertSettings();
    try{if(S.map&&typeof plotStormTracks==='function'&&S._tracksMode!=='off')plotStormTracks(S.map);}catch(e){}
    try{if(S.activePage==='storms'&&typeof renderStorms==='function')renderStorms();}catch(e){}
    try{if(typeof updateStormBadges==='function')updateStormBadges();}catch(e){}
  }
}
function clearStormAlertHistory(){_stormAlertHistory=[];_saveStormAlertHistory();if(S.activePage==='alerts')renderAlerts();}

// ==========================================
// INTENSITY BANDS + RAIN-OVERHEAD ALERT
// ==========================================
// Four dBZ intensity bands (matching the app's storm color tiers). Each band has
// an on/off toggle (which GATES inbound storm alerts AND the rain-overhead alert
// at that intensity) and a re-notify cadence (5/10/15/30 min) that drives the
// cooldown for both. A master `rovOn` toggle controls the "rain right over you"
// alert, which fires from the radar value on the user's exact spot even when
// nothing is inbound. Stored in localStorage st_alertBands; rides the push
// subscription in thresholds.bands so the background scanner matches exactly.
const _ALERT_BAND_DEFS=[
  {key:'light',label:'Light',range:'20–29 dBZ',color:'#3aa0ff',min:20,max:29,defOn:true,defMin:10},
  {key:'moderate',label:'Moderate',range:'30–44 dBZ',color:'#36d96b',min:30,max:44,defOn:true,defMin:5},
  {key:'heavy',label:'Heavy',range:'45–54 dBZ',color:'#ffb300',min:45,max:54,defOn:true,defMin:5},
  {key:'severe',label:'Severe',range:'55+ dBZ',color:'#ff3b6b',min:55,max:9999,defOn:true,defMin:5}
];
const _BAND_CADENCE_OPTS=[0,5,10,15,30,45,60];
function _normAlertBands(o){
  o=o||{};
  const out={rovOn:o.rovOn!==false,rovMin:_BAND_CADENCE_OPTS.includes(o.rovMin)?o.rovMin:5,drizOn:o.drizOn===true,drizMin:_BAND_CADENCE_OPTS.includes(o.drizMin)?o.drizMin:15};
  _ALERT_BAND_DEFS.forEach(b=>{
    const c=o[b.key]||{};
    out[b.key]={on:c.on!==undefined?!!c.on:b.defOn,min:_BAND_CADENCE_OPTS.includes(c.min)?c.min:b.defMin};
  });
  return out;
}
function _loadAlertBands(){
  try{const s=localStorage.getItem('st_alertBands');if(s){const o=JSON.parse(s);if(o&&typeof o==='object')return _normAlertBands(o)}}catch(e){}
  return _normAlertBands({});
}
function _saveAlertBands(b){try{localStorage.setItem('st_alertBands',JSON.stringify(b))}catch(e){}}
function bandDef(key){return _ALERT_BAND_DEFS.find(b=>b.key===key)||null}
function bandForDbz(dbz){
  if(dbz==null||dbz<20)return null;
  for(const b of _ALERT_BAND_DEFS){if(dbz>=b.min&&dbz<=b.max)return b.key}
  return null;
}
function bandEnabled(key){const b=_loadAlertBands();return!!(key&&b[key]&&b[key].on)}
function bandCadenceMin(key){const b=_loadAlertBands();const def=bandDef(key);const c=b[key];return(c&&_BAND_CADENCE_OPTS.includes(c.min))?c.min:(def?def.defMin:5)}
function rovCadenceMin(){const b=_loadAlertBands();return _BAND_CADENCE_OPTS.includes(b.rovMin)?b.rovMin:5}
let _rainOverheadCooldown=0;
try{_rainOverheadCooldown=parseInt(localStorage.getItem('st_rovCooldown'))||0}catch(e){}
// Opt-in "Drizzle / very light" overhead alert for sub-band rain (10–19 dBZ),
// below the Light band floor. Its own on/off (drizOn) + cadence (drizMin).
const _DRIZ_MIN_DBZ=10;
let _drizzleCooldown=0;
try{_drizzleCooldown=parseInt(localStorage.getItem('st_drizCooldown'))||0}catch(e){}
function drizCadenceMin(){const b=_loadAlertBands();return _BAND_CADENCE_OPTS.includes(b.drizMin)?b.drizMin:15}
// "Raining right over you" — reads the shared radar-over-user band
// (rainOverUserNow) so it agrees with the conditions card, then fires when that
// dBZ falls in an enabled band, throttled by its own rovMin timer (not the band's
// cadence). Independent of any inbound storm.
function checkRainOverheadAlert(){
  const bands=_loadAlertBands();
  const ov=(typeof rainOverUserNow==='function')?rainOverUserNow():null;
  if(!ov||ov.maxDbz==null)return;
  const dbz=Math.round(ov.maxDbz);
  const now=Date.now();
  // Rain right over you — fires when the overhead dBZ lands in an enabled 20+ band.
  if(bands.rovOn){
    const key=bandForDbz(dbz);
    if(key&&bands[key]&&bands[key].on&&now-_rainOverheadCooldown>=rovCadenceMin()*60000){
      _rainOverheadCooldown=now;
      try{localStorage.setItem('st_rovCooldown',String(now))}catch(e){}
      const def=bandDef(key);
      const msg=`🌧️ Rain right over you — ${def.label} (${dbz} dBZ)`;
      toast(msg,6000);
      _sendBrowserNotification('Rain Overhead',msg);
      if(S.activePage==='alerts')renderAlerts();
    }
  }
  // Drizzle / very light — opt-in alert for sub-band rain (10–19 dBZ), own timer.
  if(bands.drizOn&&dbz>=_DRIZ_MIN_DBZ&&dbz<20&&now-_drizzleCooldown>=drizCadenceMin()*60000){
    _drizzleCooldown=now;
    try{localStorage.setItem('st_drizCooldown',String(now))}catch(e){}
    const msg=`🌦️ Drizzle right over you — very light (${dbz} dBZ)`;
    toast(msg,6000);
    _sendBrowserNotification('Drizzle Overhead',msg);
    if(S.activePage==='alerts')renderAlerts();
  }
}
function renderAlertBandSettings(){
  const b=_loadAlertBands();
  const opts=(sel)=>_BAND_CADENCE_OPTS.map(m=>`<option value="${m}"${m===sel?' selected':''}>${m===0?'every time':'every '+m+' min'}</option>`).join('');
  let html=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:6px">
    <label style="display:flex;align-items:center;gap:6px;font-size:0.72em;color:var(--text-primary);flex:1;min-width:0;cursor:pointer">
      <input type="checkbox" ${b.rovOn?'checked':''} onchange="toggleRainOverhead(this.checked)" class="accent-cyan-check">
      <span>🌧️ Rain right over you</span>
    </label>
    <select onchange="setRovCadence(this.value)" ${b.rovOn?'':'disabled'} style="font-size:0.7em;padding:3px 4px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;font-family:var(--font-mono)">${opts(b.rovMin)}</select>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:6px">
    <label style="display:flex;align-items:center;gap:6px;font-size:0.72em;color:var(--text-primary);flex:1;min-width:0;cursor:pointer">
      <input type="checkbox" ${b.drizOn?'checked':''} onchange="toggleDrizzle(this.checked)" class="accent-cyan-check">
      <span>🌦️ Drizzle / very light <span style="opacity:0.55">10–19 dBZ</span></span>
    </label>
    <select onchange="setDrizCadence(this.value)" ${b.drizOn?'':'disabled'} style="font-size:0.7em;padding:3px 4px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;font-family:var(--font-mono)">${opts(b.drizMin)}</select>
  </div>
  <div class="setting-hint" style="font-size:0.68em;margin-bottom:8px">Alert when rain is falling directly on your spot (read from radar) — even with no inbound storm, on its own timer above. The bands below set which storm intensities alert you and how often each can re-notify — they also gate inbound storm alerts.</div>`;
  _ALERT_BAND_DEFS.forEach(def=>{
    const c=b[def.key];
    html+=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;gap:6px">
      <label style="display:flex;align-items:center;gap:6px;font-size:0.7em;color:var(--text-muted);flex:1;min-width:0;cursor:pointer">
        <input type="checkbox" ${c.on?'checked':''} onchange="toggleAlertBand('${def.key}',this.checked)" class="accent-cyan-check">
        <span style="width:11px;height:11px;border-radius:3px;flex:0 0 auto;background:${def.color}"></span>
        <span style="white-space:nowrap">${def.label} <span style="opacity:0.55">${def.range}</span></span>
      </label>
      <select onchange="setAlertBandCadence('${def.key}',this.value)" ${c.on?'':'disabled'} style="font-size:0.7em;padding:3px 4px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;font-family:var(--font-mono)">${opts(c.min)}</select>
    </div>`;
  });
  return html;
}
function _refreshAlertBandUI(){const el=document.getElementById('alert-band-settings');if(el)el.innerHTML=renderAlertBandSettings()}
function _cadLbl(m){return m===0?'every time':'every '+m+' min'}
function _bandToast(msg){if(typeof toast==='function')toast(msg,2500)}
function toggleRainOverhead(on){const b=_loadAlertBands();b.rovOn=!!on;_saveAlertBands(b);if(on)requestNotifPermission();_refreshAlertBandUI();if(typeof syncPushAlerts==='function')syncPushAlerts();_bandToast(on?'🌧️ Rain right over you: ON':'Rain right over you: OFF')}
function toggleAlertBand(key,on){const b=_loadAlertBands();if(b[key])b[key].on=!!on;_saveAlertBands(b);if(on)requestNotifPermission();_refreshAlertBandUI();if(typeof syncPushAlerts==='function')syncPushAlerts();const d=bandDef(key);_bandToast((d?d.label:'Band')+(on?' alerts: ON':' alerts: OFF'))}
function setAlertBandCadence(key,val){const n=parseInt(val,10);if(!_BAND_CADENCE_OPTS.includes(n))return;const b=_loadAlertBands();if(b[key])b[key].min=n;_saveAlertBands(b);if(typeof syncPushAlerts==='function')syncPushAlerts();const d=bandDef(key);_bandToast((d?d.label:'Band')+' re-notify: '+_cadLbl(n))}
function setRovCadence(val){const n=parseInt(val,10);if(!_BAND_CADENCE_OPTS.includes(n))return;const b=_loadAlertBands();b.rovMin=n;_saveAlertBands(b);if(typeof syncPushAlerts==='function')syncPushAlerts();_bandToast('Rain overhead re-notify: '+_cadLbl(n))}
function toggleDrizzle(on){const b=_loadAlertBands();b.drizOn=!!on;_saveAlertBands(b);if(on)requestNotifPermission();_refreshAlertBandUI();if(typeof syncPushAlerts==='function')syncPushAlerts();_bandToast(on?'🌦️ Drizzle alerts: ON':'Drizzle alerts: OFF')}
function setDrizCadence(val){const n=parseInt(val,10);if(!_BAND_CADENCE_OPTS.includes(n))return;const b=_loadAlertBands();b.drizMin=n;_saveAlertBands(b);if(typeof syncPushAlerts==='function')syncPushAlerts();_bandToast('Drizzle re-notify: '+_cadLbl(n))}

// ==========================================
// RAIN ALERT
// ==========================================
const _RAIN_SENSITIVITY={light:20,moderate:30,heavy:40};
let _rainAlertCooldown=0;
try{_rainAlertCooldown=parseInt(localStorage.getItem('st_rainAlertCooldown'))||0}catch(e){}
let _rainAlertHistory=[];
try{const h=localStorage.getItem('st_rainAlertHistory');if(h)_rainAlertHistory=JSON.parse(h)}catch(e){}
function _loadRainAlertCfg(){
  try{const s=localStorage.getItem('st_rainAlertCfg');if(s)return JSON.parse(s)}catch(e){}
  return{on:false,sensitivity:'moderate',cooldownMin:30};
}
function _saveRainAlertCfg(cfg){try{localStorage.setItem('st_rainAlertCfg',JSON.stringify(cfg))}catch(e){}}
function _saveRainAlertHistory(){
  if(_rainAlertHistory.length>30)_rainAlertHistory=_rainAlertHistory.slice(-30);
  try{localStorage.setItem('st_rainAlertHistory',JSON.stringify(_rainAlertHistory))}catch(e){}
}
function checkRainAlert(){
  const cfg=_loadRainAlertCfg();
  if(!cfg.on)return;
  if(!S.weather||S.weather.precipitation==null)return;
  const precip=S.weather.precipitation; // mm in current observation period
  const threshMm={light:0.1,moderate:1.0,heavy:3.0};
  const thresh=threshMm[cfg.sensitivity]??1.0;
  if(precip<thresh)return;
  const now=Date.now();
  const cooldownMs=(cfg.cooldownMin||30)*60000;
  if(_rainAlertHistory.length){
    const last=_rainAlertHistory[_rainAlertHistory.length-1];
    if(now-last.ts<cooldownMs)return;
  }
  const precipStr=S.tempUnit===0?(precip/25.4).toFixed(2)+'"':precip.toFixed(1)+'mm';
  const label=cfg.sensitivity.charAt(0).toUpperCase()+cfg.sensitivity.slice(1);
  _sendBrowserNotification('🌧️ Rain Alert',`${label} rain detected: ${precipStr}`);
  toast(`🌧️ Rain: ${precipStr}`,5000);
  _rainAlertHistory.push({ts:now,precip,sensitivity:cfg.sensitivity});
  _saveRainAlertHistory();
  if(S.activePage==='alerts')renderAlerts();
}
function toggleRainAlert(on){
  const cfg=_loadRainAlertCfg();
  cfg.on=on;
  _saveRainAlertCfg(cfg);
  if(on)requestNotifPermission();
  syncRainAlertUI();
}
function setRainSensitivity(val){
  const cfg=_loadRainAlertCfg();
  cfg.sensitivity=val;
  _saveRainAlertCfg(cfg);
}
function setRainCooldown(val){
  const n=parseInt(val);if(isNaN(n)||n<5)return;
  const cfg=_loadRainAlertCfg();
  cfg.cooldownMin=n;
  _saveRainAlertCfg(cfg);
}
function syncRainAlertUI(){
  const cfg=_loadRainAlertCfg();
  const tog=document.getElementById('rain-alert-toggle');
  if(tog)tog.checked=cfg.on;
  const sens=document.getElementById('rain-alert-sensitivity');
  if(sens){sens.value=cfg.sensitivity;sens.disabled=!cfg.on}
  const cd=document.getElementById('rain-alert-cooldown');
  if(cd){cd.value=String(cfg.cooldownMin||30);cd.disabled=!cfg.on}
}
function clearRainAlertHistory(){_rainAlertHistory=[];_saveRainAlertHistory();if(S.activePage==='alerts')renderAlerts();}