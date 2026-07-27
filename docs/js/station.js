// ==========================================
// STATION (NWS API — CORS-friendly)
// Step 1: /points/{lat},{lon} → get observationStations URL
// Step 2: Follow that URL → list of nearby stations
// Step 3: /stations/{ICAO}/observations/latest → obs data
// NWS API has Access-Control-Allow-Origin: * (works from browser)
// AWC API: aviationweather.gov/api/data/metar — international METAR fallback
// ==========================================
const NWS_HDR={headers:{'User-Agent':'StormTracker/1.50','Accept':'application/geo+json'}};

async function _fetchStationElev(lat,lon){
  try{
    const r=await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,{signal:AbortSignal.timeout(5000)});
    if(r.ok){const d=await r.json();if(d.elevation&&d.elevation[0]!=null&&S.station){S.station.elev=d.elevation[0];renderStation()}}
  }catch(e){console.log('Station elev fetch error:',e.message)}
}

let _globalAirports=null;
async function _loadGlobalAirports(){
  if(_globalAirports)return _globalAirports;
  try{
    const r=await fetch('data/airports.json',{signal:AbortSignal.timeout(10000)});
    if(!r.ok)return null;
    const data=await r.json();
    _globalAirports=data.map(a=>({icao:a[0],iata:a[1]||null,name:a[2],lat:a[3],lon:a[4]}));
    console.log('Global airports loaded:',_globalAirports.length);
    return _globalAirports;
  }catch(e){console.log('Airport DB load error:',e.message);return null}
}
function _nearestAirports(lat,lon,airports,maxMi,limit){
  if(!airports)return[];
  return airports.map(a=>({...a,dist:haversine(lat,lon,a.lat,a.lon)}))
    .filter(a=>a.dist<=maxMi)
    .sort((a,b)=>a.dist-b.dist)
    .slice(0,limit||10);
}
async function fetchStation(){
  S._stationLocKey=S.lat+','+S.lon;
  const el=document.getElementById('page-station');showSkel(el,5);
  try{
    if(!isNWSCoverage(S.lat,S.lon)){console.log('[non-US] Skipped: NWS station lookup — falling back to AWC/global');throw new Error('NWS_INTL')}
    console.log('Tier 1: NWS — trying api.weather.gov/points for',S.lat.toFixed(4),S.lon.toFixed(4));
    const ptData={properties:await getNwsPointProps(6000).catch(()=>null)};   // v6.57 (QW1): memoized /points
    if(!ptData.properties)throw new Error('NWS_INTL');
    const stationsUrl=ptData.properties?.observationStations;
    if(!stationsUrl)throw new Error('No observation stations URL');
    const stRes=await fetch(stationsUrl,{...NWS_HDR,signal:AbortSignal.timeout(6000)});
    if(!stRes.ok)throw new Error('NWS stations returned '+stRes.status);
    const stData=await stRes.json();
    const features=stData.features||stData.observationStations||[];
    if(!features.length)throw new Error('NWS_INTL');
    S._stationSource='nws';
    S.nearbyStations=features.slice(0,10).map(f=>({
      icao:f.properties.stationIdentifier,
      name:f.properties.name||'',
      lat:f.geometry.coordinates[1],
      lon:f.geometry.coordinates[0],
      dist:haversine(S.lat,S.lon,f.geometry.coordinates[1],f.geometry.coordinates[0]),
    })).sort((a,b)=>a.dist-b.dist);
    console.log('Tier 1: NWS success — nearest:',S.nearbyStations[0].icao,S.nearbyStations[0].name);
    await loadStationObs(S.nearbyStations[0].icao);
  }catch(e){
    console.log('Tier 1: NWS error:',e.message,'→ Tier 2: AWC');
    try{await fetchStationAWC()}catch(e2){
      console.log('AWC station error:',e2.message,'→ trying global airport DB');
      try{
        const airports=await _loadGlobalAirports();
        const nearest=_nearestAirports(S.lat,S.lon,airports,300,10);
        if(nearest.length){
          console.log('Global DB found',nearest.length,'airports, nearest:',nearest[0].icao,nearest[0].name,nearest[0].dist.toFixed(1)+'mi');
          S._stationSource='awc';
          S.nearbyStations=nearest;
          await loadStationObsAWC(nearest[0].icao);
        }else{
          el.innerHTML=`<div class="empty-state"><div class="empty-icon">📡</div><p>No weather stations found within 300 mi.<br><span class="c-muted-sm">Try a location closer to an airport</span></p></div>`;
        }
      }catch(e3){
        console.error('Global airport fallback error:',e3);
        el.innerHTML=`<div class="empty-state"><div class="empty-icon">📡</div><p>No weather stations found nearby.<br><span class="c-muted-sm">Try a location closer to an airport</span></p></div>`;
      }
    }
  }
}
async function fetchStationAWC(){
  const el=document.getElementById('page-station');
  const radii=[1.0,2.0,3.5,5.0];
  let foundStations=[];
  for(const degSpan of radii){
    const minLat=(S.lat-degSpan).toFixed(2),maxLat=(S.lat+degSpan).toFixed(2);
    const minLon=(S.lon-degSpan).toFixed(2),maxLon=(S.lon+degSpan).toFixed(2);
    try{
      const r=await fetch(`https://aviationweather.gov/api/data/stationinfo?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json`,{signal:AbortSignal.timeout(8000)});
      if(r.ok){
        const body=await r.json();
        if(Array.isArray(body)){
          const metarCapable=body.filter(s=>s.siteType&&(Array.isArray(s.siteType)?s.siteType.includes('METAR'):String(s.siteType).includes('METAR')));
          console.log('Tier 2: stationinfo ±'+degSpan+'° found',metarCapable.length,'METAR-capable stations');
          if(metarCapable.length){
            foundStations=metarCapable.map(s=>({icao:s.icaoId,iata:s.iataId||null,faa:s.faaId||null,name:s.site||s.icaoId,lat:s.lat,lon:s.lon,dist:haversine(S.lat,S.lon,s.lat,s.lon)})).sort((a,b)=>a.dist-b.dist).slice(0,10);
            break;
          }
        }
      }
    }catch(e){console.log('Tier 2: stationinfo error ±'+degSpan+'°:',e.message)}
  }
  if(foundStations.length){
    console.log('Tier 2: AWC stationinfo — nearest:',foundStations[0].icao,foundStations[0].name,foundStations[0].dist.toFixed(1)+'mi');
    S._stationSource='awc';
    S.nearbyStations=foundStations;
    const icao=foundStations[0].icao;
    let metarLoaded=false;
    for(const hrs of [3,6,12]){
      try{
        const mr=await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=${hrs}`,{signal:AbortSignal.timeout(8000)});
        if(mr.ok){
          const md=await mr.json();
          if(md.length){
            console.log('Tier 2: METAR found for',icao,'('+hrs+'h window)');
            S.stationId=icao;
            S.station=parseAWCobs(md[0]);
            if(foundStations[0].name)S.station.name=foundStations[0].name;
            renderStation();if(_curLang!=='en')setTimeout(quickTranslate,300);
            metarLoaded=true;
            break;
          }
        }
      }catch(e){console.log('Tier 2: METAR fetch error ('+hrs+'h):',e.message)}
    }
    if(!metarLoaded){
      console.log('Tier 2: No recent METAR for',icao,'— showing station without obs');
      S.stationId=icao;
      S.station={
        icao,name:foundStations[0].name,lat:foundStations[0].lat,lon:foundStations[0].lon,
        temp:null,dewp:null,windKmh:null,windDir:null,gustKmh:null,visMeter:null,presPa:null,
        rawMETAR:'',clouds:[],obsTime:'',wxString:'',
        _noMetar:true,_reason:'No recent METAR available'
      };
      renderStation();if(_curLang!=='en')setTimeout(quickTranslate,300);
    }
    return;
  }
  console.log('Tier 2: stationinfo returned 0 stations → Tier 3: global airport DB');
  const airports=await _loadGlobalAirports();
  const nearest=_nearestAirports(S.lat,S.lon,airports,300,10);
  if(nearest.length){
    console.log('Tier 3: OurAirports fallback — nearest:',nearest[0].icao,nearest[0].name,nearest[0].dist.toFixed(1)+'mi');
    S._stationSource='awc';
    S.nearbyStations=nearest;
    const icao=nearest[0].icao;
    let metarLoaded=false;
    for(const hrs of [3,6,12]){
      try{
        const mr=await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=${hrs}`,{signal:AbortSignal.timeout(8000)});
        if(mr.ok){const md=await mr.json();if(md.length){
          console.log('Tier 3: METAR found for',icao);
          S.stationId=icao;S.station=parseAWCobs(md[0]);
          if(nearest[0].name)S.station.name=nearest[0].name;
          renderStation();if(_curLang!=='en')setTimeout(quickTranslate,300);
          metarLoaded=true;break;
        }}
      }catch(e){}
    }
    if(!metarLoaded){
      console.log('Tier 3: No METAR for',icao,'— showing station without obs');
      S.stationId=icao;
      S.station={icao,name:nearest[0].name,lat:nearest[0].lat,lon:nearest[0].lon,
        temp:null,dewp:null,windKmh:null,windDir:null,gustKmh:null,visMeter:null,presPa:null,
        rawMETAR:'',clouds:[],obsTime:'',wxString:'',_noMetar:true,_reason:'No recent METAR available'};
      renderStation();if(_curLang!=='en')setTimeout(quickTranslate,300);
    }
    return;
  }
  throw new Error('No stations in range from any source');
}
async function fetchStationGlobal(){
  const el=document.getElementById('page-station');
  const radii=[2.0,4.0,6.0];
  let stationList=[];
  for(const degSpan of radii){
    const minLat=(S.lat-degSpan).toFixed(2),maxLat=(S.lat+degSpan).toFixed(2);
    const minLon=(S.lon-degSpan).toFixed(2),maxLon=(S.lon+degSpan).toFixed(2);
    try{
      const url=`https://aviationweather.gov/api/data/stationinfo?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json`;
      const r=await fetch(url);
      if(r.ok){
        const body=await r.json();
        if(Array.isArray(body)){
          stationList=body.filter(s=>s.siteType&&s.siteType.includes('METAR')).map(s=>({
            icao:s.icaoId,name:s.site||s.icaoId,
            lat:s.lat,lon:s.lon,
            dist:haversine(S.lat,S.lon,s.lat,s.lon)
          })).sort((a,b)=>a.dist-b.dist).slice(0,10);
        }
      }
    }catch(e){console.log('AWC stationinfo error (±'+degSpan+'°):',e.message)}
    if(stationList.length)break;
  }
  if(!stationList.length)throw new Error('No stations in range');
  S._stationSource='awc';
  S.nearbyStations=stationList;
  await loadStationObsAWC(stationList[0].icao);
}
function _extractMetarWx(raw){
  if(!raw)return '';
  const parts=raw.split(/\s+/);
  const found=[];
  for(const p of parts){
    if(p.match(/^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(RA|SN|DZ|GR|GS|PL|IC|PE|SG|UP|FG|BR|HZ|FU|SA|DU|VA|PO|SQ|FC|SS|DS)+$/))found.push(p);
  }
  if(!found.length)return '';
  const decode={'RA':'Rain','SN':'Snow','DZ':'Drizzle','GR':'Hail','GS':'Small Hail','TS':'Thunderstorm','FG':'Fog','BR':'Mist','HZ':'Haze','FU':'Smoke','SA':'Sand','DU':'Dust','SQ':'Squall','FC':'Funnel Cloud','VA':'Volcanic Ash','PO':'Dust Whirls','SS':'Sandstorm','DS':'Duststorm','SH':'Showers','FZ':'Freezing','PL':'Ice Pellets','IC':'Ice Crystals','PE':'Ice Pellets','SG':'Snow Grains','UP':'Unknown Precip','BL':'Blowing','DR':'Drifting','MI':'Shallow','PR':'Partial','BC':'Patches'};
  return found.map(wx=>{
    let intensity=wx.startsWith('+')?'Heavy ':wx.startsWith('-')?'Light ':'';
    let clean=wx.replace(/^[-+]/,'').replace(/^VC/,'Vicinity ');
    let desc='';
    while(clean.length>=2){const cd=clean.substring(0,2);desc+=(desc?' ':'')+(decode[cd]||cd);clean=clean.substring(2)}
    return intensity+desc;
  }).join(', ');
}
function parseRawMetar(raw,station){
  const parts=raw.split(/\s+/);
  let temp=null,dewp=null,windDir=null,windKt=null,gustKt=null,vis=null,altim=null,slp=null;
  let clouds=[];
  let wxString='';
  const wxCodes=['RA','SN','DZ','GR','GS','TS','FG','BR','HZ','FU','SA','DU','SQ','FC','VA','PO','SS','DS','SH','FZ','MI','PR','BC','BL','DR','VC'];
  for(let pi=0;pi<parts.length;pi++){
    const p=parts[pi];
    const windM=p.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT$/);
    if(windM){
      windDir=windM[1]==='VRB'?null:Number(windM[1]);
      windKt=Number(windM[2]);
      if(windM[4])gustKt=Number(windM[4]);
      if(windKt===0&&(windDir===0||windDir===null))windDir=null;
      continue;
    }
    const windMPS=p.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?MPS$/);
    if(windMPS){
      windDir=windMPS[1]==='VRB'?null:Number(windMPS[1]);
      windKt=Number(windMPS[2])*1.94384;
      if(windMPS[4])gustKt=Number(windMPS[4])*1.94384;
      if(windKt===0&&(windDir===0||windDir===null))windDir=null;
      continue;
    }
    const tempM=p.match(/^(M?\d{1,2})\/(M?\d{1,2})?$/);
    if(tempM){
      temp=tempM[1].startsWith('M')?-Number(tempM[1].slice(1)):Number(tempM[1]);
      if(tempM[2])dewp=tempM[2].startsWith('M')?-Number(tempM[2].slice(1)):Number(tempM[2]);
      continue;
    }
    const altM=p.match(/^Q(\d{4})$/);
    if(altM){altim=Number(altM[1]);continue}
    const altA=p.match(/^A(\d{4})$/);
    if(altA){altim=Number(altA[1])/100*33.8639;continue}
    const slpM=p.match(/^SLP(\d{3})$/);
    if(slpM){
      const sv=Number(slpM[1]);
      slp=(sv>=500?900+sv/10:1000+sv/10);
      if(altim==null)altim=slp;
      continue;
    }
    if(vis===null&&p==='CAVOK'){vis=9999;continue}
    if(vis===null&&p.match(/^9999NDV?$/)){vis=9999;continue}
    if(vis===null&&p.match(/^(\d{4})$/)&&Number(p)>=100&&Number(p)<=9999){
      vis=Number(p);continue;
    }
    const visSMfrac=p.match(/^(\d+)\s*\/\s*(\d+)SM$/);
    if(visSMfrac){vis=(Number(visSMfrac[1])/Number(visSMfrac[2]))*1609.34;continue}
    if(vis===null&&pi>0&&parts[pi-1].match(/^\d+$/)&&p.match(/^(\d+)\/(\d+)SM$/)){
      const whole=Number(parts[pi-1]);
      const fm=p.match(/^(\d+)\/(\d+)SM$/);
      vis=(whole+Number(fm[1])/Number(fm[2]))*1609.34;continue;
    }
    const visSM=p.match(/^(\d+)SM$/);
    if(visSM){vis=Number(visSM[1])*1609.34;continue}
    if(p==='P6SM'){vis=10*1609.34;continue}
    const cldM=p.match(/^(FEW|SCT|BKN|OVC|CLR|SKC|NSC|NCD|VV)(\d{3})?(.*)$/);
    if(cldM){
      clouds.push({amount:cldM[1],base:{value:cldM[2]?Number(cldM[2])*100*0.3048:null}});
      continue;
    }
    const tGroupM=p.match(/^T(\d)(\d{3})(\d)(\d{3})$/);
    if(tGroupM){
      const tVal=Number(tGroupM[2])/10*(tGroupM[1]==='1'?-1:1);
      const dVal=Number(tGroupM[4])/10*(tGroupM[3]==='1'?-1:1);
      if(temp==null)temp=tVal;
      if(dewp==null)dewp=dVal;
      continue;
    }
    const tGroupTempOnly=p.match(/^T(\d)(\d{3})$/);
    if(tGroupTempOnly){
      const tVal=Number(tGroupTempOnly[2])/10*(tGroupTempOnly[1]==='1'?-1:1);
      if(temp==null)temp=tVal;
      continue;
    }
    for(const wx of wxCodes){
      if(p.includes(wx)&&p.match(/^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(RA|SN|DZ|GR|GS|PL|IC|PE|SG|UP|FG|BR|HZ|FU|SA|DU|VA|PO|SQ|FC|SS|DS)+$/)){
        wxString+=(wxString?' ':'')+p;
        break;
      }
    }
  }
  return{
    icao:station.icao,name:station.name,lat:station.lat,lon:station.lon,
    temp,dewp,
    windKmh:windKt!=null?windKt*1.852:null,
    windDir,
    gustKmh:gustKt!=null?gustKt*1.852:null,
    visMeter:vis,
    presPa:altim!=null?altim*100:null,
    rawMETAR:raw,
    clouds,
    obsTime:new Date().toISOString(),
    wxString,
    _source:'AWC'
  };
}
function parseAWCobs(m){
  return{
    icao:m.icaoId,
    name:m.name||m.icaoId,
    lat:m.lat,lon:m.lon,
    elev:m.elev!=null?m.elev:null,
    temp:m.temp!=null?m.temp:null,
    dewp:m.dewp!=null?m.dewp:null,
    windKmh:m.wspd!=null?m.wspd*1.852:null,
    windDir:m.wdir!=null?(m.wdir==='VRB'||m.wdir===''?null:(isNaN(Number(m.wdir))?null:Number(m.wdir))):null,
    gustKmh:m.wgst!=null?m.wgst*1.852:null,
    visMeter:m.visib!=null?(String(m.visib).includes('+')?16093:Number(m.visib)>100?Number(m.visib):Number(m.visib)*1609.34):null,
    presPa:m.altim!=null?m.altim*100:null,
    rawMETAR:m.rawOb||'',
    clouds:(m.clouds||[]).map(c=>({amount:c.cover,base:{value:c.base!=null?c.base*0.3048:null}})),
    obsTime:(m.reportTime||m.obsTime||'').replace(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/,'$1T$2Z'),
    wxString:_validateWxString(m.wxString||'',m.rawOb||''),
  };
}
function loadStationFromAWC(awcData,stInfo){
  S.stationId=awcData.icaoId;
  S.station=parseAWCobs(awcData);
  if(stInfo?.name)S.station.name=stInfo.name;
  renderStation();if(_curLang!=='en')setTimeout(quickTranslate,300);
}

