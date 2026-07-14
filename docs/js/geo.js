// StormTracker — Geolocation, Search, Favorites, Travel Mode

const LOC_METHOD={GPS:'gps',ADDRESS:'address',MAP:'map',FAVORITE:'favorite',HOME:'home',RECENTER:'recenter',SCAN_HERE:'scan_here'};
const _LOC_HANDLERS={
  gps:()=>showLocationConfirm(),
  address:(p)=>{if(p&&p.query)document.getElementById('location-input').value=p.query;searchLoc()},
  map:()=>startMapPick(),
  favorite:(p)=>{const favs=getFavorites();const f=favs[p.idx];if(f){setLoc(f.lat,f.lon,f.name);toggleLocOverlay(false)}},
  home:()=>goHome(),
  recenter:()=>recenterMap(),
  scan_here:()=>scanHere()
};
function setLocation(method,payload){const h=_LOC_HANDLERS[method];if(h)h(payload||{})}

let _sugTimer=null,_sugIdx=-1,_sugResults=[];
function _syncClearBtn(){const b=document.getElementById('loc-clear-btn');if(b)b.style.display=document.getElementById('location-input').value?'flex':'none'}
document.getElementById('location-input').addEventListener('input',e=>{
  _syncClearBtn();
  const q=e.target.value.trim();
  if(q.length<2){hideSuggestions();return}
  clearTimeout(_sugTimer);
  _sugTimer=setTimeout(()=>fetchSuggestions(q),300);
});
document.getElementById('loc-clear-btn').addEventListener('click',e=>{
  e.preventDefault();
  const inp=document.getElementById('location-input');
  inp.value='';
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  hideSuggestions();
  inp.focus();
  _syncClearBtn();
});
document.getElementById('location-input').addEventListener('keydown',e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    const box=document.getElementById('loc-suggestions');
    if(box.classList.contains('active')&&_sugIdx>=0){selectSuggestion(_sugResults[_sugIdx])}
    else{hideSuggestions();searchLoc()}
    return;
  }
  const box=document.getElementById('loc-suggestions');
  if(!box.classList.contains('active'))return;
  if(e.key==='ArrowDown'){e.preventDefault();_sugIdx=Math.min(_sugIdx+1,_sugResults.length-1);highlightSug()}
  else if(e.key==='ArrowUp'){e.preventDefault();_sugIdx=Math.max(_sugIdx-1,0);highlightSug()}
  else if(e.key==='Escape'){hideSuggestions()}
});
function cleanQ(q){return q.replace(/\./g,'').replace(/\s+/g,' ').trim()}
// ---- Messy-address normalization + progressive search (v5.55) ----
const _US_STATES={AL:1,AK:1,AZ:1,AR:1,CA:1,CO:1,CT:1,DE:1,DC:1,FL:1,GA:1,HI:1,ID:1,IL:1,IN:1,IA:1,KS:1,KY:1,LA:1,ME:1,MD:1,MA:1,MI:1,MN:1,MS:1,MO:1,MT:1,NE:1,NV:1,NH:1,NJ:1,NM:1,NY:1,NC:1,ND:1,OH:1,OK:1,OR:1,PA:1,RI:1,SC:1,SD:1,TN:1,TX:1,UT:1,VT:1,VA:1,WA:1,WV:1,WI:1,WY:1,PR:1,VI:1,GU:1,AS:1,MP:1};
function _pcLike(s){
  const t=String(s).replace(/\s+/g,'').toUpperCase();
  return /^\d{5}(-\d{4})?$/.test(t)||/^\d{4,6}$/.test(t)||/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(t)||/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(t);
}
// Parse a free-form address: split on commas, drop exact-duplicate segments,
// strip junk partial postcodes ("TN 3" when "37876" appears later; "ON K1M" when "K1M 1M4" appears),
// and pull out street / house number / city / state / postcode for retries + labeling.
function _addrParse(raw){
  let segs=cleanQ(raw).split(',').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const digitToks=[];
  segs.forEach(s=>{
    s.split(' ').forEach(t=>{if(/\d/.test(t))digitToks.push(t.toUpperCase())});
    if(_pcLike(s))digitToks.push(s.replace(/\s+/g,'').toUpperCase());
  });
  // Strip junk partial postcodes from locality segments only (never the street,
  // so European trailing house numbers like "Marienplatz 8" survive)
  segs=segs.map((s,idx)=>{
    if(idx===0)return s;
    const toks=s.split(' ');
    while(toks.length>1){
      const last=toks[toks.length-1].toUpperCase();
      if(/\d/.test(last)&&digitToks.some(t=>t!==last&&t.length>last.length&&t.startsWith(last)))toks.pop();
      else break;
    }
    return toks.join(' ');
  });
  const seen={};segs=segs.filter(s=>{const k=s.toUpperCase();if(seen[k])return false;seen[k]=1;return true});
  const street=segs.length>1?segs[0]:'';
  let houseNum='',roadOnly=street,m;
  if((m=street.match(/^(\d+[A-Za-z]?)\s+(.+)$/))){houseNum=m[1];roadOnly=m[2]}
  else if((m=street.match(/^(.+?)\s+(\d+[A-Za-z]?)$/))&&!/\b(highway|hwy|route|rte|rt|interstate|loop|county road|state road|cr|fm|sr)$/i.test(m[1])){houseNum=m[2];roadOnly=m[1]}
  const rest=segs.slice(1);
  let zip='',state='',city='';
  for(const s of rest){
    if(!zip&&_pcLike(s)){zip=s;continue}
    const toks=s.split(' '),cityToks=[];
    for(const t of toks){
      const u=t.toUpperCase();
      if(!zip&&_pcLike(t))zip=t;
      else if(!state&&t.length===2&&_US_STATES[u])state=u;
      else cityToks.push(t);
    }
    if(!city&&cityToks.length)city=cityToks.join(' ');
  }
  const isUS=!!(state&&zip&&/^\d{5}(-\d{4})?$/.test(zip))||/\b(USA|United States)\b/i.test(raw);
  return{segs,street,roadOnly,houseNum,rest,zip,state,city,isUS};
}
// Ordered retry queries, from most specific to broadest. Max 6.
function _addrCandidates(p){
  const out=[];
  const push=q=>{q=(q||'').replace(/\s+/g,' ').trim();if(q&&!out.some(x=>x.toUpperCase()===q.toUpperCase()))out.push(q)};
  push(p.segs.join(', '));
  if(p.street){
    const loc=p.rest.filter(s=>!_pcLike(s));
    if(p.zip)push(p.street+', '+p.zip);
    if(loc.length)push(p.street+', '+loc.join(', '));
    if(p.roadOnly&&p.roadOnly!==p.street){
      if(p.rest.length)push(p.roadOnly+', '+p.rest.join(', '));
      if(p.zip)push(p.roadOnly+', '+p.zip);
    }
    // Locality-only last resort — but never a bare state code or postcode alone
    if(p.rest.some(s=>!_pcLike(s)&&!(s.length===2&&_US_STATES[s.toUpperCase()])))push(p.rest.join(', '));
  }
  return out.slice(0,6);
}
function _titleCase(s){return String(s).toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase())}
const _US_STATE_NAMES={AL:'ALABAMA',AK:'ALASKA',AZ:'ARIZONA',AR:'ARKANSAS',CA:'CALIFORNIA',CO:'COLORADO',CT:'CONNECTICUT',DE:'DELAWARE',DC:'DISTRICT OF COLUMBIA',FL:'FLORIDA',GA:'GEORGIA',HI:'HAWAII',ID:'IDAHO',IL:'ILLINOIS',IN:'INDIANA',IA:'IOWA',KS:'KANSAS',KY:'KENTUCKY',LA:'LOUISIANA',ME:'MAINE',MD:'MARYLAND',MA:'MASSACHUSETTS',MI:'MICHIGAN',MN:'MINNESOTA',MS:'MISSISSIPPI',MO:'MISSOURI',MT:'MONTANA',NE:'NEBRASKA',NV:'NEVADA',NH:'NEW HAMPSHIRE',NJ:'NEW JERSEY',NM:'NEW MEXICO',NY:'NEW YORK',NC:'NORTH CAROLINA',ND:'NORTH DAKOTA',OH:'OHIO',OK:'OKLAHOMA',OR:'OREGON',PA:'PENNSYLVANIA',RI:'RHODE ISLAND',SC:'SOUTH CAROLINA',SD:'SOUTH DAKOTA',TN:'TENNESSEE',TX:'TEXAS',UT:'UTAH',VT:'VERMONT',VA:'VIRGINIA',WA:'WASHINGTON',WV:'WEST VIRGINIA',WI:'WISCONSIN',WY:'WYOMING',PR:'PUERTO RICO',VI:'US VIRGIN ISLANDS',GU:'GUAM',AS:'AMERICAN SAMOA',MP:'NORTHERN MARIANA ISLANDS'};
// Does a geocoder result agree with the locality the user typed (zip OR state OR city)?
// Guards against fuzzy matches landing in the wrong state (same street name elsewhere).
function _addrLocMatch(p,a,dispName){
  if(!p.zip&&!p.state&&!p.city)return true;
  const norm=s=>String(s||'').replace(/\s+/g,'').toUpperCase();
  if(p.zip&&a.postcode&&(norm(a.postcode)===norm(p.zip)||norm(a.postcode).indexOf(norm(p.zip))===0||norm(p.zip).indexOf(norm(a.postcode))===0))return true;
  if(p.state&&a.state&&(norm(a.state)===p.state||norm(a.state)===norm(_US_STATE_NAMES[p.state]||'')))return true;
  if(p.city){
    const c=norm(p.city);
    if([a.city,a.town,a.village,a.municipality,a.suburb,a.county].some(x=>x&&norm(x)===c))return true;
    if(dispName&&norm(dispName).indexOf(c)!==-1)return true;
  }
  return false;
}
// Does the result's road resemble the street the user typed? (longest word must appear)
function _roadMatch(p,a){
  if(!p.roadOnly||!a.road)return true;
  const toks=p.roadOnly.toUpperCase().split(/[^A-Z0-9]+/).filter(t=>t.length>2);
  if(!toks.length)return true;
  const t=toks.reduce((x,y)=>y.length>x.length?y:x);
  return String(a.road).toUpperCase().indexOf(t)!==-1;
}
// US Census Bureau geocoder via JSONP (no CORS support). US house-level rescue only.
let _censusSeq=0;
function censusSearch(q){
  return new Promise((resolve,reject)=>{
    const cb='__stCensusCb'+(++_censusSeq);
    const s=document.createElement('script');
    const t=setTimeout(()=>{cleanup();reject(new Error('Census timeout'))},6000);
    function cleanup(){clearTimeout(t);try{delete window[cb]}catch(e){window[cb]=undefined}if(s.parentNode)s.parentNode.removeChild(s)}
    window[cb]=d=>{
      cleanup();
      const ms=(d&&d.result&&d.result.addressMatches)||[];
      resolve(ms.filter(mm=>mm.coordinates).map(mm=>{
        const co=mm.coordinates,a=mm.addressComponents||{};
        const road=_titleCase([a.preQualifier,a.preDirection,a.preType,a.streetName,a.suffixType,a.suffixDirection,a.suffixQualifier].filter(Boolean).join(' '));
        const hn=(mm.matchedAddress||'').match(/^(\d+[A-Za-z]?)[\s,]/);
        return{lat:String(co.y),lon:String(co.x),display_name:_titleCase(mm.matchedAddress||''),
          address:{house_number:hn?hn[1]:'',road:road,city:_titleCase(a.city||''),state:a.state||'',postcode:a.zip||'',country:'United States',country_code:'us'}};
      }));
    };
    s.onerror=()=>{cleanup();reject(new Error('Census load failed'))};
    s.src='https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address='+encodeURIComponent(q)+'&benchmark=Public_AR_Current&format=jsonp&callback='+cb;
    document.head.appendChild(s);
  });
}
// ── Search diagnostics: every smartGeoSearch records a step-by-step trace of
//    what was tried and why results were rejected. Shown in the location
//    overlay when a search fails; always logged to the console as [geo trace].
let _geoTrace=null,_geoStep=null;
function _geoBrief(r){
  const a=(r&&r.address)||{};
  return [a.house_number&&a.road?a.house_number+' '+a.road:a.road,a.city||a.town||a.village,a.state,a.postcode].filter(Boolean).join(', ')||(r&&r.display_name)||'?';
}
// Walk the candidate ladder: return the first house-level match immediately,
// otherwise remember the best road/place-level hit. For US street addresses,
// try the Census geocoder as a house-level rescue before settling.
async function smartGeoSearch(raw,limit){
  const p=_addrParse(raw);
  const cands=_addrCandidates(p);
  const t0=Date.now();
  _geoTrace={raw:raw,cleaned:p.segs.join(', '),steps:[]};
  const done=res=>{
    _geoTrace.tookMs=Date.now()-t0;
    _geoTrace.found=!!(res.data&&res.data.length);
    try{console.log('[geo trace]',JSON.stringify(_geoTrace,null,1))}catch(e){}
    return res;
  };
  let best=null,bestScore=-1;
  for(let i=0;i<cands.length;i++){
    const q=cands[i];
    const step={q:q,providers:[],outcome:''};_geoTrace.steps.push(step);
    if(Date.now()-t0>12000){step.outcome='skipped — ran out of time';continue}
    // Once we have a road-level hit, only candidates still containing the full street (house number) can do better
    if(bestScore>=2&&p.street&&q.toUpperCase().indexOf(p.street.toUpperCase())===-1){step.outcome='skipped — already have a road-level match';continue}
    if(i>0)await new Promise(r=>setTimeout(r,600));
    let data=[];
    _geoStep=step;
    try{data=await geoSearch(q,limit)}catch(e){}
    _geoStep=null;
    if(!data.length){step.outcome='no results';continue}
    const r=data[0],a=r.address||{};
    // Reject fuzzy matches in the wrong area (same street name in another state/country)
    // or on the wrong street (geocoder "nearest guess" in the right city) — a wrong
    // location is worse than "not found" for storm alerts
    if(!_addrLocMatch(p,a,r.display_name)){step.outcome='rejected — wrong area: got "'+_geoBrief(r)+'"';continue}
    if(!_roadMatch(p,a)){step.outcome='rejected — different street: got "'+_geoBrief(r)+'"';continue}
    const score=(a.house_number&&a.road)?3:(a.road?2:1);
    step.outcome=(score===3?'exact match':score===2?'road-level match':'place-level match')+': "'+_geoBrief(r)+'"';
    if(score===3)return done({data,parsed:p});
    if(score>bestScore){best=data;bestScore=score}
  }
  if(p.isUS&&p.houseNum&&bestScore<3){
    const step={q:p.segs.join(', ')+' [US Census]',providers:[],outcome:''};_geoTrace.steps.push(step);
    try{
      const cd=await censusSearch(p.segs.join(', '));
      if(cd.length){step.outcome='exact match: "'+_geoBrief(cd[0])+'"';return done({data:cd,parsed:p})}
      step.outcome='no match';
    }catch(e){step.outcome='error: '+e.message;console.log('Census geocoder failed:',e.message)}
  }
  // Guaranteed last resort: if the ladder found nothing (or the deadline cut it short),
  // resolve at least the locality the user typed — better a city-center pin with the
  // user's street kept in the label than "Location not found"
  if(!best&&p.street&&p.rest.length){
    const locQ=p.rest.join(', ');
    const step={q:locQ+' [area only]',providers:[],outcome:''};_geoTrace.steps.push(step);
    _geoStep=step;
    try{
      const d=await geoSearch(locQ,limit);
      const a0=(d.length&&d[0].address)||{};
      if(d.length&&_addrLocMatch(p,a0,d[0].display_name)){
        // Demote to locality level: drop whatever random street the geocoder
        // fuzzy-matched so the label falls back to the user's own typed street
        const clean=Object.assign({},a0);delete clean.house_number;delete clean.road;
        best=[Object.assign({},d[0],{address:clean,display_name:locQ})];
        step.outcome='area-level match: "'+locQ+'"';
      }else step.outcome=d.length?'rejected — wrong area: got "'+_geoBrief(d[0])+'"':'no results';
    }catch(e){step.outcome='error: '+e.message}
    _geoStep=null;
  }
  return done({data:best||[],parsed:p});
}
async function nomSearch(q,limit){
  const res=await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=${limit}&addressdetails=1`,{signal:AbortSignal.timeout(5000)});
  if(!res.ok)throw new Error('Nominatim '+res.status);
  return res.json();
}
async function photonSearch(q,limit){
  const res=await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}&lang=en`,{signal:AbortSignal.timeout(5000)});
  if(!res.ok)throw new Error('Photon '+res.status);
  const data=await res.json();
  return(data.features||[]).map(f=>{
    const p=f.properties||{};const c=f.geometry?.coordinates||[];
    return{lat:String(c[1]),lon:String(c[0]),display_name:[p.name,p.city||p.town||p.village||'',p.state||'',p.country||''].filter(Boolean).join(', '),
      address:{house_number:p.housenumber,road:p.street,city:p.city,town:p.town,village:p.village,hamlet:p.hamlet,suburb:p.suburb,district:p.district,administrative:p.district,county:p.county,state:p.state,state_district:p.state_district,country:p.country,country_code:p.countrycode,municipality:p.municipality,borough:p.borough,region:p.region,province:p.province}};
  });
}
async function omGeoSearch(q,limit){
  const res=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=${limit}&language=en`,{signal:AbortSignal.timeout(5000)});
  if(!res.ok)throw new Error('OM Geo '+res.status);
  const data=await res.json();
  return(data.results||[]).map(r=>({lat:String(r.latitude),lon:String(r.longitude),display_name:[r.name,r.admin1||'',r.country||''].filter(Boolean).join(', '),
    address:{city:r.name,state:r.admin1||'',country:r.country||'',country_code:(r.country_code||'').toLowerCase()}}));
}
async function geoSearch(q,limit){
  try{const d=await nomSearch(q,limit);if(_geoStep)_geoStep.providers.push('Nominatim: '+d.length+' hit'+(d.length===1?'':'s'));return d}
  catch(e){console.log('Nominatim failed:',e.message);if(_geoStep)_geoStep.providers.push('Nominatim: '+e.message)}
  try{const d=await photonSearch(q,limit);if(_geoStep)_geoStep.providers.push('Photon: '+d.length+' hit'+(d.length===1?'':'s'));return d}
  catch(e){console.log('Photon failed:',e.message);if(_geoStep)_geoStep.providers.push('Photon: '+e.message)}
  try{const d=await omGeoSearch(q,limit);if(_geoStep)_geoStep.providers.push('Open-Meteo: '+d.length+' hit'+(d.length===1?'':'s'));return d}
  catch(e){console.log('Open-Meteo geo failed:',e.message);if(_geoStep)_geoStep.providers.push('Open-Meteo: '+e.message)}
  return[];
}
async function fetchSuggestions(q){
  try{
    const p=_addrParse(q);
    const canon=p.segs.join(', ');
    let data=await geoSearch(canon,5);
    if(!data.length&&p.street&&p.zip)data=await geoSearch(p.street+', '+p.zip,5);
    if(!data.length){
      const simple=q.replace(/^\d+\s*/,'').replace(/\./g,'').trim();
      if(simple!==canon)data=await geoSearch(simple,5);
    }
    _sugResults=data;_sugIdx=-1;
    const box=document.getElementById('loc-suggestions');
    if(!data.length){hideSuggestions();return}
    box.innerHTML=data.map((r,i)=>{
      const parts=r.display_name.split(',');
      const name=parts[0].trim();
      const detail=parts.slice(1,3).map(s=>s.trim()).join(', ');
      return`<div class="loc-sug-item" data-idx="${i}" onmousedown="event.preventDefault();selectSuggestion(_sugResults[${i}])" ontouchend="event.preventDefault();selectSuggestion(_sugResults[${i}])">
        <div class="sug-name">${name}</div>
        <div class="sug-detail">${detail}</div>
      </div>`;
    }).join('');
    box.classList.add('active');
  }catch(e){}
}
function fmtLocName(addr,fallback){
  const parts=[];
  if(addr.house_number&&addr.road)parts.push(addr.house_number+' '+addr.road);
  else if(addr.road)parts.push(addr.road);
  const place=addr.city||addr.town||addr.village||addr.hamlet||addr.municipality||addr.suburb||addr.borough||addr.district||addr.administrative||addr.county||addr.region||'';
  if(place)parts.push(place);
  const state=addr.state||addr.state_district||addr.province||'';
  if(state&&state!==place)parts.push(state);
  if(addr.country&&addr.country_code!=='us')parts.push(addr.country);
  return parts.length?parts.join(', '):(fallback||'Unknown');
}
function selectSuggestion(r){
  hideSuggestions();
  const lat=parseFloat(r.lat),lon=parseFloat(r.lon);
  const addr=r.address||{};
  const name=fmtLocName(addr,r.display_name.split(',').slice(0,2).join(',').trim());
  document.getElementById('location-input').value=name;
  toggleLocOverlay(false);
  setLoc(lat,lon,name);
  const cc=addr.country_code;
  if(cc)setTimeout(()=>checkLocationUnits(cc),500);
}
function hideSuggestions(){
  clearTimeout(_sugTimer);_sugTimer=null;
  const box=document.getElementById('loc-suggestions');
  box.classList.remove('active');box.innerHTML='';_sugIdx=-1;_sugResults=[];
}
function highlightSug(){
  document.querySelectorAll('.loc-sug-item').forEach((el,i)=>{
    el.classList.toggle('selected',i===_sugIdx);
    if(i===_sugIdx)el.scrollIntoView({block:'nearest'});
  });
}

async function _checkGpsPermission(){
  if(!navigator.geolocation)return 'denied';
  if(navigator.permissions){
    try{const p=await navigator.permissions.query({name:'geolocation'});return p.state}catch(e){}
  }
  return 'prompt';
}

async function toggleAutoGps(){
  const cur=localStorage.getItem('st_autoGps')==='1';
  if(cur){
    localStorage.removeItem('st_autoGps');
    toast('📍 Auto-locate on load disabled');
    syncSettingsPanel();
    return;
  }
  const perm=await _checkGpsPermission();
  if(perm==='granted'){
    localStorage.setItem('st_autoGps','1');
    toast('📍 Auto-locate on load enabled');
    syncSettingsPanel();
    return;
  }
  _autoGpsPending=true;
  showLocationConfirm(true);
}
let _autoGpsPending=false;
let _travelGpsPending=false;

function _silentGpsOnLoad(){
  return new Promise(resolve=>{
    if(!navigator.geolocation){resolve(null);return}
    let done=false;
    function finish(val){if(done)return;done=true;clearTimeout(masterTO);resolve(val)}
    const masterTO=setTimeout(()=>finish(null),20000);
    navigator.geolocation.getCurrentPosition(
      pos=>finish(pos),
      err=>{
        if(err.code===1){localStorage.removeItem('st_autoGps');finish(null);return}
        navigator.geolocation.getCurrentPosition(
          pos=>finish(pos),
          err2=>{if(err2.code===1)localStorage.removeItem('st_autoGps');finish(null)},
          {enableHighAccuracy:false,timeout:10000,maximumAge:300000}
        );
      },
      {enableHighAccuracy:true,timeout:10000,maximumAge:300000}
    );
  });
}

let _locConfirmShown=false;
function _doGPSLocate(){
  toggleLocOverlay(false);
  const wasAutoGpsPending=_autoGpsPending;
  if(_autoGpsPending)_autoGpsPending=false;
  const wasTravelPending=_travelGpsPending;
  if(_travelGpsPending)_travelGpsPending=false;
  if(wasAutoGpsPending){
    localStorage.setItem('st_autoGps','1');
    toast('📍 Auto-locate on load enabled');
    syncSettingsPanel();
  }
  toast('Getting location...');
  let _gpsGot=false;
  let _activeAttempt=1;
  const _gpsWait=setTimeout(()=>{if(!_gpsGot)toast('📍 Still acquiring GPS — hang tight...')},5000);
  function _handleLocSuccess(pos){
    if(pos.coords.altitude!=null)S._gpsAltitude=pos.coords.altitude;
    S._gpsLocating=true;
    reverseGeo(pos.coords.latitude,pos.coords.longitude).finally(()=>{
      S._gpsLocating=false;
      if(wasTravelPending)setTimeout(()=>toggleTravelMode(),500);
    });
  }
  function _gpsOk(pos){
    if(_gpsGot)return;_gpsGot=true;
    clearTimeout(_gpsWait);clearTimeout(_gpsRetry);
    toast('📍 GPS locked — accuracy ±'+Math.round(pos.coords.accuracy)+'m');
    _handleLocSuccess(pos);
  }
  function _gpsFail(err){
    if(_gpsGot)return;_gpsGot=true;
    clearTimeout(_gpsWait);clearTimeout(_gpsRetry);
    if(err.code===1){
      if(wasAutoGpsPending){localStorage.removeItem('st_autoGps');toast('📍 Auto-locate requires GPS permission');syncSettingsPanel()}
      toast('📍 Location permission denied — please enable location in your browser/phone settings, then try again');
    }else if(err.code===2){
      toast('📍 Location unavailable — make sure GPS/Location Services is turned ON in your phone settings');
    }else if(err.code===3){
      toast('📍 GPS timed out — trying again with lower accuracy...');
      navigator.geolocation.getCurrentPosition(
        pos=>{toast('📍 Location found');_handleLocSuccess(pos)},
        err2=>{
          if(err2.code===1&&wasAutoGpsPending){localStorage.removeItem('st_autoGps');syncSettingsPanel()}
          toast('📍 Still cannot get location — try searching for your city instead');
        },
        {enableHighAccuracy:false,timeout:30000,maximumAge:300000}
      );
      return;
    }else{
      toast('📍 Could not get location — try searching instead');
    }
  }
  function _makeCallbacks(attempt){
    return[
      pos=>_gpsOk(pos),
      err=>{if(_gpsGot)return;if(err.code===1){_gpsFail(err);return}if(attempt<_activeAttempt)return;_gpsFail(err)}
    ];
  }
  const [s1,e1]=_makeCallbacks(1);
  navigator.geolocation.getCurrentPosition(s1,e1,{enableHighAccuracy:true,timeout:20000,maximumAge:60000});
  const _gpsRetry=setTimeout(()=>{
    if(!_gpsGot){
      _activeAttempt=2;
      toast('📍 Retrying GPS...');
      const [s2,e2]=_makeCallbacks(2);
      navigator.geolocation.getCurrentPosition(s2,e2,{enableHighAccuracy:true,timeout:20000,maximumAge:60000});
    }
  },2000);
}
function showLocationConfirm(forceDialog){
  if(!navigator.geolocation){toast('GPS not available');return}
  if(document.querySelector('.confirm-overlay'))return;
  if(!forceDialog&&(S.lat&&S.lon||_locConfirmShown)){_doGPSLocate();return}
  _locConfirmShown=true;
  localStorage.setItem('st_locAsked','1');
  const overlay=document.createElement('div');
  overlay.className='confirm-overlay';
  overlay.innerHTML=`<div class="confirm-box">
    <h3>📍 Share Your Location?</h3>
    <p>StormTracker needs your location to show local weather, radar, and storm data. Your position is only used in your browser and never sent to any server.</p>
    <div class="confirm-btns">
      <button class="confirm-deny" id="loc-deny">No Thanks</button>
      <button class="confirm-allow" id="loc-allow">Allow Location</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById('loc-deny').addEventListener('click',()=>{overlay.remove();if(_autoGpsPending){_autoGpsPending=false;toast('📍 Auto-locate requires GPS permission');syncSettingsPanel()}else if(_travelGpsPending){_travelGpsPending=false;toast('📍 Travel Mode requires GPS permission')}else{toast('You can search for a location instead')}});
  document.getElementById('loc-allow').addEventListener('click',()=>{overlay.remove();_doGPSLocate()});
  overlay.addEventListener('click',e=>{if(e.target===overlay){overlay.remove();if(_autoGpsPending){_autoGpsPending=false;toast('📍 Auto-locate requires GPS permission');syncSettingsPanel()}else if(_travelGpsPending){_travelGpsPending=false;toast('📍 Travel Mode requires GPS permission')}}});
}

