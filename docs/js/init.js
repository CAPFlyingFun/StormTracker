// ==========================================
// INIT — always show welcome, explicit consent
// ==========================================
let _deferredInstallPrompt=null;
function _initPWAInstallPrompt(){
  if(window.matchMedia('(display-mode: standalone)').matches)return;
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    _deferredInstallPrompt=e;
    const dismissed=localStorage.getItem('st_installDismissed');
    if(dismissed&&Date.now()-parseInt(dismissed)<604800000)return;
    _showInstallBanner();
  });
}
function _showInstallBanner(){
  if(document.getElementById('pwa-install-banner'))return;
  const bar=document.createElement('div');
  bar.id='pwa-install-banner';
  bar.style.cssText='position:fixed;bottom:60px;left:8px;right:8px;z-index:9998;background:linear-gradient(135deg,rgba(10,16,32,0.97),rgba(15,25,50,0.97));border:1px solid rgba(0,229,255,0.3);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;box-shadow:0 4px 20px rgba(0,0,0,0.5);backdrop-filter:blur(10px);animation:slideUp 0.3s ease-out';
  bar.innerHTML=`<div style="font-size:1.6em">⚡</div>
    <div class="flex-1"><div style="font-size:0.8em;font-weight:700;color:var(--text-primary)">Install StormTracker</div>
    <div style="font-size:0.65em;color:var(--text-muted);margin-top:2px">Add to home screen for the best experience</div></div>
    <button onclick="_acceptInstall()" style="padding:6px 14px;background:rgba(0,229,255,0.15);color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.4);border-radius:8px;font-size:0.75em;font-weight:700;cursor:pointer;white-space:nowrap">Install</button>
    <button onclick="_dismissInstall()" style="padding:4px 10px;background:none;border:none;color:var(--text-muted);font-size:0.7em;cursor:pointer;white-space:nowrap">Not now</button>`;
  document.body.appendChild(bar);
}
function _acceptInstall(){
  const b=document.getElementById('pwa-install-banner');
  if(b)b.remove();
  if(_deferredInstallPrompt){_deferredInstallPrompt.prompt();_deferredInstallPrompt.userChoice.then(r=>{console.log('PWA install:',r.outcome);_deferredInstallPrompt=null})}
}
function _dismissInstall(){
  const b=document.getElementById('pwa-install-banner');
  if(b)b.remove();
  localStorage.setItem('st_installDismissed',String(Date.now()));
}

let _isOffline=false;
function _initOfflineDetection(){
  _isOffline=!navigator.onLine;
  window.addEventListener('offline',()=>{_isOffline=true;_showOfflineBanner();if(S._lastWeatherData)renderWeather(S._lastWeatherData);renderHazards()});
  window.addEventListener('online',()=>{_isOffline=false;_hideOfflineBanner();toast('Back online','success');if(S.lat)fetchWeather()});
  if(_isOffline)_showOfflineBanner();
}
function _showOfflineBanner(){
  if(document.getElementById('offline-banner'))return;
  const bar=document.createElement('div');
  bar.id='offline-banner';
  bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:10002;background:linear-gradient(90deg,#b45309,#92400e);color:#fbbf24;font-size:0.75em;font-weight:600;text-align:center;padding:6px 12px;display:flex;align-items:center;justify-content:center;gap:6px';
  // v6.58: honest wording — prefer the WEATHER payload's age (persisted as
  // st_lastWeather); fall back to the hazards stamp. "showing cached data" was
  // untrue on a cold offline launch before the payload was persisted.
  const lastFetch=(typeof S!=='undefined'&&S._lastWeatherFetch)||(_hazardData&&_hazardData._lastFetch?_hazardData._lastFetch:0);
  const ago=lastFetch?_relativeTime(lastFetch):'';
  bar.innerHTML=`<span>📡 Offline — ${lastFetch?('showing saved data'+(ago?' from '+ago:'')):'no saved data yet'}</span>`;
  document.body.appendChild(bar);
  const header=document.querySelector('.app-header');
  if(header)header.style.marginTop='30px';
}
function _hideOfflineBanner(){
  const b=document.getElementById('offline-banner');
  if(b)b.remove();
  const header=document.querySelector('.app-header');
  if(header)header.style.marginTop='';
}
function _relativeTime(ts){
  const diff=Math.floor((Date.now()-ts)/1000);
  if(diff<60)return 'just now';
  if(diff<3600)return Math.floor(diff/60)+'m ago';
  if(diff<86400)return Math.floor(diff/3600)+'h ago';
  return Math.floor(diff/86400)+'d ago';
}
function _staleDataLabel(){
  if(!_isOffline)return '';
  const ts=S._lastWeatherFetch||0;
  const ago=ts?_relativeTime(ts):'unknown';
  return `<div style="text-align:center;padding:4px 10px;margin:4px 0;background:rgba(180,83,9,0.15);border:1px solid rgba(251,191,36,0.25);border-radius:8px;font-size:0.65em;color:#fbbf24">📡 Cached data · Last updated ${ago}</div>`;
}

function _showNotifPermissionModal(){
  if(!('Notification' in window))return;
  if(Notification.permission!=='default')return;
  const seen=localStorage.getItem('st_notifPromptSeen');
  if(seen)return;
  const overlay=document.createElement('div');
  overlay.id='notif-permission-modal';
  overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;z-index:10001;background:rgba(5,8,15,0.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML=`<div style="max-width:320px;width:90%;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:14px;padding:24px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.5)">
    <div style="font-size:2em;margin-bottom:8px">🔔</div>
    <div style="font-size:1em;font-weight:700;color:var(--text-primary);margin-bottom:8px">Enable Notifications?</div>
    <div style="font-size:0.78em;color:var(--text-secondary);line-height:1.5;margin-bottom:16px">Get alerted when storms approach your location or weather conditions exceed your thresholds — even when StormTracker is in the background.</div>
    <div class="flex-gap-8">
      <button onclick="_acceptNotifPermission()" style="flex:1;padding:10px;background:rgba(0,229,255,0.15);color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.3);border-radius:8px;font-size:0.85em;font-weight:700;cursor:pointer">Enable</button>
      <button onclick="_dismissNotifPermission()" style="flex:1;padding:10px;background:rgba(255,255,255,0.04);color:var(--text-muted);border:1px solid var(--border-subtle);border-radius:8px;font-size:0.85em;font-weight:600;cursor:pointer">Maybe Later</button>
    </div>
    <div style="font-size:0.6em;color:var(--text-muted);margin-top:10px">You can change this anytime in your browser settings</div>
  </div>`;
  document.body.appendChild(overlay);
}
function _acceptNotifPermission(){
  const m=document.getElementById('notif-permission-modal');
  if(m)m.remove();
  localStorage.setItem('st_notifPromptSeen',String(Date.now()));
  Notification.requestPermission().then(p=>console.log('Notification permission:',p));
}
function _dismissNotifPermission(){
  const m=document.getElementById('notif-permission-modal');
  if(m)m.remove();
  localStorage.setItem('st_notifPromptSeen',String(Date.now()));
}

// ==========================================
// LOADING SCREEN
// ==========================================
let _loadingScreenTimer=null;
function showLoadingScreen(locName){
  const el=document.getElementById('app-loading');
  if(!el)return;
  const locEl=document.getElementById('loading-loc');
  const msgEl=document.getElementById('loading-status-msg');
  if(locEl)locEl.textContent=locName?'📍 '+locName:'';
  if(msgEl)msgEl.textContent='Fetching weather data…';
  el.classList.remove('fade-out');
  el.style.display='flex';
  // Safety auto-hide after 15s in case something goes wrong
  clearTimeout(_loadingScreenTimer);
  _loadingScreenTimer=setTimeout(()=>hideLoadingScreen(),15000);
}
function hideLoadingScreen(){
  clearTimeout(_loadingScreenTimer);
  const el=document.getElementById('app-loading');
  if(!el||el.style.display==='none')return;
  el.classList.add('fade-out');
  setTimeout(()=>{el.style.display='none';el.classList.remove('fade-out');S._bootInProgress=false;_bootSteps=[];_renderBootSteps()},420);
}

// ==========================================
// BOOT DEBUG STEPS — visible during initial load
// ==========================================
let _bootSteps=[];
function _renderBootSteps(){
  const el=document.getElementById('boot-steps');
  if(!el)return;
  if(!_bootSteps.length){el.innerHTML='';return}
  el.innerHTML=_bootSteps.map(s=>{
    const icon=s.status==='done'?'✓':s.status==='fail'?'✗':'<span class="bs-spin">▶</span>';
    const cls='boot-step bs-'+s.status;
    return `<div class="${cls}"><span class="bs-icon">${icon}</span><span class="bs-label">${s.label}</span></div>`;
  }).join('');
}
function _bootStep(id,label){
  if(S._bootInProgress===false)return;
  const ix=_bootSteps.findIndex(s=>s.id===id);
  if(ix>=0)_bootSteps[ix]={id,label,status:'pending'};
  else _bootSteps.push({id,label,status:'pending'});
  _renderBootSteps();
}
function _bootStepDone(id,label){
  if(S._bootInProgress===false)return;
  const s=_bootSteps.find(x=>x.id===id);
  if(!s)return;
  s.status='done';
  if(label)s.label=label;
  _renderBootSteps();
}
function _bootStepFail(id,label){
  if(S._bootInProgress===false)return;
  const s=_bootSteps.find(x=>x.id===id);
  if(!s)return;
  s.status='fail';
  if(label)s.label=label;
  _renderBootSteps();
}

// ==========================================
// CONNECTION SPEED TEST — runs at app open
// ==========================================
async function _runConnectionSpeedTest(){
  S._netRttMs=null;S._netSpeed='unknown';
  if(typeof _bootStep==='function')_bootStep('net','Testing connection…');
  const t0=performance.now();
  try{
    const ctrl=new AbortController();
    const to=setTimeout(()=>ctrl.abort(),12000);   // v5.53: was 8s — give slow links a chance to finish before we give up
    const r=await fetch('https://api.rainviewer.com/public/weather-maps.json',{signal:ctrl.signal,cache:'no-store'});
    clearTimeout(to);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const _rvTxt=await r.text();
    // v6.57 (QW2): this download used to be timing-only and thrown away — while
    // radar paths re-fetched the SAME catalog seconds later. Seed the shared
    // 60-s cache (_rvScanFramesCache, radar.js) so the byte cost buys data too.
    try{
      const rv=JSON.parse(_rvTxt);
      const fr=(rv.radar?.past||[]).concat(rv.radar?.nowcast||[]);
      const tp=fr.length?fr[fr.length-1].path:null;
      if(tp&&typeof _rvScanFramesCache!=='undefined')_rvScanFramesCache={ts:Date.now(),frames:fr,tilePath:tp};
    }catch(e){}
    const ms=Math.round(performance.now()-t0);
    S._netRttMs=ms;
    S._netSpeed=ms<500?'fast':ms<1500?'medium':ms<4000?'slow':'verySlow';
    console.log('[Net] Speed test:',ms,'ms →',S._netSpeed);
    if(typeof _bootStepDone==='function')_bootStepDone('net',`Connection: ${ms}ms · ${S._netSpeed}`);
    return ms;
  }catch(e){
    // v5.53: a timeout/abort on a link the browser still reports as ONLINE means
    // SLOW, not offline — say so instead of the alarming "Connection check failed".
    // The app runs fine slow (cache-first + graceful data fetches); only flag a
    // real failure when navigator.onLine is actually false.
    const online=(typeof navigator!=='undefined')?navigator.onLine!==false:true;
    S._netRttMs=null;
    S._netSpeed=online?'verySlow':'offline';
    console.log('[Net] Speed test:',online?'slow (timed out, still online)':'offline','—',e.message);
    if(online){ if(typeof _bootStepDone==='function')_bootStepDone('net','Connection: slow'); }
    else { if(typeof _bootStepFail==='function')_bootStepFail('net','Offline — using cached data'); }
    return null;
  }
}

// ==========================================
// ADAPTIVE NETWORK MONITOR (v5.53) — re-checks speed every 60s (visibility-aware)
// and adjusts what loads/shows: background radar-poll cadence, a live connection-
// mode chip in the header, and netIsSlow()/netIsVerySlow() gates other features can
// hang off. Before this, the boot speed test computed _netSpeed but nothing read it.
// ==========================================
let _netPrevTier=null, _netMonitorTimer=null;
function netTier(){ return (typeof S!=='undefined'&&S._netSpeed)?S._netSpeed:'unknown'; }
function netIsSlow(){ const t=netTier(); return t==='slow'||t==='verySlow'||t==='offline'; }
function netIsVerySlow(){ const t=netTier(); return t==='verySlow'||t==='offline'; }
function _netModeChipInfo(t){
  if(t==='offline') return {txt:'📡 Offline',col:'#ff5a6a'};
  if(t==='verySlow')return {txt:'🐌 Very slow',col:'#ffa500'};
  if(t==='slow')    return {txt:'🐢 Slow',col:'#ffd23a'};
  return null;   // fast / medium / unknown -> hide the chip
}
function _updateNetModeChip(t){
  const el=document.getElementById('net-mode'); if(!el)return;
  const m=_netModeChipInfo(t);
  if(m){ el.textContent=m.txt; el.style.color=m.col; el.style.borderColor=m.col; el.style.display=''; }
  else { el.style.display='none'; }
}
function _applyNetAdaptations(){
  const t=netTier();
  _updateNetModeChip(t);
  // re-arm the background radar poll so the new (tier-aware) interval applies now
  if(typeof _rearmOverheadPoll==='function'){try{_rearmOverheadPoll()}catch(e){}}
  // announce only meaningful slow<->normal transitions, not every 60s tick
  if(_netPrevTier!==null&&t!==_netPrevTier){
    const slowNow=(t==='slow'||t==='verySlow'||t==='offline');
    const slowBefore=(_netPrevTier==='slow'||_netPrevTier==='verySlow'||_netPrevTier==='offline');
    if(slowNow&&!slowBefore){ if(typeof toast==='function')toast('🐢 Slow connection — easing off background updates'); }
    else if(!slowNow&&slowBefore){ if(typeof toast==='function')toast('⚡ Connection back to normal'); }
  }
  _netPrevTier=t;
}
function _recheckNet(){ return _runConnectionSpeedTest().then(()=>{_applyNetAdaptations();}); }
function _netMonitorStart(){
  if(_netMonitorTimer)return;
  _applyNetAdaptations();                                   // reflect the boot reading immediately
  _netMonitorTimer=setInterval(()=>{ if(!document.hidden)_recheckNet(); },60000);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden)_recheckNet(); });
  window.addEventListener('online', ()=>_recheckNet());
  window.addEventListener('offline',()=>{ if(typeof S!=='undefined')S._netSpeed='offline'; _applyNetAdaptations(); });
}

