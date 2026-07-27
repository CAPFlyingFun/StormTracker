// ==========================================
// ALERTS (NWS)
// ==========================================
function getAlertIcon(event,sev){
  const e=(event||'').toLowerCase();
  if(e.includes('tornado'))return'🌪️';
  if(e.includes('severe thunderstorm'))return'⛈️';
  if(e.includes('hurricane force wind'))return'🌀💨';
  if(e.includes('hurricane'))return'🌀';
  if(e.includes('tropical storm'))return'🌀';
  if(e.includes('storm surge'))return'🌊';
  if(e.includes('red flag'))return'🚩🔥';
  if(e.includes('fire weather'))return'🔥';
  if(e.includes('excessive heat'))return'🔥🌡️';
  if(e.includes('heat'))return'🌡️';
  if(e.includes('blizzard'))return'🌨️';
  if(e.includes('ice storm'))return'🧊';
  if(e.includes('snow squall'))return'🌬️❄️';
  if(e.includes('winter storm'))return'❄️';
  if(e.includes('winter weather'))return'🌨️';
  if(e.includes('extreme cold'))return'🥶';
  if(e.includes('cold weather'))return'🥶';
  if(e.includes('freeze'))return'🥶';
  if(e.includes('frost'))return'🥶';
  if(e.includes('extreme wind'))return'🌪️💨';
  if(e.includes('high wind'))return'💨';
  if(e.includes('wind chill'))return'🥶💨';
  if(e.includes('wind'))return'💨';
  if(e.includes('dense fog'))return'🌫️';
  if(e.includes('fog'))return'🌫️';
  if(e.includes('rip current'))return'🌊⚠️';
  if(e.includes('beach hazard'))return'🏖️⚠️';
  if(e.includes('tsunami'))return'🌊🔴';
  if(e.includes('flash flood'))return'🌊⚡';
  if(e.includes('coastal flood'))return'🌊';
  if(e.includes('river flood'))return'🏞️';
  if(e.includes('lakeshore flood'))return'🌊';
  if(e.includes('flood'))return'🌊';
  if(e.includes('gale'))return'🌊💨';
  if(e.includes('small craft'))return'⛵';
  if(e.includes('hazardous seas')||e.includes('heavy freezing spray'))return'🌊🧊';
  if(e.includes('special marine'))return'⚠️🌊';
  if(e.includes('storm warning'))return'⛈️🌊';
  if(e.includes('dust storm'))return'🏜️';
  if(e.includes('dust'))return'🏜️';
  if(e.includes('avalanche'))return'🏔️❄️';
  if(e.includes('lake effect snow'))return'🌨️💨';
  if(e.includes('air quality'))return'😷';
  if(e.includes('ashfall'))return'🌋';
  if(e.includes('hydrologic'))return'💧';
  const s=(sev||'').toLowerCase();
  return s==='extreme'?'🔴':s==='severe'?'🟠':s==='moderate'?'🟡':'🔵';
}
function _alertGlobeFile(event){
  const e=(event||'').toLowerCase();
  if(e.includes('tornado'))return'tornado';
  if(e.includes('severe thunderstorm'))return'thunderstorm-lightning';
  if(e.includes('hurricane')||e.includes('tropical storm'))return'hurricane';
  if(e.includes('storm surge'))return'storm-surge';
  if(e.includes('red flag')||e.includes('fire weather'))return'fire';
  if(e.includes('excessive heat')||e.includes('heat'))return'heat';
  if(e.includes('blizzard'))return'blizzard';
  if(e.includes('ice storm'))return'ice';
  if(e.includes('snow squall')||e.includes('winter storm')||e.includes('winter weather'))return'snow';
  if(e.includes('extreme cold')||e.includes('cold weather')||e.includes('freeze')||e.includes('frost'))return'ice';
  if(e.includes('wind chill'))return'wind-chill';
  if(e.includes('extreme wind')||e.includes('high wind')||e.includes('wind')||e.includes('gale'))return'wind';
  if(e.includes('dense fog')||e.includes('fog'))return'fog';
  if(e.includes('rip current')||e.includes('beach hazard'))return'rip-current';
  if(e.includes('tsunami'))return'tsunami';
  if(e.includes('flash flood')||e.includes('coastal flood')||e.includes('river flood')||e.includes('lakeshore flood')||e.includes('flood')||e.includes('hydrologic'))return'flood';
  if(e.includes('dust storm')||e.includes('dust'))return'dust-storm';
  if(e.includes('thunderstorm')||e.includes('storm warning'))return'thunderstorm';
  if(e.includes('small craft')||e.includes('hazardous seas'))return'small-craft';
  if(e.includes('special marine'))return'storm-surge';
  if(e.includes('special weather'))return'special-weather';
  if(e.includes('avalanche'))return'avalanche';
  if(e.includes('lake effect snow'))return'snow';
  if(e.includes('air quality')||e.includes('ashfall'))return'air-quality';
  if(e.includes('heavy freezing spray'))return'ice';
  return null;
}
function getAlertCardIcon(event,sev){
  const globeFile=_alertGlobeFile(event);
  if(!globeFile)return getAlertIcon(event,sev);
  const pack=typeof _getIconPack==='function'?_getIconPack():'globe';
  const sz=80;
  const sizeStyle=`width:${sz}px;height:${sz}px`;
  const imgStyle=`${sizeStyle};display:inline-block;vertical-align:middle;object-fit:cover;border-radius:50%`;
  if(pack==='globe-animated'){
    const vidSrc=`icons/globe-animated/${globeFile}.mp4`;
    const fallbackSrc=`icons/globe/${globeFile}.png`;
    const safeAlt=escHtml(event).replace(/'/g,'&#39;');
    const emojiFallback=getAlertIcon(event,sev).replace(/'/g,'&#39;');
    return`<video autoplay loop muted playsinline style="${imgStyle}" src="${vidSrc}" poster="${fallbackSrc}" onerror="this.outerHTML='<img src=&quot;${fallbackSrc}&quot; style=&quot;${imgStyle}&quot; alt=&quot;${safeAlt}&quot; onerror=&quot;this.outerHTML=\\&#39;${emojiFallback}\\&#39;&quot;>'"></video>`;
  }
  const imgSrc=`icons/globe/${globeFile}.png`;
  const emojiFallback=getAlertIcon(event,sev).replace(/'/g,'&#39;').replace(/"/g,'&quot;');
  return`<img src="${imgSrc}" style="${imgStyle}" alt="${escHtml(event)}" loading="lazy" onerror="this.outerHTML='${emojiFallback}'">`;
}
function fmtAlertTime(d){
  if(!(d instanceof Date)||isNaN(d))return'';
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day=days[d.getDay()];const mon=months[d.getMonth()];const date=d.getDate();
  return`${day} ${mon} ${date}, ${fmtClockShort(d)}`;
}
let _alertsTtl={ts:0,key:''};
async function fetchAlerts(force){
  const reqId=S._locReqId;
  // v6.57 (QW3): 5-min/locKey TTL (same pattern as fetchHazards) — tab switches
  // re-render from S.alerts instead of re-hitting api.weather.gov every time.
  const _now=Date.now(),_akey=(S.lat||0).toFixed(2)+','+(S.lon||0).toFixed(2);
  if(!force&&Array.isArray(S.alerts)&&_alertsTtl.key===_akey&&(_now-_alertsTtl.ts)<300000){renderAlerts();return}
  _alertsTtl={ts:_now,key:_akey};
  const el=document.getElementById('page-alerts');showSkel(el,3);
  if(!isNWSCoverage(S.lat,S.lon)){console.log('[non-US] Skipped: NWS alerts, SPC data, NWS warnings');S.alerts=[];if(reqId===S._locReqId)renderAlerts();return}
  try{
    const res=await fetch(`https://api.weather.gov/alerts/active?point=${S.lat.toFixed(4)},${S.lon.toFixed(4)}`,{headers:{'User-Agent':'StormTracker/1.50'},signal:AbortSignal.timeout(8000)});
    const data=await res.json();
    if(reqId!==S._locReqId)return;
    S.alerts=data.features||[];renderAlerts();if(_curLang!=='en')setTimeout(quickTranslate,300);
  }catch(e){if(reqId!==S._locReqId)return;S.alerts=[];renderAlerts()}
  if(S.alerts&&S.alerts.length)S._alertsShownOnce=false;
  if(typeof updateThreatTicker==='function')updateThreatTicker();
  _extractFloodAlerts();
  fetchSPCData().then(()=>{if(reqId!==S._locReqId)return;if(S.activePage==='alerts'){renderAlerts();renderHazards()}if(S.map){plotSPCWatchPolygons(S.map);plotNWSWarningPolygons(S.map);plotSPCReports(S.map)}}).catch(e=>console.warn('SPC fetch error:',e));
  fetchNHCData().then(()=>{if(reqId!==S._locReqId)return;if(S.map)plotNHCTracks(S.map);_nhcProximityCheck();if(S.activePage==='alerts'){renderAlerts();renderHazards()}if(S.activePage==='weather')_updateTropicalUI()}).catch(e=>console.warn('NHC fetch error:',e));
  if(reqId===S._locReqId&&S.activePage==='alerts')renderHazards();
}

function updateAlertBadge(){
  const badge=document.getElementById('nav-alert-badge');
  if(!badge)return;
  const n=(S.alerts||[]).length;
  badge.textContent=n;
  badge.style.background=n>0?'#ef4444':'#6b7280';
}
const _defaultAlertSecOrder=['nws','storms','station','hazards'];
function _getAlertSecOrder(){try{const o=JSON.parse(localStorage.getItem('st_alert_sec_order'));if(Array.isArray(o)&&o.length>=2){const filtered=o.filter(k=>_defaultAlertSecOrder.includes(k));_defaultAlertSecOrder.forEach(k=>{if(!filtered.includes(k))filtered.push(k)});return filtered}}catch(e){}return _defaultAlertSecOrder.slice()}
function moveAlertSection(key,dir){const full=_getAlertSecOrder();const visible=full.filter(k=>k==='nws'?isNWSCoverage(S.lat,S.lon):true);const vi=visible.indexOf(key);if(vi<0)return;const vni=vi+dir;if(vni<0||vni>=visible.length)return;const fi=full.indexOf(visible[vi]),fni=full.indexOf(visible[vni]);[full[fi],full[fni]]=[full[fni],full[fi]];try{localStorage.setItem('st_alert_sec_order',JSON.stringify(full));localStorage.setItem('st_alert_manual_order','1')}catch(e){}renderAlerts()}
function toggleAlertSection(key){const c=_getAlertCollapsed();if(c.includes(key))c.splice(c.indexOf(key),1);else c.push(key);try{localStorage.setItem('st_alert_collapsed',JSON.stringify(c))}catch(e){}renderAlerts()}
function _getAlertCollapsed(){try{const c=JSON.parse(localStorage.getItem('st_alert_collapsed'));if(Array.isArray(c))return c}catch(e){}return[]}
function _alertSecBtns(key){return`<div class="sec-btns" onclick="event.stopPropagation()"><button onclick="moveAlertSection('${key}',-1)" title="Move up">▲</button><button onclick="moveAlertSection('${key}',1)" title="Move down">▼</button></div>`}
function _getAlertSortOrder(){try{const v=localStorage.getItem('st_alert_sort');if(v==='asc')return'asc'}catch(e){}return'desc'}
function toggleAlertSort(){const cur=_getAlertSortOrder();const next=cur==='desc'?'asc':'desc';try{localStorage.setItem('st_alert_sort',next)}catch(e){}renderAlerts();if(typeof updateThreatTicker==='function')updateThreatTicker()}
function _sortAlertsByDate(alerts){const dir=_getAlertSortOrder();const sorted=alerts.slice().sort((a,b)=>{const ta=new Date(a.properties?.onset||a.properties?.effective||0).getTime();const tb=new Date(b.properties?.onset||b.properties?.effective||0).getTime();return dir==='desc'?ta-tb:tb-ta});return sorted}
function _applyAlertAutoPriority(){
  if(localStorage.getItem('st_alert_manual_order'))return;
  const hasNws=S.alerts&&S.alerts.length>0;
  const activeStorms=(S.storms||[]).filter(s=>s.impactTier==='high'||s.impactTier==='medium');
  const hasHighImpact=activeStorms.length>0;
  if(!hasNws&&!hasHighImpact)return;
  const order=[];
  if(hasNws)order.push('nws');
  if(hasHighImpact||(S.storms&&S.storms.length))order.push('storms');
  _defaultAlertSecOrder.forEach(k=>{if(!order.includes(k))order.push(k)});
  try{localStorage.setItem('st_alert_sec_order',JSON.stringify(order))}catch(e){}
  const coll=_getAlertCollapsed();
  const eq=_hazardData.earthquakes;const vol=_hazardData.volcanoes;const wf=_hazardData.wildfires;
  const eqLoaded=Array.isArray(eq);const volLoaded=Array.isArray(vol);const wfLoaded=Array.isArray(wf);
  const hazClear=eqLoaded&&eq.length===0&&volLoaded&&vol.length===0&&wfLoaded&&wf.length===0;
  if(hazClear&&!coll.includes('hazards')){coll.push('hazards');try{localStorage.setItem('st_alert_collapsed',JSON.stringify(coll))}catch(e){}}
}
function scrollToHazardSection(id){
  let target=document.getElementById(id);
  if(!target){
    const coll=_getAlertCollapsed();
    if(coll.length>0){try{localStorage.setItem('st_alert_collapsed',JSON.stringify([]))}catch(e){}renderAlerts();setTimeout(()=>scrollToHazardSection(id),150);return}
    return;
  }
  if(target.tagName==='DETAILS')target.open=true;
  target.scrollIntoView({behavior:'smooth',block:'start'});
  target.style.outline='2px solid var(--accent-cyan)';setTimeout(()=>{target.style.outline=''},2000);
}

function renderAlerts(){
  const el=document.getElementById('page-alerts');
  updateAlertBadge();
  if(!S.lat){el.innerHTML=`<div class="empty-state"><div class="empty-icon">📍</div><p>Set your location to check alerts.</p></div>`;return}
  _applyAlertAutoPriority();
  const coll=_getAlertCollapsed();
  const _isNWS=isNWSCoverage(S.lat,S.lon);
  const order=_getAlertSecOrder().filter(k=>_isNWS||k!=='nws');
  const alerts=S.alerts||[];
  const now=Date.now();
  if(alerts.length){S.alerts=alerts.filter(a=>{const e=a.properties?.ends||a.properties?.expires;return !e||new Date(e).getTime()>now});updateAlertBadge()}
  const sec={};

  if(_isNWS){ let nwsBody='';
  if(S.alerts&&S.alerts.length){
    const sortedAlerts=_sortAlertsByDate(S.alerts);
    const zoneAlerts=sortedAlerts.filter(a=>isUserInAlertZone(a));
    if(zoneAlerts.length)nwsBody+=`<div style="background:rgba(220,38,38,0.2);border:1px solid rgba(220,38,38,0.5);border-radius:8px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;gap:8px;animation:pulse 2s infinite"><span class="text-1-2">🔴</span><span style="font-size:0.8em;font-weight:700;color:#fca5a5">Your location is inside ${zoneAlerts.length} active alert zone${zoneAlerts.length>1?'s':''}: ${zoneAlerts.map(a=>escHtml(a.properties?.event||'Alert')).join(', ')}</span></div>`;
    nwsBody+=sortedAlerts.map((a,i)=>{
      const p=a.properties||{};const event=p.event||'Alert';const sev=(p.severity||'').toLowerCase();
      const evLow=event.toLowerCase();const isTorWarn=evLow.includes('tornado warning');const isSvrWarn=evLow.includes('severe thunderstorm warning');
      let cls=(sev==='extreme'||sev==='severe')?'':sev==='moderate'?'watch':'advisory';
      if(isTorWarn)cls='tornado-warning';else if(isSvrWarn)cls='svr-warning';
      const desc=reformatNwsTimes((p.description||'')).replace(/\n/g,'<br>');
      const sevIcon=getAlertCardIcon(event,sev);
      const inZone=isUserInAlertZone(a);
      const zoneBadge=inZone?'<span style="display:inline-block;background:#dc2626;color:#fff;font-size:0.55em;font-weight:700;padding:2px 6px;border-radius:10px;margin-left:6px;animation:pulse 2s infinite;vertical-align:middle">IN YOUR ZONE</span>':'';
      const hasOnset=!!p.onset;
      const effRaw=p.onset||p.effective;
      const effStr=effRaw?fmtAlertTime(new Date(effRaw)):'';
      const effLabel=hasOnset?'Begins:':'Effective:';
      const endRaw=p.ends||p.expires;
      const endStr=endRaw?fmtAlertTime(new Date(endRaw)):'';
      const endLabel=p.ends?'Ends:':'Expires:';
      const timeLine=(effStr||endStr)?`<div style="font-size:0.75em;color:var(--text-muted);margin:4px 0 2px;line-height:1.5">${effStr?'<span class="c-cyan">'+effLabel+'</span> '+effStr:''}${effStr&&endStr?' &nbsp;·&nbsp; ':''}${endStr?'<span style="color:var(--accent-orange)">'+endLabel+'</span> '+endStr:''}</div>`:'';
      const cdExp=p.ends||p.expires;
      return`<div class="nws-alert ${cls}" style="${inZone?'border-color:#dc2626;box-shadow:0 0 8px rgba(220,38,38,0.3)':''}"><div class="nws-alert-title flex-center-gap8">${sevIcon} <span>${event}${zoneBadge}</span></div>${timeLine}<div class="nws-alert-detail" style="white-space:pre-wrap;word-break:break-word">${desc}</div>${cdExp?`<div class="nws-alert-expires">⏱️ <span id="alert-cd-${i}" data-exp="${new Date(cdExp).getTime()}"></span></div>`:''}</div>`;
    }).join('');
  }else{
    nwsBody+=`<div class="alert-banner safe"><span class="alert-icon">✅</span><div class="alert-text"><span class="alert-title">No Active NWS Alerts</span><br>No NWS warnings or watches for your area.</div></div>`;
  }
  nwsBody+=_renderStormSurgeSection()+_renderTropicalSection()+_renderSPCWatchSection()+_renderSPCMDSection()+_renderSPCReportsSection();
  const nwsCnt=(S.alerts||[]).length;
  const _sortDir=_getAlertSortOrder();const _sortLabel=_sortDir==='desc'?'Soonest First':'Latest First';const _sortBtn=nwsCnt?`<button onclick="event.stopPropagation();toggleAlertSort()" title="Click to switch to ${_sortDir==='desc'?'latest':'soonest'} first" style="padding:2px 7px;font-size:0.6em;font-weight:600;border-radius:5px;cursor:pointer;border:1px solid rgba(0,229,255,0.25);background:rgba(0,229,255,0.08);color:var(--accent-cyan);white-space:nowrap">${_sortDir==='desc'?'⏶':'⏷'} ${_sortLabel}</button>`:'';
  sec.nws=`<div class="card mt-12" data-alert-sec="nws"><div class="card-title flex-between"  style="cursor:pointer" onclick="toggleAlertSection('nws')"><span><span class="icon">⚠️</span> NWS Alerts${nwsCnt?' ('+nwsCnt+')':''}</span><span class="flex-center-gap4">${_sortBtn}${_alertSecBtns('nws')}<span class="c-muted">${coll.includes('nws')?'▸':'▾'}</span></span></div>${coll.includes('nws')?'':nwsBody}</div>`; }

  { const hist=_wxAlertHistory.slice().reverse();
  let stBody='';
  if(!hist.length){
    const wxTh=_loadWxThresholds();const wxAny=Object.values(wxTh).some(t=>t&&t.on);
    stBody+=wxAny?`<div class="text-center-green-sm">✅ All clear — no weather thresholds exceeded</div>`:`<div class="text-center-muted" style="padding:12px">No station alerts yet. Enable thresholds in Settings ⚙️ → Weather Station Alerts 🔔</div>`;
  }else{
    hist.slice(0,20).forEach(h=>{
      const d=new Date(h.time);const tStr=fmtClock(d)+' · '+d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
      stBody+=`<div style="padding:8px 10px;border-bottom:1px solid var(--border-subtle);font-size:0.78em"><div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><span>${h.icon||'🔔'}</span><span class="fw600-primary">${h.label}</span><span class="alert-row-time">${tStr}</span></div><div style="color:var(--text-secondary);font-size:0.9em">${h.msg.replace('🔔 ','')}</div></div>`;
    });
  }
  const stClear=hist.length?'<button onclick="event.stopPropagation();clearWxAlertHistory()" style="font-size:0.7em;padding:2px 8px;background:rgba(255,51,85,0.1);color:var(--accent-red);border:1px solid rgba(255,51,85,0.3);border-radius:6px;cursor:pointer;font-weight:600;text-transform:none;letter-spacing:0">Clear</button>':'';
  sec.station=`<div class="card mt-12" data-alert-sec="station"><div class="card-title flex-between"  style="cursor:pointer" onclick="toggleAlertSection('station')"><span><span class="icon">🔔</span> Station Alerts${hist.length?' ('+hist.length+')':''}</span><span class="flex-center-gap4">${stClear}${_alertSecBtns('station')}<span class="c-muted">${coll.includes('station')?'▸':'▾'}</span></span></div>${coll.includes('station')?'':stBody}</div>`; }

  { function _stormThreatCmp(a,b){const dd=(b.val||0)-(a.val||0);if(dd!==0)return dd;const di=(b.impactPct||0)-(a.impactPct||0);if(di!==0)return di;return(a.distance||0)-(b.distance||0)}
  const stormHist=_stormAlertHistory.slice().reverse();
  let scBody='';
  if(!stormHist.length){
    const stTh=_loadStormThresholds();const stAny=Object.values(stTh).some(t=>t&&t.on);
    scBody+=stAny?`<div class="text-center-green-sm">✅ All clear — no storms currently match your thresholds</div>`:`<div class="text-center-muted" style="padding:12px">No storm cell alerts yet. Enable thresholds in Settings ⚙️ → Storm Cell Alerts 🌩️</div>`;
  }else{
    const batches=[];
    stormHist.forEach(h=>{
      const last=batches.length?batches[batches.length-1]:null;
      if(last&&Math.abs(h.time-last.time)<5000){last.items.push(h)}
      else{batches.push({time:h.time,items:[h]})}
    });
    batches.sort((a,b)=>{
      const at=a.items.slice().sort(_stormThreatCmp)[0];
      const bt=b.items.slice().sort(_stormThreatCmp)[0];
      return _stormThreatCmp(at,bt);
    });
    batches.slice(0,20).forEach((batch,bi)=>{
      const items=batch.items.slice().sort(_stormThreatCmp);
      const d=new Date(batch.time);
      const tStr=fmtClock(d)+' · '+d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
      if(items.length===1){
        const h=items[0];
        const tierColors={high:'#eab308',medium:'#06b6d4',low:'#ec4899',none:'#22c55e'};
        const tc=tierColors[h.impactTier]||'#666';
        let etaHtml='';
        const hDist=h.distance||0;
        if(h.arrivalMs){
          const remSec=Math.max(0,Math.round((h.arrivalMs-Date.now())/1000));
          if(remSec>0)etaHtml=`<span class="tier-eta-cd" data-tier-target="${h.arrivalMs}" style="font-size:0.8em;color:#ffcc00;font-weight:600;margin-left:6px">⏱ <b>${fmtCountdown(remSec)}</b> (${fmtClockShort(new Date(h.arrivalMs))})</span>`;
          else if(hDist<1.5)etaHtml=`<span style="font-size:0.8em;color:var(--text-muted);margin-left:6px">⏱ arrived ${fmtClockShort(new Date(h.arrivalMs))}</span>`;
        }
        let sDistLive='';
        const sCMph=h.closingMph||0;
        if(sCMph>0&&h.arrivalMs&&h.arrivalMs>Date.now()){
          const sCurDist=Math.max(0,(h.arrivalMs-Date.now())/3600000*sCMph);
          const sDv=S.radarMetric?(sCurDist*1.60934).toFixed(1)+' km':sCurDist.toFixed(1)+' mi';
          sDistLive=`<span data-dist-mi="1" data-closing-mph="${sCMph}" data-target-ms="${h.arrivalMs}" style="font-size:0.8em;color:#60a5fa;font-weight:600;margin-left:4px">📏${sDv}</span>`;
        }else if(hDist!=null&&hDist>=0){
          const sDv=S.radarMetric?(hDist*1.60934).toFixed(1)+' km':hDist.toFixed(1)+' mi';
          sDistLive=`<span style="font-size:0.8em;color:#60a5fa;font-weight:600;margin-left:4px">📏${sDv}</span>`;
        }
        const hasLoc=h.lat!=null&&(Date.now()-(h.time||0)<1800000);
        const rowClick=hasLoc?`onclick="flyToStormAlert(${h.lat},${h.lng})" style="padding:8px 10px;border-bottom:1px solid var(--border-subtle);font-size:0.78em;cursor:pointer"`:`style="padding:8px 10px;border-bottom:1px solid var(--border-subtle);font-size:0.78em"`;
        scBody+=`<div ${rowClick}>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap">
            <span>🌩️</span>
            <span class="fw600-primary">${h.val} dBZ</span>
            ${h.impactPct>0?`<span style="font-size:0.8em;padding:1px 6px;border-radius:8px;background:${tc}18;color:${tc};font-weight:600">${h.impactPct}%</span>`:''}
            ${etaHtml}${sDistLive}${hasLoc?'<span style="font-size:0.75em;color:var(--accent-cyan);margin-left:4px" title="Tap to show on radar">📍</span>':''}
            <span class="alert-row-time">${tStr}</span>
          </div>
          <div style="color:var(--text-secondary);font-size:0.9em">${h.msg.replace('🌩️ ','').replace(/ · ETA .+$/,'')}</div>
        </div>`;
      }else{
        const dbzMin=Math.min(...items.map(h=>h.val)),dbzMax=Math.max(...items.map(h=>h.val));
        const rawDistMin=Math.min(...items.map(h=>h.distance||0)),rawDistMax=Math.max(...items.map(h=>h.distance||0));
        const mFactor=S.radarMetric?1.60934:1;
        const distMin=(rawDistMin*mFactor).toFixed(1),distMax=(rawDistMax*mFactor).toFixed(1);
        const peakImp=Math.max(...items.map(h=>h.impactPct||0));
        const peakTier=items.reduce((t,h)=>{const ord={high:3,medium:2,low:1,none:0};return(ord[h.impactTier]||0)>(ord[t]||0)?h.impactTier:t},'none');
        const tierColors={high:'#eab308',medium:'#06b6d4',low:'#ec4899',none:'#22c55e'};
        const tc=tierColors[peakTier]||'#666';
        const best=items.reduce((a,b)=>(b.time||0)>(a.time||0)?b:a,items[0]);
        const distU=S.radarMetric?'km':'mi';
        const hasLoc=best.lat!=null&&(Date.now()-(best.time||0)<1800000);
        let grpEtaHtml='';
        const bestEta=items.filter(h=>h.arrivalMs&&h.arrivalMs>Date.now()).sort((a,b)=>a.arrivalMs-b.arrivalMs)[0];
        if(bestEta){
          const remSec=Math.max(0,Math.round((bestEta.arrivalMs-Date.now())/1000));
          grpEtaHtml=`<span class="tier-eta-cd" data-tier-target="${bestEta.arrivalMs}" style="font-size:0.8em;color:#ffcc00;font-weight:600">⏱ <b>${fmtCountdown(remSec)}</b></span>`;
        }
        const gid='sa-grp-'+bi;
        scBody+=`<div style="border-bottom:1px solid var(--border-subtle)">
          <div style="padding:8px 10px;font-size:0.78em;display:flex;align-items:center;gap:6px;flex-wrap:wrap${hasLoc?';cursor:pointer':''}"${hasLoc?` onclick="flyToStormAlert(${best.lat},${best.lng})"`:''}>
            <span>🌩️</span>
            <span class="fw700-primary">${items.length} storm cells</span>
            <span class="c-secondary">${dbzMin===dbzMax?dbzMin:dbzMin+'–'+dbzMax} dBZ</span>
            <span class="c-secondary">${distMin===distMax?distMin:distMin+'–'+distMax} ${distU}</span>
            ${peakImp>0?`<span style="font-size:0.8em;padding:1px 6px;border-radius:8px;background:${tc}18;color:${tc};font-weight:600">${peakImp}%</span>`:''}
            ${grpEtaHtml}
            ${hasLoc?'<span style="font-size:0.75em;color:var(--accent-cyan);margin-left:4px" title="Tap to show on radar">📍</span>':''}
            <span class="alert-row-time">${tStr}</span>
            <span class="sa-chev" onclick="event.stopPropagation();const d=document.getElementById('${gid}');d.style.display=d.style.display==='none'?'block':'none';this.textContent=d.style.display==='none'?'▸':'▾'" style="color:var(--text-muted);font-size:0.8em;cursor:pointer;padding:2px 6px">▸</span>
          </div>
          <div id="${gid}" style="display:none;padding:0 10px 6px 24px">`;
        items.forEach(h=>{
          const hTc=tierColors[h.impactTier]||'#666';
          const hNav=h.lat!=null?`<span onclick="event.stopPropagation();flyToStormAlert(${h.lat},${h.lng})" style="cursor:pointer;font-size:0.75em;color:var(--accent-cyan);margin-left:3px" title="Show on radar">📍</span>`:'';
          let hEta='';
          const hcDist=h.distance||0;
          if(h.arrivalMs){
            const rs=Math.max(0,Math.round((h.arrivalMs-Date.now())/1000));
            if(rs>0)hEta=`<span class="tier-eta-cd" data-tier-target="${h.arrivalMs}" style="font-size:0.85em;color:#ffcc00;font-weight:600">⏱${fmtCountdown(rs)}</span>`;
            else if(hcDist<1.5)hEta=`<span style="font-size:0.85em;color:var(--text-muted)">⏱arrived</span>`;
          }
          let hDistLive='';
          const cMph=h.closingMph||0;
          if(cMph>0&&h.arrivalMs&&h.arrivalMs>Date.now()){
            const curDist=Math.max(0,(h.arrivalMs-Date.now())/3600000*cMph);
            const dv=S.radarMetric?(curDist*1.60934).toFixed(1)+' km':curDist.toFixed(1)+' mi';
            hDistLive=`<span data-dist-mi="1" data-closing-mph="${cMph}" data-target-ms="${h.arrivalMs}" style="font-size:0.85em;color:#60a5fa;font-weight:600">📏${dv}</span>`;
          }else if(hcDist!=null&&hcDist>=0){
            const dv=S.radarMetric?(hcDist*1.60934).toFixed(1)+' km':hcDist.toFixed(1)+' mi';
            hDistLive=`<span style="font-size:0.85em;color:#60a5fa;font-weight:600">📏${dv}</span>`;
          }
          scBody+=`<div style="font-size:0.9em;padding:3px 0;color:var(--text-secondary);border-top:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:4px;flex-wrap:wrap">
            <span>${h.val} dBZ · ${((h.distance||0)*mFactor).toFixed(1)} ${distU}${h.impactPct>0?' · <span style="color:'+hTc+'">'+h.impactPct+'%</span>':''}</span>${hEta}${hDistLive}${hNav}
          </div>`;
        });
        scBody+=`</div></div>`;
      }
    });
  }
  const scClear=stormHist.length?'<button onclick="event.stopPropagation();clearStormAlertHistory()" style="font-size:0.7em;padding:2px 8px;background:rgba(255,51,85,0.1);color:var(--accent-red);border:1px solid rgba(255,51,85,0.3);border-radius:6px;cursor:pointer;font-weight:600;text-transform:none;letter-spacing:0">Clear</button>':'';
  sec.storms=`<div class="card mt-12" data-alert-sec="storms"><div class="card-title flex-between"  style="cursor:pointer" onclick="toggleAlertSection('storms')"><span><span class="icon">🌩️</span> Storm Cell Alerts${stormHist.length?' ('+stormHist.length+')':''}</span><span class="flex-center-gap4">${scClear}${_alertSecBtns('storms')}<span class="c-muted">${coll.includes('storms')?'▸':'▾'}</span></span></div>${coll.includes('storms')?'':scBody}</div>`; }

  /* Rain Alerts section hidden — feature removed for now */

  sec.hazards=`<div class="card mt-12" data-alert-sec="hazards"><div class="card-title flex-between"  style="cursor:pointer" onclick="toggleAlertSection('hazards')"><span><span class="icon">🌍</span> Environmental Hazards</span><span class="flex-center-gap4">${_alertSecBtns('hazards')}<span class="c-muted">${coll.includes('hazards')?'▸':'▾'}</span></span></div>${coll.includes('hazards')?'':'<div id="hazards-section"></div>'}</div>`;

  let html='';
  order.forEach(k=>{if(sec[k])html+=sec[k]});
  el.innerHTML=html;
  if(S.alerts&&S.alerts.length)startAlertCountdowns();
  renderHazards();
}

// ==========================================
// ENVIRONMENTAL HAZARDS
// ==========================================
let _hazardData={earthquakes:null,floods:null,wildfires:null,drought:null,riverGauges:null,volcanoes:null,_lastFetch:0};

function getEqRadius(){return parseInt(localStorage.getItem('eqRadius')||'200')}
function setEqRadius(val){
  localStorage.setItem('eqRadius',String(val));
  _hazardData._lastFetch=0;_hazardData.earthquakes=null;
  if(S.activePage==='alerts')fetchHazards();
  toast('🌍 Earthquake radius: '+val+' mi');
}

function _extractUSState(){
  const name=S.locName||'';
  const stateMap={'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY'};
  const abbrs=Object.values(stateMap);
  const parts=name.split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
  for(const p of parts){if(abbrs.includes(p.toUpperCase()))return p.toUpperCase()}
  for(const [full,abbr] of Object.entries(stateMap)){if(name.toLowerCase().includes(full.toLowerCase()))return abbr}
  return null;
}

async function _fetchRecentPrecip(){
  try{
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${S.lat}&longitude=${S.lon}&daily=precipitation_sum&past_days=30&forecast_days=0&timezone=auto`;
    const res=await fetch(url,{signal:AbortSignal.timeout(6000)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    const daily=data.daily?.precipitation_sum||[];
    const total30=daily.reduce((s,v)=>s+(v||0),0);
    const monthNormals=[3.5,3.2,4.1,3.8,4.3,4.2,4.5,4.3,3.9,3.5,3.5,3.4];
    const month=new Date().getMonth();
    const normalMo=monthNormals[month];
    const normalMm=normalMo*25.4;
    const pctNormal=normalMm>0?Math.round((total30/normalMm)*100):null;
    const totalIn=(total30/25.4).toFixed(2);
    _hazardData.recentPrecip={total30,totalIn,pctNormal,normalIn:normalMo.toFixed(1)};
  }catch(e){_hazardData.recentPrecip=null;console.log('Precip fetch error:',e.message)}
}

async function fetchHazards(){
  if(!S.lat||!S.lon)return;
  const reqId=S._locReqId;
  const now=Date.now();
  const locKey=S.lat.toFixed(2)+','+S.lon.toFixed(2);
  if(now-_hazardData._lastFetch<300000&&_hazardData.earthquakes!==null&&_hazardData._locKey===locKey)return;
  if(reqId!==S._locReqId)return;
  _hazardData._lastFetch=now;
  _hazardData._locKey=locKey;
  const isUS=isUSLocation(S.lat,S.lon);
  _hazardData._isUS=isUS;
  if(!isUS){
    console.log('[non-US] Skipped: drought, river gauges, SPC data');
    _hazardData.drought=null;
    _hazardData.riverGauges=[];
  }
  await Promise.allSettled([
    _fetchEarthquakes(),
    _fetchVolcanoes(),
    _fetchWildfires(),
    isUS?_fetchDrought():Promise.resolve(),
    isUS?_fetchRiverGauges():Promise.resolve(),
    _fetchRecentPrecip(),
    isUS?fetchSPCData():Promise.resolve(),
    fetchNHCData()
  ]);
  if(reqId===S._locReqId&&S.activePage==='alerts')renderHazards();
}

async function _fetchEarthquakes(){
  try{
    const res=await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',{signal:AbortSignal.timeout(8000)});
    const data=await res.json();
    const quakes=(data.features||[]).filter(f=>f.geometry&&f.geometry.coordinates&&f.properties).map(f=>{
      const [lon,lat,depth]=f.geometry.coordinates;
      const dist=haversine(S.lat,S.lon,lat,lon);
      return{mag:f.properties.mag||0,place:f.properties.place||'Unknown',time:f.properties.time,depth:depth||0,dist:dist,lat,lon,url:f.properties.url};
    }).filter(q=>q.dist<=getEqRadius()).sort((a,b)=>a.dist-b.dist).slice(0,15);
    _hazardData.earthquakes=quakes;
  }catch(e){_hazardData.earthquakes=[];console.log('Earthquake fetch error:',e.message)}
}

async function _fetchVolcanoes(){
  try{
    const res=await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes',{signal:AbortSignal.timeout(8000)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    const volcanoes=(data.events||[]).map(e=>{
      const geo=e.geometry&&e.geometry.length?e.geometry[e.geometry.length-1]:null;
      if(!geo||!geo.coordinates)return null;
      const [lon,lat]=geo.coordinates;
      const dist=haversine(S.lat,S.lon,lat,lon);
      const title=e.title||'Unknown Volcano';
      const nameParts=title.replace(' Volcano','').split(',');
      const name=nameParts[0].trim();
      const country=nameParts.length>1?nameParts[nameParts.length-1].trim():'';
      return{name,country,dist,lat,lon,date:geo.date?geo.date.substring(0,10):'',title};
    }).filter(v=>v&&v.dist<=500).sort((a,b)=>a.dist-b.dist).slice(0,10);
    _hazardData.volcanoes=volcanoes;
  }catch(e){_hazardData.volcanoes=[];console.log('Volcano fetch error:',e.message)}
}

const _stateFips={AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56',DC:'11',PR:'72'};

async function _fetchDrought(){
  const st=_extractUSState()||'';
  try{
    const d=0.01;
    const url=`https://ndmcgeodata.unl.edu/cgi-bin/mapserv.exe?map=/ms4w/apps/usdm/map/usdm_current_wms.map&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=usdm_current&QUERY_LAYERS=usdm_current&STYLES=default&CRS=EPSG:4326&BBOX=${S.lat-d},${S.lon-d},${S.lat+d},${S.lon+d}&WIDTH=2&HEIGHT=2&I=1&J=1&INFO_FORMAT=text/plain&FEATURE_COUNT=10`;
    const res=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const txt=await res.text();
    const dmMatches=[...txt.matchAll(/DM\s*=\s*'(\d+)'/g)].map(m=>parseInt(m[1]));
    if(dmMatches.length===0){
      _hazardData.drought={state:st,level:-1,levelName:'None',d0:0,d1:0,d2:0,d3:0,d4:0};
      return;
    }
    const maxDM=Math.max(...dmMatches);
    const names=['D0 Abnormally Dry','D1 Moderate Drought','D2 Severe Drought','D3 Extreme Drought','D4 Exceptional Drought'];
    const d0=dmMatches.includes(0)?1:0,d1=dmMatches.includes(1)?1:0,d2=dmMatches.includes(2)?1:0,d3=dmMatches.includes(3)?1:0,d4=dmMatches.includes(4)?1:0;
    _hazardData.drought={state:st,level:maxDM,levelName:names[maxDM]||'Unknown',d0,d1,d2,d3,d4,layers:dmMatches.sort()};
  }catch(e){
    _hazardData.drought={error:'cors',state:st};
    console.log('Drought fetch error:',e.message);
  }
}

async function _fetchWildfires(){
  const isUS=isUSLocation(S.lat,S.lon);
  if(isUS){
    try{
      const url=`https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?where=1%3D1&outFields=poly_IncidentName,attr_IncidentName,poly_GISAcres,poly_DateCurrent,attr_PercentContained,attr_FireDiscoveryDateTime,attr_InitialLatitude,attr_InitialLongitude,attr_POOState&returnGeometry=false&f=json&resultRecordCount=2000`;
      const res=await fetch(url,{signal:AbortSignal.timeout(10000)});
      if(!res.ok)throw new Error('HTTP '+res.status);
      const data=await res.json();
      if(data.error){_hazardData.wildfires={error:'api'};console.log('Wildfire API error:',data.error.message);return}
      const maxDist=300;
      const fires=(data.features||[]).map(f=>{
        const a=f.attributes;
        const lat=a.attr_InitialLatitude;
        const lon=a.attr_InitialLongitude;
        const dist=(lat&&lon)?haversine(S.lat,S.lon,lat,lon):9999;
        return{name:a.poly_IncidentName||a.attr_IncidentName||'Unknown Fire',acres:a.poly_GISAcres?Math.round(a.poly_GISAcres):null,contained:a.attr_PercentContained,date:a.poly_DateCurrent||a.attr_FireDiscoveryDateTime,dist,state:a.attr_POOState||'',source:'nifc'};
      }).filter(f=>f.name&&f.name!=='Unknown Fire'&&f.dist<=maxDist).sort((a,b)=>a.dist-b.dist).slice(0,10);
      _hazardData.wildfires=fires;
    }catch(e){_hazardData.wildfires=[];console.log('Wildfire fetch error (NIFC):',e.message)}
  }else{
    try{
      const res=await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&limit=200',{signal:AbortSignal.timeout(8000)});
      if(!res.ok)throw new Error('HTTP '+res.status);
      const data=await res.json();
      const maxDist=300;
      const fires=(data.events||[]).map(e=>{
        const geo=e.geometry&&e.geometry.length?e.geometry[e.geometry.length-1]:null;
        if(!geo||!geo.coordinates)return null;
        const [lon,lat]=geo.coordinates;
        const dist=haversine(S.lat,S.lon,lat,lon);
        const title=e.title||'Unknown Fire';
        const nameParts=title.split(',');
        const name=nameParts[0].trim();
        const country=nameParts.length>1?nameParts[nameParts.length-1].trim():'';
        return{name,country,dist,date:geo.date?new Date(geo.date).getTime():null,source:'eonet'};
      }).filter(f=>f&&f.dist<=maxDist).sort((a,b)=>a.dist-b.dist).slice(0,10);
      _hazardData.wildfires=fires;
    }catch(e){_hazardData.wildfires=[];console.log('Wildfire fetch error (EONET):',e.message)}
  }
}

async function _fetchRiverGauges(){
  try{
    const bBox=`${(S.lon-0.5).toFixed(4)},${(S.lat-0.5).toFixed(4)},${(S.lon+0.5).toFixed(4)},${(S.lat+0.5).toFixed(4)}`;
    const url=`https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bBox}&parameterCd=00065&siteStatus=active&siteType=ST`;
    const res=await fetch(url,{signal:AbortSignal.timeout(8000)});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    const ts=data.value?.timeSeries||[];
    const gauges=ts.map(s=>{
      const info=s.sourceInfo||{};
      const name=info.siteName||'Unknown Gauge';
      const lat2=parseFloat(info.geoLocation?.geogLocation?.latitude||0);
      const lon2=parseFloat(info.geoLocation?.geogLocation?.longitude||0);
      const dist=haversine(S.lat,S.lon,lat2,lon2);
      const vals=s.values?.[0]?.value||[];
      const latest=vals.length>0?vals[vals.length-1]:null;
      const height=latest?parseFloat(latest.value):null;
      const time=latest?latest.dateTime:null;
      return{name,dist,height,time,siteCode:info.siteCode?.[0]?.value||''};
    }).filter(g=>g.height!==null&&!isNaN(g.height)&&g.dist<=50).sort((a,b)=>a.dist-b.dist).slice(0,5);
    _hazardData.riverGauges=gauges;
  }catch(e){_hazardData.riverGauges=[];console.log('River gauge fetch error:',e.message)}
}

function _renderSPCWatchSection(){
  if (!isUSLocation(S.lat, S.lon)) return '';
  const watches = _spcData.watches;
  if (!watches || !watches.length) {
    return `<details id="hz-severe-wx" class="card mt-12" open><summary class="card-title detail-summary"><span><span class="icon">🌪️</span> SPC Watches</span><span class="c-muted-sm">▾</span></summary>
      <div class="text-center-green-sm">✅ No active SPC watches for the US</div></details>`;
  }
  const userWatches = watches.filter(w => _isPointInSpcWatch(S.lat, S.lon, w));
  const otherWatches = watches.filter(w => !_isPointInSpcWatch(S.lat, S.lon, w));
  let html = `<details id="hz-severe-wx" class="card mt-12" open><summary class="card-title detail-summary"><span><span class="icon">🌪️</span> SPC Watches (${watches.length})</span><span class="c-muted-sm">▾</span></summary>`;
  if (userWatches.length) {
    html += `<div class="alert-banner danger" style="margin-bottom:8px;border-left:4px solid ${userWatches.some(w => w.type === 'tornado') ? '#ff1744' : '#ff9800'}"><span class="alert-icon">${userWatches.some(w => w.type === 'tornado') ? '🌪️' : '⛈️'}</span><div class="alert-text"><span class="alert-title">You are in a ${userWatches.some(w => w.type === 'tornado') ? 'TORNADO' : 'SEVERE THUNDERSTORM'} WATCH</span><br>Conditions are favorable for severe weather in your area.</div></div>`;
  }
  const allW = [...userWatches, ...otherWatches];
  allW.forEach(w => {
    const isTor = w.type === 'tornado';
    const cls = isTor ? 'tor-watch' : 'svr-watch';
    const icon = isTor ? '🌪️' : '⛈️';
    const label = isTor ? 'Tornado Watch' : 'Severe Thunderstorm Watch';
    const inArea = _isPointInSpcWatch(S.lat, S.lon, w);
    let expStr = '';
    if (w.expTime) {
      const remain = w.expTime - Date.now();
      if (remain > 0) {
        const hrs = Math.floor(remain / 3600000);
        const mins = Math.floor((remain % 3600000) / 60000);
        expStr = hrs > 0 ? hrs + 'h:' + String(mins).padStart(2,'0') + 'm remaining' : mins + 'm remaining';
      }
    }
    html += `<div class="spc-watch-card ${cls}">
      <div class="flex-label-row">
        <span style="font-size:1.1em">${icon}</span>
        <span style="font-weight:700;font-size:0.9em;color:${isTor ? '#ff1744' : '#ff9800'}">${label} #${w.number}</span>
        ${inArea ? '<span style="font-size:0.6em;background:rgba(255,23,68,0.2);color:#ff4444;padding:1px 6px;border-radius:8px;font-weight:700">YOUR AREA</span>' : ''}
      </div>
      <div style="font-size:0.75em;color:var(--text-secondary)">${w.states || ''}</div>
      ${expStr ? `<div style="font-size:0.7em;color:var(--text-muted);margin-top:2px">⏱️ ${expStr}</div>` : ''}
    </div>`;
  });
  html += `<div class="text-hint-right">Data: NOAA Storm Prediction Center</div></details>`;
  return html;
}
function _renderSPCReportsSection(){
  if (!isUSLocation(S.lat, S.lon)) return '';
  const reports = _spcData.reports;
  if (!reports || !reports.length) {
    return `<details class="card mt-12" open><summary class="card-title detail-summary"><span><span class="icon">📋</span> SPC Storm Reports (Today)</span><span class="c-muted-sm">▾</span></summary>
      <div class="text-center-green-sm">✅ No severe weather reports today nearby</div></details>`;
  }
  const nearby = reports.filter(r => r.dist <= 200);
  if (!nearby.length) {
    return `<details class="card mt-12" open><summary class="card-title detail-summary"><span><span class="icon">📋</span> SPC Storm Reports (Today)</span><span class="c-muted-sm">▾</span></summary>
      <div class="text-center-green-sm">✅ No severe weather reports within 200 mi today</div></details>`;
  }
  const tornadoes = nearby.filter(r => r.type === 'tornado');
  const hail = nearby.filter(r => r.type === 'hail');
  const wind = nearby.filter(r => r.type === 'wind');
  const toggleChecked = S._showSPCReports ? 'checked' : '';
  let html = `<details class="card mt-12" open><summary class="card-title detail-summary"><span><span class="icon">📋</span> SPC Storm Reports (${nearby.length} today)</span><span style="display:flex;align-items:center;gap:6px"><label onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;font-size:0.65em;font-weight:500;color:var(--text-muted);cursor:pointer"><span>Map</span><input type="checkbox" ${toggleChecked} onchange="toggleSPCReports(this.checked)" class="accent-cyan-check"></label><span class="c-muted-sm">▾</span></span></summary>`;
  const summary = [];
  if (tornadoes.length) summary.push(`🌪️ ${tornadoes.length} tornado${tornadoes.length > 1 ? 'es' : ''}`);
  if (hail.length) summary.push(`🧊 ${hail.length} hail`);
  if (wind.length) summary.push(`💨 ${wind.length} wind`);
  html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;padding:0 4px">${summary.map(s => `<span style="font-size:0.75em;font-weight:600;color:var(--text-secondary)">${s}</span>`).join('<span class="c-muted">·</span>')}</div>`;
  nearby.slice(0, 15).forEach(r => {
    const icon = r.type === 'tornado' ? '🌪️' : r.type === 'hail' ? '🧊' : '💨';
    const color = r.type === 'tornado' ? '#ff1744' : r.type === 'hail' ? '#00e5ff' : '#ff9800';
    const hailIn = r.type === 'hail' && r.magnitude ? (parseFloat(r.magnitude) / 100).toFixed(2) : r.magnitude;
    const label = r.type === 'tornado' ? 'Tornado' : r.type === 'hail' ? `Hail (${hailIn}")` : `Wind (${r.magnitude} mph)`;
    const distStr = S.radarMetric ? Math.round(r.dist * 1.60934) + ' km' : Math.round(r.dist) + ' mi';
    html += `<div style="padding:6px 8px;border-left:3px solid ${color};background:${color}08;border-radius:0 6px 6px 0;margin-bottom:4px;font-size:0.75em">
      <div style="display:flex;align-items:center;gap:6px">
        <span>${icon}</span>
        <span class="fw700-primary">${label}</span>
        <span class="auto-muted-sm">${distStr} · ${r.time} UTC</span>
      </div>
      <div style="font-size:0.9em;color:var(--text-secondary);margin-top:2px">${r.location}, ${r.state}${r.comment ? ' — ' + r.comment : ''}</div>
    </div>`;
  });
  html += `<div class="text-hint-right">Data: NOAA Storm Prediction Center · Today's reports</div></details>`;
  return html;
}
function toggleSPCReports(on){
  S._showSPCReports = on;
  try { localStorage.setItem('st_spc_reports', on ? '1' : '0'); } catch(e) {}
  if (S.map) plotSPCReports(S.map);
  toast(on ? 'SPC reports shown on map' : 'SPC reports hidden from map');
}
function _renderSPCMDSection(){
  if (!isUSLocation(S.lat, S.lon)) return '';
  const allMds = _spcData.md;
  const mds = (allMds||[]).filter(md => {
    if (md._pts && md._pts.length) {
      let minD = Infinity;
      for (const p of md._pts) { const d = haversine(S.lat, S.lon, p.lat, p.lon); if (d < minD) minD = d; }
      return minD <= 200;
    }
    if (md.lat != null && md.lon != null) return haversine(S.lat, S.lon, md.lat, md.lon) <= 200;
    return false;
  });
  if (!mds.length) {
    return `<details class="card mt-12" open><summary class="card-title detail-summary"><span><span class="icon">📝</span> Mesoscale Discussions</span><span class="c-muted-sm">▾</span></summary>
      <div class="text-center-green-sm">✅ No active mesoscale discussions nearby</div></details>`;
  }
  let html = `<details class="card mt-12" open><summary class="card-title detail-summary"><span><span class="icon">📝</span> Mesoscale Discussions (${mds.length})</span><span class="c-muted-sm">▾</span></summary>`;
  mds.forEach(md => {
    const isTor = md.type === 'tornado';
    const isSvr = md.type === 'severe';
    const color = isTor ? '#ff1744' : isSvr ? '#ff9800' : '#00e5ff';
    const icon = isTor ? '🌪️' : isSvr ? '⛈️' : '📝';
    html += `<div class="spc-watch-card md" style="border-left:3px solid ${color}">
      <div class="flex-label-row">
        <span class="text-1">${icon}</span>
        <span style="font-weight:700;font-size:0.85em;color:var(--text-primary)">MD #${md.number}</span>
        ${md.validFrom ? `<span style="font-size:0.65em;color:var(--text-muted);margin-left:auto">${md.validFrom} - ${md.validTo}</span>` : ''}
      </div>
      ${md.concerning ? `<div style="font-size:0.75em;color:${color};font-weight:600">${md.concerning}</div>` : ''}
      ${md.area ? `<div style="font-size:0.7em;color:var(--text-secondary);margin-top:2px">📍 ${md.area}</div>` : ''}
    </div>`;
  });
  html += `<div class="text-hint-right">Data: NOAA Storm Prediction Center</div></details>`;
  return html;
}
function _extractFloodAlerts(){
  const floodEvents=['Flood','Flash Flood','Coastal Flood','Storm Surge','River Flood','Lakeshore Flood','Hydrologic'];
  const fireEvents=['Fire Weather','Red Flag','Fire'];
  const floods=[];
  const fireAlerts=[];
  (S.alerts||[]).forEach(a=>{
    const event=(a.properties?.event||'').toLowerCase();
    if(floodEvents.some(e=>event.includes(e.toLowerCase())))floods.push(a);
    if(fireEvents.some(e=>event.includes(e.toLowerCase())))fireAlerts.push(a);
  });
  _hazardData.floods=floods;
  _hazardData.fireAlerts=fireAlerts;
}

function renderHazards(){
  const el=document.getElementById('hazards-section');
  if(!el)return;
  if(!S.lat){el.innerHTML='';return}
  const isUS=isUSLocation(S.lat,S.lon);
  const sources=isUS?'USGS, NWS, NIFC, USDM & NASA':'USGS, NASA EONET';
  const _hzStale=_isOffline&&_hazardData._lastFetch?`<div style="text-align:center;padding:4px 10px;margin:0 0 8px;background:rgba(180,83,9,0.15);border:1px solid rgba(251,191,36,0.25);border-radius:8px;font-size:0.65em;color:#fbbf24">📡 Cached data · Last updated ${_relativeTime(_hazardData._lastFetch)}</div>`:'';
  let html=`<div style="font-size:0.65em;color:var(--text-muted);margin-bottom:10px">Real-time hazard monitoring from ${sources}</div>${_hzStale}`;
  html+=_renderHazardSummary();
  html+=_renderTropicalHazardSection();
  html+=_renderEarthquakeSection();
  html+=_renderVolcanoSection();
  if(isUS)html+=_renderFloodSection();
  html+=_renderWildfireSection();
  if(isUS)html+=_renderDroughtSection();
  else html+=_renderPrecipOnlySection();
  const _hzTime=_hazardData._lastFetch?new Date(_hazardData._lastFetch).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'';
  html+=_hzTime?`<div style="text-align:center;font-size:0.6em;color:var(--text-muted);margin-top:8px">Data as of ${_hzTime}</div>`:'';
  html+=`<div style="text-align:center;margin-top:6px"><button id="btn-refresh-hazards" onclick="_refreshHazardsBtn()" style="font-size:0.7em;padding:4px 14px;background:rgba(0,229,255,0.08);color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.2);border-radius:6px;cursor:pointer;font-weight:600">🔄 Refresh Hazards</button></div>`;
  el.innerHTML=html;
}

async function _refreshHazardsBtn(){
  const btn=document.getElementById('btn-refresh-hazards');
  if(btn){btn.disabled=true;btn.textContent='Updating...';btn.style.opacity='0.5'}
  _hazardData._lastFetch=0;
  try{await fetchHazards();renderHazards()}catch(e){console.log('Hazard refresh error:',e.message)}
  finally{const b=document.getElementById('btn-refresh-hazards');if(b){b.disabled=false;b.textContent='🔄 Refresh Hazards';b.style.opacity='1'}}
}

function _renderHazardSummary(){
  const isUS=isUSLocation(S.lat,S.lon);
  const eq=_hazardData.earthquakes;
  const vol=_hazardData.volcanoes;
  const fl=_hazardData.floods;
  const wf=_hazardData.wildfires;
  const dr=_hazardData.drought;
  const items=[];
  if(eq===null)items.push({icon:'🔄',label:'Earthquakes',status:'Loading...',color:'#666',target:'hz-earthquakes'});
  else if(eq.length===0)items.push({icon:'✅',label:'Earthquakes',status:'Clear',color:'#22c55e',target:'hz-earthquakes'});
  else{const maxMag=Math.max(...eq.map(q=>q.mag));items.push({icon:maxMag>=5?'🔴':maxMag>=4?'🟠':'🟡',label:'Earthquakes',status:`${eq.length} nearby`,color:maxMag>=5?'#ef4444':maxMag>=4?'#f97316':'#eab308',target:'hz-earthquakes'})}
  if(vol===null)items.push({icon:'🔄',label:'Volcanoes',status:'Loading...',color:'#666',target:'hz-volcanoes'});
  else if(vol.length===0)items.push({icon:'✅',label:'Volcanoes',status:'Clear',color:'#22c55e',target:'hz-volcanoes'});
  else items.push({icon:'🌋',label:'Volcanoes',status:`${vol.length} active`,color:'#ef4444',target:'hz-volcanoes'});
  if(isUS){
    if(!fl||fl.length===0)items.push({icon:'✅',label:'Flooding',status:'Clear',color:'#22c55e',target:'hz-flooding'});
    else items.push({icon:'🔴',label:'Flooding',status:`${fl.length} alert${fl.length>1?'s':''}`,color:'#ef4444',target:'hz-flooding'});
  }
  if(wf===null)items.push({icon:'🔄',label:'Wildfires',status:'Loading...',color:'#666',target:'hz-wildfires'});
  else if(wf&&wf.error)items.push({icon:'⚠️',label:'Wildfires',status:'Data unavailable',color:'#888',target:'hz-wildfires'});
  else if(!wf||wf.length===0)items.push({icon:'✅',label:'Wildfires',status:'Clear',color:'#22c55e',target:'hz-wildfires'});
  else items.push({icon:'🔥',label:'Wildfires',status:`${wf.length} active`,color:'#ff6600',target:'hz-wildfires'});
  if(isUS){
    const droughtStatus=_getDroughtStatus(dr);
    droughtStatus.target='hz-drought';
    items.push(droughtStatus);
    const spcW=_spcData.watches;
    const hookCount=(S.storms||[]).filter(s=>s._rotation).length;
    if(!spcW)items.push({icon:'🔄',label:'Severe Wx',status:'Loading...',color:'#666',target:'hz-severe-wx'});
    else{
      const localWatches=spcW.filter(w=>_isPointInSpcWatch(S.lat,S.lon,w));
      const localTor=localWatches.filter(w=>w.type==='tornado').length;
      const localSvr=localWatches.filter(w=>w.type!=='tornado').length;
      if(!localWatches.length&&!hookCount){
        if(spcW.length){
          items.push({icon:'🟢',label:'Severe Wx',status:`Clear (${spcW.length} US)`,color:'#22c55e',target:'hz-severe-wx'});
        }else{
          items.push({icon:'✅',label:'Severe Wx',status:'Clear',color:'#22c55e',target:'hz-severe-wx'});
        }
      }else{
        const parts=[];
        if(localTor)parts.push(`TOR Watch`);if(localSvr)parts.push(`SVR Watch`);if(hookCount)parts.push(`${hookCount} rotation`);
        const topColor=localTor||hookCount?'#ff1744':localSvr?'#ff9800':'#eab308';
        const sevTarget=hookCount&&!localWatches.length?null:'hz-severe-wx';
        const sevAction=hookCount&&!localWatches.length?"switchPage('storms')":null;
        items.push({icon:localTor||hookCount?'🌪️':'⛈️',label:'Severe Wx',status:parts.join(' · '),color:topColor,target:sevTarget,action:sevAction});
      }
    }
  }
  const nhc=_getFilteredSystems();
  if(nhc===null)items.push({icon:'🔄',label:'Tropical',status:'Loading...',color:'#666',target:'hz-tropical'});
  else if(!nhc.length)items.push({icon:'✅',label:'Tropical',status:S._nhcRegionFilter!=='all'?'Clear (filtered)':'Clear',color:'#22c55e',target:'hz-tropical'});
  else{
    const inCone=nhc.filter(s=>s._inCone).length;
    const hasWarning=nhc.some(s=>s._tropAlerts&&s._tropAlerts.warnings.some(w=>w.inZone));
    const hasWatch=nhc.some(s=>s._tropAlerts&&s._tropAlerts.watches.some(w=>w.inZone));
    const nearCount=nhc.filter(s=>s.dist!=null&&s.dist<=S._nhcProxRadius).length;
    const maxCat=Math.max(...nhc.map(s=>(s.category||{num:-1}).num));
    let statusText,topColor,icon;
    if(hasWarning){statusText='⚠️ WARNING';topColor='#ff1744';icon='🔴'}
    else if(hasWatch){statusText='👁️ WATCH';topColor='#ffc107';icon='🟡'}
    else if(inCone){statusText=`${inCone} IN CONE`;topColor='#ff9800';icon='🟠'}
    else if(nearCount){statusText=`Tracking · ${nearCount} near`;topColor=maxCat>=3?'#ff5722':maxCat>=1?'#ffc107':'#4fc3f7';icon='🌀'}
    else{statusText=`${nhc.length} active`;topColor='#4fc3f7';icon='🌀'}
    items.push({icon,label:'Tropical',status:statusText,color:topColor,target:'hz-tropical'});
  }
  const cols=items.length<=3?'1fr 1fr 1fr':'1fr 1fr';
  let html=`<div style="display:grid;grid-template-columns:${cols};gap:6px;margin-bottom:12px">`;
  items.forEach(it=>{
    const clickAction=it.action||((it.target)?`scrollToHazardSection('${it.target}')`:``);
    html+=`<div onclick="${clickAction}" style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:8px${clickAction?';cursor:pointer':''}">
      <span class="text-1">${it.icon}</span>
      <div><div style="font-size:0.7em;font-weight:600;color:var(--text-primary)">${it.label}</div>
      <div style="font-size:0.6em;color:${it.color};font-weight:600">${it.status}</div></div>
    </div>`;
  });
  html+=`</div>`;
  return html;
}

function _getDroughtStatus(dr){
  if(!dr)return{icon:'🔄',label:'Drought',status:'Loading...',color:'#666'};
  if(dr.error==='cors')return{icon:'⚠️',label:'Drought',status:'Data unavailable',color:'#888'};
  if(dr.error==='nodata')return{icon:'⚠️',label:'Drought',status:'No current data',color:'#888'};
  if(dr.level<0)return{icon:'✅',label:'Drought',status:'None',color:'#22c55e'};
  if(dr.level>=4)return{icon:'🔴',label:'Drought',status:'D4 Exceptional',color:'#800000'};
  if(dr.level>=3)return{icon:'🔴',label:'Drought',status:'D3 Extreme',color:'#ef4444'};
  if(dr.level>=2)return{icon:'🟠',label:'Drought',status:'D2 Severe',color:'#f97316'};
  if(dr.level>=1)return{icon:'🟡',label:'Drought',status:'D1 Moderate',color:'#eab308'};
  return{icon:'🟢',label:'Drought',status:'D0 Abn. Dry',color:'#a3e635'};
}

function _renderEarthquakeSection(){
  const eq=_hazardData.earthquakes;
  const radius=getEqRadius();
  let html=`<details id="hz-earthquakes" class="mb-8"><summary class="summary-cyan">
    <span>🌍 Earthquakes (within ${radius} mi)</span>
    <span class="auto-muted-sm">▸</span>
  </summary><div class="py-4">`;
  if(eq===null){html+=`<div class="text-center-muted">Loading earthquake data...</div>`}
  else if(eq.length===0){html+=`<div class="text-center-ok-sm">✅ No significant earthquakes nearby in the last 24 hours</div>`}
  else{
    eq.forEach(q=>{
      const magColor=q.mag>=6?'#ef4444':q.mag>=5?'#f97316':q.mag>=4?'#eab308':q.mag>=3?'#06b6d4':'#22c55e';
      const timeAgo=_timeAgo(q.time);
      const distStr=S.radarMetric?Math.round(q.dist*1.60934)+' km':Math.round(q.dist)+' mi';
      html+=`<div class="detail-row">
        <div style="min-width:38px;text-align:center;padding:3px 6px;background:${magColor}18;border:1px solid ${magColor}44;border-radius:6px;color:${magColor};font-weight:700;font-size:1.05em">M${q.mag.toFixed(1)}</div>
        <div class="flex-1" style="min-width:0"><div style="color:var(--text-primary);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${q.place||'Unknown'}</div>
        <div style="color:var(--text-muted);font-size:0.9em">${distStr} away · ${Math.round(q.depth)} km deep · ${timeAgo}</div></div>
      </div>`;
    });
  }
  html+=`<div class="text-hint-right">Data: USGS · M2.5+ in last 24h</div>`;
  html+=`</div></details>`;
  return html;
}

function _renderVolcanoSection(){
  const vol=_hazardData.volcanoes;
  let html=`<details id="hz-volcanoes" class="mb-8"><summary class="summary-cyan">
    <span>🌋 Volcanic Activity</span>
    <span class="auto-muted-sm">▸</span>
  </summary><div class="py-4">`;
  if(vol===null){html+=`<div class="text-center-muted">Loading volcano data...</div>`}
  else if(!vol||vol.length===0){html+=`<div class="text-center-ok-sm">✅ No active volcanic events within 500 mi</div>`}
  else{
    vol.forEach(v=>{
      const distStr=S.radarMetric?Math.round(v.dist*1.60934)+' km':Math.round(v.dist)+' mi';
      const locLabel=v.country?` · ${v.country}`:'';
      const dateStr=v.date?` · Last report: ${v.date}`:'';
      const distColor=v.dist<100?'#ef4444':v.dist<200?'#f97316':'#eab308';
      html+=`<div style="padding:6px 8px;border-left:3px solid ${distColor};margin-bottom:6px;background:${distColor}08;border-radius:0 6px 6px 0;font-size:0.75em">
        <div class="fw700-primary">🌋 ${v.name}</div>
        <div style="color:var(--text-secondary);font-size:0.9em;margin-top:2px">${distStr} away${locLabel}${dateStr}</div>
      </div>`;
    });
  }
  html+=`<div class="text-hint-right">Data: NASA EONET</div>`;
  html+=`</div></details>`;
  return html;
}

function _renderPrecipOnlySection(){
  const precip=_hazardData.recentPrecip;
  if(!precip)return '';
  const pctNum=parseFloat(precip.pctNormal)||0;
  const pctColor=pctNum<50?'#ef4444':pctNum<80?'#f97316':pctNum>150?'#3b82f6':pctNum>120?'#06b6d4':'#22c55e';
  const pctLabel=pctNum<50?'Severe deficit':pctNum<80?'Below normal':pctNum>150?'Well above normal':pctNum>120?'Above normal':'Normal';
  return `<details id="hz-drought" class="mb-8"><summary class="summary-cyan">
    <span>🌧️ Precipitation</span>
    <span class="auto-muted-sm">▸</span>
  </summary><div class="py-4">
    <div style="padding:6px 8px;font-size:0.75em;display:flex;align-items:center;gap:10px">
      <div style="min-width:55px;text-align:center;padding:4px 8px;background:${pctColor}18;border:1px solid ${pctColor}44;border-radius:6px;color:${pctColor};font-weight:700">${precip.pctNormal}%</div>
      <div><div style="color:var(--text-primary);font-weight:600">${pctLabel}</div>
      <div class="c-muted-85">${precip.totalIn} in last 30d (normal: ${precip.normalIn} in)</div></div>
    </div>
    <div class="text-hint-right">Data: Open-Meteo Archive</div>
  </div></details>`;
}

function _renderFloodSection(){
  const fl=_hazardData.floods||[];
  const gauges=_hazardData.riverGauges||[];
  let html=`<details id="hz-flooding" class="mb-8"><summary class="summary-cyan">
    <span>🌊 Flood Monitoring</span>
    <span class="auto-muted-sm">▸</span>
  </summary><div class="py-4">`;
  if(fl.length===0){html+=`<div class="text-center-ok-sm">✅ No flood warnings, watches, or advisories active</div>`}
  else{
    fl.forEach(a=>{
      const p=a.properties||{};
      const event=p.event||'Flood Alert';
      const sev=(p.severity||'').toLowerCase();
      const sevColor=sev==='extreme'?'#ef4444':sev==='severe'?'#f97316':sev==='moderate'?'#eab308':'#06b6d4';
      const sevIcon=getAlertIcon(event,sev);
      const desc=(p.description||'').split('\n')[0].substring(0,150);
      const expires=p.expires?new Date(p.expires):null;
      html+=`<div style="padding:6px 8px;border-left:3px solid ${sevColor};margin-bottom:6px;background:${sevColor}08;border-radius:0 6px 6px 0;font-size:0.75em">
        <div class="fw700-primary">${sevIcon} ${event}</div>
        <div style="color:var(--text-secondary);font-size:0.9em;margin-top:2px">${desc}${desc.length>=150?'...':''}</div>
        ${expires?`<div style="color:var(--text-muted);font-size:0.85em;margin-top:2px;font-family:var(--font-mono)">⏱️ Expires: ${expires.toLocaleString()}</div>`:''}
      </div>`;
    });
  }
  if(gauges.length>0){
    html+=`<div style="font-size:0.7em;font-weight:600;color:var(--accent-blue);margin:8px 8px 4px;padding-top:6px;border-top:1px solid var(--border-subtle)">📊 Nearby Stream Gauges (USGS)</div>`;
    gauges.forEach(g=>{
      const distStr=S.radarMetric?Math.round(g.dist*1.60934)+' km':g.dist.toFixed(1)+' mi';
      const heightColor=g.height>15?'#ef4444':g.height>10?'#f97316':g.height>5?'#eab308':'#22c55e';
      const timeStr=g.time?new Date(g.time).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):'';
      html+=`<div style="padding:4px 8px;font-size:0.72em;display:flex;align-items:center;gap:6px;border-bottom:1px solid rgba(255,255,255,0.04)">
        <div style="min-width:48px;text-align:center;padding:2px 6px;background:${heightColor}18;border:1px solid ${heightColor}44;border-radius:5px;color:${heightColor};font-weight:700;font-size:0.95em">${g.height.toFixed(1)} ft</div>
        <div class="flex-1" style="min-width:0"><div style="color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${g.name}</div>
        <div class="c-muted-85">${distStr} away${timeStr?' · '+timeStr:''}</div></div>
      </div>`;
    });
  }
  html+=`<div class="text-hint-right">Data: NWS Active Alerts${gauges.length?' + USGS Water Services':''}</div>`;
  html+=`</div></details>`;
  return html;
}

function _renderWildfireSection(){
  const wf=_hazardData.wildfires||[];
  const fireAlerts=_hazardData.fireAlerts||[];
  let html=`<details id="hz-wildfires" class="mb-8"><summary class="summary-cyan">
    <span>🔥 Wildfire Activity</span>
    <span class="auto-muted-sm">▸</span>
  </summary><div class="py-4">`;
  if(fireAlerts.length>0){
    html+=`<div style="font-size:0.7em;font-weight:600;color:#ff6600;margin-bottom:6px;padding:0 8px">⚠️ Fire Weather Alerts (${fireAlerts.length})</div>`;
    fireAlerts.forEach(a=>{
      const p=a.properties||{};
      html+=`<div style="padding:4px 8px;border-left:3px solid #ff6600;margin-bottom:4px;background:rgba(255,102,0,0.06);border-radius:0 6px 6px 0;font-size:0.72em">
        <div class="fw700-primary">🔥 ${p.event||'Fire Weather Alert'}</div>
        <div style="color:var(--text-secondary);font-size:0.9em;margin-top:2px">${(p.description||'').split('\n')[0].substring(0,120)}...</div>
      </div>`;
    });
  }
  const wfArr=Array.isArray(wf)?wf:[];
  const wfError=wf&&wf.error;
  const isUS=isUSLocation(S.lat,S.lon);
  if(wfError){html+=`<div class="text-center-muted">⚠️ Wildfire data unavailable</div>`}
  else if(wfArr.length===0&&fireAlerts.length===0){html+=`<div class="text-center-ok-sm">✅ No active wildfires or fire weather alerts nearby</div>`}
  else if(wfArr.length>0){
    const headerLabel=isUS?`Active Fire Perimeters (${wfArr.length})`:`Active Wildfires (${wfArr.length})`;
    html+=`<div style="font-size:0.7em;font-weight:600;color:#ff6600;margin-bottom:6px;padding:0 8px">${headerLabel}</div>`;
    wfArr.forEach(f=>{
      if(f.source==='eonet'){
        const distStr=Math.round(f.dist)+' mi away';
        const locLabel=f.country?` · ${f.country}`:'';
        html+=`<div class="detail-row">
          <span class="text-1-2">🔥</span>
          <div class="flex-1"><div class="fw600-primary">${f.name}</div>
          <div style="color:var(--text-muted);font-size:0.9em">${distStr}${locLabel}</div></div>
        </div>`;
      }else{
        const acresStr=f.acres?f.acres.toLocaleString()+' acres':'Size unknown';
        const containStr=f.contained!=null?Math.round(f.contained)+'% contained':'Containment unknown';
        const distStr=f.dist&&f.dist<9999?Math.round(f.dist)+' mi away':'';
        html+=`<div class="detail-row">
          <span class="text-1-2">🔥</span>
          <div class="flex-1"><div class="fw600-primary">${f.name}${f.state?' <span style="color:var(--text-muted);font-weight:400;font-size:0.85em">('+f.state.replace('US-','')+')</span>':''}</div>
          <div style="color:var(--text-muted);font-size:0.9em">${acresStr} · ${containStr}${distStr?' · '+distStr:''}</div></div>
        </div>`;
      }
    });
  }
  const wfSource=isUS?'NIFC + NWS':'NASA EONET';
  html+=`<div class="text-hint-right">Data: ${wfSource}</div>`;
  html+=`</div></details>`;
  return html;
}

function _renderDroughtSection(){
  const dr=_hazardData.drought;
  const precip=_hazardData.recentPrecip;
  const isUS=isUSLocation(S.lat,S.lon);
  let html=`<details id="hz-drought" class="mb-8"><summary class="summary-cyan">
    <span>☀️ Drought Monitor</span>
    <span class="auto-muted-sm">▸</span>
  </summary><div class="py-4">`;
  if(!isUS){html+=`<div class="text-center-muted">Drought Monitor covers US locations only</div>`}
  else if(!dr){html+=`<div class="text-center-muted">Loading drought data...</div>`}
  else if(dr.error==='nodata'){
    html+=`<div class="text-center-muted">
      No drought data available for today's date.<br>
      <a href="https://droughtmonitor.unl.edu/CurrentMap/StateDroughtMonitor.aspx?${dr.state||'FL'}" target="_blank" rel="noopener" class="c-cyan">View latest on US Drought Monitor →</a>
    </div>`;
  }else if(dr.error==='cors'){
    html+=`<div class="text-center-muted">
      Drought data requires direct access.<br>
      <a href="https://droughtmonitor.unl.edu/CurrentMap/StateDroughtMonitor.aspx?${dr.state||'FL'}" target="_blank" rel="noopener" class="c-cyan">View US Drought Monitor →</a>
    </div>`;
  }else if(dr.error==='state'){html+=`<div class="text-center-muted">Drought data not available for this location</div>`}
  else{
    const allLevels=[
      {dm:-1,label:'No Drought',color:'#22c55e'},
      {dm:0,label:'D0 Abnormally Dry',color:'#ffe040'},
      {dm:1,label:'D1 Moderate Drought',color:'#ffaa00'},
      {dm:2,label:'D2 Severe Drought',color:'#ff6600'},
      {dm:3,label:'D3 Extreme Drought',color:'#ff0000'},
      {dm:4,label:'D4 Exceptional Drought',color:'#800000'}
    ];
    const cur=allLevels.find(l=>l.dm===dr.level)||allLevels[0];
    html+=`<div style="padding:4px 8px;font-size:0.75em">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:8px">${dr.state} — Your Location</div>
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(0,0,0,0.15);border-radius:8px;border-left:4px solid ${cur.color};margin-bottom:8px">
        <div style="width:16px;height:16px;border-radius:50%;background:${cur.color};flex-shrink:0"></div>
        <div><div style="font-weight:700;color:${cur.color};font-size:1.1em">${cur.label}</div>
        ${dr.level>=0?'<div style="color:var(--text-muted);font-size:0.85em;margin-top:2px">Drought severity at your exact location</div>':''}</div>
      </div>`;
    if(dr.layers&&dr.layers.length>0){
      html+=`<div style="font-size:0.85em;color:var(--text-muted);margin-bottom:6px">Active drought layers here:</div>`;
      dr.layers.forEach(dm=>{
        const lv=allLevels.find(l=>l.dm===dm);
        if(lv)html+=`<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:0.9em">
          <div style="width:10px;height:10px;border-radius:2px;background:${lv.color};flex-shrink:0"></div>
          <span class="c-secondary">${lv.label}</span></div>`;
      });
    }
    if(precip&&precip.pctNormal!==null){
      const pctColor=precip.pctNormal>=120?'#22c55e':precip.pctNormal>=80?'#06b6d4':precip.pctNormal>=50?'#eab308':precip.pctNormal>=25?'#f97316':'#ef4444';
      html+=`<div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--border-subtle);display:flex;align-items:center;gap:8px">
        <div style="font-size:0.85em;color:var(--text-secondary)">💧 30-Day Rainfall</div>
        <div style="margin-left:auto;font-weight:700;color:${pctColor};font-size:0.95em">${precip.pctNormal}% of normal</div>
      </div>
      <div style="font-size:0.8em;color:var(--text-muted);text-align:right">${precip.totalIn} in actual vs ~${precip.normalIn} in avg</div>`;
    }
    html+=`</div>`;
  }
  if(!isUS&&precip&&precip.pctNormal!==null){
    const pctColor=precip.pctNormal>=120?'#22c55e':precip.pctNormal>=80?'#06b6d4':precip.pctNormal>=50?'#eab308':precip.pctNormal>=25?'#f97316':'#ef4444';
    html+=`<div style="padding:4px 8px;font-size:0.75em">
      <div class="flex-center-gap8">
        <span class="c-secondary">💧 30-Day Rainfall</span>
        <span style="margin-left:auto;font-weight:700;color:${pctColor}">${precip.pctNormal}% of normal</span>
      </div>
      <div style="font-size:0.85em;color:var(--text-muted);text-align:right">${precip.totalIn} in actual vs ~${precip.normalIn} in avg</div>
    </div>`;
  }
  html+=`<div class="text-hint-right">Data: US Drought Monitor + Open-Meteo</div>`;
  html+=`</div></details>`;
  return html;
}

function _timeAgo(ts){
  const diff=Date.now()-ts;
  const mins=Math.floor(diff/60000);
  if(mins<1)return'just now';
  if(mins<60)return mins+'m ago';
  const hrs=Math.floor(mins/60);
  if(hrs<24)return hrs+'h ago';
  const days=Math.floor(hrs/24);
  return days+'d ago';
}

function startAlertCountdowns(){
  if(S._alertCdTimer)clearInterval(S._alertCdTimer);
  function tick(){
    const now=Date.now();let anyExpired=false;
    document.querySelectorAll('[id^="alert-cd-"]').forEach(el=>{
      const exp=parseInt(el.dataset.exp);
      const rem=exp-now;
      if(rem<=0){el.textContent='Expired';el.style.color='var(--accent-red)';anyExpired=true;return}
      const h=Math.floor(rem/3600000);const m=Math.floor((rem%3600000)/60000);const s=Math.floor((rem%60000)/1000);
      el.textContent=(h?h+'h ':'')+(m<10&&h?'0':'')+m+'m '+(s<10?'0':'')+s+'s remaining';
      if(rem<3600000)el.style.color='var(--accent-orange)';
      else el.style.color='var(--text-muted)';
    });
    if(anyExpired)setTimeout(()=>renderAlerts(),1500);
  }
  tick();
  S._alertCdTimer=setInterval(tick,1000);
}