// Build the display label for a search result, preferring the user's own typed
// street/city/zip when the geocoder only matched the road or area
function _geoLabelFor(r,parsed){
  const addr=r.address||{};
  const hasStreet=addr.house_number&&addr.road;
  if(!hasStreet&&parsed&&parsed.houseNum&&parsed.street){
    const place=parsed.city||addr.city||addr.town||addr.village||addr.suburb||addr.district||addr.administrative||addr.county||'';
    const region=[parsed.state||addr.state||addr.country||'',parsed.zip].filter(Boolean).join(' ');
    return[parsed.street,place,region].filter(Boolean).join(', ');
  }
  return fmtLocName(addr,r.display_name.split(',').slice(0,2).join(',').trim());
}
// Failure diagnostics panel (location overlay + welcome screen)
function _hideGeoDebug(elId){const d=document.getElementById(elId||'loc-search-debug');if(d){d.style.display='none';d.innerHTML=''}}
function _showGeoDebug(title,elId){
  const d=document.getElementById(elId||'loc-search-debug');if(!d)return;
  const tr=_geoTrace;
  let h='<div style="font-weight:700;color:#ff8a80;margin-bottom:4px">⚠️ '+escHtml(title)+'</div>';
  if(tr&&tr.steps&&tr.steps.length){
    h+='<div style="color:var(--text-muted)">Searched for: <b>'+escHtml(tr.cleaned)+'</b>';
    if(tr.cleaned.toUpperCase()!==String(tr.raw||'').replace(/\s+/g,' ').trim().toUpperCase())h+=' <span style="opacity:0.7">(cleaned up from “'+escHtml(tr.raw)+'”)</span>';
    h+='</div><div style="margin-top:4px">';
    tr.steps.forEach((s,i)=>{
      h+='<div style="margin-top:3px"><span style="opacity:0.6">'+(i+1)+'.</span> “'+escHtml(s.q)+'” → <b>'+escHtml(s.outcome||'—')+'</b>';
      if(s.providers&&s.providers.length)h+='<div style="opacity:0.65;padding-left:16px">'+s.providers.map(escHtml).join(' · ')+'</div>';
      h+='</div>';
    });
    h+='</div><div style="margin-top:6px;color:var(--text-muted)">Took '+((tr.tookMs||0)/1000).toFixed(1)+'s. Tip: try just street + ZIP code, or city + state.</div>';
  }else h+='<div style="color:var(--text-muted)">No search details were recorded.</div>';
  d.innerHTML=h;d.style.display='block';
}
async function searchLoc(){
  if(S._searching)return;
  hideSuggestions();
  const q=document.getElementById('location-input').value.trim();
  if(!q)return;
  _hideGeoDebug();
  S._searching=true;
  toast('Searching...');
  try{
    const{data,parsed}=await smartGeoSearch(q,1);
    if(data.length){
      const r=data[0];
      const addr=r.address||{};
      toggleLocOverlay(false);
      setLoc(parseFloat(r.lat),parseFloat(r.lon),_geoLabelFor(r,parsed));
      checkLocationUnits(addr.country_code);
    }
    else{toast('Location not found');_showGeoDebug('No match found for that address')}
  }catch(e){toast('Search failed');_showGeoDebug('Search failed: '+((e&&e.message)||e));console.log('searchLoc error:',e)}
  finally{S._searching=false}
}