async function init(){
  if(typeof _autoCheckUpdate==='function'&&await _autoCheckUpdate())return;
  _pruneExpiredAlerts();
  if(typeof _drainPushNotifQueue==='function')_drainPushNotifQueue();
  if(typeof _updateNotifBadge==='function')_updateNotifBadge();
  _loadAllCustomIcons().catch(()=>{});
  loadUnits();
  updateAIFab();
  _initPWAInstallPrompt();
  _initOfflineDetection();
  S._bootInProgress=true;
  _runConnectionSpeedTest().then(()=>_netMonitorStart());
  try{
    const saved=JSON.parse(localStorage.getItem('st_loc'));
    if(saved&&saved.lat&&saved.lon){
      if(!getHomeLocation())setHomeLocation(saved.lat,saved.lon,saved.name);
      _showBottomNav();
      if(localStorage.getItem('st_autoGps')==='1'){
        const gps=await _silentGpsOnLoad();
        if(gps){
          if(gps.coords.altitude!=null)S._gpsAltitude=gps.coords.altitude;
          reverseGeo(gps.coords.latitude,gps.coords.longitude);
          return;
        }
      }
      setLoc(saved.lat,saved.lon,saved.name);return;
    }
  }catch(e){}
  _hideBottomNav();
  document.getElementById('status-text').textContent='Enter a location to begin';
  _hideHeaderBtns();
  document.getElementById('page-weather').innerHTML=`
    <div class="welcome-screen">
      <div style="font-size:3em;margin-bottom:12px">⚡</div>
      <h2>Welcome to StormTracker</h2>
      <p>Real-time storm detection powered by live radar data.<br>No API keys, no accounts, 100% free.</p>
      <button class="welcome-btn" onclick="showLocationConfirm()">🛰️ Use My Location</button>
      <div id="welcome-search-wrap" style="width:100%;max-width:320px;margin-top:8px">
        <div style="display:flex;gap:6px">
          <input type="text" id="welcome-search-input" placeholder="Search city, ZIP, or address..." style="flex:1;padding:10px 14px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:8px;font-size:0.9em;font-family:var(--font-body);outline:none" autocomplete="off">
          <button onclick="_welcomeSearch()" style="padding:10px 18px;background:rgba(0,229,255,0.15);color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.3);border-radius:8px;font-size:0.85em;font-weight:600;cursor:pointer;white-space:nowrap">Go</button>
        </div>
        <div id="welcome-suggestions" style="margin-top:4px"></div>
        <div id="welcome-search-debug" style="display:none;margin-top:8px;padding:8px 10px;background:rgba(255,82,82,0.08);border:1px solid rgba(255,82,82,0.3);border-radius:8px;font-size:0.72em;line-height:1.45;max-height:200px;overflow-y:auto;text-align:left;word-break:break-word"></div>
      </div>
      <button class="welcome-btn secondary" onclick="startMapPick()" style="background:rgba(0,229,255,0.08);border-color:rgba(0,229,255,0.3)">📌 Set Location from Map</button>
      <div style="margin-top:20px;font-size:0.75em;color:var(--text-muted)">
        <strong>Features:</strong><br>
        Live weather &middot; Radar map &middot; Storm cell detection<br>
        METAR station data &middot; NWS alerts<br>
        Tappable unit cycling &middot; 7-day forecast
      </div>
    </div>`;
  const _wsi=document.getElementById('welcome-search-input');
  if(_wsi){
    _wsi.addEventListener('keydown',e=>{if(e.key==='Enter')_welcomeSearch()});
    let _wst=null;
    _wsi.addEventListener('input',()=>{
      clearTimeout(_wst);
      const q=_wsi.value.trim();
      if(q.length<2){document.getElementById('welcome-suggestions').innerHTML='';return}
      _wst=setTimeout(async()=>{
        try{
          const data=await geoSearch(q,5);
          const box=document.getElementById('welcome-suggestions');
          if(!box)return;
          if(!data.length){box.innerHTML='';return}
          box.innerHTML=data.map(r=>{
            const a=r.address||{};
            const nm=fmtLocName(a,r.display_name.split(',').slice(0,2).join(',').trim());
            return `<button onclick="setLoc(${parseFloat(r.lat)},${parseFloat(r.lon)},'${nm.replace(/'/g,"\\'")}');if(typeof checkLocationUnits==='function')checkLocationUnits('${a.country_code||''}')" style="display:block;width:100%;padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer;text-align:left;color:var(--text-primary);font-size:0.82em;margin-bottom:4px">${nm}</button>`;
          }).join('');
        }catch(e){}
      },300);
    });
  }
}
function _hideBottomNav(){const n=document.querySelector('.bottom-nav');if(n)n.style.display='none'}
function _showBottomNav(){const n=document.querySelector('.bottom-nav');if(n)n.style.display=''}
function _hideHeaderBtns(){['btn-travel','btn-loc-open','btn-settings'].forEach(id=>{const b=document.getElementById(id);if(b)b.style.display='none'})}
function _showHeaderBtns(){['btn-travel','btn-loc-open','btn-settings'].forEach(id=>{const b=document.getElementById(id);if(b)b.style.display=''})}
async function _welcomeSearch(){
  const inp=document.getElementById('welcome-search-input');
  if(!inp)return;
  const q=inp.value.trim();
  if(!q){toast('Please enter a location');return}
  if(S._searching)return;
  S._searching=true;
  _hideGeoDebug('welcome-search-debug');
  toast('Searching...');
  try{
    const{data,parsed}=await smartGeoSearch(q,1);
    if(data.length){
      const r=data[0];const a=r.address||{};
      setLoc(parseFloat(r.lat),parseFloat(r.lon),_geoLabelFor(r,parsed));
      if(typeof checkLocationUnits==='function')checkLocationUnits(a.country_code);
    }else{toast('Location not found');_showGeoDebug('No match found for that address','welcome-search-debug')}
  }catch(e){toast('Search failed');_showGeoDebug('Search failed: '+((e&&e.message)||e),'welcome-search-debug');console.log('welcomeSearch error:',e)}
  finally{S._searching=false}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();

const LANGS=[
  {c:'en',f:'🇺🇸',n:'English'},{c:'es',f:'🇪🇸',n:'Español'},{c:'fr',f:'🇫🇷',n:'Français'},
  {c:'de',f:'🇩🇪',n:'Deutsch'},{c:'it',f:'🇮🇹',n:'Italiano'},{c:'pt',f:'🇧🇷',n:'Português'},
  {c:'ja',f:'🇯🇵',n:'日本語'},{c:'ko',f:'🇰🇷',n:'한국어'},{c:'zh',f:'🇨🇳',n:'中文'},
  {c:'ar',f:'🇸🇦',n:'العربية'},{c:'hi',f:'🇮🇳',n:'हिन्दी'},{c:'ru',f:'🇷🇺',n:'Русский'},
  {c:'tr',f:'🇹🇷',n:'Türkçe'},{c:'nl',f:'🇳🇱',n:'Nederlands'},{c:'pl',f:'🇵🇱',n:'Polski'},
  {c:'vi',f:'🇻🇳',n:'Tiếng Việt'},{c:'th',f:'🇹🇭',n:'ไทย'},{c:'sv',f:'🇸🇪',n:'Svenska'},
  {c:'id',f:'🇮🇩',n:'Bahasa'},{c:'uk',f:'🇺🇦',n:'Українська'},
  {c:'cs',f:'🇨🇿',n:'Čeština'},{c:'da',f:'🇩🇰',n:'Dansk'},{c:'fi',f:'🇫🇮',n:'Suomi'},
  {c:'el',f:'🇬🇷',n:'Ελληνικά'},{c:'he',f:'🇮🇱',n:'עברית'},{c:'hu',f:'🇭🇺',n:'Magyar'},
  {c:'no',f:'🇳🇴',n:'Norsk'},{c:'ro',f:'🇷🇴',n:'Română'},{c:'ms',f:'🇲🇾',n:'Melayu'},
  {c:'tl',f:'🇵🇭',n:'Filipino'},{c:'sw',f:'🇰🇪',n:'Kiswahili'}
];
let _curLang=localStorage.getItem('st_lang')||'en';
let _tCache=JSON.parse(localStorage.getItem('st_tcache')||'{}');
let _translating=false;

function buildLangMenu(){
  const menu=document.getElementById('lang-menu');
  menu.innerHTML=LANGS.map(l=>`<div class="lang-item${l.c===_curLang?' active':''}" onclick="selectLang('${l.c}')">
    <span class="lang-flag">${l.f}</span><span class="lang-name">${l.n}</span>${l.c===_curLang?'<span class="lang-check">✓</span>':''}
  </div>`).join('');
}
function toggleLangMenu(){
  const menu=document.getElementById('lang-menu');
  const open=menu.classList.toggle('open');
  if(open){buildLangMenu();document.addEventListener('click',closeLangMenuOutside,{once:true,capture:true})}
}
function closeLangMenuOutside(e){
  const menu=document.getElementById('lang-menu');
  const btn=document.getElementById('btn-lang');
  if(!menu.contains(e.target)&&e.target!==btn){menu.classList.remove('open')}
  else if(menu.classList.contains('open')){document.addEventListener('click',closeLangMenuOutside,{once:true,capture:true})}
}
function selectLang(code){
  document.getElementById('lang-menu').classList.remove('open');
  if(code===_curLang&&code!=='en')return;
  _curLang=code;
  localStorage.setItem('st_lang',code);
  const flag=LANGS.find(l=>l.c===code);
  document.getElementById('btn-lang').textContent=flag?flag.f:'🇺🇸';
  if(code==='en'){restoreOriginals();toast('Language: English');return}
  preseedStormVocab(code);
  translatePage(code);
}

function getTextNodes(root){
  const nodes=[];
  const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
    acceptNode(n){
      const p=n.parentElement;
      if(!p)return NodeFilter.FILTER_REJECT;
      const tag=p.tagName;
      if(['SCRIPT','STYLE','SVG','CANVAS','NOSCRIPT'].includes(tag))return NodeFilter.FILTER_REJECT;
      if(p.closest('svg'))return NodeFilter.FILTER_REJECT;
      const txt=n.textContent.trim();
      if(!txt||txt.length<2)return NodeFilter.FILTER_REJECT;
      if(/^[\d\s.,:/%°+\-→↑↓←·•\u2022]+$/.test(txt))return NodeFilter.FILTER_REJECT;
      if(/^[\u2600-\u27BF\uD83C-\uDBFF\uDC00-\uDFFF\s]+$/.test(txt))return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while(walk.nextNode())nodes.push(walk.currentNode);
  return nodes;
}

async function mmTranslate(text,lang){
  const key=lang+'::'+text;
  if(_tCache[key])return _tCache[key];
  try{
    const r=await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0,500))}&langpair=en|${lang}&de=stormtracker@weather.app`);
    const d=await r.json();
    if(d.responseStatus===200&&d.responseData?.translatedText){
      let t=d.responseData.translatedText;
      if(t.toUpperCase()===t&&text.toUpperCase()!==text)t=text;
      _tCache[key]=t;
      if(Object.keys(_tCache).length%20===0){
        try{localStorage.setItem('st_tcache',JSON.stringify(_tCache))}catch(e){}
      }
      return t;
    }
  }catch(e){}
  return text;
}

async function translatePage(lang){
  if(_translating)return;
  _translating=true;
  const ln=LANGS.find(l=>l.c===lang);

  const nodes=getTextNodes(document.body);
  const unique=new Map();
  const cachedNow=[];
  nodes.forEach(n=>{
    const txt=n.textContent.trim();
    if(!n._origText)n._origText=n.textContent;
    const ck=lang+'::'+txt;
    if(_tCache[ck]){
      cachedNow.push([n,txt,_tCache[ck]]);
      return;
    }
    if(!unique.has(txt))unique.set(txt,[]);
    unique.get(txt).push(n);
  });

  cachedNow.forEach(([n,txt,tr])=>{n.textContent=n.textContent.replace(txt,tr)});

  const entries=[...unique.entries()];
  if(entries.length>0){
    const bar=document.createElement('div');
    bar.className='translate-bar show';
    bar.id='translate-bar';
    bar.innerHTML=`<div class="t-spinner"></div><span>Translating to ${ln?ln.n:lang}...</span><span id="t-progress">0%</span>`;
    document.body.appendChild(bar);

    let done=0;
    const total=entries.length;
    const batchSize=4;

    for(let i=0;i<entries.length;i+=batchSize){
      const batch=entries.slice(i,i+batchSize);
      const results=await Promise.all(batch.map(([txt])=>mmTranslate(txt,lang)));
      batch.forEach(([txt,nodeList],j)=>{
        const translated=results[j];
        nodeList.forEach(n=>{
          n.textContent=n.textContent.replace(txt,translated);
        });
      });
      done+=batch.length;
      const pct=Math.round(done/total*100);
      const prog=document.getElementById('t-progress');
      if(prog)prog.textContent=pct+'%';
    }

    try{localStorage.setItem('st_tcache',JSON.stringify(_tCache))}catch(e){}
    const b=document.getElementById('translate-bar');
    if(b){b.innerHTML=`<span>✓ Translated to ${ln?ln.n:lang}</span>`;setTimeout(()=>b.remove(),2000)}
  }

  _translating=false;
  _tCooldown=Date.now();
  if(lang==='ar'||lang==='he')document.body.style.direction='rtl';
  else document.body.style.direction='ltr';
}

function tStr(s){if(_curLang==='en'||!s)return s;const k=_curLang+'::'+s;return _tCache[k]||s}

const _stormVocab=['Storm Cell','Live Radar','Peak dBZ','Rain Rate','Distance','Bearing','Moving','Status','Impact','ETA','Countdown','Arrives','Overhead · Moving away','Nearby · Not approaching','at','Extreme — Hail/Tornado','Intense — Hail Likely','Very Heavy Rain','Heavy Rain','Moderate Rain','Light Rain','Drizzle/Mist','No Impact — Nearby','Low Risk','Moderate Risk','Elevated Risk','High Risk','Extreme Risk','returns','Light','Extreme','Temp','Dew Pt','Humidity','Baro','Vis','Sky','tap to change units','tap','Updated','mi away','Gusts','Nearby Stations','Loading','Light Precipitation','7-Day Forecast','Today','Now','Feels','High / Low','Rain Chance','Precipitation','Max Wind','Sunrise','Sunset','Hourly Forecast — Next 72h','NWS Forecast','Thunderstorm','Rain','Snow','Cloudy','Partly Cloudy','Clear','Fog','Drizzle','Mostly fair'];
async function preseedStormVocab(lang){
  const need=_stormVocab.filter(w=>!_tCache[lang+'::'+w]);
  if(!need.length)return;
  for(let i=0;i<need.length;i+=4){
    const batch=need.slice(i,i+4);
    await Promise.all(batch.map(w=>mmTranslate(w,lang)));
  }
  try{localStorage.setItem('st_tcache',JSON.stringify(_tCache))}catch(e){}
}

function quickTranslate(){
  if(_curLang==='en'||_translating)return;
  const nodes=getTextNodes(document.body);
  const uncached=new Map();
  nodes.forEach(n=>{
    if(!n._origText)n._origText=n.textContent;
    const cur=n.textContent.trim();
    const orig=n._origText?.trim()||cur;
    const ckOrig=_curLang+'::'+orig;
    if(_tCache[ckOrig]){
      if(cur!==_tCache[ckOrig])n.textContent=n._origText.replace(orig,_tCache[ckOrig]);
      return;
    }
    const ckCur=_curLang+'::'+cur;
    if(_tCache[ckCur])return;
    if(!uncached.has(orig))uncached.set(orig,[]);
    uncached.get(orig).push(n);
  });
  if(uncached.size>0&&uncached.size<80) translateUncached(uncached,_curLang);
}
async function translateUncached(uncMap,lang){
  if(_translating)return;
  _translating=true;
  const entries=[...uncMap.entries()];
  for(let i=0;i<entries.length;i+=4){
    const batch=entries.slice(i,i+4);
    const results=await Promise.all(batch.map(([txt])=>mmTranslate(txt,lang)));
    batch.forEach(([txt,nodeList],j)=>{
      nodeList.forEach(n=>{n.textContent=n.textContent.replace(txt,results[j])});
    });
  }
  try{localStorage.setItem('st_tcache',JSON.stringify(_tCache))}catch(e){}
  _translating=false;
  _tCooldown=Date.now();
}

function restoreOriginals(){
  const nodes=getTextNodes(document.body);
  nodes.forEach(n=>{if(n._origText)n.textContent=n._origText});
  document.body.style.direction='ltr';
}

let _tObserver=null, _tCooldown=0;
function startTranslateObserver(){
  if(_tObserver)_tObserver.disconnect();
  _tObserver=new MutationObserver(muts=>{
    if(_curLang==='en'||_translating)return;
    let hasNew=false;
    muts.forEach(m=>{
      m.addedNodes.forEach(n=>{
        if(n.nodeType===1&&!['SCRIPT','STYLE','SVG'].includes(n.tagName)&&!n.classList?.contains('translate-bar')&&!n.classList?.contains('lang-menu'))hasNew=true;
      });
    });
    if(hasNew){
      clearTimeout(_tObserver._debounce);
      _tObserver._debounce=setTimeout(()=>{
        if(!_translating)quickTranslate();
      },1000);
    }
  });
  _tObserver.observe(document.body,{childList:true,subtree:true});
}

// ==========================================
// 2.5D ISOMETRIC STORM VIEW
// ==========================================
const ISO={
  open:false,
  el:null,
  scene:null,
  wrap:null,
  zoom:1,
  tiltX:55,
  tiltZ:0,
  _startTilt:null,
  _startTouch:null,
  _pinchDist:null,
  popup:null
};

function stormThreatScore(dbz,distance,bearing){
  const intens=Math.min(50,Math.max(0,((dbz-15)/45)*50));
  let impactScore=0;
  const etas=S._stormETAs||{};
  const mv=S.stormMovement;
  if(mv&&mv.speed>=2){
    const bearToUser=(bearing+180)%360;
    const diff=Math.abs(((mv.direction-bearToUser+180)%360)-180);
    const closing=mv.speed*Math.cos(Math.min(diff,60)*Math.PI/180);
    if(closing>0){
      const proxBonus=Math.max(0,(80-distance)/80)*20;
      const angleBonus=Math.max(0,(45-diff)/45)*25;
      const speedBonus=Math.min(5,closing/4);
      impactScore=Math.min(50,proxBonus+angleBonus+speedBonus);
    }
  }
  const etaMatch=Object.values(etas).find(e=>{
    if(!e)return false;
    if(e.impact>0&&e.distance!==undefined)return Math.abs(e.distance-distance)<2&&Math.abs((e.bearing||0)-bearing)<15;
    return false;
  });
  if(etaMatch&&etaMatch.impact>0){impactScore=Math.max(impactScore,etaMatch.impact/2)}
  return Math.min(100,Math.round(intens+impactScore));
}
function threatColor(score){
  if(score>80)return{color:'#e040fb',glow:'rgba(224,64,251,0.8)',label:'Extreme'};
  if(score>55)return{color:'#ff3355',glow:'rgba(255,51,85,0.75)',label:'Serious'};
  if(score>35)return{color:'#facc15',glow:'rgba(250,204,21,0.65)',label:'Moderate'};
  return{color:'#22c55e',glow:'rgba(34,197,94,0.5)',label:'Low'};
}
function dbzToEmoji(d){
  const pack=_getIconPack();
  if(pack==='emoji'||pack==='basmilius'){
    if(d>=56)return'🌩️';
    if(d>=46)return'⛈️';
    if(d>=31)return'🌧️';
    return'☁️';
  }
  const cond=d>=52?'thunderstorm-lightning':d>=46?'thunderstorm':d>=31?'rain':'overcast';
  return getWeatherIcon(cond,20);
}
function stormSVG(dbz,color,sz){
  const w=Math.round(sz*20),h=Math.round(sz*14);
  const baseC=dbz>=52?'#555':dbz>=46?'#666':dbz>=31?'#999':'#ccc';
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 40 28">`;
  svg+=`<path d="M10 22 C4 22 0 18 0 14 C0 10 3 7 7 7 C8 3 12 0 17 0 C22 0 26 3 27 7 C27 6.8 28 6.5 29 6.5 C33 6.5 36 9.5 36 13 C36 13.5 36 14 35.8 14.5 C38 15 40 17 40 20 C40 23 38 25 35 25 L10 25 C6 25 4 23 4 22 Z" fill="${baseC}" opacity="0.5"/>`;
  svg+=`<path d="M10 22 C4 22 0 18 0 14 C0 10 3 7 7 7 C8 3 12 0 17 0 C22 0 26 3 27 7 C27 6.8 28 6.5 29 6.5 C33 6.5 36 9.5 36 13 C36 13.5 36 14 35.8 14.5 C38 15 40 17 40 20 C40 23 38 25 35 25 L10 25 C6 25 4 23 4 22 Z" fill="${color}" opacity="0.6"/>`;
  if(dbz>=31){
    const drops=dbz>=52?5:dbz>=46?3:2;
    for(let i=0;i<drops;i++){
      const dx=10+i*(20/(drops-1||1));
      svg+=`<line x1="${dx}" y1="25" x2="${dx-2}" y2="28" stroke="${dbz>=46?'#6cf':'#8cf'}" stroke-width="1.2" opacity="0.7"/>`;
    }
  }
  if(dbz>=46){
    svg+=`<path d="M18 24 L20 28 L22 24 Z" fill="#ff0" opacity="0.9"/>`;
    svg+=`<line x1="20" y1="24" x2="20" y2="20" stroke="#ff0" stroke-width="1" opacity="0.7"/>`;
  }
  svg+=`</svg>`;
  return svg;
}
function dbzToHeight(d){
  if(d>=56)return 140;
  if(d>=46)return 100;
  if(d>=31)return 60;
  if(d>=20)return 30;
  return 12;
}
function dbzToSize(d){
  if(d>=56)return 2.2;
  if(d>=46)return 1.8;
  if(d>=31)return 1.5;
  return 1.2;
}
function dbzToShadow(d){
  if(d>=56)return'drop-shadow(0 6px 12px rgba(255,40,40,0.5)) drop-shadow(0 0 8px rgba(255,60,60,0.3))';
  if(d>=46)return'drop-shadow(0 5px 10px rgba(0,0,0,0.7))';
  if(d>=31)return'drop-shadow(0 4px 8px rgba(0,0,0,0.5))';
  return'drop-shadow(0 3px 5px rgba(150,150,150,0.3))';
}