function buildSyntheticMetar(icao,p){
  const parts=[icao];
  if(p.timestamp){const d=new Date(p.timestamp);parts.push(String(d.getUTCDate()).padStart(2,'0')+String(d.getUTCHours()).padStart(2,'0')+String(d.getUTCMinutes()).padStart(2,'0')+'Z')}
  if(p.rawMessage===''||p.rawMessage===null)parts.push('AUTO');
  if(p.windDirection?.value!=null||p.windSpeed?.value!=null){
    const dir=p.windDirection?.value!=null?String(Math.round(p.windDirection.value)).padStart(3,'0'):'VRB';
    const spd=p.windSpeed?.value!=null?String(Math.round(p.windSpeed.value*0.539957)).padStart(2,'0'):'00';
    let w=dir+spd;
    if(p.windGust?.value!=null)w+='G'+String(Math.round(p.windGust.value*0.539957)).padStart(2,'0');
    parts.push(w+'KT');
  }
  if(p.visibility?.value!=null){const sm=p.visibility.value/1609.34;parts.push(sm>=10?'10SM':sm.toFixed(1)+'SM')}
  if(p.cloudLayers?.length){p.cloudLayers.forEach(c=>{const cov=c.amount||'';const alt=c.base?.value!=null?String(Math.round(c.base.value*3.28084/100)).padStart(3,'0'):'';if(cov&&alt)parts.push(cov+alt)})}
  else parts.push('CLR');
  if(p.temperature?.value!=null){const t=Math.round(p.temperature.value);const td=p.dewpoint?.value!=null?Math.round(p.dewpoint.value):null;parts.push((t<0?'M'+String(Math.abs(t)).padStart(2,'0'):String(t).padStart(2,'0'))+'/'+(td!=null?(td<0?'M'+String(Math.abs(td)).padStart(2,'0'):String(td).padStart(2,'0')):''))}
  if(p.barometricPressure?.value!=null){const inhg=p.barometricPressure.value/3386.39;parts.push('A'+Math.round(inhg*100).toString().padStart(4,'0'))}
  const rmk=[];
  rmk.push('AO2');
  const slpPa=p.seaLevelPressure?.value!=null?p.seaLevelPressure.value:(p.barometricPressure?.value!=null?p.barometricPressure.value:null);
  if(slpPa!=null){const slpMb=slpPa/100;const slpCode=Math.round((slpMb%100)*10).toString().padStart(3,'0');rmk.push('SLP'+slpCode)}
  if(p.temperature?.value!=null){const tv=p.temperature.value;const sgn=tv<0?'1':'0';const tCode=sgn+Math.round(Math.abs(tv)*10).toString().padStart(3,'0');let dpCode='';if(p.dewpoint?.value!=null){const dv=p.dewpoint.value;const ds=dv<0?'1':'0';dpCode=ds+Math.round(Math.abs(dv)*10).toString().padStart(3,'0')}if(dpCode)rmk.push('T'+tCode+dpCode);else rmk.push('T'+tCode)}
  if(rmk.length)parts.push('RMK',rmk.join(' '));
  return parts.join(' ');
}
async function loadStationObs(icao){
  const el=document.getElementById('page-station');
  S.stationId=icao;
  if(S._stationSource==='vatsim'){
    const st=S.nearbyStations?.find(s=>s.icao===icao)||{icao,name:icao,lat:S.lat,lon:S.lon};
    return loadStationVatsim(st);
  }
  if(S._stationSource==='awc'){return loadStationObsAWC(icao)}
  const stInfo=S.nearbyStations?.find(s=>s.icao===icao);
  const stName=stInfo?.name||S._airportDataCache?.find(a=>a.icao===icao)?.name||icao;
  const sLat=stInfo?.lat||S.lat;
  const sLon=stInfo?.lon||S.lon;
  let awcOk=false;
  try{
    const ar=await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=3`,{signal:AbortSignal.timeout(4000)});
    if(ar.ok){
      const ad=await ar.json();
      if(ad.length&&ad[0].rawOb){
        S.station=parseAWCobs(ad[0]);
        if(stInfo?.name)S.station.name=stInfo.name;
        if(!S.station.name||S.station.name===icao)S.station.name=stName;
        if(S.station.dewp==null||S.station.temp==null){
          for(let i=1;i<ad.length;i++){
            if(!ad[i].rawOb)continue;
            const older=parseAWCobs(ad[i]);
            if(S.station.temp==null&&older.temp!=null)S.station.temp=older.temp;
            if(S.station.dewp==null&&older.dewp!=null)S.station.dewp=older.dewp;
            if(S.station.temp!=null&&S.station.dewp!=null)break;
          }
        }
        awcOk=true;
        console.log('Station '+icao+' loaded from AWC: '+S.station.rawMETAR?.substring(0,40));
      }
    }
  }catch(e){console.log('AWC primary failed for '+icao+':',e.message)}
  if(!awcOk){
    try{
      const obsRes=await fetch(`https://api.weather.gov/stations/${icao}/observations/latest`,NWS_HDR);
      if(!obsRes.ok)throw new Error('Obs returned '+obsRes.status);
      const obsData=await obsRes.json();
      const p=obsData.properties||{};
      const geo=obsData.geometry?.coordinates;
      const _sLat=stInfo?.lat||(geo?geo[1]:S.lat);
      const _sLon=stInfo?.lon||(geo?geo[0]:S.lon);
      const nwsRaw=p.rawMessage||'';
      if(nwsRaw){
        S.station=parseRawMetar(nwsRaw,{icao,name:stName,lat:_sLat,lon:_sLon});
      }else{
        S.station={
          icao,name:stName,lat:_sLat,lon:_sLon,
          temp:p.temperature?.value!=null?p.temperature.value:null,
          dewp:p.dewpoint?.value!=null?p.dewpoint.value:null,
          windKmh:p.windSpeed?.value!=null?p.windSpeed.value:null,
          windDir:p.windDirection?.value!=null?p.windDirection.value:null,
          gustKmh:p.windGust?.value!=null?p.windGust.value:null,
          visMeter:p.visibility?.value!=null?p.visibility.value:null,
          presPa:p.barometricPressure?.value!=null?p.barometricPressure.value:null,
          rawMETAR:buildSyntheticMetar(icao,p),
          clouds:p.cloudLayers||[],obsTime:p.timestamp||'',
          wxString:p.textDescription||'',
        };
      }
      S.station.elev=p.elevation?.value!=null?p.elevation.value:null;
      S.station.obsTime=p.timestamp||'';
      if(!S.station.wxString)S.station.wxString=p.textDescription||'';
      if(p.cloudLayers?.length&&!S.station.clouds?.length)S.station.clouds=p.cloudLayers;
      if(S.station.temp==null&&p.temperature?.value!=null)S.station.temp=p.temperature.value;
      if(S.station.dewp==null&&p.dewpoint?.value!=null)S.station.dewp=p.dewpoint.value;
      if(S.station.windKmh==null&&p.windSpeed?.value!=null)S.station.windKmh=p.windSpeed.value;
      if(S.station.windDir==null&&p.windDirection?.value!=null)S.station.windDir=p.windDirection.value;
      if(S.station.presPa==null&&p.barometricPressure?.value!=null)S.station.presPa=p.barometricPressure.value;
      if(S.station.visMeter==null&&p.visibility?.value!=null)S.station.visMeter=p.visibility.value;
      if(!S.station.name||S.station.name===icao)S.station.name=stName;
      console.log('Station '+icao+' loaded from NWS API');
    }catch(e){
      console.error('NWS obs fetch error:',e);
      try{await loadStationObsAWC(icao)}catch(e2){
        el.innerHTML=`<div class="empty-state"><div class="empty-icon">📡</div><p>Could not load observations for ${icao}.</p></div>`;
      }
      return;
    }
  }
  if(awcOk&&(S.station.elev==null||!S.station.wxString)){
    const _suppIcao=icao;
    (async()=>{try{
      const nwsSupp=await fetch(`https://api.weather.gov/stations/${_suppIcao}/observations/latest`,NWS_HDR);
      if(!nwsSupp.ok||S.stationId!==_suppIcao)return;
      const nd=await nwsSupp.json();const np=nd.properties||{};
      let changed=false;
      if(S.station.elev==null&&np.elevation?.value!=null){S.station.elev=np.elevation.value;changed=true}
      if(!S.station.wxString&&np.textDescription){S.station.wxString=np.textDescription;changed=true}
      if(!S.station.obsTime&&np.timestamp){S.station.obsTime=np.timestamp;changed=true}
      if(changed&&S.stationId===_suppIcao)renderStation();
    }catch(e){}})();
  }
  const hasUsableData=S.station?.temp!=null||S.station?.windKmh!=null||S.station?.visMeter!=null;
  if(!hasUsableData){
    try{await loadStationObsAWC(icao)}catch(e2){
      el.innerHTML=`<div class="empty-state"><div class="empty-icon">📡</div><p>Could not load observations for ${icao}.</p></div>`;
    }
    return;
  }
  if(S.station.elev==null)_fetchStationElev(sLat,sLon);
  renderStation();if(_curLang!=='en')setTimeout(quickTranslate,300);
}
async function loadStationObsAWC(icao){
  let data=[];
  for(const hrs of [3,6,12]){
    try{
      const r=await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=${hrs}`,{signal:AbortSignal.timeout(8000)});
      if(r.ok){data=await r.json();if(data.length)break}
    }catch(e){console.log('AWC obs fetch error ('+hrs+'h):',e.message)}
  }
  const stInfo=S.nearbyStations?.find(s=>s.icao===icao);
  S.stationId=icao;
  if(!data.length)throw new Error('AWC returned no METAR for '+icao);
  S.station=parseAWCobs(data[0]);
  if(stInfo?.name)S.station.name=stInfo.name;
  renderStation();if(_curLang!=='en')setTimeout(quickTranslate,300);
}

function renderStation(){
  const el=document.getElementById('page-station');const s=S.station;if(!s)return;
  const tempC=s.temp;
  const dpC=s.dewp;
  const windKmh=s.windKmh;
  const gustKmh=s.gustKmh;
  const wDir=s.windDir;
  const visMeter=s.visMeter;
  const visSM=visMeter!=null?(visMeter/1609.34):null;
  const presPa=s.presPa;
  const presMb=presPa!=null?(presPa/100):null;
  const rh=(tempC!=null&&dpC!=null)?Math.round(100*Math.exp((17.27*dpC)/(237.7+dpC))/Math.exp((17.27*tempC)/(237.7+tempC))):null;
  const dist=(s.lat!=null&&s.lon!=null)?haversine(S.lat,S.lon,s.lat,s.lon).toFixed(1):'?';
  const raw=s.rawMETAR||'';
  const _fltInfo=getFltCatDetail(visSM,s);
  const fltCat=_fltInfo.cat;
  const fltCls=fltCat==='VFR'?'vfr':fltCat==='MVFR'?'mvfr':fltCat==='IFR'?'ifr':'lifr';
  const stationName=s.name||S.stationId||'Weather Station';
  const obLabel=s.obsTime?fmtClock(new Date(s.obsTime)):'';

  const skyTxt=formatClouds(s);
  const wxDesc=s.wxString||skyTxt;
  const feelsLike=tempC!=null?calcFeelsLike(tempC,windKmh,rh):null;

  const homeIcao=S.nearbyStations?.length?S.nearbyStations[0].icao:null;
  const isHome=!homeIcao||S.stationId===homeIcao;

  el.innerHTML=`
    <div class="card" style="padding-bottom:8px">
      ${!isHome?`<div class="mb-8"><button onclick="switchStation('${homeIcao}')" style="padding:4px 10px;background:rgba(0,229,255,0.1);color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.3);border-radius:6px;font-size:0.75em;cursor:pointer;font-weight:600">← Back to ${homeIcao}</button></div>`:''}
      ${s._noMetar?`<div style="background:rgba(255,193,7,0.12);border:1px solid rgba(255,193,7,0.35);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:0.78em;color:#ffc107;display:flex;align-items:center;gap:6px"><span class="text-1-2">📡</span><span><b>${s.icao||S.stationId}</b> found — ${s._reason||'No recent METAR available'}. International stations may report infrequently.</span></div>`:''}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        ${stationNeonIcon(wxDesc,32)}
        <div class="flex-1">
          <div style="font-weight:700;font-size:0.95em">${S.stationId} — ${stationName}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:2px;flex-wrap:wrap">
            <span class="flt-cat flt-${fltCls}" style="font-size:0.7em;padding:1px 8px" title="${_fltInfo.reason}">${fltCat==='VFR'?'●':'◉'} ${fltCat}</span><span class="text-hint" style="font-size:0.55em">${_fltInfo.reason}</span>
            <span class="text-muted-65">${S.visUnit===1?(dist*1.60934).toFixed(1)+' km':dist+' mi'} away</span>
            ${obLabel?`<span style="font-size:0.6em;color:var(--text-muted);font-family:var(--font-mono)">Updated: ${obLabel}</span>`:''}
          </div>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:16px;margin:12px 0;justify-content:center">
        <div class="wind-compass" style="width:100px;height:100px;flex-shrink:0">
          <span class="compass-label compass-n">N</span><span class="compass-label compass-s">S</span>
          <span class="compass-label compass-e">E</span><span class="compass-label compass-w">W</span>
          <div class="wind-arrow" style="transform:rotate(${wDir||0}deg)"></div>
        </div>
        <div style="text-align:left">
          <div style="font-size:1.4em;font-weight:700">${windKmh!=null?fmtWind(windKmh):(gustKmh!=null?fmtWind(gustKmh):'Calm')}</div>
          <div class="c-muted-sm">${wDir!=null?degToDir(wDir)+' wind':(windKmh!=null?'Variable wind':(gustKmh!=null?'Gusting':'Calm'))}</div>
          ${gustKmh!=null&&windKmh!=null?`<div style="font-size:0.8em;color:var(--accent-orange);font-weight:600">Gusts ${fmtWind(gustKmh)}</div>`:''}
        </div>
      </div>

      <div class="station-grid" style="grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px">
        <div class="station-tile" style="padding:10px">
          <div style="font-size:0.6em;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Temperature</div>
          <div class="station-val text-13">${tempC!=null?fmtTemp(tempC):'--'}</div>
          ${feelsLike!=null&&Math.abs(feelsLike-tempC)>1?`<div class="text-muted-65">Feels ${fmtTemp(feelsLike)}</div>`:''}
        </div>
        <div class="station-tile" style="padding:10px">
          <div style="font-size:0.6em;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Dew Point</div>
          <div class="station-val text-13">${dpC!=null?fmtTemp(dpC):'--'}</div>
          <div class="text-muted-65">${rh!=null?rh+'% RH':''}</div>
        </div>
      </div>

      <div class="station-grid" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
        <div class="station-tile px-6-py-8">
          <div class="tile-label-upper">Pressure</div>
          <div class="station-val text-1">${presMb!=null?fmtPres(presMb):'--'}</div>
        </div>
        <div class="station-tile px-6-py-8">
          <div class="tile-label-upper">Visibility</div>
          <div class="station-val text-1">${visSM!=null?fmtVis(visSM):'--'}</div>
        </div>
        <div class="station-tile px-6-py-8">
          <div class="tile-label-upper">Sky</div>
          <div class="station-val" style="font-size:${skyTxt.length>10?'0.75':'1'}em">${skyTxt}</div>
        </div>
      </div>

      ${(()=>{
        if(tempC==null||dpC==null)return'';
        const _sp=tempC-dpC;const _wk=windKmh!=null?(windKmh/1.852):null;
        const _dy=_isDaytimeNow();
        const _cc=_stationCloudPct(s);
        const _fog=getFogRisk(_sp,_wk,_dy,_cc);
        const _inv=detectInversion(_sp,_wk,_dy,_cc);
        let html='<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
        html+=`<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:8px;padding:8px;text-align:center"><div class="tile-label-upper">🌫️ Fog Risk</div><div style="font-size:0.9em;font-weight:700;color:${_fog.color}">${_fog.level}</div><div class="text-hint">${_fog.desc}</div></div>`;
        html+='<div style="flex:1;min-width:120px;background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle);border-radius:8px;padding:8px;text-align:center"><div class="tile-label-upper">☁️ Cloud Base</div>';
        const _estCb=calcCloudBase(_sp);
        const _ceil=getMetarCeilingFt(s);
        let _cbArrow='';
        if(_ceil!=null){
          if(_ceil>=_estCb)_cbArrow=' <span style="color:#39ff14;font-weight:900;font-size:1.1em;text-shadow:0 0 6px rgba(57,255,20,0.6)">↑</span>';
          else _cbArrow=' <span style="color:#ff3355;font-weight:900;font-size:1.1em;text-shadow:0 0 6px rgba(255,51,85,0.6)">↓</span>';
        }else{
          const _hr=S._hourlyData;
          if(_hr&&_hr.time&&_hr.temperature_2m&&_hr.dew_point_2m){
            const _nowMs=Date.now();
            const _nIdx=_hr.time.findIndex(t=>new Date(t).getTime()>=_nowMs);
            if(_nIdx>=0&&_nIdx+1<_hr.time.length){
              const _s0=_hr.temperature_2m[_nIdx]-_hr.dew_point_2m[_nIdx];
              const _s1=_hr.temperature_2m[_nIdx+1]-_hr.dew_point_2m[_nIdx+1];
              const _delta=_s1-_s0;
              if(_delta>0.5)_cbArrow=' <span style="color:#39ff14;font-weight:900;font-size:1.1em;text-shadow:0 0 6px rgba(57,255,20,0.6)">↑</span>';
              else if(_delta<-0.5)_cbArrow=' <span style="color:#ff3355;font-weight:900;font-size:1.1em;text-shadow:0 0 6px rgba(255,51,85,0.6)">↓</span>';
              else _cbArrow=' <span style="color:var(--text-muted);font-size:1.1em">→</span>';
            }
          }
        }
        html+=`<div style="font-size:0.9em;font-weight:700;color:var(--accent-cyan)">${fmtAlt(_estCb)}${_cbArrow}</div><div class="text-hint">Estimated AGL</div>`;
        html+='</div>';
        html+='</div>';
        if(_inv.detected)html+=`<div style="background:rgba(255,152,0,0.1);border:1px solid rgba(255,152,0,0.3);border-radius:8px;padding:6px 10px;margin-bottom:10px;font-size:0.72em;color:var(--accent-orange);text-align:center">⚠️ ${_inv.text}</div>`;
        return html;
      })()}
      ${raw?`<div class="metar-raw" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'" style="cursor:pointer">${raw} <span style="font-size:0.75em;color:var(--text-muted)">▼ tap to decode</span></div><div class="metar-decoded" style="display:none">${decodeMetar(raw)}</div>`:''}
    </div>
    ${renderNearbyStations()}`;
  // Keep Weather tab cloud base color in sync with latest station data
  if(typeof updateWeatherCloudBaseColor==='function')updateWeatherCloudBaseColor();
}

function renderNearbyStations(){
  if(!S.nearbyStations||S.nearbyStations.length<=1)return'';
  return`<div class="card"><div class="card-title"><span class="icon">📡</span> Nearby Stations (${S.nearbyStations.length})</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${S.nearbyStations.map(st=>{
        const active=st.icao===S.stationId;
        return`<div onclick="switchStation('${st.icao}')" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${active?'var(--bg-elevated)':'var(--bg-surface)'};border:1px solid ${active?'var(--accent-blue)':'var(--border-subtle)'};border-radius:var(--radius-sm);cursor:pointer;font-size:0.8em">
          <div><span style="font-weight:700;color:${active?'var(--accent-cyan)':'var(--text-primary)'}">${st.icao}</span> <span class="c-muted">${st.name||''}</span></div>
          <span class="c-muted-85">${st.dist.toFixed(1)} mi</span>
        </div>`;
      }).join('')}
    </div></div>`;
}

async function switchStation(code){
  let icao=code.toUpperCase().trim();
  if(icao.length===3){
    const match=S.nearbyStations?.find(s=>(s.iata||'').toUpperCase()===icao||(s.faa||'').toUpperCase()===icao);
    if(match){icao=match.icao}
    else{
      const airports=await _loadGlobalAirports();
      const dbMatch=airports?.find(a=>(a.iata||'').toUpperCase()===icao);
      if(dbMatch){icao=dbMatch.icao}
      else{
        try{
          const infoR=await fetch(`https://aviationweather.gov/api/data/stationinfo?ids=K${icao},C${icao},E${icao},L${icao},S${icao}&format=json`,{signal:AbortSignal.timeout(5000)});
          if(infoR.ok){const infoD=await infoR.json();if(infoD.length)icao=infoD[0].icaoId}
          else icao='K'+icao;
        }catch(e){icao='K'+icao}
      }
    }
  }
  toast('Loading '+icao+'...');
  S.stationId=icao;
  const isUS=/^K[A-Z]{3}$/.test(icao)||/^P[A-Z]{3}$/.test(icao)||/^TJ[A-Z]{2}$/.test(icao)||/^PH[A-Z]{2}$/.test(icao);
  S._stationSource=isUS?'nws':'awc';
  try{
    await loadStationObs(icao);
  }catch(e){
    console.error('switchStation error for',icao,':',e.message);
    const el=document.getElementById('page-station');
    if(el)el.innerHTML=`<div class="empty-state"><div class="empty-icon">📡</div><p>Could not load ${icao}.<br><span class="c-muted-sm">${e.message}</span></p></div>`;
  }
}