async function reverseGeo(lat,lon){
  const fallback=`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  try{
    const res=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`,{headers:{'Accept-Language':'en'},signal:AbortSignal.timeout(5000)});
    if(res.ok){const data=await res.json();const addr=data.address||{};setLoc(lat,lon,fmtLocName(addr,fallback));checkLocationUnits(addr.country_code);return}
  }catch(e){console.log('Nominatim reverse failed:',e.message)}
  try{
    const res=await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`,{signal:AbortSignal.timeout(5000)});
    if(res.ok){const data=await res.json();const f=data.features?.[0];if(f){const p=f.properties||{};
      const addr={city:p.city,town:p.town,village:p.village,suburb:p.suburb,district:p.district,state:p.state,country:p.country,country_code:p.countrycode,road:p.street,house_number:p.housenumber,administrative:p.district,county:p.county};
      setLoc(lat,lon,fmtLocName(addr,fallback));checkLocationUnits(p.countrycode);return}}
  }catch(e){console.log('Photon reverse failed:',e.message)}
  setLoc(lat,lon,fallback);
}

function updateNavForLocation(){
  const isUS=S.lat&&isUSLocation(S.lat,S.lon);
  const alt=document.getElementById('nav-alerts');
  if(alt)alt.style.display=isUS?'':'none';
  document.querySelectorAll('.bottom-nav .nav-item').forEach(b=>{
    b.style.flex='1';
  });
}
function getHomeLocation(){
  try{return JSON.parse(localStorage.getItem('st_home_location'))}catch(e){return null}
}
function setHomeLocation(lat,lon,name){
  try{localStorage.setItem('st_home_location',JSON.stringify({lat,lon,name}))}catch(e){}
}
function recenterMap(){
  const a=S._anchorLoc||(S.lat?{lat:S.lat,lon:S.lon,name:S.locName}:null);
  if(!a){toast('📍 No location set');return}
  setLoc(a.lat,a.lon,a.name,{mapZoom:8});
  toast('📍 '+a.name);
}
function goHome(){
  let home=getHomeLocation();
  if(!home&&S.lat){
    setHomeLocation(S.lat,S.lon,S.locName);
    home={lat:S.lat,lon:S.lon,name:S.locName};
    toast('📍 Home set: '+S.locName);
  }
  if(!home){toast('📍 No home location — set a location first');return}
  setLoc(home.lat,home.lon,home.name,{mapZoom:8});
  toast('📍 Home: '+home.name);
}
function scanHere(){
  if(!S.map){toast('Open radar map first');return}
  const center=S.map.getCenter();
  setLoc(center.lat,center.lng);
  toast('🔍 Scanning: '+S.locName);
}
function showHdScanDialog(){
  if(!S.map){toast('Open radar map first');return}
  const home=getHomeLocation();
  const mapCenter=S.map.getCenter();
  const hasHome=!!home;
  const hasSavedLoc=!!(S.lat&&S.lon);
  let overlay=document.getElementById('hd-scan-overlay');
  if(overlay)overlay.remove();
  overlay=document.createElement('div');
  overlay.id='hd-scan-overlay';
  overlay.className='hd-scan-overlay';
  let btns='';
  if(hasHome){
    btns+=`<button class="hd-scan-btn" id="hd-home"><span>🏠 Home Location</span><div class="hd-label">${home.name}</div></button>`;
  }
  if(hasSavedLoc&&(!hasHome||Math.abs(S.lat-home.lat)>0.01||Math.abs(S.lon-home.lon)>0.01)){
    btns+=`<button class="hd-scan-btn" id="hd-saved"><span>📍 Current Location</span><div class="hd-label">${S.locName}</div></button>`;
  }
  btns+=`<button class="hd-scan-btn" id="hd-center"><span>🎯 Current Map Center</span><div class="hd-label">${mapCenter.lat.toFixed(4)}, ${mapCenter.lng.toFixed(4)}</div></button>`;
  overlay.innerHTML=`<div class="hd-scan-box">
    <div style="font-size:1.3em;margin-bottom:4px">🔦</div>
    <div style="font-size:1.05em;font-weight:700;color:var(--text-primary);margin-bottom:4px">HD Scan</div>
    <div style="font-size:0.75em;color:var(--text-muted);margin-bottom:14px">15-mile high-resolution radar analysis at zoom 12</div>
    ${btns}
    <button id="hd-cancel" style="width:100%;padding:10px;margin-top:8px;border-radius:8px;border:1px solid var(--border-subtle);background:rgba(255,255,255,0.04);color:var(--text-muted);font-size:0.8em;cursor:pointer">Cancel</button>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay){overlay.remove()}});
  document.getElementById('hd-cancel').addEventListener('click',()=>overlay.remove());
  function prepHdTarget(lat,lon,name){
    clearViewScanCircle();
    S.stormMarkers.forEach(m=>{try{S.map.removeLayer(m)}catch(e){}});S.stormMarkers=[];
    clearStormCone();
    S.lat=lat;S.lon=lon;S.locName=name;
    document.getElementById('location-input').value=name;
    S.station=null;S.stationId=null;S._stationSource=null;S.stormMovement=null;S._windCache=null;S._aloftData=null;
    S._locReqId=(S._locReqId||0)+1; // HD target is a real location change: invalidate any in-flight winds-aloft gate
    S.radarSource=isUSLocation(lat,lon)?'nexrad':'rainviewer';
    S.storms=[];if(typeof bumpStormScanId==='function')bumpStormScanId();S._topStorms=[];S._topStormAnalysis={inbound:[],overhead:[],nearby:[],allWithEta:[]};S._rawScanPts=[];S._sonarClusteredPts=[];S._sonarTotalSwept=0;S._sonarSweepAngle=0;S._approachData=null;S._arrowCells=[];clearStormZones();
    try{localStorage.setItem('st_loc',JSON.stringify({lat,lon,name}))}catch(e){}
    if(S._userMarker)S._userMarker.setLatLng([lat,lon]);
    if(S._rangeCircle)S._rangeCircle.setLatLng([lat,lon]);
    showRadarLayer(S.map);
    updateNavForLocation();
    document.getElementById('status-text').textContent='HD Scan · '+name;
  }
  const homeBtn=document.getElementById('hd-home');
  if(homeBtn)homeBtn.addEventListener('click',()=>{
    overlay.remove();
    prepHdTarget(home.lat,home.lon,home.name);
    S.map.setView([home.lat,home.lon],10,{animate:true,duration:0.5});
    setTimeout(()=>{S.map.setZoom(12,{animate:true});scanRadarHiRes(S.map,true)},500);
  });
  const savedBtn=document.getElementById('hd-saved');
  if(savedBtn)savedBtn.addEventListener('click',()=>{
    overlay.remove();
    S.map.setView([S.lat,S.lon],10,{animate:true,duration:0.5});
    setTimeout(()=>{S.map.setZoom(12,{animate:true});scanRadarHiRes(S.map,true)},500);
  });
  const centerBtn=document.getElementById('hd-center');
  if(centerBtn)centerBtn.addEventListener('click',()=>{
    overlay.remove();
    const ctr=S.map.getCenter();
    prepHdTarget(ctr.lat,ctr.lng,`${ctr.lat.toFixed(4)}, ${ctr.lng.toFixed(4)}`);
    S.map.setZoom(12,{animate:true});
    setTimeout(()=>scanRadarHiRes(S.map,true),500);
  });
}
function setLoc(lat,lon,name,opts){
  if(typeof opts==='boolean')opts={fromTravel:opts};
  opts=opts||{};
  const fromTravel=!!opts.fromTravel;
  if(!getHomeLocation()){setHomeLocation(lat,lon,name||`${lat.toFixed(4)}, ${lon.toFixed(4)}`)}
  if(!fromTravel && S.travelMode) stopTravelMode();
  if(!fromTravel&&!S._gpsLocating)S._gpsAltitude=null;
  if(typeof clearViewScanCircle==='function')clearViewScanCircle();
  S.lat=lat;S.lon=lon;
  S.locName=name||`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  S._anchorLoc={lat:lat,lon:lon,name:S.locName};
  document.getElementById('location-input').value=S.locName;
  document.getElementById('status-dot').classList.add('live');
  document.getElementById('status-text').textContent='Loading · '+S.locName;
  S.station=null;S.stationId=null;S._stationSource=null;S.stormMovement=null;S._windCache=null;S._aloftData=null;
  S.radarSource=isUSLocation(lat,lon)?'nexrad':'rainviewer';
  updateNavForLocation();
  if(S.map){
    S.stormMarkers.forEach(m=>{try{S.map.removeLayer(m)}catch(e){}});S.stormMarkers=[];
    clearStormCone();
  }
  S.storms=[];S._topStorms=[];S._topStormAnalysis={inbound:[],overhead:[],nearby:[],allWithEta:[]};S._rawScanPts=[];S._sonarClusteredPts=[];S._sonarTotalSwept=0;S._sonarSweepAngle=0;S._approachData=null;S._arrowCells=[];clearStormZones();
  const _tickerBar=document.getElementById('threat-ticker');if(_tickerBar)_tickerBar.style.display='none';
  const _locChanged=S._prevLat!=null&&(Math.abs(S._prevLat-lat)>0.01||Math.abs(S._prevLon-lon)>0.01);
  S._prevLat=lat;S._prevLon=lon;
  if(_locChanged){
    _stormAlertHistory=[];_saveStormAlertHistory();
    _wxAlertHistory=[];_saveWxAlertHistory();
    Object.keys(_STORM_ALERT_COOLDOWN).forEach(k=>delete _STORM_ALERT_COOLDOWN[k]);try{localStorage.removeItem('st_stormAlertCooldown')}catch(e){}
    if(_spcData){_spcData.reports=null;_spcData._lastFetch=0}
    if(S.activePage==='alerts')renderAlerts();
  }
  try{localStorage.setItem('st_loc',JSON.stringify({lat,lon,name:S.locName}))}catch(e){}
  if(S.map){
    const zoom=opts.mapZoom||S.map.getZoom();
    S.map.setView([lat,lon],zoom,opts.mapZoom?{animate:true,duration:0.5}:undefined);
    if(S._userMarker)S._userMarker.setLatLng([lat,lon]);
    if(S._rangeCircle)S._rangeCircle.setLatLng([lat,lon]);
    showRadarLayer(S.map);
  }
  if(typeof _showBottomNav==='function')_showBottomNav();
  if(typeof _showHeaderBtns==='function')_showHeaderBtns();
  const wEl=document.getElementById('page-weather');if(wEl)showSkel(wEl,6);
  if(typeof showLoadingScreen==='function')showLoadingScreen(S.locName);
  if(typeof _bootStep==='function'){_bootStep('loc','Location: '+S.locName);_bootStepDone('loc','Location: '+S.locName)}
  S._locReqId=(S._locReqId||0)+1;
  const _reqId=S._locReqId;
  document.getElementById('status-text').textContent=(fromTravel?'🧭 Travel Mode · ':'Live · ')+S.locName;
  fetchAlerts();
  const _refreshDone=(async()=>{
    await fetchWeather();
    if(_reqId!==S._locReqId)return;
    await scanRadarForStorms();
    if(_reqId!==S._locReqId)return;
    fetchHazards();
    fetchTerrainGrid();
  })();
  if(!fromTravel)scheduleHourlyRefresh();
  if(typeof refreshMpingIfVisible==='function')refreshMpingIfVisible();
  if(typeof startOverheadPoll==='function'&&(typeof isOverheadPollEnabled!=='function'||isOverheadPollEnabled()))startOverheadPoll();
  return _refreshDone;
}

function getFavorites(){
  try{return JSON.parse(localStorage.getItem('st_favs')||'[]')}catch(e){return[]}
}
function saveFavorites(favs){
  try{localStorage.setItem('st_favs',JSON.stringify(favs))}catch(e){}
}
function saveFavorite(){
  if(!S.lat){toast('Set a location first');return}
  const favs=getFavorites();
  if(favs.length>=5){toast('Max 5 favorites — remove one first');return}
  if(favs.some(f=>Math.abs(f.lat-S.lat)<0.01&&Math.abs(f.lon-S.lon)<0.01)){toast('Location already saved');return}
  favs.push({lat:S.lat,lon:S.lon,name:S.locName});
  saveFavorites(favs);
  renderFavorites();
  toast('⭐ Saved: '+S.locName);
}
function removeFavorite(idx){
  const favs=getFavorites();
  const f=favs[idx];
  if(f&&typeof _setPushLocEnabled==='function'){try{_setPushLocEnabled(pushLocId(f.lat,f.lon),false);}catch(e){}}
  favs.splice(idx,1);
  saveFavorites(favs);
  renderFavorites();
  try{if(typeof syncPushAlerts==='function')syncPushAlerts();}catch(e){}
}
function renameFavorite(idx){
  const favs=getFavorites();
  const f=favs[idx];
  if(!f)return;
  const newName=prompt('Rename favorite:',f.name);
  if(newName!==null&&newName.trim()){
    favs[idx].name=newName.trim();
    saveFavorites(favs);
    renderFavorites();
    try{if(typeof syncPushAlerts==='function')syncPushAlerts();}catch(e){}
    toast('Renamed to: '+newName.trim());
  }
}
// Toggle the background-push 🔔 for one saved location. Updates the per-location
// state and, if background alerts are already on, re-pushes the watch set.
function toggleFavPush(idx){
  const favs=getFavorites();
  const f=favs[idx];
  if(!f)return;
  if(typeof pushLocId!=='function'||typeof _setPushLocEnabled!=='function'){toast('Notifications not available on this device');return;}
  const on=!isPushLocOn(f.lat,f.lon);
  _setPushLocEnabled(pushLocId(f.lat,f.lon),on);
  renderFavorites();
  toast(on?'🔔 Background alerts ON for '+f.name:'🔕 Background alerts OFF for '+f.name);
  try{
    if(typeof _getPushSub==='function'&&_getPushSub()&&typeof enablePushAlerts==='function') enablePushAlerts(true);
  }catch(e){}
  try{if(typeof syncSettingsPanel==='function')syncSettingsPanel();}catch(e){}
}
function loadFavorite(idx){
  const favs=getFavorites();
  const f=favs[idx];
  if(f){setLoc(f.lat,f.lon,f.name);toggleLocOverlay(false)}
}
function goToFavorite(idx){
  const favs=getFavorites();
  const f=favs[idx];
  if(f){setLoc(f.lat,f.lon,f.name);toggleLocOverlay(false)}
}
function toggleFavEmailAlert(idx){
  const favs=getFavorites();
  const f=favs[idx];
  if(!f)return;
  f.emailAlerts=f.emailAlerts===false?true:f.emailAlerts===true?false:true;
  saveFavorites(favs);
  renderFavorites();
  toast(f.emailAlerts?'📬 Email alerts ON for '+f.name:'📬 Email alerts OFF for '+f.name);
}
function renderFavorites(){
  const el=document.getElementById('fav-list');
  if(!el)return;
  const favs=getFavorites();
  if(!favs.length){el.innerHTML='<div style="font-size:0.7em;color:#555;text-align:center;padding:4px">No favorites saved</div>';return}
  const loggedIn=!!_syncToken&&!!_syncApiUrl();
  const pushSupported=(typeof pushLocId==='function')&&('serviceWorker' in navigator)&&('PushManager' in window);
  el.innerHTML=favs.map((f,i)=>{
    const emailOn=f.emailAlerts!==false;
    const emailBtn=loggedIn&&_emailAlertsOn?`<button onclick="event.stopPropagation();toggleFavEmailAlert(${i})" style="background:none;border:1px solid ${emailOn?'rgba(0,200,100,0.4)':'var(--border-subtle)'};color:${emailOn?'#00cc66':'var(--text-muted)'};font-size:0.55em;cursor:pointer;padding:1px 5px;border-radius:4px;white-space:nowrap" title="${emailOn?'Email alerts ON':'Email alerts OFF'}">${emailOn?'📬':'📭'}</button>`:'';
    const pushOn=pushSupported&&isPushLocOn(f.lat,f.lon);
    const pushBtn=pushSupported?`<button onclick="event.stopPropagation();toggleFavPush(${i})" style="background:none;border:1px solid ${pushOn?'rgba(57,217,138,0.5)':'var(--border-subtle)'};color:${pushOn?'var(--accent-green)':'var(--text-muted)'};font-size:0.6em;cursor:pointer;padding:1px 5px;border-radius:4px;white-space:nowrap" title="${pushOn?'Background storm alerts ON — tap to turn off':'Background storm alerts OFF — tap to turn on'}">${pushOn?'🔔':'🔕'}</button>`:'';
    return`<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;margin:2px 0;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer" onclick="loadFavorite(${i})">
    <span class="text-sm">⭐</span>
    <span style="flex:1;font-size:0.75em;color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name}</span>
    ${pushBtn}
    ${emailBtn}
    <button onclick="event.stopPropagation();goToFavorite(${i})" style="background:none;border:1px solid var(--accent-cyan);color:var(--accent-cyan);font-size:0.6em;cursor:pointer;padding:2px 6px;border-radius:3px;white-space:nowrap;font-weight:500" title="Go to location">GO</button>
    <button onclick="event.stopPropagation();renameFavorite(${i})" style="background:none;border:none;color:var(--accent-cyan);font-size:0.7em;cursor:pointer;padding:2px 4px" title="Rename">✏️</button>
    <button onclick="event.stopPropagation();removeFavorite(${i})" style="background:none;border:none;color:#f44;font-size:0.7em;cursor:pointer;padding:2px 4px">✕</button>
  </div>`;
  }).join('');
}

function startMapPick(){
  toggleLocOverlay(false);
  let overlay=document.getElementById('map-pick-overlay');
  if(overlay){overlay.style.display='flex';return}
  overlay=document.createElement('div');
  overlay.id='map-pick-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;background:#0f172a';
  overlay.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#1e293b;border-bottom:1px solid #334155;flex-shrink:0">
      <div><div style="color:#fff;font-weight:600;font-size:1em">📌 Pick Location</div>
      <div style="color:#94a3b8;font-size:0.75em">Drag the map to center the crosshair on your spot</div></div>
      <button id="map-pick-close" style="background:none;border:none;color:#94a3b8;font-size:1.4em;cursor:pointer;padding:4px 8px">✕</button>
    </div>
    <div id="map-pick-map" style="flex:1;position:relative"></div>
    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:1000;pointer-events:none">
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="20" fill="none" stroke="#00ff88" stroke-width="2" opacity="0.5"/>
        <circle cx="30" cy="30" r="10" fill="none" stroke="#00ff88" stroke-width="2" opacity="0.8"/>
        <circle cx="30" cy="30" r="3" fill="#00ff88"/>
        <line x1="30" y1="0" x2="30" y2="20" stroke="#00ff88" stroke-width="1.5" opacity="0.6"/>
        <line x1="30" y1="40" x2="30" y2="60" stroke="#00ff88" stroke-width="1.5" opacity="0.6"/>
        <line x1="0" y1="30" x2="20" y2="30" stroke="#00ff88" stroke-width="1.5" opacity="0.6"/>
        <line x1="40" y1="30" x2="60" y2="30" stroke="#00ff88" stroke-width="1.5" opacity="0.6"/>
      </svg>
    </div>
    <div style="position:absolute;top:50%;left:0;right:0;border-top:1px solid rgba(0,255,136,0.12);z-index:999;pointer-events:none"></div>
    <div style="position:absolute;left:50%;top:0;bottom:0;border-left:1px solid rgba(0,255,136,0.12);z-index:999;pointer-events:none"></div>
    <div style="padding:12px 16px;background:#1e293b;border-top:1px solid #334155;flex-shrink:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;min-height:20px">
        <span style="color:#00ff88;font-size:0.9em">⊕</span>
        <span id="map-pick-addr" style="color:#fff;font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Resolving...</span>
      </div>
      <div class="flex-gap-8">
        <button id="map-pick-cancel" style="flex:1;padding:12px;background:transparent;border:1px solid #475569;color:#cbd5e1;border-radius:8px;font-size:0.9em;font-weight:600;cursor:pointer">Cancel</button>
        <button id="map-pick-confirm" style="flex:1;padding:12px;background:#00cc6a;border:none;color:#fff;border-radius:8px;font-size:0.9em;font-weight:700;cursor:pointer">⊕ Set This Location</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const initLat=S.lat||39.8,initLon=S.lon||-98.5;
  const pickMap=L.map('map-pick-map',{center:[initLat,initLon],zoom:9,zoomControl:true});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19,attribution:'© CartoDB'}).addTo(pickMap);
  S._pickMap=pickMap;
  let resolveTimer=null;
  const addrEl=document.getElementById('map-pick-addr');
  async function resolveAddr(lat,lon){
    addrEl.textContent='Looking up address...';
    try{
      const r=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&zoom=18`,{headers:{'Accept-Language':'en'}});
      const d=await r.json();
      if(d.address){
        const a=d.address;
        const parts=[];
        if(a.road||a.pedestrian||a.neighbourhood||a.suburb)parts.push(a.road||a.pedestrian||a.neighbourhood||a.suburb);
        parts.push(a.city||a.town||a.village||a.hamlet||a.municipality||a.county||'');
        if(a.state||a.state_district)parts.push(a.state||a.state_district);
        if(a.country&&a.country_code!=='us')parts.push(a.country);
        const name=parts.filter(Boolean).join(', ')||`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        addrEl.textContent=name;
      }else{addrEl.textContent=`${lat.toFixed(4)}, ${lon.toFixed(4)}`}
    }catch(e){addrEl.textContent=`${lat.toFixed(4)}, ${lon.toFixed(4)}`}
  }
  resolveAddr(initLat,initLon);
  pickMap.on('moveend',()=>{
    const c=pickMap.getCenter();
    if(resolveTimer)clearTimeout(resolveTimer);
    resolveTimer=setTimeout(()=>resolveAddr(c.lat,c.lng),600);
  });
  document.getElementById('map-pick-close').onclick=cancelMapPick;
  document.getElementById('map-pick-cancel').onclick=cancelMapPick;
  document.getElementById('map-pick-confirm').onclick=async()=>{
    const c=pickMap.getCenter();
    const lat=c.lat,lon=c.lng;
    let name=addrEl.textContent||`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    if(name==='Looking up address...'||name==='Resolving...')name=`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    cancelMapPick();
    setLoc(lat,lon,name);
    toast('📌 Location set: '+name);
  };
}
function cancelMapPick(){
  const overlay=document.getElementById('map-pick-overlay');
  if(overlay){
    if(S._pickMap){S._pickMap.remove();S._pickMap=null}
    overlay.remove();
  }
}

function getAutoRefreshMin(){
  const v=localStorage.getItem('autoRefreshMin');
  if(v===null)return 60;
  return parseInt(v,10);
}
function scheduleAutoRefresh(){
  if(S._autoRefreshTimer)clearInterval(S._autoRefreshTimer);
  S._autoRefreshTimer=null;
  const mins=getAutoRefreshMin();
  if(!mins||mins<=0){S._nextRefreshAt=0;return}
  const ms=mins*60*1000;
  S._nextRefreshAt=Date.now()+ms;
  S._autoRefreshTimer=setInterval(()=>{
    if(S.travelMode)return;
    S._nextRefreshAt=Date.now()+ms;
    startScanRefreshTimer();
    fetchWeather();
    fetchAlerts();fetchHazards();
    fetchTerrainGrid();
    scanRadarForStorms();
  },ms);
  startScanRefreshTimer();
  scheduleAloftWatchdog();
}
function scheduleHourlyRefresh(){scheduleAutoRefresh()}

// v4.51: Aloft watchdog — every 10 min, if S._aloftData is empty/missing
// (e.g. the initial fetch failed due to a flaky connection), retry the fetch
// without waiting for the next 60-min auto-refresh cycle. Cheap when winds
// are already loaded (just an undefined check); only fires the network call
// when data is actually missing.
function scheduleAloftWatchdog(){
  if(S._aloftWatchdogTimer)clearInterval(S._aloftWatchdogTimer);
  S._aloftWatchdogTimer=setInterval(async()=>{
    if(S.travelMode)return;
    if(!S.lat)return;
    const haveData=S._aloftData&&S._aloftData.length;
    const cacheAgeMs=S._windCache?(Date.now()-S._windCache.ts):Infinity;
    // Re-fetch if we have no aloft data OR if cache is older than 30 min.
    if(!haveData||cacheAgeMs>30*60*1000){
      console.log('[AloftWatchdog] aloft data missing or stale ('+(haveData?Math.round(cacheAgeMs/60000)+' min':'none')+') — retrying fetch');
      try{
        if(typeof fetchWindsAloft==='function')await fetchWindsAloft();
        if(S._aloftData&&S._aloftData.length&&S.storms&&S.storms.length){
          if(typeof computeTopStorms==='function')computeTopStorms();
          if(typeof renderStorms==='function')renderStorms();
          if(typeof updateStormBadges==='function')updateStormBadges();
          console.log('[AloftWatchdog] aloft recovered — storms recomputed');
        }
      }catch(e){console.warn('[AloftWatchdog] retry failed:',e)}
    }
  },10*60*1000);
}

// ==========================================
// TRAVEL MODE (Live GPS Tracking)
// ==========================================
async function toggleTravelMode(){
  if(S.travelMode) return stopTravelMode();
  if(!localStorage.getItem('gpsInterval')){
    showTravelIntervalPopup();
    return;
  }
  if(!navigator.geolocation) return toast('GPS not available on this device');
  const _tPerm=await _checkGpsPermission();
  if(_tPerm==='denied'||_tPerm==='prompt'){
    toast('📍 GPS permission required for Travel Mode');
    _travelGpsPending=true;
    showLocationConfirm(true);
    return;
  }
  let gpsPos;
  toast('📍 Acquiring GPS for Travel Mode...');
  try{
    gpsPos=await new Promise((resolve,reject)=>{
      const _w=setTimeout(()=>toast('📍 Still acquiring GPS — hang tight...'),5000);
      navigator.geolocation.getCurrentPosition(p=>{clearTimeout(_w);resolve(p)},e=>{clearTimeout(_w);reject(e)},{enableHighAccuracy:true,timeout:20000,maximumAge:60000});
    });
    if(gpsPos&&gpsPos.coords.altitude!=null)S._gpsAltitude=gpsPos.coords.altitude;
  }catch(err){
    if(err.code===1){
      toast('📍 Location access denied — Travel Mode requires GPS permission');
    }else{
      toast('📍 Could not get GPS position — please try again');
    }
    return;
  }
  if(S.lat&&S.lon&&gpsPos){
    const gpsDist=haversine(S.lat,S.lon,gpsPos.coords.latitude,gpsPos.coords.longitude);
    if(gpsDist>50){
      const confirmed=await showGpsRelocateConfirm(gpsDist,gpsPos.coords.latitude,gpsPos.coords.longitude);
      if(!confirmed)return;
    }
  }
  if(gpsPos){S.lat=gpsPos.coords.latitude;S.lon=gpsPos.coords.longitude}
  S.travelMode=true;
  S.travelLastUpdate=0;
  S.gpsInterval=parseInt(localStorage.getItem('gpsInterval')||'300',10);
  const ind=document.getElementById('travel-indicator');
  ind.classList.add('show');
  document.getElementById('travel-status').textContent='🧭 Acquiring GPS...';
  const btn=document.getElementById('travel-btn');
  btn.textContent='⏹ Stop Travel Mode';
  btn.classList.add('active');
  const hdrTravel=document.getElementById('btn-travel');
  if(hdrTravel){hdrTravel.style.opacity='1';hdrTravel.style.background='rgba(0,229,255,0.2)';hdrTravel.style.borderRadius='8px';}
  document.getElementById('status-text').textContent='🧭 Travel Mode · Tracking...';
  const intRow=document.getElementById('gps-interval-row');
  if(intRow)intRow.style.display='block';
  const intSel=document.getElementById('gps-interval-sel');
  if(intSel)intSel.value=String(S.gpsInterval);
  if(S.map && !S.travelMarker){
    S.travelMarker=L.circleMarker([S.lat||0,S.lon||0],{radius:8,fillColor:'#00e5ff',fillOpacity:0.9,color:'#fff',weight:2,className:'travel-gps-dot'}).addTo(S.map);
  }
  startGpsWatch();
  toast('🧭 Travel Mode ON — GPS tracking active (updates every '+fmtGpsInt(S.gpsInterval)+')');
}
function showGpsRelocateConfirm(distMi,gpsLat,gpsLon){
  return new Promise(resolve=>{
    const distStr=distMi>500?Math.round(distMi).toLocaleString()+' mi':Math.round(distMi)+' mi';
    const overlay=document.createElement('div');
    overlay.className='confirm-overlay';
    overlay.innerHTML=`<div class="confirm-dialog" style="max-width:340px">
      <div style="text-align:center;margin-bottom:12px">
        <div style="font-size:2em">📍</div>
        <div style="font-weight:700;font-size:1.1em;margin:8px 0">Switch to GPS Location?</div>
      </div>
      <p style="font-size:0.85em;color:var(--text-secondary);text-align:center;margin-bottom:16px">
        Your GPS is <strong>${distStr}</strong> from the current location.<br>
        Travel Mode will reset everything to your actual GPS position.
      </p>
      <div class="flex-gap-8">
        <button id="gps-reloc-no" style="flex:1;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text-secondary);font-weight:600;cursor:pointer">Stay Here</button>
        <button id="gps-reloc-yes" style="flex:1;padding:10px;border-radius:8px;border:none;background:var(--accent-cyan);color:#000;font-weight:700;cursor:pointer">Use GPS 📍</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    document.getElementById('gps-reloc-no').addEventListener('click',()=>{overlay.remove();resolve(false)});
    document.getElementById('gps-reloc-yes').addEventListener('click',()=>{
      overlay.remove();
      toast('📍 Relocating to GPS position...');
      S._gpsLocating=true;
      reverseGeo(gpsLat,gpsLon).finally(()=>{S._gpsLocating=false});
      resolve(true);
    });
    overlay.addEventListener('click',e=>{if(e.target===overlay){overlay.remove();resolve(false)}});
  });
}
function stopTravelMode(){
  S.travelMode=false;
  if(S.travelWatchId!==null){navigator.geolocation.clearWatch(S.travelWatchId);S.travelWatchId=null}
  _clearTravelCountdown();
  S._travelSpdTxt=null;S._travelAccTxt=null;
  document.getElementById('travel-indicator').classList.remove('show');
  const intRow=document.getElementById('gps-interval-row');
  if(intRow)intRow.style.display='none';
  const btn=document.getElementById('travel-btn');
  btn.textContent='🧭 Travel Mode — Follow GPS Live';
  btn.classList.remove('active');
  const hdrTravel=document.getElementById('btn-travel');
  if(hdrTravel){hdrTravel.style.opacity='0.5';hdrTravel.style.background='';hdrTravel.style.borderRadius='';}
  if(S.travelMarker&&S.map){S.map.removeLayer(S.travelMarker);S.travelMarker=null}
  if(S.lat) document.getElementById('status-text').textContent='Live · '+S.locName;
  toast('Travel Mode OFF');
  scheduleAutoRefresh();
  startScanRefreshTimer();
}
function fmtGpsInt(s){
  if(s<60)return s+'s';
  if(s<3600)return Math.round(s/60)+'m';
  return Math.round(s/3600)+'h';
}
function setGpsInterval(val){
  S.gpsInterval=parseInt(val,10);
  localStorage.setItem('gpsInterval',String(S.gpsInterval));
  const sel1=document.getElementById('gps-interval-sel');if(sel1)sel1.value=String(S.gpsInterval);
  const sel2=document.getElementById('settings-travel-int');if(sel2)sel2.value=String(S.gpsInterval);
  if(S.travelMode){
    _startTravelCountdown();
    toast('🧭 Refresh interval set to '+fmtGpsInt(S.gpsInterval));
  }
}