function bearingToDir(b){
  const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(b/22.5)%16];
}

function geoToIso(stormLat,stormLng,userLat,userLng,scale){
  const R=3958.8;
  const dLat=(stormLat-userLat)*Math.PI/180;
  const dLng=(stormLng-userLng)*Math.PI/180;
  const avgLat=(stormLat+userLat)/2*Math.PI/180;
  const dx=R*dLng*Math.cos(avgLat);
  const dy=R*dLat;
  return{x:dx*scale,y:-dy*scale};
}

function open3DView(){
  if(!S.lat||!S.lon)return;
  const name=S.locName||`${S.lat.toFixed(2)}, ${S.lon.toFixed(2)}`;
  const returnUrl=window.location.href;
  let url=`https://capflyingfun.github.io/StormTracker3D/?lat=${S.lat}&lon=${S.lon}&name=${encodeURIComponent(name)}&returnUrl=${encodeURIComponent(returnUrl)}`;
  try{
    const payload={};
    if(S.storms&&S.storms.length){
      payload.storms=S.storms.slice(0,200).map(s=>({lat:s.lat,lng:s.lng,dbz:s.dbz,distance:s.distance,bearing:s.bearing}));
    }
    if(S.stormMovement)payload.stormMovement=S.stormMovement;
    if(S._cloudBaseFt)payload.cloudBaseFt=S._cloudBaseFt;
    if(S.weather)payload.weather={cloud_cover:S.weather.cloud_cover,wind_speed_10m:S.weather.wind_speed_10m,wind_direction_10m:S.weather.wind_direction_10m,temperature_2m:S.weather.temperature_2m,dewpoint_2m:S.weather.dewpoint_2m};
    if(payload.storms){url+='#storms='+btoa(encodeURIComponent(JSON.stringify(payload)));}
  }catch(e){console.warn('Storm data encode failed:',e);}
  window.location.href=url;
}