function decodeMetar(raw){
  if(!raw)return'';
  const WX_CODES={
    'TS':'Thunderstorm','RA':'Rain','SN':'Snow','DZ':'Drizzle','FG':'Fog','BR':'Mist',
    'HZ':'Haze','FU':'Smoke','SA':'Sand','DU':'Dust','SQ':'Squall','FC':'Funnel Cloud',
    'GR':'Hail','GS':'Small Hail/Snow Pellets','IC':'Ice Crystals','PL':'Ice Pellets',
    'SG':'Snow Grains','UP':'Unknown Precip','VA':'Volcanic Ash','PO':'Dust Whirls',
    'SS':'Sandstorm','DS':'Duststorm','FZ':'Freezing','BL':'Blowing','DR':'Low Drifting',
    'MI':'Shallow','PR':'Partial','BC':'Patches','SH':'Showers','PE':'Ice Pellets'
  };
  const parts=raw.trim().split(/\s+/);
  const rows=[];
  let _lastMetarTempC=null;
  const c=(color,label,val,extra)=>`<div style="display:flex;align-items:baseline;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="font-family:var(--font-mono);font-weight:700;color:${color};min-width:70px;font-size:0.85em">${label}</span><span style="color:${color};font-weight:600;font-size:0.9em">${val}</span>${extra?`<span class="text-muted-sm">${extra}</span>`:''}</div>`;

  for(let i=0;i<parts.length;i++){
    const p=parts[i];
    if(i===0&&/^[A-Z]{4}$/.test(p)){
      rows.push(c('var(--accent-cyan)','Station',p,'ICAO identifier'));continue;
    }
    if(/^\d{6}Z$/.test(p)){
      const day=p.slice(0,2),hr=p.slice(2,4),mn=p.slice(4,6);
      rows.push(c('#a78bfa','Time',`Day ${day}, ${hr}:${mn} UTC`,'Observation time'));continue;
    }
    if(p==='AUTO'){rows.push(c('#94a3b8','Type','Automated','No human observer'));continue}
    if(p==='COR'){rows.push(c('#f59e0b','Type','Corrected','Correction to prior report'));continue}
    if(/^(VRB|\d{3})\d{2,3}(G\d{2,3})?(KT|MPS|KMH)$/.test(p)){
      const m=p.match(/^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?(KT|MPS|KMH)$/);
      if(m){
        const dir=m[1]==='VRB'?'Variable':m[1]+'°';
        const spd=parseInt(m[2]);const gust=m[4]?parseInt(m[4]):null;
        const unit=m[5];
        const unitLabel=unit==='KT'?'knots':unit==='MPS'?'m/s':'km/h';
        const spdKt=unit==='MPS'?spd*1.944:unit==='KMH'?spd*0.5399:spd;
        const gustKt=gust?(unit==='MPS'?gust*1.944:unit==='KMH'?gust*0.5399:gust):null;
        let wStr=`${dir} at ${spd} ${unitLabel}`;
        if(unit!=='KT')wStr+=` (${Math.round(spdKt)} kt)`;
        if(gust){wStr+=`, gusting ${gust} ${unitLabel}`;if(unit!=='KT')wStr+=` (${Math.round(gustKt)} kt)`}
        if(spd===0&&!gust)wStr='Calm';
        const sev=gustKt&&gustKt>=35?'color:var(--accent-red);font-weight:700':spdKt>=25?'color:var(--accent-orange)':'';
        rows.push(c(sev||'#22c55e','Wind',wStr,gustKt>=50?'⚠️ DANGEROUS':''));
      }continue;
    }
    if(/^\d{3}V\d{3}$/.test(p)){
      rows.push(c('#22c55e','Wind Var',`${p.slice(0,3)}° to ${p.slice(4)}°`,'Variable direction'));continue;
    }
    if(/^\d+SM$/.test(p)||/^\d+\/\d+SM$/.test(p)||p==='M1/4SM'||p==='P6SM'){
      let vis=p.replace('SM','');
      if(vis.startsWith('M'))vis='Less than '+vis.slice(1);
      const visMi=parseFloat(vis)||10;
      const sev=visMi<1?'var(--accent-red)':visMi<3?'var(--accent-orange)':visMi<=5?'#f59e0b':'#22c55e';
      rows.push(c(sev,'Visibility',vis+' statute miles',visMi<3?'⚠️ Low visibility':''));continue;
    }
    if(/^\d{4}$/.test(p)&&!(/^\d{6}Z$/.test(p))&&parseInt(p)>=0&&parseInt(p)<=9999&&i>1){
      const visM=parseInt(p);
      const visKm=(visM/1000).toFixed(1);
      const visMi2=(visM/1609.34).toFixed(1);
      const visStr=visM>=9999?'10+ km (6.2+ mi)':visM>=5000?`${visKm} km (${visMi2} mi)`:`${visM} m (${visMi2} mi)`;
      const sev2=visM<1600?'var(--accent-red)':visM<5000?'var(--accent-orange)':visM<=8000?'#f59e0b':'#22c55e';
      rows.push(c(sev2,'Visibility',visStr,visM<1600?'⚠️ Low visibility':'International (meters)'));continue;
    }
    if(/^R\d{2}/.test(p)){
      rows.push(c('#f59e0b','RVR',p,'Runway visual range'));continue;
    }
    const wxMatch=p.match(/^([+-]|VC)?(TS|SH|FZ|BL|DR|MI|PR|BC)?(RA|SN|DZ|FG|BR|HZ|FU|SA|DU|SQ|FC|GR|GS|IC|PL|SG|UP|VA|PO|SS|DS|PE)+$/);
    if(wxMatch){
      const intensity=p.startsWith('+')?'Heavy':p.startsWith('-')?'Light':p.startsWith('VC')?'Vicinity':'Moderate';
      let desc='';
      const body=p.replace(/^[+-]|^VC/,'');
      for(let j=0;j<body.length;j+=2){
        const code=body.slice(j,j+2);
        if(WX_CODES[code])desc+=(desc?' + ':'')+WX_CODES[code];
      }
      const hasSevere=p.includes('TS')||p.includes('GR')||p.includes('FC')||p.includes('SQ');
      const hasLightning=p.includes('TS');
      const sev=hasSevere?'var(--accent-red)':p.startsWith('+')?'var(--accent-orange)':'#f59e0b';
      rows.push(c(sev,'Weather',`${intensity}: ${desc}`,hasLightning?'⚡ Lightning possible':''));continue;
    }
    if(/^(CLR|SKC|FEW|SCT|BKN|OVC|VV)\d{0,3}/.test(p)){
      const cov=p.match(/^(CLR|SKC|FEW|SCT|BKN|OVC|VV)/)[1];
      const ht=p.replace(cov,'');
      const htFt=ht?parseInt(ht)*100:null;
      const covNames={CLR:htFt!=null?'Clear (below '+htFt.toLocaleString()+'ft)':'Clear',SKC:'Sky Clear',FEW:'Few (1-2 oktas)',SCT:'Scattered (3-4 oktas)',BKN:'Broken (5-7 oktas)',OVC:'Overcast (8 oktas)',VV:'Vertical Visibility'};
      const sev=(cov==='OVC'||cov==='BKN')&&htFt&&htFt<1000?'var(--accent-orange)':cov==='VV'?'var(--accent-red)':'#64748b';
      rows.push(c(sev,'Clouds',`${covNames[cov]||cov}${htFt!=null&&cov!=='CLR'?' at '+htFt.toLocaleString()+' ft':''}`,''));continue;
    }
    if(/^M?\d{1,2}\/M?\d{0,2}$/.test(p)){
      const [t,d]=p.split('/');
      const tc=t.startsWith('M')?-parseInt(t.slice(1)):parseInt(t);
      _lastMetarTempC=tc;
      if(d&&d.length){
        const dc=d.startsWith('M')?-parseInt(d.slice(1)):parseInt(d);
        const spreadC=tc-dc;
        const cbFt=calcCloudBase(spreadC);
        const _mCeil=getMetarCeilingFt(S.station);
        let cbLine=`Spread: ${fmtTempDiff(spreadC)} — ${getSpreadLabel(spreadC)}<br>Est. cloud base: ~${fmtAlt(cbFt)} AGL`;
        if(_mCeil!=null){
          cbLine+=`<br>Reported ceiling: ${fmtAlt(_mCeil)} AGL`;
        }
        rows.push(c('#00e5ff','Temp/Dew',`${fmtTemp(tc)} / ${fmtTemp(dc)}`,cbLine));
      }else{
        rows.push(c('#00e5ff','Temp/Dew',`${fmtTemp(tc)} / --`,'Dew point not reported'));
      }
      continue;
    }
    if(/^A\d{4}$/.test(p)){
      const inhg=(parseInt(p.slice(1))/100).toFixed(2);
      const mb=(parseFloat(inhg)*33.8639).toFixed(1);
      const elevM=S.station?.elev!=null?S.station.elev:(S._terrainData?S._terrainData.userElev:null);
      const elevFt=elevM!=null?elevM*3.281:null;
      let altExtra='';
      if(elevFt!=null){
        const pa=calcPressureAlt(elevFt,parseFloat(inhg));
        altExtra+=`<br>Pressure Alt: ${fmtAlt(pa)}`;
        const metarTempC=_lastMetarTempC;
        if(metarTempC!=null){
          const da=calcDensityAlt(elevFt,parseFloat(inhg),metarTempC);
          const daAbove=da-elevFt;
          const daColor=daAbove>6000?'var(--accent-red)':daAbove>4000?'var(--accent-orange)':daAbove>2000?'var(--accent-yellow)':'var(--accent-green)';
          altExtra+=`<br><span style="color:${daColor}">Density Alt: ${fmtAlt(da)}</span>`;
        }
      }
      rows.push(c('#a78bfa','Altimeter',`${inhg} inHg (${mb} mb)`,altExtra));continue;
    }
    if(/^Q\d{4}$/.test(p)){
      const mb=parseInt(p.slice(1));
      const qInHg=(mb/33.8639).toFixed(2);
      const elevM=S.station?.elev!=null?S.station.elev:(S._terrainData?S._terrainData.userElev:null);
      const elevFt=elevM!=null?elevM*3.281:null;
      let qExtra='';
      if(elevFt!=null){
        const pa=calcPressureAlt(elevFt,parseFloat(qInHg));
        qExtra+=`<br>Pressure Alt: ${fmtAlt(pa)}`;
        if(_lastMetarTempC!=null){
          const da=calcDensityAlt(elevFt,parseFloat(qInHg),_lastMetarTempC);
          const daAbove=da-elevFt;
          const daColor=daAbove>6000?'var(--accent-red)':daAbove>4000?'var(--accent-orange)':daAbove>2000?'var(--accent-yellow)':'var(--accent-green)';
          qExtra+=`<br><span style="color:${daColor}">Density Alt: ${fmtAlt(da)}</span>`;
        }
      }
      rows.push(c('#a78bfa','QNH',`${mb} hPa (${qInHg} inHg)`,qExtra));continue;
    }
    if(p==='RMK'){
      const rmk=parts.slice(i+1).join(' ');
      const rmkParts=[];
      if(rmk.includes('AO2'))rmkParts.push('Automated station with precip sensor');
      if(rmk.includes('AO1'))rmkParts.push('Automated station without precip sensor');
      const pkm=rmk.match(/PK WND (\d{3})(\d{2,3})\/(\d{2,4})/);
      if(pkm)rmkParts.push(`Peak wind ${pkm[1]}° at ${pkm[2]} kt at :${pkm[3]}`);
      const slpm=rmk.match(/SLP(\d{3})/);
      if(slpm){const slp=(parseInt(slpm[1])<500?'10':'9')+slpm[1].slice(0,2)+'.'+slpm[1].slice(2);rmkParts.push(`Sea level pressure: ${slp} mb`)}
      const tm=rmk.match(/T(\d)(\d{3})(\d)(\d{3})/);
      if(tm){const t=(tm[1]==='1'?-1:1)*parseInt(tm[2])/10;const d=(tm[3]==='1'?-1:1)*parseInt(tm[4])/10;rmkParts.push(`Precise: ${t.toFixed(1)}°C / ${d.toFixed(1)}°C`)}
      if(rmk.includes('$'))rmkParts.push('⚠️ Station needs maintenance');
      const ltg=rmk.match(/LTG(DSNT|VC)?\s*(CG|IC|CC|CA)*/);
      if(ltg)rmkParts.push('⚡ Lightning observed'+(ltg[1]==='DSNT'?' (distant)':ltg[1]==='VC'?' (vicinity)':''));
      if(rmkParts.length)rows.push(c('#94a3b8','Remarks',rmkParts.join('<br>'),''));
      else rows.push(c('#94a3b8','Remarks',rmk,''));
      break;
    }
  }
  return`<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:8px 10px;margin-top:4px;font-size:0.8em">${rows.join('')}</div>`;
}