function setAutoRefresh(val){
  const mins=parseInt(val,10);
  localStorage.setItem('autoRefreshMin',String(mins));
  scheduleAutoRefresh();
  startScanRefreshTimer();
  toast(mins>0?'🔄 Auto refresh set to '+fmtGpsInt(mins*60):'🔄 Auto refresh off');
}
function showTravelIntervalPopup(){
  const p=document.getElementById('travel-interval-popup');
  if(p)p.style.display='flex';
}
function closeTravelIntervalPopup(){
  const p=document.getElementById('travel-interval-popup');
  if(p)p.style.display='none';
}
function pickTravelInterval(val){
  closeTravelIntervalPopup();
  S.gpsInterval=val;
  localStorage.setItem('gpsInterval',String(val));
  startTravelModeAfterPick();
}
async function startTravelModeAfterPick(){
  if(!navigator.geolocation) return toast('GPS not available on this device');
  try{
    const _gp=await new Promise((resolve,reject)=>{
      const _w=setTimeout(()=>toast('📍 Still acquiring GPS — hang tight...'),5000);
      navigator.geolocation.getCurrentPosition(p=>{clearTimeout(_w);resolve(p)},e=>{clearTimeout(_w);reject(e)},{enableHighAccuracy:true,timeout:20000,maximumAge:60000});
    });
    if(_gp){
      if(_gp.coords.altitude!=null)S._gpsAltitude=_gp.coords.altitude;
      S.lat=_gp.coords.latitude;S.lon=_gp.coords.longitude;
    }
  }catch(err){
    if(err.code===1)toast('📍 Location access denied — Travel Mode requires GPS permission');
    else toast('📍 Could not get GPS position — please try again');
    return;
  }
  S.travelMode=true;
  S.travelLastUpdate=0;
  const ind=document.getElementById('travel-indicator');
  ind.classList.add('show');
  document.getElementById('travel-status').textContent='🧭 Acquiring GPS...';
  const btn=document.getElementById('travel-btn');
  btn.textContent='⏹ Stop Travel Mode';btn.classList.add('active');
  const hdrTravel=document.getElementById('btn-travel');
  if(hdrTravel){hdrTravel.style.opacity='1';hdrTravel.style.background='rgba(0,229,255,0.2)';hdrTravel.style.borderRadius='8px';}
  document.getElementById('status-text').textContent='🧭 Travel Mode · Tracking...';
  const intRow=document.getElementById('gps-interval-row');if(intRow)intRow.style.display='block';
  const intSel=document.getElementById('gps-interval-sel');if(intSel)intSel.value=String(S.gpsInterval);
  if(S.map&&!S.travelMarker){
    S.travelMarker=L.circleMarker([S.lat||0,S.lon||0],{radius:8,fillColor:'#00e5ff',fillOpacity:0.9,color:'#fff',weight:2,className:'travel-gps-dot'}).addTo(S.map);
  }
  startGpsWatch();
  toast('🧭 Travel Mode ON — refreshing every '+fmtGpsInt(S.gpsInterval));
}
function _fmtTravelCd(sec){
  const m=Math.floor(sec/60),s=sec%60;
  return String(m).padStart(2,'0')+'m:'+String(s).padStart(2,'0')+'s';
}
async function startGpsWatch(){
  if(S.travelWatchId!==null){navigator.geolocation.clearWatch(S.travelWatchId);S.travelWatchId=null}
  _clearTravelCountdown();
  S.travelWatchId=navigator.geolocation.watchPosition(
    pos=>onTravelPosition(pos),
    err=>{document.getElementById('travel-status').textContent='🧭 GPS error — retrying...'},
    {enableHighAccuracy:true, maximumAge:5000, timeout:20000}
  );
  if(S.lat){
    try{
      const name=await reverseGeocode(S.lat,S.lon);
      if(!S.travelMode)return;
      const locName=name||`${S.lat.toFixed(4)}, ${S.lon.toFixed(4)}`;
      await setLoc(S.lat,S.lon,locName,{fromTravel:true});
    }catch(e){}
  }
  if(S.travelMode)_startTravelCountdown();
}
function _clearTravelCountdown(){
  if(S._travelCdTimer){clearInterval(S._travelCdTimer);S._travelCdTimer=null}
  S._travelTarget=0;
}
function _startTravelCountdown(){
  _clearTravelCountdown();
  const intSec=S.gpsInterval||300;
  S._travelTarget=Date.now()+intSec*1000;
  _tickTravelCd();
  S._travelCdTimer=setInterval(_tickTravelCd,1000);
}
function _tickTravelCd(){
  if(!S.travelMode){_clearTravelCountdown();return}
  const remain=Math.max(0,Math.ceil((S._travelTarget-Date.now())/1000));
  const intSec=S.gpsInterval||300;
  const intLabel=fmtGpsInt(intSec);
  const cdStr=_fmtTravelCd(remain)+'/'+intLabel;
  const spdTxt=S._travelSpdTxt||'—';
  const accTxt=S._travelAccTxt||'—';
  const statusEl=document.getElementById('travel-status');
  if(statusEl)statusEl.textContent='🧭 '+spdTxt+' · ±'+accTxt+' · '+cdStr;
  if(remain<=0){
    _clearTravelCountdown();
    _travelCycleRefresh();
  }
}
async function _travelCycleRefresh(){
  if(!S.travelMode)return;
  const statusEl=document.getElementById('travel-status');
  if(statusEl)statusEl.textContent='🧭 Refreshing...';
  let lat=S.lat,lon=S.lon;
  try{
    const pos=await new Promise((resolve,reject)=>{
      navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
    });
    if(!S.travelMode)return;
    if(pos.coords.altitude!=null)S._gpsAltitude=pos.coords.altitude;
    lat=pos.coords.latitude;lon=pos.coords.longitude;
    S.lat=lat;S.lon=lon;
    if(S.travelMarker)S.travelMarker.setLatLng([lat,lon]);
    if(S._userMarker)S._userMarker.setLatLng([lat,lon]);
    if(S._rangeCircle)S._rangeCircle.setLatLng([lat,lon]);
    if(S.map)S.map.panTo([lat,lon],{animate:true,duration:0.5});
  }catch(e){
    if(!S.travelMode)return;
  }
  if(lat==null)return void(S.travelMode&&_startTravelCountdown());
  const name=await reverseGeocode(lat,lon).catch(()=>null);
  if(!S.travelMode)return;
  const locName=name||`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  try{await setLoc(lat,lon,locName,{fromTravel:true})}catch(e){}
  if(S.travelMode)_startTravelCountdown();
}
function onTravelPosition(pos){
  if(!S.travelMode) return;
  if(pos.coords.altitude!=null)S._gpsAltitude=pos.coords.altitude;
  const lat=pos.coords.latitude, lon=pos.coords.longitude;
  const acc=pos.coords.accuracy;
  const spd=pos.coords.speed;
  S._travelSpdTxt=spd!==null&&spd>=0?(S.windUnit===0?((spd*2.237).toFixed(0)+' mph'):(S.windUnit===2?((spd*3.6).toFixed(0)+' km/h'):((spd*1.944).toFixed(0)+' kts'))):'—';
  S._travelAccTxt=acc<1000?(acc.toFixed(0)+'m'):((acc/1000).toFixed(1)+'km');
  S.lat=lat;S.lon=lon;
  if(S.travelMarker)S.travelMarker.setLatLng([lat,lon]);
  if(S._userMarker)S._userMarker.setLatLng([lat,lon]);
  if(S._rangeCircle)S._rangeCircle.setLatLng([lat,lon]);
  if(S.map)S.map.panTo([lat,lon],{animate:true,duration:0.5});
}
async function reverseGeocode(lat,lon){
  const fb=`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  try{
    const res=await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`,{headers:{'Accept-Language':'en'},signal:AbortSignal.timeout(5000)});
    if(res.ok){const d=await res.json();if(d&&d.address)return fmtLocName(d.address,d.display_name);}
  }catch(e){}
  try{
    const res=await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`,{signal:AbortSignal.timeout(5000)});
    if(res.ok){const d=await res.json();const f=d.features?.[0];if(f){const p=f.properties||{};
      return fmtLocName({city:p.city,town:p.town,village:p.village,suburb:p.suburb,district:p.district,state:p.state,country:p.country,country_code:p.countrycode,road:p.street,administrative:p.district,county:p.county},fb);}}
  }catch(e){}
  return fb;
}

// ==========================================
// WEATHER STATION ALERTS (Threshold Monitoring)