function show3DView(){
  if(!S.lat)return;
  let ov=document.getElementById('iso-overlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='iso-overlay';
    ov.className='iso-overlay';
    ov.innerHTML=`
      <div class="iso-header">
        <div>
          <h3>🏔️ 3D Storm Terrain</h3>
          <div class="iso-loc" id="iso-loc"></div>
        </div>
        <button class="iso-close" onclick="hide3DView()">✕ Close</button>
      </div>
      <div class="iso-scene-wrap" id="iso-scene-wrap">
        <canvas id="iso-canvas"></canvas>
        <div class="iso-legend" style="max-height:240px">
          <h4>Elevation = Intensity</h4>
          ${DBZ_BINS.map((e,i,a)=>{const nx=a[i+1];const rng=nx?`${e.min}–${nx.min-1}`:`${e.min}+`;return`<div class="iso-legend-row"><span class="le" style="color:${e.color}">▓</span> ${e.label} (${rng} dBZ)</div>`}).join('')}
          <div class="iso-legend-row"><span class="le">⚡</span> Lightning (≥40)</div>
        </div>
        <div class="iso-info" id="iso-info"></div>
        <div class="iso-info iso-fps-badge" id="iso-fps" style="top:58px"></div>
        <div class="iso-height-ctrl" id="iso-height-ctrl">
          <label>🏔️ Height</label>
          <input type="range" id="iso-height-slider" min="1" max="20" step="0.5" value="7">
          <span id="iso-height-val">7×</span>
        </div>
        <div class="iso-cam" id="iso-cam">
          <div class="iso-cam-pad">
            <div aria-hidden="true"></div>
            <div class="iso-cam-btn" data-cam="up">▲</div>
            <div aria-hidden="true"></div>
            <div class="iso-cam-btn" data-cam="left">◀</div>
            <div class="iso-cam-btn iso-cam-center" data-cam="reset">RST</div>
            <div class="iso-cam-btn" data-cam="right">▶</div>
            <div aria-hidden="true"></div>
            <div class="iso-cam-btn" data-cam="down">▼</div>
            <div aria-hidden="true"></div>
          </div>
          <div class="iso-cam-zoom">
            <div class="iso-cam-btn" data-cam="zout">−</div>
            <div class="iso-cam-btn" data-cam="zin">+</div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ISO.el=ov;
    ISO.wrap=document.getElementById('iso-scene-wrap');
    ISO.canvas=document.getElementById('iso-canvas');
    ISO.ctx=ISO.canvas.getContext('2d');
    ov.addEventListener('selectstart',e=>e.preventDefault());
    ov.addEventListener('contextmenu',e=>e.preventDefault());
    ov.addEventListener('copy',e=>e.preventDefault());
    ov.addEventListener('dblclick',e=>e.preventDefault());
    ov.addEventListener('touchmove',e=>{if(!e.target.closest('.iso-height-ctrl'))e.preventDefault();},{passive:false});
    ov.addEventListener('touchstart',e=>{if(e.touches.length===1&&!e.target.closest('.iso-close,.iso-cam-btn,.iso-pop-close,.iso-height-ctrl'))e.preventDefault();},{passive:false});
    const hSlider=document.getElementById('iso-height-slider');
    if(hSlider){
      hSlider.addEventListener('input',()=>{
        ISO.heightMul=parseFloat(hSlider.value);
        document.getElementById('iso-height-val').textContent=hSlider.value+'×';
        ISO._dirty=true;
      });
    }
    setupIsoTouch();
  }
  ISO.open=true;
  ISO.zoom=1;
  ISO.tiltX=55;
  ISO.tiltZ=0;
  ISO._fps={frames:0,last:performance.now(),current:60,target:45,history:[]};
  ov.classList.add('active');
  const loc=document.getElementById('iso-loc');
  if(loc)loc.textContent=S.locName||`${S.lat.toFixed(2)}, ${S.lon.toFixed(2)}`;
  ISO._grid=buildTerrainGrid();
  ISO._dirty=true;
  isoStartLoop();
}

function hide3DView(){
  ISO.open=false;
  isoStopLoop();
  const ov=document.getElementById('iso-overlay');
  if(ov)ov.classList.remove('active');
  if(ISO.popup){ISO.popup.remove();ISO.popup=null;}
}

ISO._rafPending=false;
ISO._fps={frames:0,last:performance.now(),current:60,target:45,history:[]};
ISO._grid=null;
ISO._dirty=true;
ISO.heightMul=7;

function isoStartLoop(){
  if(ISO._loopId)return;
  function tick(){
    if(!ISO.open){ISO._loopId=0;return;}
    isoFpsTick();
    if(ISO._dirty){
      ISO._dirty=false;
      renderTerrain3D();
    }
    ISO._loopId=requestAnimationFrame(tick);
  }
  ISO._loopId=requestAnimationFrame(tick);
}
function isoStopLoop(){
  if(ISO._loopId){cancelAnimationFrame(ISO._loopId);ISO._loopId=0;}
}
function isoFpsTick(){
  const f=ISO._fps;
  f.frames++;
  const now=performance.now();
  const dt=now-f.last;
  if(dt>=500){
    f.current=Math.round(f.frames/(dt/1000));
    f.frames=0;
    f.last=now;
    f.history.push(f.current);
    if(f.history.length>6)f.history.shift();
    const badge=document.getElementById('iso-fps');
    if(badge)badge.textContent=`${f.current} fps`;
  }
}

function buildTerrainGrid(){
  const storms=S.storms||[];
  const GS=64;
  const grid=new Float32Array(GS*GS);
  const scanR=S.scanRadius||80;
  const R=3958.8;
  storms.forEach(st=>{
    if(!st.dbz||st.dbz<15)return;
    const dLat=(st.lat-S.lat)*Math.PI/180;
    const dLng=((st.lng||st.lon)-S.lon)*Math.PI/180;
    const avgLat=(st.lat+S.lat)/2*Math.PI/180;
    const dx=R*dLng*Math.cos(avgLat);
    const dy=R*dLat;
    const gx=Math.round((dx/scanR+1)*0.5*(GS-1));
    const gy=Math.round((-dy/scanR+1)*0.5*(GS-1));
    const spread=2;
    for(let oy=-spread;oy<=spread;oy++){
      for(let ox=-spread;ox<=spread;ox++){
        const ix=gx+ox,iy=gy+oy;
        if(ix<0||ix>=GS||iy<0||iy>=GS)continue;
        const d=Math.sqrt(ox*ox+oy*oy);
        const w=Math.max(0,1-d/spread);
        const idx=iy*GS+ix;
        grid[idx]=Math.max(grid[idx],st.dbz*w);
      }
    }
  });
  for(let pass=0;pass<2;pass++){
    const tmp=new Float32Array(grid);
    for(let y=1;y<GS-1;y++){
      for(let x=1;x<GS-1;x++){
        const i=y*GS+x;
        tmp[i]=(grid[i]*2+grid[i-1]+grid[i+1]+grid[i-GS]+grid[i+GS])/6;
      }
    }
    grid.set(tmp);
  }
  const info=document.getElementById('iso-info');
  if(info)info.textContent=`${storms.filter(s=>s.dbz>=15).length} storms in view`;
  return{data:grid,size:GS};
}

function terrainDbzRGB(v){
  if(v>=56)return[224,64,251];
  if(v>=46)return[255,51,85];
  if(v>=36)return[255,170,20];
  if(v>=25)return[80,220,80];
  if(v>=15)return[34,160,94];
  return[20,60,40];
}

function renderTerrain3D(){
  const c=ISO.canvas;
  const ctx=ISO.ctx;
  if(!c||!ctx)return;
  const wrap=ISO.wrap;
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const W=wrap.clientWidth;
  const H=wrap.clientHeight;
  c.width=W*dpr;
  c.height=H*dpr;
  c.style.width=W+'px';
  c.style.height=H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);

  ctx.fillStyle='#060d1a';
  ctx.fillRect(0,0,W,H);

  const g=ISO._grid;
  if(!g)return;
  const GS=g.size;
  const data=g.data;

  const rotZ=ISO.tiltZ*Math.PI/180;
  const tiltX=ISO.tiltX;
  const cosR=Math.cos(rotZ),sinR=Math.sin(rotZ);
  const yScale=Math.cos(tiltX*Math.PI/180);
  const hScale=Math.sin(tiltX*Math.PI/180);
  const zoom=ISO.zoom;
  const baseScale=Math.min(W,H)*0.0065*zoom;
  const heightMul=baseScale*(ISO.heightMul||7);
  const cx=W/2, cy=H*0.55;

  const scanR=S.scanRadius||80;
  const useMetric=S.units==='metric';
  const ringMax=useMetric?Math.round(scanR*1.60934/20)*20||80:scanR;
  const ringStep=useMetric?20:(ringMax<=50?10:20);
  const unitL=useMetric?'km':'mi';
  ctx.strokeStyle='rgba(40,80,120,0.35)';
  ctx.lineWidth=0.5;
  for(let r=ringStep;r<=ringMax;r+=ringStep){
    const rPx=r*baseScale*GS/scanR;
    ctx.beginPath();
    ctx.ellipse(cx,cy,rPx,rPx*yScale,0,0,Math.PI*2);
    ctx.stroke();
    ctx.fillStyle='rgba(80,140,200,0.4)';
    ctx.font='9px Inter,sans-serif';
    ctx.fillText(r+unitL,cx+rPx+3,cy+3);
  }

  ctx.fillStyle='rgba(0,200,255,0.8)';
  ctx.beginPath();ctx.arc(cx,cy,3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(0,200,255,0.6)';
  ctx.font='bold 9px Inter,sans-serif';
  ctx.fillText('YOU',cx+6,cy+3);

  const nAngle=rotZ;
  const nR=ringMax*baseScale*GS/scanR+12;
  const nx=cx+Math.sin(nAngle)*nR;
  const ny=cy-Math.cos(nAngle)*nR*yScale;
  ctx.fillStyle='rgba(255,100,100,0.8)';
  ctx.font='bold 10px Inter,sans-serif';
  ctx.textAlign='center';
  ctx.fillText('▲ N',nx,ny);
  ctx.textAlign='left';

  const half=(GS-1)/2;
  const projected=new Float32Array(GS*GS*2);
  for(let gy=0;gy<GS;gy++){
    for(let gx=0;gx<GS;gx++){
      const wx=(gx-half)*baseScale;
      const wy=(gy-half)*baseScale;
      const rx=wx*cosR-wy*sinR;
      const ry=wx*sinR+wy*cosR;
      const v=data[gy*GS+gx];
      const h=v>0?(v/65)*heightMul:0;
      const sx=cx+rx;
      const sy=cy+ry*yScale-h*hScale;
      const idx=(gy*GS+gx)*2;
      projected[idx]=sx;
      projected[idx+1]=sy;
    }
  }

  for(let gy=GS-2;gy>=0;gy--){
    for(let gx=0;gx<GS-1;gx++){
      const i00=gy*GS+gx;
      const i10=i00+1;
      const i01=i00+GS;
      const i11=i01+1;
      const v00=data[i00],v10=data[i10],v01=data[i01],v11=data[i11];
      const maxV=Math.max(v00,v10,v01,v11);
      if(maxV<5)continue;
      const avgV=(v00+v10+v01+v11)/4;

      const x0=projected[i00*2],y0=projected[i00*2+1];
      const x1=projected[i10*2],y1=projected[i10*2+1];
      const x2=projected[i11*2],y2=projected[i11*2+1];
      const x3=projected[i01*2],y3=projected[i01*2+1];

      const c1=(x1-x0)*(y3-y0)-(y1-y0)*(x3-x0);
      const rgb=terrainDbzRGB(avgV);
      const bright=0.5+avgV/130;
      const shade=c1>0?0.85:1.0;
      const alpha=Math.min(0.92,0.3+avgV/80);
      ctx.fillStyle=`rgba(${Math.round(rgb[0]*bright*shade)},${Math.round(rgb[1]*bright*shade)},${Math.round(rgb[2]*bright*shade)},${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.lineTo(x2,y2);ctx.lineTo(x3,y3);
      ctx.closePath();ctx.fill();

      if(maxV>=20){
        ctx.strokeStyle=`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.15)`;
        ctx.lineWidth=0.5;
        ctx.stroke();
      }
    }
  }

  const showLtng=_sonarCfg.showLightning!==false;
  if(showLtng){
    const time=Date.now();
    for(let gy=0;gy<GS;gy++){
      for(let gx=0;gx<GS;gx++){
        const v=data[gy*GS+gx];
        if(v<40)continue;
        const freq=v>=56?800:1500;
        const seed=(gx*73+gy*137)%freq;
        if((time+seed)%freq>100)continue;
        const idx=(gy*GS+gx)*2;
        const lx=projected[idx],ly=projected[idx+1];
        ctx.fillStyle='rgba(255,255,100,0.9)';
        ctx.font='bold 12px sans-serif';
        ctx.fillText('⚡',lx-6,ly-2);
      }
    }
  }

  const mv=S.stormMovement;
  if(mv&&mv.speed>=2){
    const dir=(mv.direction)*Math.PI/180;
    const aLen=40*zoom;
    const ax=cx+Math.sin(dir+rotZ)*aLen;
    const ay=cy-Math.cos(dir+rotZ)*aLen*yScale;
    ctx.strokeStyle='rgba(0,220,255,0.7)';
    ctx.lineWidth=2;
    ctx.setLineDash([5,3]);
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ax,ay);ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='rgba(0,220,255,0.8)';
    ctx.beginPath();
    const tipA=Math.atan2(ax-cx,-(ay-cy));
    ctx.moveTo(ax,ay);
    ctx.lineTo(ax-6*Math.sin(tipA-0.4),ay+6*Math.cos(tipA-0.4));
    ctx.lineTo(ax-6*Math.sin(tipA+0.4),ay+6*Math.cos(tipA+0.4));
    ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(0,220,255,0.9)';
    ctx.font='bold 9px Inter,sans-serif';
    ctx.textAlign='center';
    ctx.fillText(`STORM ${mv.speed.toFixed(0)}mph`,ax,ay-8);
    ctx.textAlign='left';
  }

  const aloftDir=S._upperWindDir;
  if(aloftDir!=null){
    const toDir=((aloftDir+180)%360)*Math.PI/180;
    const aLen=35*zoom;
    const ax=cx+Math.sin(toDir+rotZ)*aLen;
    const ay=cy-Math.cos(toDir+rotZ)*aLen*yScale;
    ctx.strokeStyle='rgba(255,0,220,0.5)';
    ctx.lineWidth=1.5;
    ctx.setLineDash([6,4]);
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ax,ay);ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='rgba(255,0,220,0.6)';
    ctx.beginPath();
    const tipA=Math.atan2(ax-cx,-(ay-cy));
    ctx.moveTo(ax,ay);
    ctx.lineTo(ax-5*Math.sin(tipA-0.4),ay+5*Math.cos(tipA-0.4));
    ctx.lineTo(ax-5*Math.sin(tipA+0.4),ay+5*Math.cos(tipA+0.4));
    ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(255,0,220,0.8)';
    ctx.font='bold 9px Inter,sans-serif';
    ctx.textAlign='center';
    ctx.fillText('ALOFT',ax,ay-8);
    ctx.textAlign='left';
  }
}