function wxDescToCode(desc){
  if(!desc)return 0;
  const d=desc.toLowerCase();
  if(d.includes('thunder')||d.includes('t-storm'))return d.includes('hail')?96:95;
  if(d.includes('heavy snow')||d.includes('blizzard'))return 75;
  if(d.includes('snow shower'))return 85;
  if(d.includes('snow'))return 73;
  if(d.includes('freezing rain')||d.includes('ice')||d.includes('sleet'))return 66;
  if(d.includes('heavy rain'))return 65;
  if(d.includes('rain shower'))return 80;
  if(d.includes('rain'))return 61;
  if(d.includes('drizzle'))return 51;
  if(d.includes('fog')||d.includes('mist')||d.includes('haze'))return 45;
  if(d.includes('overcast'))return 3;
  if(d.includes('mostly cloudy')||d.includes('broken'))return 3;
  if(d.includes('partly')||d.includes('scattered'))return 2;
  if(d.includes('few cloud'))return 1;
  if(d.includes('clear')||d.includes('fair')||d.includes('sunny'))return 0;
  return 2;
}
function isCurrentlyDay(){
  const h=new Date().getHours();
  return h>=6&&h<20;
}
function metarDescToBasmilius(desc,isDay){
  if(!desc)return null;
  const d=desc.toLowerCase();
  const dn=isDay!==undefined?isDay:isCurrentlyDay();
  if(d.includes('thunder')&&d.includes('rain'))return dn?'thunderstorms-day-rain':'thunderstorms-night-rain';
  if(d.includes('thunder')||d.includes('tsra')||d.includes('ts '))return dn?'thunderstorms-day':'thunderstorms-night';
  if(d.includes('freezing rain')||d.includes('freezing drizzle')||d.includes('fzra')||d.includes('fzdz'))return'sleet';
  if(d.includes('heavy rain')||d.includes('heavy shower'))return dn?'extreme-day-rain':'extreme-night-rain';
  if(d.includes('rain shower')||d.includes('light rain')||d.includes('-ra'))return dn?'partly-cloudy-day-rain':'partly-cloudy-night-rain';
  if(d.includes('rain')||d.includes(' ra'))return'rain';
  if(d.includes('heavy snow'))return dn?'extreme-day-snow':'extreme-night-snow';
  if(d.includes('snow shower')||d.includes('flurr'))return dn?'partly-cloudy-day-snow':'partly-cloudy-night-snow';
  if(d.includes('snow')||d.includes(' sn'))return'snow';
  if(d.includes('drizzle')||d.includes(' dz'))return'drizzle';
  if(d.includes('sleet')||d.includes('ice pellet')||d.includes(' pl'))return'sleet';
  if(d.includes('hail')||d.includes(' gr'))return dn?'extreme-day-hail':'extreme-night-hail';
  if(d.includes('fog')||d.includes('mist')||d.includes(' fg')||d.includes(' br'))return dn?'fog-day':'fog-night';
  if(d.includes('haze')||d.includes('smoke')||d.includes(' hz')||d.includes(' fu'))return dn?'haze-day':'haze-night';
  if(d.includes('dust')||d.includes('sand'))return dn?'dust-day':'dust-night';
  if(d.includes('tornado')||d.includes('funnel'))return'tornado';
  if(d.includes('hurricane'))return'hurricane';
  if(d.includes('overcast')||d==='ovc'||d.startsWith('ovc '))return'overcast';
  if(d.includes('broken')||d.includes('mostly cloudy')||d==='bkn'||d.startsWith('bkn '))return'overcast';
  if(d.includes('scattered')||d.includes('partly cloudy')||d.includes('partly sunny')||d==='sct'||d.startsWith('sct '))return dn?'partly-cloudy-day':'partly-cloudy-night';
  if(d.includes('few cloud')||d.includes('mostly clear')||d.includes('mostly sunny')||d==='few'||d.startsWith('few '))return dn?'partly-cloudy-day':'partly-cloudy-night';
  if(d.includes('clear')||d.includes('fair')||d.includes('sunny')||d==='clr'||d==='skc')return dn?'clear-day':'clear-night';
  if(d.includes('cloudy')||d.includes('cloud'))return'cloudy';
  if(d.includes('wind'))return'wind';
  return null;
}
function _basmiliusToCond(bm){
  const m={'clear-day':'clear-day','clear-night':'clear-night','partly-cloudy-day':'partly-cloudy-day','partly-cloudy-night':'partly-cloudy-night','overcast':'overcast','fog-day':'fog','fog-night':'fog','haze-day':'haze','haze-night':'haze','dust-day':'haze','dust-night':'haze','drizzle':'rain','rain':'rain','extreme-rain':'rain-heavy','extreme-day-rain':'rain-heavy','extreme-night-rain':'rain-heavy','partly-cloudy-day-rain':'few-clouds-day-rain','partly-cloudy-night-rain':'mostly-cloudy-night-rain','overcast-day-rain':'mostly-cloudy-day-rain','overcast-night-rain':'mostly-cloudy-night-rain','snow':'snow','extreme-snow':'blizzard','extreme-day-snow':'blizzard','extreme-night-snow':'blizzard','partly-cloudy-day-snow':'partly-cloudy-day-snow','partly-cloudy-night-snow':'mostly-cloudy-night-snow','overcast-day-snow':'mostly-cloudy-night-snow','overcast-night-snow':'snow-night','sleet':'sleet','thunderstorms-day':'thunderstorm','thunderstorms-night':'thunderstorm-night','thunderstorms-day-rain':'thunderstorm','thunderstorms-night-rain':'thunderstorm-night','thunderstorms-day-extreme-rain':'thunderstorm-rain','thunderstorms-night-extreme-rain':'thunderstorm-night','tornado':'tornado','hurricane':'tornado','wind':'overcast','cloudy':'overcast','extreme-day-hail':'thunderstorm','extreme-night-hail':'thunderstorm-night'};
  return m[bm]||'overcast';
}
function stationNeonIcon(desc,sz){
  const s=parseInt(sz)||24;
  const dn=isCurrentlyDay();
  const bm=metarDescToBasmilius(desc,dn);
  if(bm){
    const pack=_getIconPack();
    if(pack==='basmilius')return bmIcon(bm,s);
    return getWeatherIcon(_basmiliusToCond(bm),s);
  }
  return neonWx(wxDescToCode(desc),dn,s);
}