function buildHeadingStrip(){
  const track=document.getElementById('iso-hstrip-track');
  if(!track)return;
  const labels={0:'N',30:'030',45:'NE',60:'060',90:'E',120:'120',135:'SE',150:'150',180:'S',210:'210',225:'SW',240:'240',270:'W',300:'300',315:'NW',330:'330'};
  const cardinals=[0,45,90,135,180,225,270,315];
  const majors=[30,60,120,150,210,240,300,330];
  let html='';
  for(let r=0;r<3;r++){
    for(let deg=0;deg<360;deg+=10){
      const d=deg;
      const isCardinal=cardinals.includes(d);
      const isMajor=majors.includes(d);
      const isNorth=d===0;
      const cls=isCardinal?'cardinal'+(isNorth?' north':''):(isMajor?'major':'');
      const lbl=labels[d]||'';
      html+=`<div class="iso-hstrip-tick ${cls}" data-deg="${d}"><span class="iso-hstrip-lbl">${lbl}</span></div>`;
    }
  }
  track.innerHTML=html;
}
function updateIsoBillboard(){
  if(!ISO.scene)return;
  isoFpsTick();
  const els=ISO._stormEls;
  const t=`translate(-50%,-100%) rotateZ(${-ISO.tiltZ}deg) rotateX(${-ISO.tiltX}deg)`;
  for(let i=0;i<els.length;i++){
    els[i].style.transform=t;
  }
  const heading=(((-ISO.tiltZ)%360)+360)%360;
  const arrows=ISO._windArrows;
  if(arrows){
    for(let i=0;i<arrows.length;i++){
      const dir=parseFloat(arrows[i].dataset.dir);
      arrows[i].style.transform=`translate(-50%,-50%) rotate(${dir-heading}deg)`;
    }
  }
  const labels=ISO._windLabels;
  if(labels){
    for(let i=0;i<labels.length;i++){
      const dir=parseFloat(labels[i].dataset.dir);
      const r=parseFloat(labels[i].dataset.radius);
      const angle=(dir-heading)*Math.PI/180;
      labels[i].style.left=Math.sin(angle)*r+'px';
      labels[i].style.top=-Math.cos(angle)*r+'px';
    }
  }
}
function updateIsoCompass(){
  const track=document.getElementById('iso-hstrip-track');
  const hdg=document.getElementById('iso-hstrip-hdg');
  if(!track)return;
  const heading=(((-ISO.tiltZ)%360)+360)%360;
  const tickW=40;
  const totalTicks=36;
  const totalW=totalTicks*tickW;
  const offset=(heading/360)*totalW;
  const stripEl=document.getElementById('iso-hstrip');
  const centerX=stripEl?stripEl.clientWidth/2:180;
  track.style.transform=`translateX(${centerX-offset-totalW}px)`;
  if(hdg)hdg.textContent=`${Math.round(heading).toString().padStart(3,'0')}°`;
}

function setupIsoTouch(){
  const w=ISO.wrap;
  let dragging=false;
  let lastX,lastY;
  const markDirty=()=>{ISO._dirty=true;};

  w.addEventListener('pointerdown',(e)=>{
    if(e.target.closest('.iso-popup,.iso-legend,.iso-info,.iso-close,.iso-cam,.iso-height-ctrl'))return;
    dragging=true;
    lastX=e.clientX;
    lastY=e.clientY;
    w.setPointerCapture(e.pointerId);
  });
  w.addEventListener('pointermove',(e)=>{
    if(!dragging)return;
    const dx=e.clientX-lastX;
    const dy=e.clientY-lastY;
    ISO.tiltZ=(ISO.tiltZ+dx*0.3)%360;
    ISO.tiltX=Math.max(15,Math.min(85,ISO.tiltX+dy*0.3));
    lastX=e.clientX;
    lastY=e.clientY;
    markDirty();
  });
  w.addEventListener('pointerup',()=>{dragging=false;});
  w.addEventListener('pointercancel',()=>{dragging=false;});

  w.addEventListener('wheel',(e)=>{
    e.preventDefault();
    ISO.zoom=Math.max(0.3,Math.min(4,ISO.zoom-(e.deltaY>0?0.1:-0.1)));
    markDirty();
  },{passive:false});

  let pinchDist=null;
  w.addEventListener('touchstart',(e)=>{
    if(e.touches.length===2){
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      pinchDist=Math.hypot(dx,dy);
    }
  });
  w.addEventListener('touchmove',(e)=>{
    if(e.touches.length===2&&pinchDist){
      e.preventDefault();
      const dx=e.touches[0].clientX-e.touches[1].clientX;
      const dy=e.touches[0].clientY-e.touches[1].clientY;
      const newDist=Math.hypot(dx,dy);
      ISO.zoom=Math.max(0.3,Math.min(4,ISO.zoom*(newDist/pinchDist)));
      pinchDist=newDist;
      markDirty();
    }
  },{passive:false});
  w.addEventListener('touchend',()=>{pinchDist=null;});

  const camPad=document.getElementById('iso-cam');
  if(camPad){
    let camInterval=null;
    const camActions={
      up:()=>{ISO.tiltX=Math.max(15,ISO.tiltX-2);markDirty();},
      down:()=>{ISO.tiltX=Math.min(85,ISO.tiltX+2);markDirty();},
      left:()=>{ISO.tiltZ=(ISO.tiltZ-3)%360;markDirty();},
      right:()=>{ISO.tiltZ=(ISO.tiltZ+3)%360;markDirty();},
      zin:()=>{ISO.zoom=Math.min(4,ISO.zoom+0.1);markDirty();},
      zout:()=>{ISO.zoom=Math.max(0.3,ISO.zoom-0.1);markDirty();},
      reset:()=>{ISO.tiltX=55;ISO.tiltZ=0;ISO.zoom=1;markDirty();}
    };
    const startCam=(action)=>{
      if(camActions[action])camActions[action]();
      camInterval=setInterval(()=>{if(camActions[action])camActions[action]();},80);
    };
    const stopCam=()=>{if(camInterval){clearInterval(camInterval);camInterval=null;}};

    camPad.addEventListener('pointerdown',(e)=>{
      const btn=e.target.closest('[data-cam]');
      if(!btn)return;
      e.preventDefault();e.stopPropagation();
      startCam(btn.dataset.cam);
    });
    camPad.addEventListener('pointerup',stopCam);
    camPad.addEventListener('pointerleave',stopCam);
    camPad.addEventListener('pointercancel',stopCam);
  }
}