function formatClouds(s){
  if(!s.clouds||!s.clouds.length)return'CLR';
  return s.clouds.map(c=>{
    const cvg=c.amount||c.cover||'';
    let baseFt=null;
    if(c.base!=null&&typeof c.base==='object'&&c.base.value!=null)baseFt=Math.round(c.base.value*3.281/100)*100;
    else if(typeof c.base==='number')baseFt=Math.round(c.base/100)*100;
    return cvg+(baseFt!=null?' '+baseFt+'ft':'');
  }).filter(Boolean).join(', ')||'CLR';
}

function renderMetarDecoded(s){
  const parts=[];
  if(s.temp!=null)parts.push(`<span>🌡️ Temp: ${fmtTemp(s.temp)}</span>`);
  if(s.dewp!=null)parts.push(`<span>💧 Dew: ${fmtTemp(s.dewp)}</span>`);
  if(s.windKmh!=null){
    let w=`💨 Wind: ${fmtWind(s.windKmh)} ${s.windDir!=null?degToDir(s.windDir):'VRB'}`;
    if(s.gustKmh!=null)w+=` G${fmtWind(s.gustKmh)}`;
    parts.push(`<span>${w}</span>`);
  }
  if(s.visMeter!=null)parts.push(`<span>👁️ Vis: ${fmtVis(s.visMeter/1609.34)}</span>`);
  if(s.presPa!=null)parts.push(`<span>📊 Baro: ${fmtPres(s.presPa/100)}</span>`);
  if(s.wxString)parts.push(`<span style="color:var(--accent-orange)">🌤️ ${s.wxString}</span>`);
  if(!parts.length)return'';
  return`<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:12px;font-size:0.7em;color:var(--text-secondary)">${parts.join('')}</div>`;
}

function getFltCat(visSM,s){return getFlightCatBadge(visSM,s).cat}
function getFltCatDetail(visSM,s){return getFlightCatBadge(visSM,s)}