let _syncToken = localStorage.getItem('st_syncToken') || '';
let _syncEmail = localStorage.getItem('st_syncEmail') || '';
let _syncLastTime = localStorage.getItem('st_syncLastTime') || '';
let _emailAlertsOn = localStorage.getItem('st_emailAlerts') === '1';
let _syncFormMode='signup';
function _syncFormModeChanged(mode){_syncFormMode=mode;renderSyncSection()}

function _syncApiUrl() {
  const saved = localStorage.getItem('st_syncApiUrl');
  if (saved) return saved;
  if (location.hostname.includes('workers.dev')) return location.origin;
  return '';
}

async function _syncFetch(path, opts = {}) {
  const base = _syncApiUrl();
  if (!base) throw new Error('Sync server URL not configured');
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (_syncToken) headers['Authorization'] = 'Bearer ' + _syncToken;
  const res = await fetch(base + path, { ...opts, headers, signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function _gatherSyncSettings() {
  return {
    favorites: (function(){try{return JSON.parse(localStorage.getItem('st_favs')||'[]')}catch(e){return[]}})(),
    homeLocation: (function(){try{return JSON.parse(localStorage.getItem('st_home_location'))}catch(e){return null}})(),
    wxThresholds: (function(){try{return JSON.parse(localStorage.getItem('st_wxThresholds'))}catch(e){return{}}})(),
    stormThresholds: (function(){try{return JSON.parse(localStorage.getItem('st_stormThresholds'))}catch(e){return{}}})(),
    units: (function(){try{return JSON.parse(localStorage.getItem('st_units'))}catch(e){return null}})(),
    unitMode: localStorage.getItem('st_unitMode') || 'auto',
    customUnits: (function(){try{return JSON.parse(localStorage.getItem('st_customUnits'))}catch(e){return null}})(),
    gaugeStyle: localStorage.getItem('st_gaugeStyle') || 'neon',
    timeFormat: localStorage.getItem('st_timeFormat') || 'auto',
    sonarCfg: (function(){try{return JSON.parse(localStorage.getItem('st_sonarCfg'))}catch(e){return null}})(),
    sonarZoom: parseInt(localStorage.getItem('st_sonarZoom')) || 80,
    tickerSpeed: parseInt(localStorage.getItem('st_tickerSpeed')) || 100,
    iconPack: localStorage.getItem('st_iconPack') || 'basmilius',
    customBasePack: localStorage.getItem('st_customBasePack') || 'basmilius',
    emailAlerts: _emailAlertsOn,
  };
}

function _applySyncSettings(s) {
  if (!s || typeof s !== 'object') return;
  if (s.favorites) { try { localStorage.setItem('st_favs', JSON.stringify(s.favorites)); } catch(e){} }
  if (s.homeLocation) { try { localStorage.setItem('st_home_location', JSON.stringify(s.homeLocation)); } catch(e){} }
  if (s.wxThresholds) { try { localStorage.setItem('st_wxThresholds', JSON.stringify(s.wxThresholds)); } catch(e){} }
  if (s.stormThresholds) { try { localStorage.setItem('st_stormThresholds', JSON.stringify(s.stormThresholds)); } catch(e){} }
  if (s.units) { try { localStorage.setItem('st_units', JSON.stringify(s.units)); } catch(e){} }
  if (s.unitMode) localStorage.setItem('st_unitMode', s.unitMode);
  if (s.customUnits) { try { localStorage.setItem('st_customUnits', JSON.stringify(s.customUnits)); } catch(e){} }
  if (s.gaugeStyle) localStorage.setItem('st_gaugeStyle', s.gaugeStyle);
  if (s.timeFormat) localStorage.setItem('st_timeFormat', s.timeFormat);
  if (s.sonarCfg) { try { localStorage.setItem('st_sonarCfg', JSON.stringify(s.sonarCfg)); } catch(e){} }
  if (s.sonarZoom) localStorage.setItem('st_sonarZoom', String(s.sonarZoom));
  if (s.tickerSpeed) localStorage.setItem('st_tickerSpeed', String(s.tickerSpeed));
  if (s.iconPack) localStorage.setItem('st_iconPack', s.iconPack);
  if (s.customBasePack) localStorage.setItem('st_customBasePack', s.customBasePack);
  if (s.emailAlerts !== undefined) {
    _emailAlertsOn = !!s.emailAlerts;
    localStorage.setItem('st_emailAlerts', _emailAlertsOn ? '1' : '0');
  }
}

function _setSyncState(token, email) {
  _syncToken = token || '';
  _syncEmail = email || '';
  localStorage.setItem('st_syncToken', _syncToken);
  localStorage.setItem('st_syncEmail', _syncEmail);
}

function _clearSyncState() {
  _syncToken = ''; _syncEmail = ''; _syncLastTime = '';
  localStorage.removeItem('st_syncToken');
  localStorage.removeItem('st_syncEmail');
  localStorage.removeItem('st_syncLastTime');
}

function _getSyncEmail(){
  const el=document.getElementById('sync-email');
  const v=(el?el.value:'').trim();
  if(!v)return{err:'Enter email address'};
  return{email:v};
}

async function syncSignup() {
  const pinEl = document.getElementById('sync-pin');
  if (!pinEl) return;
  const {email,err}=_getSyncEmail();
  if(err)return toast(err);
  const pin = pinEl.value.trim();
  if (!pin) return toast('Enter a PIN');
  if (!/^\d{4,6}$/.test(pin)) return toast('PIN must be 4-6 digits');
  try {
    const data = await _syncFetch('/api/signup', { method: 'POST', body: JSON.stringify({ email, pin }) });
    _setSyncState(data.token, data.email);
    toast('✅ Account created');
    renderSyncSection();
    syncPushSettings();
  } catch (e) {
    toast('❌ ' + (e.message || 'Signup failed'));
  }
}

async function syncLogin() {
  const emailEl = document.getElementById('sync-email');
  const pinEl = document.getElementById('sync-pin');
  if (!emailEl || !pinEl) return;
  const email = emailEl.value.trim();
  if (!email) return toast('Enter your email address');
  const pin = pinEl.value.trim();
  if (!pin) return toast('Enter your PIN');
  try {
    const data = await _syncFetch('/api/login', { method: 'POST', body: JSON.stringify({ email, pin }) });
    _setSyncState(data.token, data.email);
    toast('✅ Logged in');
    renderSyncSection();
    syncPullSettings();
  } catch (e) {
    toast('❌ ' + (e.message || 'Login failed'));
  }
}

async function syncLogout() {
  try { await _syncFetch('/api/logout', { method: 'POST' }); } catch(e) {}
  _clearSyncState();
  toast('Logged out');
  renderSyncSection();
}

async function syncPushSettings() {
  if (!_syncToken) return toast('Not logged in');
  try {
    const settings = _gatherSyncSettings();
    const data = await _syncFetch('/api/settings/sync', { method: 'POST', body: JSON.stringify({ settings }) });
    _syncLastTime = data.updated_at || new Date().toISOString();
    localStorage.setItem('st_syncLastTime', _syncLastTime);
    toast('☁️ Settings uploaded');
    renderSyncSection();
  } catch (e) {
    toast('❌ ' + (e.message || 'Sync failed'));
  }
}

async function syncPullSettings() {
  if (!_syncToken) return toast('Not logged in');
  try {
    const data = await _syncFetch('/api/settings');
    if (data.settings && Object.keys(data.settings).length > 0) {
      _applySyncSettings(data.settings);
      _syncLastTime = data.updated_at || '';
      localStorage.setItem('st_syncLastTime', _syncLastTime);
      toast('☁️ Settings restored');
      try { loadUnits(); syncSettingsPanel(); } catch(e) {}
    } else {
      toast('No saved settings found — uploading current settings');
      syncPushSettings();
    }
    renderSyncSection();
  } catch (e) {
    toast('❌ ' + (e.message || 'Pull failed'));
  }
}

function toggleEmailAlerts() {
  _emailAlertsOn = !_emailAlertsOn;
  localStorage.setItem('st_emailAlerts', _emailAlertsOn ? '1' : '0');
  renderSyncSection();
  if (_syncToken) syncPushSettings();
}

async function sendTestAlert() {
  if (!_syncToken) return toast('Not logged in');
  const btn = document.getElementById('btn-test-alert');
  if (btn) { btn.disabled = true; btn.textContent = '📨 Sending...'; }
  try {
    const data = await _syncFetch('/api/test-alert', { method: 'POST' });
    if (data.ok) {
      toast('✅ Test sent via ' + (data.provider || 'email') + ' to ' + (data.to || ''));
    } else {
      toast('❌ ' + (data.error || 'Send failed'));
    }
  } catch (e) {
    toast('❌ ' + (e.message || 'Test failed'));
  }
  if (btn) { btn.disabled = false; btn.textContent = '📨 Send Test'; }
}

function setSyncApiUrl() {
  const el = document.getElementById('sync-api-url');
  if (!el) return;
  const url = el.value.trim().replace(/\/+$/, '');
  localStorage.setItem('st_syncApiUrl', url);
  toast(url ? '🔗 Sync server URL saved' : 'Sync server URL cleared');
  renderSyncSection();
}

async function syncDeleteAccount() {
  if (!confirm('Delete your sync account? This removes all synced data from the server. Local settings are not affected.')) return;
  try {
    await _syncFetch('/api/account', { method: 'DELETE' });
    _clearSyncState();
    _emailAlertsOn = false;
    localStorage.setItem('st_emailAlerts', '0');
    toast('Account deleted');
    renderSyncSection();
  } catch (e) {
    toast('❌ ' + (e.message || 'Delete failed'));
  }
}

function renderSyncSection() {
  const el = document.getElementById('sync-alerts-section');
  if (!el) return;
  const base = _syncApiUrl();
  const loggedIn = !!_syncToken && !!base;

  let html = '';

  html += '<div class="mb-8"><div style="display:flex;align-items:center;gap:4px;margin-bottom:4px"><span class="text-muted-65">Server URL</span></div>';
  html += `<div style="display:flex;gap:4px"><input type="text" id="sync-api-url" value="${escHtml(base)}" placeholder="https://your-worker.workers.dev" style="flex:1;font-size:0.65em;padding:4px 6px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;font-family:var(--font-mono)"><button onclick="setSyncApiUrl()" style="font-size:0.6em;padding:4px 8px;background:rgba(167,139,250,0.12);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);border-radius:6px;cursor:pointer;font-weight:600;white-space:nowrap">Save</button></div></div>`;

  if (!base) {
    html += '<div style="font-size:0.6em;color:var(--text-muted);padding:8px 0">Set your Cloudflare Worker URL above to enable sync & email alerts. See worker/README.md for setup instructions.</div>';
    el.innerHTML = html;
    return;
  }

  if (!loggedIn) {
    const isSignup=_syncFormMode!=='login';
    const modeTab=(label,active,mode)=>`<button onclick="_syncFormModeChanged('${mode}')" style="flex:1;padding:5px;font-size:0.65em;font-weight:600;cursor:pointer;border-radius:6px 6px 0 0;border:1px solid ${active?'rgba(167,139,250,0.4)':'var(--border-subtle)'};border-bottom:none;background:${active?'rgba(167,139,250,0.12)':'rgba(255,255,255,0.02)'};color:${active?'#a78bfa':'var(--text-muted)'}">${label}</button>`;
    html+='<div style="display:flex;gap:2px;margin-bottom:0">';
    html+=modeTab('Sign Up',isSignup,'signup');
    html+=modeTab('Log In',!isSignup,'login');
    html+='</div>';
    html+='<div style="margin-bottom:6px;padding:8px;border:1px solid var(--border-subtle);border-radius:0 0 6px 6px;background:rgba(255,255,255,0.02)">';
    if(isSignup){
      html+='<input type="email" id="sync-email" placeholder="you@email.com" style="width:100%;font-size:0.7em;padding:6px 8px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;margin-bottom:4px;box-sizing:border-box">';
      html+='<input type="password" id="sync-pin" placeholder="Create a 4-6 digit PIN" inputmode="numeric" pattern="[0-9]*" maxlength="6" style="width:100%;font-size:0.7em;padding:6px 8px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;box-sizing:border-box">';
      html+='</div>';
      html+='<button onclick="syncSignup()" style="width:100%;padding:7px;font-size:0.7em;font-weight:600;background:rgba(167,139,250,0.15);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);border-radius:6px;cursor:pointer;margin-bottom:6px">Create Account</button>';
    }else{
      html+='<input type="email" id="sync-email" placeholder="you@email.com" style="width:100%;font-size:0.7em;padding:6px 8px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;margin-bottom:4px;box-sizing:border-box">';
      html+='<input type="password" id="sync-pin" placeholder="Your PIN" inputmode="numeric" pattern="[0-9]*" maxlength="6" style="width:100%;font-size:0.7em;padding:6px 8px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:6px;box-sizing:border-box">';
      html+='</div>';
      html+='<button onclick="syncLogin()" style="width:100%;padding:7px;font-size:0.7em;font-weight:600;background:rgba(0,229,255,0.1);color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.3);border-radius:6px;cursor:pointer;margin-bottom:6px">Log In</button>';
    }
    html += '<div class="text-hint" style="font-size:0.55em">Account is optional — the app works fully without one.</div>';
  } else {
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span class="text-secondary-sm">📧 ${escHtml(_syncEmail)}</span><span style="font-size:0.55em;padding:2px 8px;background:rgba(0,200,100,0.15);color:#00cc66;border-radius:10px;font-weight:600">Connected</span></div>`;

    html += '<div style="display:flex;gap:4px;margin-bottom:8px">';
    html += '<button onclick="syncPushSettings()" style="flex:1;padding:6px;font-size:0.65em;font-weight:600;background:rgba(167,139,250,0.12);color:#a78bfa;border:1px solid rgba(167,139,250,0.3);border-radius:6px;cursor:pointer">⬆ Upload</button>';
    html += '<button onclick="syncPullSettings()" style="flex:1;padding:6px;font-size:0.65em;font-weight:600;background:rgba(0,229,255,0.1);color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.3);border-radius:6px;cursor:pointer">⬇ Download</button>';
    html += '</div>';

    if (_syncLastTime) {
      try {
        const d = new Date(_syncLastTime);
        html += `<div style="font-size:0.55em;color:var(--text-muted);margin-bottom:8px">Last sync: ${fmtClock(d)} · ${d.toLocaleDateString()}</div>`;
      } catch(e) {}
    }

    const alertOn = _emailAlertsOn;
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid var(--border-subtle)">';
    html += '<div><span class="text-secondary-sm">📬 Email Alerts</span><div style="font-size:0.55em;color:var(--text-muted);margin-top:2px">Get emailed when thresholds are exceeded</div></div>';
    html += `<button onclick="toggleEmailAlerts()" style="font-size:0.65em;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:600;border:1px solid ${alertOn?'#00cc66':'var(--border-subtle)'};background:${alertOn?'rgba(0,200,100,0.15)':'rgba(255,255,255,0.04)'};color:${alertOn?'#00cc66':'var(--text-muted)'}">${alertOn?'ON':'OFF'}</button>`;
    html += '</div>';
    html += '<button onclick="sendTestAlert()" id="btn-test-alert" style="width:100%;padding:6px;font-size:0.65em;font-weight:600;background:rgba(255,165,0,0.12);color:#ffa500;border:1px solid rgba(255,165,0,0.3);border-radius:6px;cursor:pointer;margin-bottom:8px">📨 Send Test Email</button>';
    if (alertOn) {
      html += '<div style="font-size:0.55em;color:var(--text-muted);margin-bottom:8px;padding:0 4px">Alerts check your saved locations every 10 minutes against your Weather Station Alert thresholds above. 15-min cooldown per alert type.</div>';
    }

    html += '<div style="display:flex;gap:4px;margin-top:6px">';
    html += '<button onclick="syncLogout()" style="flex:1;padding:5px;font-size:0.6em;font-weight:600;background:rgba(255,255,255,0.04);color:var(--text-muted);border:1px solid var(--border-subtle);border-radius:6px;cursor:pointer">Log Out</button>';
    html += '<button onclick="syncDeleteAccount()" style="flex:1;padding:5px;font-size:0.6em;font-weight:600;background:rgba(255,51,85,0.08);color:var(--accent-red);border:1px solid rgba(255,51,85,0.3);border-radius:6px;cursor:pointer">Delete Account</button>';
    html += '</div>';
  }

  el.innerHTML = html;
}

(function initLang(){
  const flag=LANGS.find(l=>l.c===_curLang);
  document.getElementById('btn-lang').textContent=flag?flag.f:'🇺🇸';
  startTranslateObserver();
  if(_curLang!=='en'){
    preseedStormVocab(_curLang);
    setTimeout(()=>translatePage(_curLang),2000);
  }
})();