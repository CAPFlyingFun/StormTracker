// ==========================================
// WEATHER (Open-Meteo)
// ==========================================
let _lightningFlashState=null;

// Blend two Open-Meteo model responses into one.
// gfs = GFS (global baseline, what NWS uses)
// hrrr = HRRR (high-res CONUS, hourly updates) — may be null outside US
// For precipitation: take the max (more conservative — HRRR tends to underestimate).
// For all other numeric arrays: simple average where both have valid data.
function _blendOMModels(gfs,hrrr){
  if(!gfs&&!hrrr)return null;
  if(!gfs)return hrrr;
  if(!hrrr)return gfs;
  // Deep copy GFS as the base structure
  const out=JSON.parse(JSON.stringify(gfs));
  out._modelBlend='GFS+HRRR';

  // --- Current ---
  const curAvg=['temperature_2m','apparent_temperature','precipitation',
    'relative_humidity_2m','cloud_cover','pressure_msl',
    'wind_speed_10m','wind_gusts_10m','wind_direction_10m'];
  curAvg.forEach(v=>{
    if(gfs.current?.[v]!=null&&hrrr.current?.[v]!=null)
      out.current[v]=+(((gfs.current[v]+hrrr.current[v])/2).toFixed(4));
  });
  // Precip: max for safety
  if(gfs.current?.precipitation!=null&&hrrr.current?.precipitation!=null)
    out.current.precipitation=Math.max(gfs.current.precipitation,hrrr.current.precipitation);

  // --- Hourly ---
  const hrAvg=['temperature_2m','apparent_temperature','relative_humidity_2m',
    'dew_point_2m','weather_code','wind_speed_10m','wind_gusts_10m',
    'wind_direction_10m','pressure_msl','cloud_cover','visibility',
    'cape','lifted_index','convective_inhibition','uv_index','freezing_level_height'];
  const gLen=gfs.hourly?.time?.length||0;
  const hLen=hrrr.hourly?.time?.length||0;
  hrAvg.forEach(v=>{
    const ga=gfs.hourly?.[v],ha=hrrr.hourly?.[v];
    if(!ga&&!ha)return;
    if(!ha){out.hourly[v]=ga;return;}
    if(!ga){out.hourly[v]=ha;return;}
    out.hourly[v]=ga.map((g,i)=>{
      const h=ha[i];
      if(g==null&&h==null)return null;
      if(g==null)return h;
      if(h==null)return g;
      return +((g+h)/2).toFixed(4);
    });
  });
  // Hourly precip: max where both present, else fall back to whichever model
  // has the array (mirrors the graceful fallback used for every other field
  // above — otherwise the Rain Forecast Bars graph silently vanishes whenever
  // one model is missing the precipitation key).
  {
    const gp=gfs.hourly?.precipitation,hp=hrrr.hourly?.precipitation;
    if(gp&&hp){
      out.hourly.precipitation=gp.map((g,i)=>Math.max(g??0,hp[i]??0));
    }else if(gp){out.hourly.precipitation=gp}
    else if(hp){out.hourly.precipitation=hp}
  }

  // --- Daily ---
  const dayAvg=['temperature_2m_max','temperature_2m_min','wind_speed_10m_max'];
  dayAvg.forEach(v=>{
    const ga=gfs.daily?.[v],ha=hrrr.daily?.[v];
    if(!ga||!ha){out.daily[v]=ga||ha;return;}
    out.daily[v]=ga.map((g,i)=>{
      const h=ha[i];
      if(g==null&&h==null)return null;
      if(g==null)return h;
      if(h==null)return g;
      return +((g+h)/2).toFixed(4);
    });
  });
  // Daily precip sum: max where both present, else single-model fallback
  // (same bug class as hourly.precipitation — see comment above).
  {
    const gp=gfs.daily?.precipitation_sum,hp=hrrr.daily?.precipitation_sum;
    if(gp&&hp){out.daily.precipitation_sum=gp.map((g,i)=>Math.max(g??0,hp[i]??0))}
    else if(gp){out.daily.precipitation_sum=gp}
    else if(hp){out.daily.precipitation_sum=hp}
  }
  // Daily precip probability: max where both present, else single-model fallback
  {
    const gp=gfs.daily?.precipitation_probability_max,hp=hrrr.daily?.precipitation_probability_max;
    if(gp&&hp){out.daily.precipitation_probability_max=gp.map((g,i)=>Math.max(g??0,hp[i]??0))}
    else if(gp){out.daily.precipitation_probability_max=gp}
    else if(hp){out.daily.precipitation_probability_max=hp}
  }

  return out;
}
async function _fetchOMModels(host,omPath,isUS){
  const _getJSON=url=>fetch(url,{signal:AbortSignal.timeout(12000)}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()});
  const base='https://'+host+'/v1/forecast'+omPath;
  const [_gfsRes,_hrrrRes]=await Promise.allSettled([
    _getJSON(base+'&models=gfs_seamless'),
    isUS?_getJSON(base+'&models=hrrr_conus'):Promise.resolve(null)
  ]);
  const g=_gfsRes.status==='fulfilled'?_gfsRes.value:null;
  const h=_hrrrRes.status==='fulfilled'?_hrrrRes.value:null;
  return{gfs:g,hrrr:h,blended:_blendOMModels(g,h)||g||h};
}
// v4.45: Try api.open-meteo.com, on host failure (both models fail) fall
// through to customer-api.open-meteo.com (the operationally-independent
// customer subdomain — mirrors v4.42 winds-aloft sibling fallback).
async function _fetchOMSequence(omPath,isUS,reqId){
  const hosts=['api','customer-api'];
  for(let i=0;i<hosts.length;i++){
    if(reqId!=null&&reqId!==S._locReqId)return null;
    const host=hosts[i]+'.open-meteo.com';
    try{
      const r=await _fetchOMModels(host,omPath,isUS);
      if(r.blended){r.host=hosts[i];console.log('OM models: '+host+(i>0?' (sibling fallback)':'')+' ✓ '+(r.gfs?'GFS✓':'GFS✗')+' '+(r.hrrr?'HRRR✓':'HRRR✗')+(isUS?'':' (non-US, HRRR skipped)'));return r}
      console.log('OM models: '+host+' returned no blend');
    }catch(e){console.log('OM models: '+host+' failed: '+e.message)}
    if(i===0){
      if(reqId!=null&&reqId!==S._locReqId)return null;
      await new Promise(r=>setTimeout(r,2500));
      if(reqId!=null&&reqId!==S._locReqId)return null;
      try{
        const r=await _fetchOMModels(host,omPath,isUS);
        if(r.blended){r.host=hosts[i];console.log('OM models: '+host+' retry ✓');return r}
      }catch(e){console.log('OM models: '+host+' retry failed: '+e.message+' — falling through to customer-api')}
    }
  }
  return null;
}
// v4.45: Skeleton omData used when both Open-Meteo hosts fail but NWS/AWC
// did return data — keeps the renderer's shape contract so existing
// code paths don't NPE on missing hourly/daily arrays.
function _buildPartialOmData(){
  const nowMin=new Date().toISOString().slice(0,16);
  return{
    current:{
      time:nowMin,temperature_2m:null,apparent_temperature:null,
      relative_humidity_2m:null,precipitation:0,weather_code:3,
      cloud_cover:null,pressure_msl:null,
      wind_speed_10m:0,wind_direction_10m:0,wind_gusts_10m:0,is_day:1
    },
    hourly:{time:[],temperature_2m:[],apparent_temperature:[],relative_humidity_2m:[],
      dew_point_2m:[],precipitation:[],weather_code:[],wind_speed_10m:[],
      wind_gusts_10m:[],wind_direction_10m:[],pressure_msl:[],cloud_cover:[],
      visibility:[],is_day:[],cape:[],lifted_index:[],convective_inhibition:[],
      uv_index:[],freezing_level_height:[]},
    daily:{time:[],weather_code:[],temperature_2m_max:[],temperature_2m_min:[],
      precipitation_sum:[],precipitation_probability_max:[],sunrise:[],sunset:[],
      wind_speed_10m_max:[]},
    timezone:'auto',
    _omPartial:true
  };
}
async function fetchWeather(){
  const reqId=S._locReqId;
  const el=document.getElementById('page-weather');
  if(_isOffline&&S._lastWeatherData){renderWeather(S._lastWeatherData);return}
  const _silentRefresh=S._lastWeatherData&&S._lastWeatherData._omPartial;
  if(!_silentRefresh)showSkel(el,6);
  if(typeof _bootStep==='function')_bootStep('wx','Fetching weather…');
  const _omPath=`?latitude=${S.lat}&longitude=${S.lon}`
    +`&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day`
    +`&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,cloud_cover,visibility,is_day,cape,lifted_index,convective_inhibition,uv_index,freezing_level_height`
    +`&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max`
    +`&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm&timezone=auto&forecast_days=7&past_days=2`;
  const _isUSLoc=isUSLocation(S.lat,S.lon);
  try{
    // v4.45: Fan out Open-Meteo + NWS + AWC in parallel — an Open-Meteo
    // outage no longer gates the rest of the tab. NWS/AWC are independent
    // services and will keep the hero populated even when OM is 502'ing.
    const _otherP=[fetchAWCNearest()];
    if(_isUSLoc)_otherP.push(fetchNWSCurrent(),fetchNWSForecast(),fetchNwsHourlyQpf());
    else console.log('[non-US] Skipped: NWS current obs, NWS forecast, NWS QPF');
    const all=await Promise.allSettled([_fetchOMSequence(_omPath,_isUSLoc,reqId),..._otherP]);
    if(reqId!==S._locReqId)return;
    const omRes=all[0].status==='fulfilled'?all[0].value:null;
    const awcCur=all[1].status==='fulfilled'?all[1].value:null;
    const nwsCur=_isUSLoc&&all[2]&&all[2].status==='fulfilled'?all[2].value:null;
    const nwsFc=_isUSLoc&&all[3]&&all[3].status==='fulfilled'?all[3].value:null;
    const nwsQpf=_isUSLoc&&all[4]&&all[4].status==='fulfilled'?all[4].value:null;
    let omData,isPartial=false;
    if(omRes&&omRes.blended){
      omData=omRes.blended;
      omData._omHost=omRes.host;
    } else if(awcCur||nwsCur||nwsFc){
      omData=_buildPartialOmData();
      isPartial=true;
      console.log('OM models: both hosts failed — partial render via '+
        [nwsCur&&'NWS-current',nwsFc&&'NWS-forecast',awcCur&&'AWC-METAR'].filter(Boolean).join('+'));
    } else {
      throw new Error('All sources failed (Open-Meteo + NWS + AWC)');
    }
    if(reqId!==S._locReqId)return;
    S.forecast=omData;
    try{
      const sources=[];
      if(!isPartial){
        const _omHostLabel=omData._omHost==='customer-api'?'Open-Meteo (customer-api)':'Open-Meteo';
        sources.push({src:_omHostLabel,temp:omData.current.temperature_2m,dewp:null,
          windKmh:omData.current.wind_speed_10m,windDir:omData.current.wind_direction_10m,
          gustKmh:omData.current.wind_gusts_10m,presMb:omData.current.pressure_msl,
          feelsC:omData.current.apparent_temperature,humidity:omData.current.relative_humidity_2m,
          visMeter:null,wxString:''});
      }
      if(nwsCur){
        sources.push({src:'NWS·'+nwsCur.station,temp:nwsCur.temp,dewp:nwsCur.dewp,
          windKmh:nwsCur.windKmh,windDir:nwsCur.windDir,gustKmh:nwsCur.gustKmh,
          presMb:nwsCur.presPa!=null?nwsCur.presPa/100:null,feelsC:nwsCur.feelsC,
          humidity:null,visMeter:nwsCur.visMeter,wxString:nwsCur.wxString,station:nwsCur.station});
      }
      if(awcCur){
        sources.push({src:'AWC·'+awcCur.icao,temp:awcCur.temp,dewp:awcCur.dewp,
          windKmh:awcCur.windKmh,windDir:awcCur.windDir,gustKmh:awcCur.gustKmh,
          presMb:awcCur.presPa!=null?awcCur.presPa/100:null,feelsC:null,
          humidity:null,visMeter:awcCur.visMeter,wxString:awcCur.wxString||'',station:awcCur.icao});
      }
      if(sources.length){
        const blend=blendSources(sources);
        if(blend.temp!=null)omData.current.temperature_2m=blend.temp;
        if(blend.windKmh!=null)omData.current.wind_speed_10m=blend.windKmh;
        if(blend.windDir!=null)omData.current.wind_direction_10m=blend.windDir;
        if(blend.gustKmh!=null)omData.current.wind_gusts_10m=blend.gustKmh;
        if(blend.presMb!=null)omData.current.pressure_msl=blend.presMb;
        if(blend.feelsC!=null)omData.current.apparent_temperature=blend.feelsC;
        if(blend.humidity!=null)omData.current.relative_humidity_2m=blend.humidity;
        if(blend.visMeter!=null)S._nwsVisM=blend.visMeter;
        if(blend.dewp!=null){
          omData.current._directDewC=blend.dewp;
          const _tFor=omData.current.temperature_2m!=null?omData.current.temperature_2m:blend.dewp;
          const rh=Math.round(100*Math.exp((17.27*blend.dewp)/(237.7+blend.dewp))/Math.exp((17.27*_tFor)/(237.7+_tFor)));
          omData.current.relative_humidity_2m=Math.min(100,Math.max(0,rh));
        }
        const _hasPrecipWx=blend.wxString&&/rain|snow|drizzle|thunder|storm|fog|mist|haze|sleet|hail|freezing|shower/i.test(blend.wxString);
        if(_hasPrecipWx) omData.current._nwsDesc=blend.wxString;
        omData.current._nwsStation=blend.station||null;
        if(blend.cloudPct!=null){
          const _omCC=omData.current.cloud_cover;
          omData.current.cloud_cover=blend.cloudPct;
          omData.current._cloudSrc='METAR';
          console.log('Cloud cover from METAR: '+_omCC+'% → '+blend.cloudPct+'% ('+blend.station+')');
        }
        const _modelTag=omData._modelBlend?` [${omData._modelBlend}]`:'';
        omData.current._source=blend.sourceLabel+_modelTag+(isPartial?' · ⏳ Open-Meteo':'');
        omData.current._sourceCount=sources.length;
        console.log('Weather blend: '+sources.map(s=>s.src).join(' + ')+' → '+blend.sourceLabel+_modelTag+(isPartial?' (PARTIAL — Open-Meteo down)':''));
      } else if(!isPartial){
        const _omHostLabel=omData._omHost==='customer-api'?'Open-Meteo (customer-api)':'Open-Meteo';
        omData.current._source=_omHostLabel+(omData._modelBlend?` [${omData._modelBlend}]`:'');
        omData.current._sourceCount=1;
      }
      if(nwsFc&&nwsFc.length){
        omData._nwsForecast=nwsFc;
        console.log('Weather: NWS forecast loaded ('+nwsFc.length+' periods)');
      }
      // v4.54: Merge NWS gridpoint QPF into hourly.precipitation (per-hour
      // MAX). Catches the case where GFS+HRRR underforecast vs. NWS's own
      // official QPF — the Rain Forecast Bars graph stays honest even when
      // one model agrees with itself but disagrees with the official forecast.
      if(nwsQpf&&nwsQpf.size&&omData.hourly&&omData.hourly.time&&omData.hourly.time.length){
        try{
          const bumped=_mergeNwsQpfIntoOM(omData,nwsQpf);
          console.log('NWS QPF merged: '+nwsQpf.size+' NWS hours, '+bumped+' OM hours bumped upward');
        }catch(e){console.log('NWS QPF merge failed:',e.message)}
      }
    }catch(e){console.log('Multi-source blend failed:',e.message)}
    if(reqId!==S._locReqId)return;
    if(!isPartial&&omData.current._cloudSrc!=='METAR'&&omData.hourly&&omData.hourly.cloud_cover&&omData.hourly.time&&omData.hourly.time.length){
      const _cTime=omData.current.time;
      if(!_cTime) console.log('Cloud sync skipped: no current.time');
      const _nowISO=(_cTime||'').slice(0,13);
      const _hrIdx=omData.hourly.time.findIndex(t=>t&&t.startsWith(_nowISO));
      if(_hrIdx>=0){
        const _hrCC=omData.hourly.cloud_cover[_hrIdx];
        const _prevCC=omData.current.cloud_cover;
        if(_hrCC!==_prevCC){
          console.log('Cloud cover synced to hourly NOW: '+_prevCC+'% → '+_hrCC+'%');
          omData.current.cloud_cover=_hrCC;
        }
      }
    }
    const _finalCC=omData.current.cloud_cover;
    if(!omData.current._nwsDesc&&_finalCC!=null){
      omData.current._nwsDesc=cloudCategory(_finalCC);
    }
    S.weather=omData.current;S._lastWeatherFetch=Date.now();S._lastWeatherData=omData;_resetMinMax();renderWeather(omData);if(typeof updateThreatTicker==='function')updateThreatTicker();if(_curLang!=='en')setTimeout(quickTranslate,300);setTimeout(checkWeatherThresholds,500);if(typeof V3D!=='undefined'&&V3D.active&&typeof refreshSky3D==='function')refreshSky3D();
    if(typeof _bootStepDone==='function')_bootStepDone('wx',isPartial?'Weather partial (waiting on Open-Meteo)':'Weather data received');
    if(isPartial)_scheduleOMRetry(reqId,_omPath,_isUSLoc,0);
  }catch(e){
    if(reqId!==S._locReqId)return;
    if(typeof hideLoadingScreen==='function')hideLoadingScreen();
    if(typeof _bootStepFail==='function')_bootStepFail('wx','Weather fetch failed');
    if(S._lastWeatherData){
      renderWeather(S._lastWeatherData);
    } else {
      el.innerHTML=`<div class="empty-state"><div class="empty-icon">⚠️</div><p>Could not load weather data.</p><button onclick="fetchWeather()" style="margin-top:8px;padding:6px 18px;border-radius:8px;background:var(--accent-blue,#3b82f6);color:#fff;border:none;cursor:pointer;font-size:0.85em">Retry</button></div>`;
    }
  }
}
// v4.45: Background retry after a partial render. When Open-Meteo finally
// returns, hourly/daily/UV/freeze-level cells back-fill in place without
// the user tapping Retry. Capped at 3 attempts so a sustained outage
// doesn't keep retrying forever — autorefresh / page switch picks it up.
// v4.58: tighter, more attempts. Old delays (15/30/60s, 3 tries) gave up
// after ~1m45s — on slow connections the user would see "Waiting on
// Open-Meteo" and have to manually close/reopen the app. New chain stays
// snappy early (5s) and stretches to ~3 minutes total before yielding to
// the hourly autorefresh.
const _OM_RETRY_DELAYS=[5000,10000,20000,45000,90000];
function _scheduleOMRetry(reqId,omPath,isUS,attempt){
  if(attempt>=_OM_RETRY_DELAYS.length){console.log('OM background retry: giving up after '+_OM_RETRY_DELAYS.length+' attempts — autorefresh will retry');return}
  if(S._omRetryTimer){clearTimeout(S._omRetryTimer);S._omRetryTimer=null}
  S._omRetryTimer=setTimeout(async()=>{
    S._omRetryTimer=null;
    if(reqId!==S._locReqId)return;
    if(!S._lastWeatherData||!S._lastWeatherData._omPartial)return;
    console.log('OM background retry '+(attempt+1)+'/'+_OM_RETRY_DELAYS.length+'…');
    const r=await _fetchOMSequence(omPath,isUS,reqId);
    if(reqId!==S._locReqId)return;
    if(r&&r.blended){
      const cached=S._lastWeatherData;
      if(!cached){return}
      const om=r.blended;
      cached.hourly=om.hourly;
      cached.daily=om.daily;
      cached.timezone=om.timezone;
      cached._modelBlend=om._modelBlend;
      cached._omHost=r.host;
      cached._omPartial=false;
      const cc=cached.current,oc=om.current;
      if(cc.temperature_2m==null)cc.temperature_2m=oc.temperature_2m;
      if(cc.apparent_temperature==null)cc.apparent_temperature=oc.apparent_temperature;
      if(cc.relative_humidity_2m==null)cc.relative_humidity_2m=oc.relative_humidity_2m;
      if(cc.pressure_msl==null)cc.pressure_msl=oc.pressure_msl;
      if(cc.cloud_cover==null)cc.cloud_cover=oc.cloud_cover;
      if(!cc.wind_speed_10m)cc.wind_speed_10m=oc.wind_speed_10m;
      if(!cc.wind_gusts_10m)cc.wind_gusts_10m=oc.wind_gusts_10m;
      if(cc.weather_code===3&&oc.weather_code!=null)cc.weather_code=oc.weather_code;
      if(!cc.precipitation)cc.precipitation=oc.precipitation||0;
      cc.is_day=oc.is_day;
      const _modelTag=cached._modelBlend?` [${cached._modelBlend}]`:'';
      const _omHostLabel=r.host==='customer-api'?'Open-Meteo (customer-api)':'Open-Meteo';
      cc._source=(cc._source||'').replace(/ · ⏳ Open-Meteo$/,'')||(_omHostLabel+_modelTag);
      console.log('OM background retry succeeded via '+r.host+' — re-rendering');
      try{renderWeather(cached)}catch(e){console.log('partial-retry render failed:',e.message)}
      if(typeof refreshRainClock==='function')refreshRainClock(true);
      if(typeof _bootStepDone==='function')_bootStepDone('wx','Weather data filled in');
    } else {
      console.log('OM background retry '+(attempt+1)+' failed');
      _scheduleOMRetry(reqId,omPath,isUS,attempt+1);
    }
  },_OM_RETRY_DELAYS[attempt]);
}
async function _fetchAWCOnce(){
  const _isUS=isNWSCoverage(S.lat,S.lon);
  const _bboxLevels=_isUS?[1.0,2.0,3.5]:[1.5,3.0];
  const _timeout=_isUS?8000:4000;
  let data=[];
  for(const deg of _bboxLevels){
    const url=`https://aviationweather.gov/api/data/metar?ids=&format=json&taf=false&hours=3&bbox=${(S.lat-deg).toFixed(2)},${(S.lon-deg).toFixed(2)},${(S.lat+deg).toFixed(2)},${(S.lon+deg).toFixed(2)}`;
    console.log('AWC fetch (±'+deg+'°):',url);
    const r=await fetch(url,{signal:AbortSignal.timeout(_timeout)});
    if(!r.ok){console.log('AWC fetch failed:',r.status);continue}
    data=await r.json();
    console.log('AWC returned',data.length,'stations');
    if(data.length)break;
  }
  if(!data.length)return null;
  const nearest=data.reduce((best,m)=>{
    const d=haversine(S.lat,S.lon,m.lat,m.lon);
    return(!best||d<best._dist)?{...m,_dist:d}:best;
  },null);
  if(!nearest)return null;
  console.log('AWC nearest:',nearest.icaoId,'dist:',nearest._dist?.toFixed(1)+'mi');
  const _cloudPct=_metarCloudPct(nearest);
  if(_cloudPct!=null)console.log('AWC cloud cover:',_cloudPct+'% from',_metarCloudSummary(nearest));
  return{
    icao:nearest.icaoId,temp:nearest.temp,dewp:nearest.dewp,
    windKmh:nearest.wspd!=null?nearest.wspd*1.852:null,
    windDir:nearest.wdir!=null&&nearest.wdir!=='VRB'?Number(nearest.wdir):null,
    gustKmh:nearest.wgst!=null?nearest.wgst*1.852:null,
    presPa:nearest.altim!=null?nearest.altim*100:null,
    visMeter:nearest.visib!=null?(String(nearest.visib).includes('+')?16093:Number(nearest.visib)>100?Number(nearest.visib):Number(nearest.visib)*1609.34):null,
    wxString:nearest.wxString||'',cloudPct:_cloudPct,dist:nearest._dist
  };
}
function _metarCloudPct(m){
  const layers=m.clouds||(m.cldCvg1?[{cover:m.cldCvg1},{cover:m.cldCvg2},{cover:m.cldCvg3}]:null);
  if(!layers||!layers.length)return null;
  const map={SKC:0,CLR:0,NCD:0,NSC:0,CAVOK:0,FEW:18,SCT:44,BKN:75,OVC:100,VV:100};
  let max=null;
  for(const l of layers){
    const code=(l&&(l.cover||l.coverage||l))||'';
    const v=map[String(code).toUpperCase()];
    if(v!=null&&(max==null||v>max))max=v;
  }
  return max;
}
function _metarCloudSummary(m){
  const layers=m.clouds||[];
  return layers.map(l=>(l.cover||'')+(l.base!=null?l.base:'')).join(' ')||'(no layers)';
}
function _heroBandFromZone(zone){
  if(!zone||!zone.length)return null;
  const z=zone[0];
  const dbz=z.maxDbz!=null?z.maxDbz:(z.cls==='trace'?0:z.min);
  // v5.79: the "raining now over you" floor must match the app-wide rain floor
  // (STORM_MIN_DBZ, 25 dBZ — the same threshold the Rain Clock, forecast ring and
  // 36 h graph use since v5.54). Previously this fired at >=5 dBZ, so a wisp of
  // 5-24 dBZ echo drifting within 1.5 mi lit the hero "Light rain · LIVE RADAR"
  // while the Rain Clock (25 dBZ floor) correctly said "not raining, nearest rain
  // 3 mi away." Now both agree: sub-25 echo is not "rain over you."
  const _floor=(typeof getRainFloorDbz==='function')?getRainFloorDbz():25;   // v6.56: USER rain floor — was fixed 25, so lowering the setting revived the dial but never this hero line
  if(dbz<_floor)return null;
  return Object.assign({},dbzColor(dbz),{maxDbz:dbz});
}
// v4.74: ONE shared "is it raining over the user right now?" signal. The hero
// conditions LIVE RADAR override (renderWeather / refreshHeroFromZone) AND the
// Rain Clock now-window both read THIS, so they can never disagree again
// ("pouring now but the clock says rain starts in an hour"). It reuses the exact
// dBZ-at-user zone the conditions card already uses — checkUserInZone() (the hex
// bin sitting on the user's spot) classified by _heroBandFromZone() — returning
// the band {cls,label,color,maxDbz} or null when radar shows nothing overhead.
function rainOverUserNow(){
  const zone=(typeof checkUserInZone==='function')?checkUserInZone():null;
  return _heroBandFromZone(zone);
}
function refreshHeroFromZone(){
  if(!S._lastWeatherData)return;
  const _ov=rainOverUserNow();
  if(_ov&&S._lastZoneOv===_ov.cls)return;
  if(!_ov&&S._lastZoneOv==null)return;
  S._lastZoneOv=_ov?_ov.cls:null;
  try{renderWeather(S._lastWeatherData)}catch(e){console.log('hero refresh failed:',e.message)}
}
async function fetchAWCNearest(){
  try{
    const r=await _fetchAWCOnce();
    if(r)return r;
    if(!isNWSCoverage(S.lat,S.lon)){console.log('AWC: no nearby station (non-US, skipping retry)');return null}
    console.log('AWC retry in 2s...');
    await new Promise(ok=>setTimeout(ok,2000));
    return await _fetchAWCOnce();
  }catch(e){
    if(!isNWSCoverage(S.lat,S.lon)){console.log('AWC nearest failed (non-US, skipping retry):',e.message);return null}
    console.log('AWC nearest error:',e.message,', retrying...');
    try{await new Promise(ok=>setTimeout(ok,2000));return await _fetchAWCOnce()}
    catch(e2){console.log('AWC retry failed:',e2.message);return null}
  }
}
function blendSources(sources){
  function avg(field){
    const vals=sources.map(s=>s[field]).filter(v=>v!=null&&!isNaN(v));
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }
  function first(field){
    for(const s of sources){if(s[field]!=null)return s[field]}
    return null;
  }
  function avgDir(field){
    const dirs=sources.map(s=>s[field]).filter(v=>v!=null&&!isNaN(v));
    if(!dirs.length)return null;
    if(dirs.length===1)return dirs[0];
    let sx=0,sy=0;
    dirs.forEach(d=>{const r=d*Math.PI/180;sx+=Math.sin(r);sy+=Math.cos(r)});
    let a=Math.atan2(sx/dirs.length,sy/dirs.length)*180/Math.PI;
    return((a%360)+360)%360;
  }
  const station=sources.find(s=>s.station)?.station||null;
  const srcNames=sources.filter(s=>!s.src.startsWith('Open-Meteo')).map(s=>s.src);
  const omSrc=sources.find(s=>s.src.startsWith('Open-Meteo'));
  const sourceLabel=srcNames.length?srcNames.join('+'):(omSrc?omSrc.src:'Open-Meteo');
  return{
    temp:avg('temp'),
    dewp:first('dewp'),
    windKmh:avg('windKmh'),
    windDir:avgDir('windDir'),
    gustKmh:Math.max(avg('gustKmh')||0,avg('windKmh')||0)||null,
    presMb:avg('presMb'),
    feelsC:first('feelsC'),
    humidity:first('humidity'),
    visMeter:first('visMeter'),
    cloudPct:first('cloudPct'),
    wxString:sources.find(s=>s.wxString)?.wxString||'',
    station,sourceLabel
  };
}
async function fetchNWSCurrent(){
  try{
    const pt={properties:await getNwsPointProps(6000).catch(()=>null)};   // v6.57 (QW1): memoized /points
    if(!pt.properties)return null;
    const stUrl=pt.properties?.observationStations;
    if(!stUrl)return null;
    const stRes=await fetch(stUrl,{...NWS_HDR,signal:AbortSignal.timeout(6000)});
    if(!stRes.ok)return null;
    const stData=await stRes.json();
    const nearest=stData.features?.[0];
    if(!nearest)return null;
    const icao=nearest.properties?.stationIdentifier;
    const obsRes=await fetch(`https://api.weather.gov/stations/${icao}/observations/latest`,{...NWS_HDR,signal:AbortSignal.timeout(6000)});
    if(!obsRes.ok)return null;
    const obs=await obsRes.json();
    const p=obs.properties||{};
    if(p.temperature?.value==null)return null;
    return{
      temp:p.temperature.value,dewp:p.dewpoint?.value,
      windKmh:p.windSpeed?.value,windDir:p.windDirection?.value,
      gustKmh:p.windGust?.value,presPa:p.barometricPressure?.value,
      visMeter:p.visibility?.value,wxString:_validateWxString(p.textDescription||'',p.rawMessage||''),
      feelsC:p.windChill?.value??p.heatIndex?.value??null,
      station:icao
    };
  }catch(e){return null}
}
async function _nwsForecastOnce(ptTimeout,fcTimeout){
  const pt={properties:await getNwsPointProps(ptTimeout).catch(()=>null)};   // v6.57 (QW1): memoized /points
  if(!pt.properties)return null;
  const fcUrl=pt.properties?.forecast;
  if(!fcUrl)return null;
  const fcRes=await fetch(fcUrl,{...NWS_HDR,signal:AbortSignal.timeout(fcTimeout)});
  if(!fcRes.ok)return null;
  const fc=await fcRes.json();
  return(fc.properties?.periods||[]).slice(0,14).map(p=>{
    const apiPop=p.probabilityOfPrecipitation?.value;
    const m=(p.detailedForecast||'').match(/[Cc]hance of precipitation is\s+(\d+)\s*%/);
    const textPop=m?Number(m[1]):null;
    return{
      name:p.name,temp:p.temperature,unit:p.temperatureUnit,
      wind:p.windSpeed,windDir:p.windDirection,
      short:p.shortForecast,detail:p.detailedForecast,
      precip:textPop!=null?textPop:(apiPop||0),
      isDaytime:p.isDaytime,icon:p.icon
    };
  });
}
async function fetchNWSForecast(){
  try{
    const r=await _nwsForecastOnce(7000,8000);
    if(r&&r.length)return r;
  }catch(e){console.log('NWS forecast: first attempt failed, retrying...',e.message)}
  try{
    await new Promise(r=>setTimeout(r,1500));
    const r=await _nwsForecastOnce(9000,10000);
    if(r&&r.length)return r;
  }catch(e){console.log('NWS forecast: retry failed',e.message)}
  return null;
}

// v4.54: NWS gridpoint QPF backup — when GFS+HRRR underforecast (or just
// disagree with NWS's official quantitative precip), pull NWS's own hourly
// precipitation forecast from /gridpoints/{wfo}/{x},{y} and merge per-hour
// max into the Open-Meteo precipitation array. US-only (NWS coverage).
// Returns a Map<hourMs, mm> aligned to clock hours.
function _parseNwsValidTime(vt){
  // "2026-05-26T18:00:00+00:00/PT3H" → {startMs, hours}
  const [iso,dur]=String(vt||'').split('/');
  if(!iso||!dur)return null;
  const startMs=new Date(iso).getTime();
  if(!isFinite(startMs))return null;
  // ISO 8601 period: P[nD]T[nH] — we care about days and hours
  const m=dur.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/);
  if(!m)return null;
  const days=+(m[1]||0),hrs=+(m[2]||0),mins=+(m[3]||0);
  const hours=days*24+hrs+mins/60;
  if(hours<=0)return null;
  return{startMs,hours};
}
async function _nwsQpfOnce(ptTimeout,fcTimeout){
  const pt={properties:await getNwsPointProps(ptTimeout).catch(()=>null)};   // v6.57 (QW1): memoized /points
  if(!pt.properties)return null;
  const gridUrl=pt.properties?.forecastGridData;
  if(!gridUrl)return null;
  const gRes=await fetch(gridUrl,{...NWS_HDR,signal:AbortSignal.timeout(fcTimeout)});
  if(!gRes.ok)return null;
  const g=await gRes.json();
  const qpf=g.properties?.quantitativePrecipitation;
  if(!qpf||!Array.isArray(qpf.values)||!qpf.values.length)return null;
  // NWS QPF unit is typically wmoUnit:mm. If it's in/inches, convert.
  const unit=(qpf.uom||'').toLowerCase();
  const toMm=unit.includes('inch')||unit.includes('[in_i]')?25.4:1;
  // Each entry covers a multi-hour period (1/3/6h). Spread evenly across
  // clock hours so the value lines up with Open-Meteo's hourly grid.
  const out=new Map();
  for(const v of qpf.values){
    const p=_parseNwsValidTime(v.validTime);
    if(!p||v.value==null||v.value<0)continue;
    const totalMm=v.value*toMm;
    const nHrs=Math.max(1,Math.round(p.hours));
    const perHr=totalMm/nHrs;
    for(let i=0;i<nHrs;i++){
      const hourMs=Math.floor((p.startMs+i*3600000)/3600000)*3600000;
      // If two periods cover the same hour, take the larger spread value
      const cur=out.get(hourMs)||0;
      if(perHr>cur)out.set(hourMs,perHr);
    }
  }
  return out;
}
async function fetchNwsHourlyQpf(){
  try{
    const r=await _nwsQpfOnce(7000,8000);
    if(r&&r.size)return r;
  }catch(e){console.log('NWS QPF: first attempt failed, retrying...',e.message)}
  try{
    await new Promise(r=>setTimeout(r,1500));
    const r=await _nwsQpfOnce(9000,10000);
    if(r&&r.size)return r;
  }catch(e){console.log('NWS QPF: retry failed',e.message)}
  return null;
}
// Merge a NWS QPF map into Open-Meteo hourly.precipitation by clock hour.
// Strategy: per-hour MAX (safety-conservative — mirrors how GFS and HRRR are
// blended). If OM says 0 and NWS says 0.5 mm, the bar reflects 0.5 mm.
// Returns count of hours touched for log visibility.
function _mergeNwsQpfIntoOM(omData,qpfMap){
  if(!omData||!omData.hourly||!omData.hourly.time||!qpfMap||!qpfMap.size)return 0;
  const t=omData.hourly.time;
  let p=omData.hourly.precipitation;
  if(!Array.isArray(p)||p.length!==t.length){
    p=new Array(t.length).fill(0);
    omData.hourly.precipitation=p;
  }
  let touched=0,bumped=0;
  for(let i=0;i<t.length;i++){
    const hourMs=Math.floor(new Date(t[i]).getTime()/3600000)*3600000;
    const nws=qpfMap.get(hourMs);
    if(nws==null)continue;
    const cur=p[i]||0;
    if(nws>cur){p[i]=+nws.toFixed(3);bumped++}
    touched++;
  }
  omData._nwsQpfMerged={touched,bumped};
  return bumped;
}

function getBaroPrediction(current,hourly){
  const presMb=current.pressure_msl;
  const windDir=current.wind_direction_10m||0;
  let trend='steady',trendMb=0;
  if(hourly&&hourly.pressure_msl&&hourly.time){
    const now=Date.now();
    const pts=hourly.time.map((t,i)=>({t:new Date(t).getTime(),p:hourly.pressure_msl[i]})).filter(p=>p.t<=now&&p.t>=now-3*3600000);
    if(pts.length>=2){trendMb=pts[pts.length-1].p-pts[0].p;trend=trendMb>0.5?'rising':trendMb<-0.5?'falling':'steady'}
  }
  const isSE=windDir>=135&&windDir<180,isS=windDir>=180&&windDir<225,isSW=windDir>=225&&windDir<270;
  const isW=windDir>=270&&windDir<315,isN=windDir>=315||windDir<45,isNW=windDir>=315;
  const isNE=windDir>=45&&windDir<90,isE=windDir>=90&&windDir<135;
  let prediction='',icon='🌤️',confidence='Moderate';
  if(trend==='falling'){
    if(presMb<1005){prediction='Storm likely';icon='⛈️';confidence='High'}
    else if(presMb<1013){
      if(isSE||isS||isSW||isW){prediction='Rain within 12-24 hrs';icon='🌧️';confidence='High'}
      else if(isN||isNW){prediction='Unsettled, clearing possible';icon='🌥️';confidence='Moderate'}
      else{prediction='Cloudiness, rain possible';icon='🌦️';confidence='Moderate'}
    }else{
      if(isS||isSW||isSE){prediction='Rain within 24-36 hrs';icon='🌦️';confidence='Moderate'}
      else{prediction='Change approaching';icon='🌥️';confidence='Moderate'}
    }
  }else if(trend==='rising'){
    if(presMb>1022){prediction='Continued fair';icon='☀️';confidence='High'}
    else if(presMb>1013){
      if(isN||isNW||isW){prediction='Fair weather ahead';icon='🌤️';confidence='High'}
      else if(isSW||isS){prediction='Fair, warming';icon='🌤️';confidence='Moderate'}
      else{prediction='Clearing';icon='⛅';confidence='Moderate'}
    }else{
      if(isW||isNW){prediction='Clearing soon';icon='⛅';confidence='Moderate'}
      else{prediction='Slow improvement';icon='🌥️';confidence='Low'}
    }
  }else{
    if(presMb>1022){prediction='Fair and dry';icon='☀️';confidence='High'}
    else if(presMb>1013){
      if(isN||isNE||isE){prediction='Fair, no change';icon='🌤️';confidence='Moderate'}
      else{prediction='Mostly fair';icon='⛅';confidence='Moderate'}
    }else if(presMb>1005){
      if(isS||isSW||isSE){prediction='Rain possible';icon='🌦️';confidence='Low'}
      else{prediction='Mostly cloudy';icon='🌥️';confidence='Low'}
    }else{prediction='Unsettled, precip likely';icon='🌧️';confidence='Moderate'}
  }
  return{prediction,icon,confidence,trend,trendMb};
}

function renderWeather(data){
  if(typeof hideLoadingScreen==='function')hideLoadingScreen();
  if(typeof checkFirstLaunch==='function')setTimeout(checkFirstLaunch,1500);
  if(typeof initDesktopMode==='function'&&window.innerWidth>=1024)setTimeout(initDesktopMode,200);
  const el=document.getElementById('page-weather');
  const c=data.current,isDay=c.is_day===1;
  const tempC=c.temperature_2m,feelsC=c.apparent_temperature;
  const icon=wmoIcon(c.weather_code,isDay),desc=wmoDesc(c.weather_code,isDay);
  const wxNavBtn=document.querySelector('[data-page="weather"] .nav-icon');
  if(wxNavBtn)wxNavBtn.innerHTML=neonWx(c.weather_code,isDay,20);
  const _zoneOverride=rainOverUserNow();
  const _zoneDbzToWmo={sprinkles:51,drizzle:53,trace:3,light:61,light2:63,moderate:63,moderate2:65,heavy:65,intense:65,'mod-severe':65,severe:95,severe2:96,extreme:99};
  // v5.80/v5.81: reconcile the hero headline with the 1.5 mi radar-overhead truth.
  // The blended present-weather (_nwsDesc) is the NEAREST METAR station's report —
  // it can read "Thunderstorms and Rain" while the user's own spot is dry (station
  // is ~10 mi away). Only show a rain/storm headline when it is CONFIRMED over the
  // user: either radar shows >=25 dBZ overhead (_zoneOverride) OR the local rain
  // gauge (precipitation) is non-zero. Otherwise — including the initial load
  // BEFORE radar has come back — drop to the actual sky condition so we never
  // fabricate rain that then has to be corrected. (v5.81: dropped the old
  // "_radarLoaded" gate that let the first pre-radar render show the station's rain
  // and then fail to clear, since refreshHeroFromZone only re-renders on an
  // override-class change.) Storm cards + ticker still surface nearby/inbound rain.
  let _heroDesc,_heroWCode;
  if(_zoneOverride){
    _heroDesc=_zoneOverride.label;
    _heroWCode=_zoneDbzToWmo[_zoneOverride.cls]||63;
  }else{
    const _descPrecip=c._nwsDesc&&/rain|snow|drizzle|thunder|storm|shower|sleet|hail|freezing/i.test(c._nwsDesc);
    const _localPrecip=(c.precipitation!=null&&c.precipitation>=0.01);
    if(_descPrecip&&!_localPrecip&&c.cloud_cover!=null){
      // Station reports precip but nothing is confirmed on the user (radar clear or
      // still loading, gauge dry) — show the sky, not fabricated rain.
      _heroDesc=cloudCategory(c.cloud_cover);
      _heroWCode=c.cloud_cover>=70?3:c.cloud_cover>=30?2:c.cloud_cover>10?1:0;
    }else{
      _heroDesc=c._nwsDesc||desc;
      _heroWCode=c.weather_code;
    }
  }
  const dewC=Math.min(tempC,c._directDewC!=null?c._directDewC:calcDewC(tempC,Math.min(100,c.relative_humidity_2m)));
  const hourly=data.hourly||{},daily=data.daily||{};
  S._hourlyData=hourly;
  const baro=getBaroPrediction(c,hourly);
  S._baroTrendMb=baro.trendMb;S._baroTrend=baro.trend;
  const trendArrow=baro.trend==='rising'?'↑':baro.trend==='falling'?'↓':'→';
  const windNum=kmhTo(c.wind_speed_10m,S.windUnit);
  const windUnit=WIND_UNITS[S.windUnit];
  const hasGust=c.wind_gusts_10m!=null&&c.wind_gusts_10m>0;
  const gustNum=hasGust?kmhTo(c.wind_gusts_10m,S.windUnit):'--.-';
  const gustStr=hasGust?'G'+fmtWind(c.wind_gusts_10m):'Gust: --.- '+windUnit;

  const _simActive=_windCurSim.spd>0&&S._skipWindRestart;
  const wd=_simActive?_windCurSim.dir:Math.round((c.wind_direction_10m||0)*10)/10;
  const windSpd=_simActive?_windCurSim.spd:(c.wind_speed_10m||0);
  const windDisp=parseFloat(kmhTo(windSpd,S.windUnit));
  const gustRaw=_simActive?_windCurSim.gust:(c.wind_gusts_10m||windSpd);
  const gustDisp=parseFloat(kmhTo(gustRaw,S.windUnit));
  _trackMinMax(windSpd);
  const bf=beaufortFromKmh(windSpd);
  const gaugeData={windSpd,wd,windDisp,gustDisp,gustRaw,windNum,windUnit,gustStr,bf,simActive:_simActive,pressure:c.pressure_msl};
  const gaugeHtml=renderWindGauge(gaugeData);

  const _nowMs=Date.now();
  const _hIdx=hourly.time?hourly.time.findIndex(t=>new Date(t).getTime()>=_nowMs):-1;
  const _h1=_hIdx>=0&&_hIdx+1<(hourly.time||[]).length?_hIdx+1:-1;
  function _ta(nowV,nextV,thresh){
    if(nowV==null||nextV==null)return'';
    const d=nextV-nowV;
    if(Math.abs(d)<=thresh)return' <span style="color:var(--text-muted);font-size:0.6em">→</span>';
    if(d>0)return' <span style="color:#39ff14;font-size:0.6em;text-shadow:0 0 6px rgba(57,255,20,0.6)">⤴</span>';
    return' <span style="color:#ff3355;font-size:0.6em;text-shadow:0 0 6px rgba(255,51,85,0.6)">⤵</span>';
  }
  function _taC(nowV,nextV,thresh){
    if(nowV==null||nextV==null)return'';
    const d=nextV-nowV;
    if(Math.abs(d)<=thresh)return' <span style="color:var(--text-muted);font-size:0.6em">→</span>';
    if(d>0)return' <span style="color:#00FFFF;font-size:0.6em;text-shadow:0 0 6px rgba(0,255,255,0.5)">⤴</span>';
    return' <span style="color:#00FFFF;font-size:0.6em;text-shadow:0 0 6px rgba(0,255,255,0.5)">⤵</span>';
  }
  function _hv(key){return _hIdx>=0&&hourly[key]?hourly[key][_hIdx]:null}
  function _hv1(key){return _h1>=0&&hourly[key]?hourly[key][_h1]:null}

  const sections={
    wind:`<div class="weather-section" data-sec="wind"><div class="sec-header"><span class="card-title m-0"><span class="icon">💨</span> Wind</span>${secBtns('wind')}</div>
      <div class="wind-gauge-full">${gaugeHtml}</div>
      <div class="wind-stats-2x2">
        <div class="wind-stat-cell"><div class="wind-stat-label">Speed</div><div class="wind-stat-val">${windNum} ${windUnit}</div></div>
        <div class="wind-stat-cell"><div class="wind-stat-label">Direction</div><div class="wind-stat-val">${degToDir(wd)} ${wd.toFixed(0)}°</div></div>
        <div class="wind-stat-cell"><div class="wind-stat-label">Gusts</div><div class="wind-stat-val">${hasGust?kmhTo(c.wind_gusts_10m,S.windUnit)+' '+windUnit:'--'}</div></div>
        <div class="wind-stat-cell"><div class="wind-stat-label">Beaufort</div><div class="wind-stat-val" style="color:${_BFT_CLR[bf]}">F${bf} ${_BFT_NAME[bf]}</div></div>
      </div></div>`,
    trends:`<div class="weather-section" data-sec="trends"><div class="sec-header"><span class="card-title m-0"><span class="icon">📈</span> 48h Trends</span>${secBtns('trends')}</div>
      ${renderTrendCharts(hourly)}</div>`,
    hourly:`<div class="weather-section" data-sec="hourly"><div class="sec-header"><span class="card-title m-0"><span class="icon">🕐</span> 72h Hourly Forecast</span>${secBtns('hourly')}</div>
      ${renderHourlyForecast(hourly,daily)}</div>`,
    forecast:`<div class="weather-section" data-sec="forecast"><div class="sec-header"><span></span>${secBtns('forecast')}</div>${data._nwsForecast?renderNWSForecast(data._nwsForecast):renderDailyForecast(daily,data.timezone)}</div>`
  };
  const order=getSecOrder();

  const _omPartial=data._omPartial===true;
  const _omChip=_omPartial?'<span style="display:inline-block;font-size:0.55em;color:var(--accent-cyan);background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.3);border-radius:4px;padding:1px 5px;line-height:1.4;font-weight:600">⏳ Open-Meteo</span>':null;
  const _omBanner=_omPartial?`<div style="margin-bottom:8px;padding:8px 10px;background:rgba(0,229,255,0.08);border:1px solid rgba(0,229,255,0.25);border-radius:8px;font-size:0.7em;color:var(--text-secondary);text-align:center"><strong style="color:var(--accent-cyan)">⏳ Waiting on Open-Meteo</strong> — UV, freezing level, hourly bars and 7-day forecast will fill in once the service is back. Showing live NWS/AWC observations meanwhile.</div>`:'';
  const _humStr=c.relative_humidity_2m!=null?Math.min(100,c.relative_humidity_2m)+'%':(_omChip||'--');
  const _ccStr=c.cloud_cover!=null?c.cloud_cover+'%':(_omChip||'--');
  const _presStr=c.pressure_msl!=null?fmtPres(c.pressure_msl):(_omChip||'--');
  const _tempOk=tempC!=null&&!isNaN(tempC);
  const _dewOk=dewC!=null&&!isNaN(dewC);
  const _spreadOk=_tempOk&&_dewOk;
  // v4.46: emit rain-clock / rain-forecast-bars placeholders in user-saved
  // order so the user's up/down choice survives every renderWeather() pass
  // (autorefresh, OM retry, unit changes, etc.) — not just the explicit
  // moveSection click.
  const _topOrder=getSecOrder();
  const _rainPlaceholders=_topOrder.filter(k=>k==='rainclock'||k==='rainbars')
    .map(k=>k==='rainclock'?'<div id="rain-clock"></div>':'<div id="rain-forecast-bars"></div>').join('');
  el.innerHTML=`
    ${_rainPlaceholders}
    <div class="weather-hero">
      ${_omBanner}
      <div class="hero-icon-showcase">${animEmoji(_heroWCode,isDay,'340px',_heroDesc)}</div>
      <div class="hero-temp-line" style="font-size:2.8em;font-weight:800;line-height:1;background:linear-gradient(180deg,var(--text-primary) 0%,var(--text-secondary) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin:6px 0 2px">${_tempOk?fmtTempShort(tempC):'--'}<span style="-webkit-text-fill-color:initial;background:none">${_taC(_hv('temperature_2m'),_hv1('temperature_2m'),1)}</span></div>
      <div class="hero-desc-line" style="font-size:0.85em;color:${_zoneOverride?_zoneOverride.color:'var(--text-secondary)'};margin-bottom:2px">${_heroDesc}${_zoneOverride?'<span style="display:inline-block;margin-left:6px;font-size:0.65em;font-weight:700;padding:1px 6px;border-radius:4px;background:rgba(255,60,60,0.15);color:'+_zoneOverride.color+';border:1px solid '+_zoneOverride.color+'40;vertical-align:middle;letter-spacing:0.04em">LIVE RADAR</span>':''}</div>
      ${c._source?`<div class="hero-source-line" style="font-size:0.55em;color:var(--accent-cyan);opacity:0.7;margin-bottom:4px">${c._source}${c._sourceCount>1?' (×'+c._sourceCount+' avg)':''}</div>`:''}
      <div class="hero-stats-grid">
        <div class="hero-stat-cell"><div class="hero-side-label">Feels Like</div><div class="hero-side-val">${feelsC!=null?fmtTemp(feelsC):'--'}${_taC(_hv('apparent_temperature'),_hv1('apparent_temperature'),1)}</div></div>
        <div class="hero-stat-cell"><div class="hero-side-label">Humidity</div><div class="hero-side-val">${_humStr}${_taC(_hv('relative_humidity_2m'),_hv1('relative_humidity_2m'),3)}</div></div>
        <div class="hero-stat-cell"><div class="hero-side-label">☁️ Clouds</div><div class="hero-side-val">${_ccStr}${_taC(_hv('cloud_cover'),_hv1('cloud_cover'),10)}</div></div>
        <div class="hero-stat-cell"><div class="hero-side-label">Pressure</div><div class="hero-side-val">${_presStr}${_ta(_hv('pressure_msl'),_hv1('pressure_msl'),0.5)}</div></div>
        <div class="hero-stat-cell"><div class="hero-side-label">Precip</div><div class="hero-side-val">${fmtPrecip(c.precipitation||0)}${_taC(_hv('precipitation'),_hv1('precipitation'),0.1)}</div></div>
        <div class="hero-stat-cell"><div class="hero-side-label">🌡️ Dew Pt</div><div class="hero-side-val">${_dewOk?fmtTemp(dewC):'--'}${_taC(_hv('dew_point_2m'),_hv1('dew_point_2m'),1)}</div></div>
        ${(()=>{
  const _uv=_hv('uv_index');
  const _uvColor=_uv==null?'var(--text-muted)':_uv<=2?'#4caf50':_uv<=5?'#ffeb3b':_uv<=7?'#ff9800':_uv<=10?'#f44336':'#ce93d8';
  const _uvLabel=_uv==null?(_omPartial?'waiting…':'--'):_uv<=2?'Low':_uv<=5?'Moderate':_uv<=7?'High':_uv<=10?'Very High':'Extreme';
  const _uvVal=_uv!=null?_uv.toFixed(1):(_omChip||'--');
  const _flM=_hv('freezing_level_height');
  const _flFt=_flM!=null?Math.round(_flM*3.281):null;
  const _flVal=_flFt!=null?fmtAlt(_flFt):(_omChip||'--');
  return`<div class="hero-stat-cell"><div class="hero-side-label">☀️ UV Index</div><div class="hero-side-val" style="color:${_uvColor}">${_uvVal}${_taC(_uv,_hv1('uv_index'),0.5)}</div><div style="font-size:0.38em;color:${_uvColor};margin-top:1px">${_uvLabel}</div></div>`
    +`<div class="hero-stat-cell"><div class="hero-side-label">❄️ Freeze Level</div><div class="hero-side-val">${_flVal}${_taC(_hv('freezing_level_height'),_hv1('freezing_level_height'),100)}</div><div style="font-size:0.38em;color:var(--text-muted);margin-top:1px">${_flFt!=null?'MSL · ice/snow line':(_omPartial?'waiting on Open-Meteo':'')}</div></div>`;
})()}
        <div class="hero-stat-cell"><div class="hero-side-label">Spread</div><div class="hero-side-val">${_spreadOk?fmtTempDiff(tempC-dewC):'--'}</div><div style="font-size:0.42em;color:var(--text-muted);margin-top:1px;line-height:1.2">${_spreadOk?getSpreadLabel(tempC-dewC):''}</div>${(()=>{
  if(!_spreadOk)return'';
  const _spread=tempC-dewC;
  const _estB=adjustCloudBaseForUser(calcCloudBase(_spread));
  const _s0=_hIdx>=0&&hourly.temperature_2m&&hourly.dew_point_2m?hourly.temperature_2m[_hIdx]-hourly.dew_point_2m[_hIdx]:null;
  const _s1=_h1>=0&&hourly.temperature_2m&&hourly.dew_point_2m?hourly.temperature_2m[_h1]-hourly.dew_point_2m[_h1]:null;
  const _arrow=_ta(_s0,_s1,0.5);
  return`<div id="weather-spread-cb" data-spread="${_spread}" style="font-size:0.38em;color:var(--accent-cyan);margin-top:1px;line-height:1.1">Est. base ~${fmtAlt(_estB)} AGL ${_arrow}</div>`;
})()}</div>
        ${(()=>{if(!_spreadOk)return'';const spread=tempC-dewC;const windKt=c.wind_speed_10m!=null?(c.wind_speed_10m/1.852):null;const fog=getFogRisk(spread,windKt,isDay,c.cloud_cover);const stab=getStabilityLabel(spread,Math.min(100,c.relative_humidity_2m||0),tempC);const inv=detectInversion(spread,windKt,isDay,c.cloud_cover);return`<div class="hero-stat-cell"><div class="hero-side-label">🌫️ Fog Risk</div><div class="hero-side-val" style="font-size:0.85em;color:${fog.color}">${fog.level}</div><div style="font-size:0.38em;color:var(--text-muted);margin-top:1px;line-height:1.2">${fog.desc}</div></div><div class="hero-stat-cell"><div class="hero-side-label">🌡️ Stability</div><div class="hero-side-val" style="font-size:0.75em;color:${stab.color}">${stab.label}</div><div style="font-size:0.38em;color:var(--text-muted);margin-top:1px;line-height:1.2">${stab.desc}</div></div>${inv.detected?`<div class="hero-stat-cell" style="grid-column:1/-1"><div style="font-size:0.5em;color:var(--accent-orange);text-align:center;padding:2px 6px;background:rgba(255,152,0,0.1);border-radius:4px">⚠️ ${inv.text}</div></div>`:''}`})()}
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin:6px 0 0">
        <span style="position:relative;display:inline-flex;align-items:center">${(()=>{const bm={'☀️':0,'🌤️':1,'⛅':2,'🌥️':3,'☁️':3,'🌦️':51,'🌧️':61,'⛈️':95};const bc2=bm[baro.icon]!=null?bm[baro.icon]:3;return neonWx(bc2,true,36)})()}<span style="position:absolute;bottom:-2px;right:-4px;font-size:8px;background:rgba(0,180,255,0.25);color:var(--accent-cyan);border-radius:3px;padding:0 3px;line-height:1.4;font-weight:700;letter-spacing:0.03em;border:1px solid rgba(0,229,255,0.3)">FCST</span></span>
        <span style="font-size:0.75em;font-weight:600;color:var(--text-secondary)">${baro.prediction}</span>
        <span class="baro-trend ${baro.trend}" style="font-size:0.6em;color:${baro.trend==='rising'?'var(--accent-green)':baro.trend==='falling'?'var(--accent-red)':'var(--text-muted)'};text-shadow:0 0 6px ${baro.trend==='rising'?'rgba(0,255,136,0.4)':baro.trend==='falling'?'rgba(255,51,85,0.4)':'none'}">${trendArrow} ${(()=>{const isI=S.presUnit===0;if(isI){const v=Math.abs(baro.trendMb/33.8639);return(baro.trendMb>=0?'+':'-')+(v<0.05?v.toFixed(3):v.toFixed(2))+' inHg'}return(baro.trendMb>=0?'+':'')+baro.trendMb.toFixed(1)+' mb'})()}</span>
      </div>
    </div>
    ${_staleDataLabel()}
    <div class="card" style="margin-top:8px;padding:8px" id="mini-sonar-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span class="card-title m-0"><span class="icon">📡</span> Radar Sonar</span>
        <div style="display:flex;gap:4px;align-items:center">
          <button id="sonar-zoom-in" onclick="event.stopPropagation();sonarZoomIn()" style="background:none;border:1px solid var(--accent-cyan);color:var(--accent-cyan);font-size:0.7em;width:24px;height:24px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;font-weight:700;opacity:0.8" title="Zoom in">＋</button>
          <button id="sonar-zoom-out" onclick="event.stopPropagation();sonarZoomOut()" style="background:none;border:1px solid var(--accent-cyan);color:var(--accent-cyan);font-size:0.7em;width:24px;height:24px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;font-weight:700;opacity:0.8" title="Zoom out">ー</button>
          <button onclick="event.stopPropagation();_toggleSonarSettings()" style="background:none;border:1px solid var(--accent-cyan);color:var(--accent-cyan);font-size:0.7em;width:24px;height:24px;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;opacity:0.8" title="Dot size settings">⚙</button>
          <button onclick="event.stopPropagation();switchPage('radar')" style="background:none;border:1px solid var(--accent-cyan);color:var(--accent-cyan);font-size:0.6em;padding:3px 8px;border-radius:4px;cursor:pointer">Open Radar →</button>
        </div>
      </div>
      <div id="mini-sonar-wrap" style="width:100%;position:relative">
        <canvas id="mini-sonar-canvas" style="width:100%;display:block;border-radius:8px"></canvas>
      </div>
      <div id="mini-sonar-info" style="font-size:0.6em;color:var(--text-muted);text-align:center;margin-top:4px"></div>
    </div>
    ${order.map(k=>sections[k]||'').join('')}
    <div id="wx-tropical-section"></div>`;
  setTimeout(initPrecipTaps,0);
  setTimeout(()=>{startSonarSweep();_syncSonarZoomBtns()},50);
  if(!S._skipWindRestart) startWindSim();
  _updateTropicalUI();
  if(typeof renderRainClock==='function')renderRainClock();
  if(typeof renderRainForecastBars==='function')renderRainForecastBars();
}
function _updateTropicalUI(){
  const el=document.getElementById('wx-tropical-section');
  if(!el)return;
  el.innerHTML=_renderTropicalSection();
}
function _renderTropicalHazardSection(){
  const nhc=_getFilteredSystems();
  if(!nhc||!nhc.length)return '<div id="hz-tropical"></div>';
  const nearStorms=nhc.filter(s=>s.dist!=null&&s.dist<=S._nhcProxRadius);
  if(!nearStorms.length)return '<div id="hz-tropical"></div>';
  let html=`<div id="hz-tropical" style="border-top:1px solid var(--border-subtle);padding-top:10px;margin-top:8px"><div style="font-size:0.8em;font-weight:700;color:#9333EA;margin-bottom:6px">🌀 Tropical Cyclones Nearby</div>`;
  nearStorms.forEach(s=>{
    const cat=s.category||_saffirSimpson(s.maxWind);
    const distStr=s.dist!=null?Math.round(s.dist)+' mi':'?';
    html+=`<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:${cat.color}0a;border-left:3px solid ${cat.color};border-radius:0 6px 6px 0;margin-bottom:4px">
      <span class="text-1">🌀</span>
      <div class="flex-1"><div style="font-size:0.75em;font-weight:700;color:var(--text-primary)">${s.type} ${s.name}</div><div style="font-size:0.6em;color:${cat.color};font-weight:600">${cat.label} · ${distStr}</div></div>
      ${s.maxWind?`<div style="font-size:0.7em;font-weight:700;color:${cat.color}">${s.maxWind} mph</div>`:''}</div>`;
  });
  html+=`</div>`;
  return html;
}
function drawMiniSonar(){
  const canvas=document.getElementById('mini-sonar-canvas');
  if(!canvas||!S.lat)return;
  const wrap=document.getElementById('mini-sonar-wrap');
  if(!wrap)return;
  const dpr=window.devicePixelRatio||1;
  const size=wrap.clientWidth;
  if(size<10)return;
  canvas.width=size*dpr;canvas.height=size*dpr;
  canvas.style.width=size+'px';canvas.style.height=size+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  const cx=size/2,cy=size/2,maxR=size/2-20;
  ctx.fillStyle='#0a0e14';
  ctx.beginPath();ctx.arc(cx,cy,maxR+10,0,Math.PI*2);ctx.fill();
  const scanR=S.scanRadius||80;
  const viewR=_sonarZoomMi;
  let zoneCount=0,maxDbz=0;
  let allLightningDots=[];
  if(S._rawScanPts&&S._rawScanPts.length){
    const useRaw=viewR<=40;
    const dots=[];
    if(useRaw){
      const src=S._sonarClusteredPts&&S._sonarClusteredPts.length?S._sonarClusteredPts:S._rawScanPts;
      for(const p of src){
        const distMi=haversine(S.lat,S.lon,p.lat,p.lng);
        if(distMi>viewR)continue;
        const bear=(bearingDeg(S.lat,S.lon,p.lat,p.lng)+360)%360;
        const aMid=(bear-90)*Math.PI/180;
        const rMid=maxR*(distMi/viewR);
        if(rMid<=0)continue;
        dots.push({x:cx+Math.cos(aMid)*rMid,y:cy+Math.sin(aMid)*rMid,dbz:p.dbz,dist:rMid,angDeg:bear,count:p.count||1});
        if(p.dbz>maxDbz)maxDbz=p.dbz;
        zoneCount++;
      }
    }else{
      const cells=hexGridBin(S._rawScanPts,S.lat,S.lon,scanR);
      for(const[k,c]of cells){
        if(c.dist>viewR)continue;
        const aMid=(c.bearing-90)*Math.PI/180;
        const rMid=maxR*(c.dist/viewR);
        if(rMid<=0)continue;
        dots.push({x:cx+Math.cos(aMid)*rMid,y:cy+Math.sin(aMid)*rMid,dbz:c.maxDbz,dist:rMid,angDeg:c.bearing});
        if(c.maxDbz>maxDbz)maxDbz=c.maxDbz;
        zoneCount++;
      }
    }
    dots.sort((a,b)=>a.dbz-b.dbz);
    const sweepDeg=S._sonarSweepAngle||0;
    const totalSwept=S._sonarTotalSwept||0;
    const zoomScale=80/viewR;
    const minDot=Math.max(2.5,size*0.012)*Math.min(zoomScale,6),maxDot=Math.max(6,size*0.028)*Math.min(zoomScale,6);
    const rawDotR=useRaw?Math.max(2,size*0.007)*Math.min(zoomScale,3):0;
    const cfg=_sonarCfg;
    const sweepDps=cfg.sweepSpeed;
    const holdDegs=cfg.fadeDur*sweepDps;
    const fadeDegs=(cfg.fadeDur+1)*sweepDps;
    const totalDegs=holdDegs+fadeDegs;
    const opacMul=cfg.dotOpacity/100;
    const dbzFloor=cfg.dbzFloor;
    const isAlwaysOn=cfg.alwaysOn;
    const glowMul=cfg.glowInt;
    allLightningDots=[];
    for(const d of dots){
      if(d.dbz<dbzFloor)continue;
      if(d.dbz>=48&&cfg.showLightning&&!(typeof ltgLive==='function'&&ltgLive()))allLightningDots.push(d);
      const frac=Math.min(1,d.dist/maxR);
      const dbzCls=_dbzEntry(d.dbz).cls;
      const dbzSc=_getDbzScale(dbzCls);
      const cntSc=useRaw?Math.min(1.8,1+Math.log2(d.count||1)*0.15):1;
      const dotR=(useRaw?rawDotR*(0.8+0.4*frac):(minDot+(maxDot-minDot)*frac))*dbzSc*cntSc;
      const hex=dbzHex(d.dbz);
      let sweepAlpha=1;
      if(!isAlwaysOn){
        const dotAng=((d.angDeg-90)%360+360)%360;
        let angDiff=((sweepDeg-dotAng)%360+360)%360;
        const hasBeenSwept=totalSwept>=360||angDiff<totalSwept;
        if(!hasBeenSwept){
          ctx.beginPath();ctx.arc(d.x,d.y,dotR,0,Math.PI*2);
          ctx.fillStyle='rgba(20,25,35,0.5)';ctx.fill();
          continue;
        }
        if(angDiff<holdDegs){sweepAlpha=1}
        else if(angDiff<totalDegs){sweepAlpha=Math.max(0.06,1-(angDiff-holdDegs)/fadeDegs)}
        else{sweepAlpha=0.06}
      }
      const baseA=Math.min(0.95,0.4+d.dbz/60)*opacMul;
      const alpha=baseA*sweepAlpha;
      ctx.beginPath();ctx.arc(d.x,d.y,dotR,0,Math.PI*2);
      ctx.fillStyle=hexToRgba(hex,alpha);ctx.fill();
      if(d.dbz>=40&&sweepAlpha>0.15&&glowMul>0){
        ctx.save();ctx.shadowColor=hex;ctx.shadowBlur=dotR*3*glowMul;
        ctx.beginPath();ctx.arc(d.x,d.y,dotR*0.8,0,Math.PI*2);
        ctx.fillStyle=hexToRgba(hex,alpha*0.7);ctx.fill();
        ctx.restore();
        if(sweepAlpha>0.5&&glowMul>=1){
          ctx.beginPath();ctx.arc(d.x,d.y,dotR*(1+0.6*glowMul),0,Math.PI*2);
          ctx.strokeStyle=hexToRgba(hex,sweepAlpha*0.3);ctx.lineWidth=1;ctx.stroke();
        }
      }
    }
    const hookStorms=(S.storms||[]).filter(s=>s._rotation&&s.distance<=viewR);
    if(hookStorms.length){
      ctx.save();
      ctx.font=`${Math.max(14,size*0.05)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.shadowColor='rgba(255,23,68,0.9)';ctx.shadowBlur=10;
      for(const hs of hookStorms){
        const distMi=hs.distance;
        const bear=(bearingDeg(S.lat,S.lon,hs.lat,hs.lng)+360)%360;
        const aMid=(bear-90)*Math.PI/180;
        const rMid=maxR*(distMi/viewR);
        const hx=cx+Math.cos(aMid)*rMid,hy=cy+Math.sin(aMid)*rMid;
        ctx.fillStyle='rgba(255,23,68,0.9)';ctx.fillText('🌪️',hx,hy-Math.max(8,size*0.025));
        ctx.font=`bold ${Math.max(7,size*0.022)}px Inter,sans-serif`;
        ctx.shadowColor='rgba(0,0,0,0.95)';ctx.shadowBlur=6;
        ctx.fillStyle='rgba(255,23,68,0.8)';ctx.fillText('ROTATION',hx,hy+Math.max(10,size*0.03));
        ctx.font=`${Math.max(14,size*0.05)}px sans-serif`;
        ctx.shadowColor='rgba(255,23,68,0.9)';ctx.shadowBlur=10;
      }
      ctx.restore();
    }
  }
  const gB=(_sonarCfg.gridBright||100)/100;
  if(gB>0){
    const nRings=4;
    for(let i=1;i<=nRings;i++){
      const r=maxR*(i/nRings);
      ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);
      ctx.strokeStyle=`rgba(0,220,255,${0.18*gB})`;ctx.lineWidth=0.8;ctx.stroke();
      const dist=Math.round(viewR*(i/nRings));
      const label=S.radarMetric?Math.round(dist*1.60934)+'km':dist+'mi';
      ctx.save();ctx.shadowColor='rgba(0,0,0,0.95)';ctx.shadowBlur=6;
      ctx.fillStyle=`rgba(0,220,255,${0.5*gB})`;ctx.font=`${Math.max(8,size*0.028)}px Inter,sans-serif`;
      ctx.textAlign='center';ctx.fillText(label,cx,cy-r+10);ctx.restore();
    }
    ctx.beginPath();ctx.moveTo(cx,cy-maxR);ctx.lineTo(cx,cy+maxR);ctx.strokeStyle=`rgba(0,220,255,${0.1*gB})`;ctx.lineWidth=0.5;ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx-maxR,cy);ctx.lineTo(cx+maxR,cy);ctx.stroke();
    const dirs=[['N',0],['S',180],['E',90],['W',270]];
    ctx.save();ctx.shadowColor='rgba(0,0,0,0.95)';ctx.shadowBlur=6;
    ctx.fillStyle=`rgba(0,220,255,${0.6*gB})`;ctx.font=`bold ${Math.max(9,size*0.035)}px Inter,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    for(const[l,deg]of dirs){
      const a=(deg-90)*Math.PI/180;
      const lx=cx+Math.cos(a)*(maxR+12),ly=cy+Math.sin(a)*(maxR+12);
      ctx.fillText(l,lx,ly);
    }
    ctx.restore();
  }
  try{
    const topInbound=(S._topStorms||[]).filter(s=>s.distance<=viewR);
    const mv=(typeof getSteeringMv==='function')?getSteeringMv():(S.stormMovement&&S.stormMovement.speed>=2?S.stormMovement:null);
    const _hasObs=mv&&mv.source&&mv.source!=='aloft';
    if(_sonarCfg.showStormArrows&&mv){
      const mvRad=(mv.direction-90)*Math.PI/180;
      if(_hasObs&&topInbound.length>0){
        const shown=topInbound.slice(0,12);
        for(const st of shown){
          const dist=st.distance||0;
          const bearing=st.bearing||0;
          const stAng=(bearing-90)*Math.PI/180;
          const r=Math.min(maxR-8,maxR*(dist/viewR));
          const sx=cx+Math.cos(stAng)*r,sy=cy+Math.sin(stAng)*r;
          const _sh=(typeof getHybridMovement==='function')?getHybridMovement(st):null;
          const _sdir=(_sh&&_sh.speed>=2)?_sh.direction:mv.direction;
          const _smvRad=(_sdir-90)*Math.PI/180;
          const neonC=dbzHex(st.dbz);
          const arrLen=Math.max(10,Math.min(20,maxR*0.12));
          const tipX=sx+Math.cos(_smvRad)*arrLen,tipY=sy+Math.sin(_smvRad)*arrLen;
          const headL=6,ha1=_smvRad-Math.PI+0.5,ha2=_smvRad-Math.PI-0.5;
          ctx.save();ctx.shadowColor='rgba(0,0,0,0.9)';ctx.shadowBlur=6;ctx.shadowOffsetX=1;ctx.shadowOffsetY=1;
          ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(tipX,tipY);
          ctx.strokeStyle=neonC;ctx.lineWidth=2.5;ctx.stroke();
          ctx.beginPath();ctx.moveTo(tipX,tipY);ctx.lineTo(tipX+Math.cos(ha1)*headL,tipY+Math.sin(ha1)*headL);ctx.moveTo(tipX,tipY);ctx.lineTo(tipX+Math.cos(ha2)*headL,tipY+Math.sin(ha2)*headL);
          ctx.strokeStyle=neonC;ctx.lineWidth=2.5;ctx.stroke();
          ctx.beginPath();ctx.arc(sx,sy,3.5,0,Math.PI*2);ctx.fillStyle=neonC;ctx.fill();
          ctx.restore();
        }
      }
      const isAir=!_hasObs;
      const neonC=isAir?'#ffe14d':pathArrowNeonColor(maxDbz);
      const arrLen=maxR*0.6;
      const ax=cx+Math.cos(mvRad)*arrLen,ay=cy+Math.sin(mvRad)*arrLen;
      const la=mvRad-Math.PI+0.4,ra=mvRad-Math.PI-0.4;
      ctx.save();ctx.shadowColor='rgba(0,0,0,0.9)';ctx.shadowBlur=6;
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax+Math.cos(la)*12,ay+Math.sin(la)*12);ctx.moveTo(ax,ay);ctx.lineTo(ax+Math.cos(ra)*12,ay+Math.sin(ra)*12);
      ctx.strokeStyle=neonC;ctx.lineWidth=2.5;ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx+Math.cos(mvRad)*15,cy+Math.sin(mvRad)*15);ctx.lineTo(ax,ay);
      ctx.strokeStyle=hexToRgba(neonC,isAir?0.7:0.5);ctx.lineWidth=1.5;
      if(isAir)ctx.setLineDash([5,3]); else ctx.setLineDash([4,3]);
      ctx.stroke();ctx.setLineDash([]);
      const slx=ax+Math.cos(mvRad)*10,sly=ay+Math.sin(mvRad)*10;
      ctx.fillStyle=hexToRgba(neonC,0.9);ctx.font=`bold ${Math.max(9,size*0.028)}px Inter,sans-serif`;
      ctx.shadowColor='rgba(0,0,0,0.95)';ctx.shadowBlur=6;
      const _srcLbl=isAir?'AIR':(mv.source==='hybrid'?'HYBRID':'STORM');
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(_srcLbl,slx,sly);
      ctx.restore();
      const spdUnit=S.radarMetric?Math.round(mv.speed*1.60934)+'km/h':Math.round(mv.speed)+'mph';
      const _pctTxt=(!isAir&&mv.confidence)?` ${Math.round(mv.confidence*100)}%`:'';
      const chipTxt=`${_srcLbl.toLowerCase()} → ${degToDir(mv.direction)} ${spdUnit}${_pctTxt}`;
      ctx.save();ctx.font=`${Math.max(8,size*0.022)}px Inter,sans-serif`;
      ctx.textAlign='left';ctx.textBaseline='top';
      ctx.shadowColor='rgba(0,0,0,0.95)';ctx.shadowBlur=4;
      ctx.fillStyle=hexToRgba(neonC,0.85);ctx.fillText(chipTxt,8,8);
      ctx.restore();
    }
    if(_sonarCfg.showRelMotion&&typeof calcStormETAForBriefing==='function'&&topInbound.length){
      const shown=topInbound.slice(0,6);
      ctx.save();
      ctx.shadowColor='rgba(0,0,0,0.9)';ctx.shadowBlur=4;
      ctx.font=`${Math.max(8,size*0.022)}px Inter,sans-serif`;
      for(const st of shown){
        let b;try{b=calcStormETAForBriefing(st)}catch(e){continue}
        if(!b||b.classification==='unknown')continue;
        const sc=stormClass(b.classification);
        const col=sc.color;
        const stAng=((st.bearing||0)-90)*Math.PI/180;
        const dist=st.distance||0;
        const r=Math.min(maxR-6,maxR*(dist/viewR));
        const sx=cx+Math.cos(stAng)*r,sy=cy+Math.sin(stAng)*r;
        if(b.closingMph>0){
          const closeFrac=Math.min(1,Math.abs(b.closingMph)/30);
          const lineEnd=Math.max(8,closeFrac*r*0.85);
          const ux=(cx-sx),uy=(cy-sy);
          const um=Math.sqrt(ux*ux+uy*uy)||1;
          const ex=sx+(ux/um)*lineEnd,ey=sy+(uy/um)*lineEnd;
          ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);
          ctx.strokeStyle=col;ctx.lineWidth=1.6;ctx.setLineDash([3,2]);ctx.stroke();ctx.setLineDash([]);
          const head=5,ang=Math.atan2(ey-sy,ex-sx);
          ctx.beginPath();
          ctx.moveTo(ex,ey);ctx.lineTo(ex-Math.cos(ang-0.5)*head,ey-Math.sin(ang-0.5)*head);
          ctx.moveTo(ex,ey);ctx.lineTo(ex-Math.cos(ang+0.5)*head,ey-Math.sin(ang+0.5)*head);
          ctx.strokeStyle=col;ctx.lineWidth=1.6;ctx.stroke();
          const pctStr=(sc.showPct&&b.coneConfidence!=null)?` ${Math.round(b.coneConfidence*100)}%`:'';
          const lbl=b.classification==='direct'?`${sc.badge}${pctStr} ≈${b.closingMph}mph`
                   :b.classification==='near_miss'?`${sc.badge}${pctStr}`
                   :b.classification==='passing'?sc.badge:'';
          if(lbl){
            ctx.fillStyle=col;ctx.textAlign='left';ctx.textBaseline='middle';
            ctx.fillText(lbl,ex+4,ey);
          }
        }
        if(b.perpMissMi!=null&&b.perpMissMi>0&&b.classification!=='direct'){
          const missR=Math.min(maxR-4,maxR*(b.perpMissMi/viewR));
          if(b.sideBearing!=null&&missR>3){
            const sAng=(b.sideBearing-90)*Math.PI/180;
            const tx=cx+Math.cos(sAng)*missR,ty=cy+Math.sin(sAng)*missR;
            const perp=sAng+Math.PI/2;const tickL=5;
            ctx.beginPath();
            ctx.moveTo(tx+Math.cos(perp)*tickL,ty+Math.sin(perp)*tickL);
            ctx.lineTo(tx-Math.cos(perp)*tickL,ty-Math.sin(perp)*tickL);
            ctx.strokeStyle=col;ctx.lineWidth=1.8;ctx.stroke();
            const missMi=S.radarMetric?(b.perpMissMi*1.60934).toFixed(1)+' km':b.perpMissMi.toFixed(0)+' mi';
            const missLbl=`miss ${missMi} ${degToDir(b.sideBearing)}`;
            ctx.fillStyle=col;ctx.textAlign='left';ctx.textBaseline='middle';
            ctx.fillText(missLbl,tx+tickL+3,ty);
          }
        }
      }
      ctx.restore();
    }
    const aloftDir=S._upperWindDir;
    if(_sonarCfg.showAloft&&aloftDir!=null){
      const toDir=(aloftDir+180)%360;
      const aloftRad=(toDir-90)*Math.PI/180;
      const aLen=maxR*0.55;
      const aStart=15;
      const ax1=cx+Math.cos(aloftRad)*aStart,ay1=cy+Math.sin(aloftRad)*aStart;
      const ax2=cx+Math.cos(aloftRad)*aLen,ay2=cy+Math.sin(aloftRad)*aLen;
      ctx.save();ctx.shadowColor='rgba(0,0,0,0.9)';ctx.shadowBlur=6;
      ctx.beginPath();ctx.moveTo(ax1,ay1);ctx.lineTo(ax2,ay2);
      ctx.strokeStyle='rgba(255,0,220,0.55)';ctx.lineWidth=1.8;ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);
      const headL=8,ha1=aloftRad-Math.PI+0.4,ha2=aloftRad-Math.PI-0.4;
      ctx.beginPath();ctx.moveTo(ax2,ay2);ctx.lineTo(ax2+Math.cos(ha1)*headL,ay2+Math.sin(ha1)*headL);
      ctx.moveTo(ax2,ay2);ctx.lineTo(ax2+Math.cos(ha2)*headL,ay2+Math.sin(ha2)*headL);
      ctx.strokeStyle='rgba(255,0,220,0.65)';ctx.lineWidth=2;ctx.stroke();
      const lx=ax2+Math.cos(aloftRad)*10,ly=ay2+Math.sin(aloftRad)*10;
      ctx.fillStyle='rgba(255,0,220,0.8)';ctx.font=`bold ${Math.max(9,size*0.028)}px Inter,sans-serif`;
      ctx.shadowColor='rgba(0,0,0,0.95)';ctx.shadowBlur=6;
      ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('ALOFT',lx,ly);
      ctx.restore();
    }
  }catch(e){console.log('Sonar storm overlay error:',e.message)}
  if(!S._sonarSweepAngle)S._sonarSweepAngle=0;
  if(!_sonarCfg.alwaysOn){
    const sweepRad=S._sonarSweepAngle*Math.PI/180;
    ctx.save();
    const sweepEndX=cx+Math.cos(sweepRad)*maxR,sweepEndY=cy+Math.sin(sweepRad)*maxR;
    const tailSpan=0.6;
    for(let i=0;i<12;i++){
      const frac=i/12;
      const aOff=sweepRad-tailSpan*frac;
      const ex=cx+Math.cos(aOff)*maxR,ey=cy+Math.sin(aOff)*maxR;
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ex,ey);
      ctx.strokeStyle=`rgba(0,220,255,${0.18*(1-frac)})`;ctx.lineWidth=1.5*(1-frac*0.5);ctx.stroke();
    }
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(sweepEndX,sweepEndY);
    ctx.strokeStyle='rgba(0,255,255,0.35)';ctx.lineWidth=2;ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.shadowColor='#00dcff';ctx.shadowBlur=10;
  ctx.beginPath();ctx.arc(cx,cy,7,0,Math.PI*2);ctx.fillStyle='#00eeff';ctx.fill();
  ctx.restore();
  ctx.beginPath();ctx.arc(cx,cy,11,0,Math.PI*2);ctx.strokeStyle='rgba(0,220,255,0.6)';ctx.lineWidth=2;ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,16,0,Math.PI*2);ctx.strokeStyle='rgba(0,220,255,0.25)';ctx.lineWidth=1;ctx.stroke();
  // v5.69: real WarPulse strikes replace the ≥48 dBZ radar estimate on the
  // sonar when fresh (the estimate collection above is gated off via ltgLive()).
  if(_sonarCfg.showLightning&&typeof ltgLive==='function'&&ltgLive()){
    for(const f of S._ltgStrikes.flashes){
      const distMi=(f.distMi!=null)?f.distMi:haversine(S.lat,S.lon,f.lat,f.lon);
      if(distMi>viewR)continue;
      const bear=(f.bear!=null)?f.bear:(bearingDeg(S.lat,S.lon,f.lat,f.lon)+360)%360;
      const aMid=(bear-90)*Math.PI/180,rMid=maxR*(distMi/viewR);
      allLightningDots.push({x:cx+Math.cos(aMid)*rMid,y:cy+Math.sin(aMid)*rMid});
    }
  }
  if(_sonarCfg.showLightning&&allLightningDots.length&&(typeof _ltgShown!=='function'||_ltgShown())){
    const clR=Math.max(15,size*0.06);
    const lGroups=[];
    for(const d of allLightningDots){
      let merged=false;
      for(const g of lGroups){
        const dx=d.x-g.sx/g.n,dy=d.y-g.sy/g.n;
        if(dx*dx+dy*dy<clR*clR){g.sx+=d.x;g.sy+=d.y;g.n++;g.dots.push(d);merged=true;break}
      }
      if(!merged)lGroups.push({sx:d.x,sy:d.y,n:1,dots:[d]});
    }
    const now=performance.now();
    // v5.71: REAL (observed WarPulse) strikes PULSE — a flashing bolt with an
    // expanding cyan ring — while radar-derived ESTIMATES render as a solid,
    // steady bolt, so you can tell live data from a guess at a glance.
    const _ltgReal=(typeof ltgLive==='function'&&ltgLive());
    if(!_lightningFlashState)_lightningFlashState=[];
    while(_lightningFlashState.length<lGroups.length)_lightningFlashState.push({on:true,nextToggle:now+100+Math.random()*700});
    _lightningFlashState.length=lGroups.length;
    ctx.save();
    const boltSz=Math.max(10,size*0.035);
    ctx.font=`${boltSz}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.shadowColor='rgba(255,255,0,0.8)';ctx.shadowBlur=6;
    for(let gi=0;gi<lGroups.length;gi++){
      const g=lGroups[gi];
      const gx=g.sx/g.n,gy=g.sy/g.n;
      let flashAlpha;
      if(_ltgReal){
        // v5.75: real = a SLOW expanding ring (~2.6 s) + a slow, readable alpha
        // pulse. The bolt never fully blanks now, so it and its count stay legible
        // instead of the fast on/off flicker that was hard to read.
        const ph=(now/2600+gi*0.37)%1;
        ctx.save();ctx.shadowBlur=0;
        ctx.beginPath();ctx.arc(gx,gy,boltSz*0.45+ph*boltSz*0.9,0,Math.PI*2);
        ctx.strokeStyle=`rgba(120,210,255,${0.5*(1-ph)})`;ctx.lineWidth=2;ctx.stroke();
        ctx.restore();
        flashAlpha=0.65+0.3*Math.sin(now/520+gi*1.3);
      }else{
        // estimated: solid steady bolt (no pulse)
        flashAlpha=0.85;
      }
      ctx.fillStyle=`rgba(255,255,50,${flashAlpha})`;ctx.fillText('⚡',gx,gy);
      if(g.n>1){
        ctx.save();ctx.shadowBlur=0;
        ctx.font=`bold ${Math.max(7,boltSz*0.55)}px Inter,sans-serif`;
        ctx.fillStyle=`rgba(255,255,50,${Math.min(1,flashAlpha+0.05)})`;ctx.strokeStyle='rgba(0,0,0,0.6)';ctx.lineWidth=2;
        const tx=gx+boltSz*0.45,ty=gy-boltSz*0.35;
        ctx.strokeText(String(g.n),tx,ty);ctx.fillText(String(g.n),tx,ty);
        ctx.restore();
        ctx.font=`${boltSz}px sans-serif`;
      }
    }
    ctx.restore();
  }else{_lightningFlashState=null}
  const infoEl=document.getElementById('mini-sonar-info');
  if(infoEl){
    if(zoneCount>0){
      infoEl.textContent=`${zoneCount} zone${zoneCount>1?'s':''} · Peak ${maxDbz} dBZ · ${S.radarMetric?Math.round(viewR*1.60934)+'km':viewR+'mi'} radius`;
    }else{
      infoEl.textContent=S.scanTime?`All clear · ${S.radarMetric?Math.round(viewR*1.60934)+'km':viewR+'mi'} radius`:`Waiting for radar scan...`;
    }
  }
}
let _sonarAnimId=0;
function startSonarSweep(){
  if(_sonarAnimId)return;
  S._sonarSweepAngle=S._sonarSweepAngle||0;
  let last=0;
  function tick(ts){
    if(!document.getElementById('mini-sonar-canvas')){_sonarAnimId=0;return;}
    const dt=last?ts-last:16;last=ts;
    const prevAngle=S._sonarSweepAngle||0;
    if(_sonarCfg.alwaysOn){S._sonarTotalSwept=720;drawMiniSonar();_sonarAnimId=requestAnimationFrame(tick);return}
    const advance=dt*(_sonarCfg.sweepSpeed/1000);
    S._sonarSweepAngle=(prevAngle+advance)%360;
    S._sonarTotalSwept=Math.min(720,(S._sonarTotalSwept||0)+advance);
    drawMiniSonar();
    _sonarAnimId=requestAnimationFrame(tick);
  }
  _sonarAnimId=requestAnimationFrame(tick);
}
function stopSonarSweep(){if(_sonarAnimId){cancelAnimationFrame(_sonarAnimId);_sonarAnimId=0;}}
const _wn={p:[151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180],
  g:[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]],
  fade(t){return t*t*t*(t*(t*6-15)+10)},
  lerp(a,b,t){return a+(b-a)*t},
  dot(g,x,y){return g[0]*x+g[1]*y},
  noise(x,y){
    const p=_wn.p,g=_wn.g,X=Math.floor(x)&255,Y=Math.floor(y)&255;
    x-=Math.floor(x);y-=Math.floor(y);
    const u=_wn.fade(x),v=_wn.fade(y);
    const aa=p[(p[X]+Y)&255]%8,ab=p[(p[X]+Y+1)&255]%8,ba=p[(p[(X+1)&255]+Y)&255]%8,bb=p[(p[(X+1)&255]+Y+1)&255]%8;
    return _wn.lerp(_wn.lerp(_wn.dot(g[aa],x,y),_wn.dot(g[ba],x-1,y),u),_wn.lerp(_wn.dot(g[ab],x,y-1),_wn.dot(g[bb],x-1,y-1),u),v);
  }
};
let _windSimTimer=null;
let _windRefreshTimer=null;
let _gustSamples=[];
let _windBase={spd:0,dir:0,gust:0};
let _windCurSim={spd:0,dir:0,gust:0};
let _windFloor=0;
let _windCeil=0;
let _windLerpFrom={spd:0,dir:0};
let _windLerpTo={spd:0,dir:0};
let _windLerpT0=0;
let _WIND_LERP_DUR=5000;
let _windTrend=0;
let _windSweepRaf=null;
let _windSweepPaused=false;
let _windSweepAfterRender=false;
function _pickWindTarget(){
  const tSec=Date.now()/1000;
  const n=_wn.noise(tSec*0.2,0);
  const u=(n+1)/2;
  const range=_windCeil-_windFloor;
  if(!Number.isFinite(range)||range<=0)return{spd:_windFloor||0,dir:_windBase.dir||0};
  const ws=Number(_windBase.spd)||0;
  let center=Math.max(0.01,Math.min(0.99,(ws-_windFloor)/range));
  const fc=_getForecastWind();
  if(fc&&Number.isFinite(fc.spd)&&ws>0){
    const trendRatio=Math.max(-0.5,Math.min(0.5,(fc.spd-ws)/ws));
    _windTrend=trendRatio;
    const shift=trendRatio*0.3;
    center=Math.max(0.01,Math.min(0.99,center+shift));
  }else{_windTrend=0;}
  const dn=_wn.noise(tSec*0.2,100);
  const dir=((_windBase.dir+dn*5)%360+360)%360;
  if(Math.random()<0.08){
    const gustSpd=_windCeil-(Math.random()*range*0.08);
    return{spd:Math.max(_windFloor,Math.min(_windCeil,gustSpd)),dir};
  }
  const d=u-center;
  const exp=1.8;
  let biased;
  if(d<0){
    const nd=Math.min(1,Math.abs(d)/center);
    biased=center-Math.pow(nd,exp)*center;
  }else{
    const nd=Math.min(1,d/(1-center));
    biased=center+Math.pow(nd,exp)*(1-center);
  }
  if(!Number.isFinite(biased))biased=center;
  const spd=_windFloor+Math.max(0,Math.min(1,biased))*range;
  return{spd,dir};
}
function _updateWindRange(){
  const ws=Number(_windBase.spd)||0;
  const wg=Number(_windBase.gust)||ws;
  _windFloor=Math.max(0,ws*0.5);
  _windCeil=wg*1.1;
  if(_windCeil<=_windFloor)_windCeil=_windFloor+1;
}
function _getForecastWind(now){
  const h=S._hourlyData;
  if(!h||!h.time||!h.wind_speed_10m||!h.wind_direction_10m)return null;
  const times=h.time;const spds=h.wind_speed_10m;const dirs=h.wind_direction_10m;
  const gusts=h.wind_gusts_10m;
  const nowMs=now||Date.now();
  let i0=-1;
  for(let i=0;i<times.length-1;i++){
    const t0=new Date(times[i]).getTime(),t1=new Date(times[i+1]).getTime();
    if(nowMs>=t0&&nowMs<t1){i0=i;break}
  }
  if(i0<0)return null;
  const t0=new Date(times[i0]).getTime(),t1=new Date(times[i0+1]).getTime();
  const frac=(nowMs-t0)/(t1-t0);
  const spd=spds[i0]+(spds[i0+1]-spds[i0])*frac;
  let dd=dirs[i0+1]-dirs[i0];if(dd>180)dd-=360;if(dd<-180)dd+=360;
  const dir=((dirs[i0]+dd*frac)%360+360)%360;
  const gust=gusts?(gusts[i0]+(gusts[i0+1]-gusts[i0])*frac):null;
  return{spd,dir,gust};
}
function startWindSim(){
  if(_windSimTimer)clearInterval(_windSimTimer);
  if(_windRefreshTimer)clearInterval(_windRefreshTimer);
  if(S._windPickTimer)clearInterval(S._windPickTimer);
  if(!S.weather)return;
  _windBase={spd:S.weather.wind_speed_10m||0,dir:S.weather.wind_direction_10m||0,gust:S.weather.wind_gusts_10m||0};
  _updateWindRange();
  const initGust=Number(S.weather.wind_gusts_10m)||_windBase.spd;
  const now=Date.now();
  _gustSamples=[{t:now,v:initGust}];
  _windCurSim={spd:_windBase.spd,dir:_windBase.dir,gust:initGust};
  _windLerpFrom={spd:_windBase.spd,dir:_windBase.dir};
  _windLerpTo=_pickWindTarget();
  _windLerpT0=Date.now();
  _windRefreshTimer=setInterval(async()=>{
    if(document.hidden)return;   // v6.57 (QW5): no AWC refetch while backgrounded
    try{
      const awc=await fetchAWCNearest();
      if(awc&&awc.windKmh!=null){
        const newSpd=awc.windKmh;
        const newDir=awc.windDir!=null?awc.windDir:_windBase.dir;
        console.log('Wind refresh from AWC·'+awc.icao+': spd='+newSpd.toFixed(1)+'kmh dir='+newDir+'°');
        const newGust=awc.gustKmh!=null?awc.gustKmh:_windBase.gust;
        _windBase={spd:newSpd,dir:newDir,gust:newGust};
        _updateWindRange();
        _windLerpFrom={spd:_windCurSim.spd,dir:_windCurSim.dir};
        _windLerpTo=_pickWindTarget();
        _windLerpT0=Date.now();
      }
    }catch(e){console.log('Wind refresh error:',e.message)}
  },120000);
  _WIND_LERP_DUR=_getSimInterval();
  S._windPickTimer=setInterval(()=>{
    if(document.hidden)return;   // v6.57 (QW5)
    _windLerpFrom={spd:_windCurSim.spd,dir:_windCurSim.dir};
    _windLerpTo=_pickWindTarget();
    _windLerpT0=Date.now();
  },_WIND_LERP_DUR);
  _windSimTimer=setInterval(()=>{
    if(document.hidden)return;   // v6.57 (QW5): freeze the 100-ms sim while backgrounded
    const now=Date.now();
    const elapsed=now-_windLerpT0;
    const p=Math.min(1,elapsed/_WIND_LERP_DUR);
    const ep=p*p*(3-2*p);
    let simSpd=_windLerpFrom.spd+(_windLerpTo.spd-_windLerpFrom.spd)*ep;
    simSpd=Math.max(_windFloor,Math.min(_windCeil,simSpd));
    let dd=_windLerpTo.dir-_windLerpFrom.dir;
    if(dd>180)dd-=360;if(dd<-180)dd+=360;
    let simDir=((_windLerpFrom.dir+dd*ep)%360+360)%360;
    _gustSamples.push({t:now,v:simSpd});
    const gw=_getGustWindow();
    while(_gustSamples.length&&now-_gustSamples[0].t>gw)_gustSamples.shift();
    const displayGust=_gustSamples.length>0?Math.max(..._gustSamples.map(s=>s.v)):0;
    _windCurSim={spd:simSpd,dir:simDir,gust:displayGust};
    _trackMinMax(simSpd);
    const gStyle=getGaugeStyle();
    if(gStyle==='neon'){
      const dirEl=document.querySelector('.wrc-dir');
      if(dirEl)dirEl.textContent=degToDir(simDir)+' '+simDir.toFixed(0)+'°';
      const cx=50,cy=50;
      if(!_windSweepPaused){
        const numEl=document.querySelector('.wrc-num');
        const gustEl=document.querySelector('.wrc-gust');
        if(numEl)numEl.textContent=kmhTo(simSpd,S.windUnit);
        if(gustEl)gustEl.textContent=displayGust>0?'G'+fmtWind(displayGust)+' ('+_fmtWindowLabel(_getGustWindow())+')':'';
        const simSpdDisp=parseFloat(kmhTo(simSpd,S.windUnit));
        const gustDispSim=parseFloat(kmhTo(displayGust,S.windUnit));
        updateGaugeSegments(simSpdDisp,gustDispSim);
      }
      const compass=document.querySelector('.wind-rose svg');
      if(compass){
        const ptr=compass.querySelector('polygon');
        const dot=compass.querySelector('polygon+circle');
        if(ptr&&dot){
          const r=42,pBase=10;
          const ptrAng=(simDir-90)*Math.PI/180;
          const px=cx+Math.cos(ptrAng)*r,py=cy+Math.sin(ptrAng)*r;
          const pLx=cx+Math.cos(ptrAng-0.2)*pBase,pLy=cy+Math.sin(ptrAng-0.2)*pBase;
          const pRx=cx+Math.cos(ptrAng+0.2)*pBase,pRy=cy+Math.sin(ptrAng+0.2)*pBase;
          const pBx=cx+Math.cos(ptrAng+Math.PI)*5,pBy=cy+Math.sin(ptrAng+Math.PI)*5;
          ptr.setAttribute('points',`${px.toFixed(1)},${py.toFixed(1)} ${pLx.toFixed(1)},${pLy.toFixed(1)} ${pBx.toFixed(1)},${pBy.toFixed(1)} ${pRx.toFixed(1)},${pRy.toFixed(1)}`);
          dot.setAttribute('cx',px.toFixed(1));dot.setAttribute('cy',py.toFixed(1));
        }
      }
    }else{
      const gyroActive=_gyroEnabled&&_gyroHeading!=null;
      if(!S._gaugeTickLast||now-S._gaugeTickLast>(gyroActive?150:300)){
        S._gaugeTickLast=now;
        const wr=document.querySelector('.wind-rose,[data-gauge]');
        if(wr&&S.weather){
          const c2=S.weather;
          const wn2=kmhTo(simSpd,S.windUnit);
          const wu2=WIND_UNITS[S.windUnit];
          const gd2=parseFloat(kmhTo(displayGust,S.windUnit));
          const gs2=displayGust>0?'G'+fmtWind(displayGust)+' ('+_fmtWindowLabel(_getGustWindow())+')':'';
          const bf2=beaufortFromKmh(simSpd);
          const d2={windSpd:simSpd,wd:simDir,windDisp:parseFloat(wn2),gustDisp:gd2,gustRaw:displayGust,windNum:wn2,windUnit:wu2,gustStr:gs2,bf:bf2,simActive:true,pressure:c2.pressure_msl};
          const newHtml=renderWindGauge(d2);
          const parent=wr.parentElement;
          if(parent){
            const temp=document.createElement('div');
            temp.innerHTML=newHtml;
            parent.replaceChild(temp.firstElementChild,wr);
          }
        }
      }
    }
  },100);
  if(_windSweepAfterRender){
    _windSweepAfterRender=false;
    windSweepAnim();
  }
}
function secBtns(key){return`<div class="sec-btns"><button onclick="moveSection('${key}',-1)" title="Move up">▲</button><button onclick="moveSection('${key}',1)" title="Move down">▼</button></div>`}
// v4.46: Reorder system now also covers the Rain Clock and Rain Forecast Bars
// cards at the top of the Weather tab (they render their own card wrapper so
// they re-render in place after a swap rather than going through renderWeather).
const _defaultSecOrder=['rainclock','rainbars','wind','trends','forecast'];
function getSecOrder(){try{const o=JSON.parse(localStorage.getItem('st_sec_order'));if(Array.isArray(o)&&o.length>=2){const valid=['rainclock','rainbars','wind','trends','forecast','hourly'];const filtered=o.filter(k=>valid.includes(k));_defaultSecOrder.forEach(k=>{if(!filtered.includes(k))filtered.push(k)});return filtered}}catch(e){}return _defaultSecOrder.slice()}
function moveSection(key,dir){
  const order=getSecOrder();const i=order.indexOf(key);
  if(i<0)return;const ni=i+dir;
  if(ni<0||ni>=order.length)return;
  [order[i],order[ni]]=[order[ni],order[i]];
  try{localStorage.setItem('st_sec_order',JSON.stringify(order))}catch(e){}
  if(S.forecast)renderWeather(S.forecast);
  // v4.46: re-render the top cards that own their own card wrapper
  try{if(typeof renderRainClock==='function')renderRainClock()}catch(e){}
  try{if(typeof renderRainForecastBars==='function')renderRainForecastBars()}catch(e){}
  // v4.46: physically reorder the top placeholder divs in the DOM so the
  // user-chosen order persists between rain-clock and rain-bars cards.
  try{
    const parent=document.getElementById('rain-clock')?.parentNode;
    if(parent){
      const rc=document.getElementById('rain-clock');
      const rb=document.getElementById('rain-forecast-bars');
      if(rc&&rb){
        const rcIdx=order.indexOf('rainclock'),rbIdx=order.indexOf('rainbars');
        if(rcIdx>rbIdx&&rc.previousElementSibling===rb){/*already*/}
        else if(rbIdx>rcIdx&&rb.previousElementSibling===rc){/*already*/}
        else if(rcIdx>rbIdx)parent.insertBefore(rb,rc);
        else parent.insertBefore(rc,rb);
      }
    }
  }catch(e){}
}

function get48hData(h){
  if(!h||!h.time)return null;
  const nowMs=Date.now();
  const all=h.time.map((t,i)=>({t:new Date(t).getTime(),idx:i}));
  const pastStart=all.findIndex(p=>p.t>=nowMs-24*3600000);
  const futEnd=all.findIndex(p=>p.t>=nowMs+24*3600000);
  const start=Math.max(0,pastStart);
  const end=futEnd>0?futEnd:all.length;
  const nowIdx=all.findIndex(p=>p.t>=nowMs);
  return{start,end,nowIdx:nowIdx>=0?nowIdx-start:24,count:end-start};
}
const TREND_SERIES=[
  {id:'temp',label:'Temp',icon:'🌡️',color:'#ef4444',key:'temperature_2m',fmt:v=>fmtTemp(v),group:'temp'},
  {id:'feels',label:'Feels Like',icon:'🤔',color:'#f97316',key:'apparent_temperature',fmt:v=>fmtTemp(v),group:'temp'},
  {id:'dewpt',label:'Dew Point',icon:'💧',color:'#06b6d4',key:'dew_point_2m',fmt:v=>fmtTemp(v),group:'temp'},
  {id:'humidity',label:'Humidity',icon:'💦',color:'#22d3ee',key:'relative_humidity_2m',fmt:v=>v.toFixed(0)+'%',unit:'%',group:'pct'},
  {id:'cloud',label:'Clouds',icon:'☁️',color:'#94a3b8',key:'cloud_cover',fmt:v=>v.toFixed(0)+'%',unit:'%',group:'pct'},
  {id:'precip',label:'Precip',icon:'🌧️',color:'#3b82f6',key:'precipitation',fmt:v=>fmtPrecip(v),bar:true,group:'precip'},
  {id:'precipProb',label:'Rain %',icon:'☂️',color:'#818cf8',key:'precipitation_probability',fmt:v=>(v||0).toFixed(0)+'%',unit:'%',group:'pct'},
  {id:'wind',label:'Wind',icon:'💨',color:'#10b981',key:'wind_speed_10m',fmt:v=>fmtWind(v),group:'wind'},
  {id:'gust',label:'Gusts',icon:'🌬️',color:'#f59e0b',key:'wind_gusts_10m',fmt:v=>fmtWind(v),group:'wind'},
  {id:'pres',label:'Pressure',icon:'📊',color:'#00e5ff',key:'pressure_msl',fmt:v=>fmtPres(v),group:'pres'},
];
if(!S._trendSel)S._trendSel=['temp','feels'];
function toggleTrendSeries(id){
  const idx=S._trendSel.indexOf(id);
  if(idx>=0)S._trendSel.splice(idx,1);
  else{if(S._trendSel.length>=4)S._trendSel.shift();S._trendSel.push(id)}
  if(S.forecast)renderTrendChartUpdate(S.forecast.hourly);
}
function renderTrendCharts(h){
  if(!h||!h.time)return'';
  const info=get48hData(h);if(!info)return'';
  const pills=TREND_SERIES.map(s=>{
    const on=S._trendSel.includes(s.id);
    return`<button onclick="toggleTrendSeries('${s.id}')" style="padding:3px 8px;border-radius:12px;border:1px solid ${on?s.color:'#334155'};background:${on?s.color+'22':'transparent'};color:${on?s.color:'#94a3b8'};font-size:0.65em;font-weight:600;cursor:pointer;white-space:nowrap">${s.icon} ${s.label}</button>`;
  }).join('');
  return`<div class="card" id="trend-card">
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${pills}</div>
    <div id="trend-chart-area">${buildTrendSVG(h,info)}</div></div>`;
}
function renderTrendChartUpdate(h){
  const info=get48hData(h);if(!info)return;
  const pills=TREND_SERIES.map(s=>{
    const on=S._trendSel.includes(s.id);
    return`<button onclick="toggleTrendSeries('${s.id}')" style="padding:3px 8px;border-radius:12px;border:1px solid ${on?s.color:'#334155'};background:${on?s.color+'22':'transparent'};color:${on?s.color:'#94a3b8'};font-size:0.65em;font-weight:600;cursor:pointer;white-space:nowrap">${s.icon} ${s.label}</button>`;
  }).join('');
  const card=document.getElementById('trend-card');
  if(card)card.innerHTML=`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px">${pills}</div><div id="trend-chart-area">${buildTrendSVG(h,info)}</div>`;
}
function buildTrendSVG(h,info){
  const sel=S._trendSel.map(id=>TREND_SERIES.find(s=>s.id===id)).filter(Boolean);
  if(!sel.length)return'<div style="text-align:center;color:var(--text-muted);font-size:0.8em;padding:20px">Select data series above</div>';
  const W=600,H=180,PAD_L=6,PAD_R=6,PAD_T=18,PAD_B=22;
  const cW=W-PAD_L-PAD_R,cH=H-PAD_T-PAD_B;
  const {start,end,nowIdx,count}=info;
  if(count<4)return'';
  const hasBars=sel.some(s=>s.bar);
  const lineData=sel.filter(s=>!s.bar);
  const barData=sel.filter(s=>s.bar);
  let svg=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">`;
  svg+=`<defs><linearGradient id="tg-now" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(0,229,255,0.15)"/><stop offset="100%" stop-color="rgba(0,229,255,0)"/></linearGradient></defs>`;
  for(let g=0;g<=4;g++){
    const y=PAD_T+cH*(g/4);
    svg+=`<line x1="${PAD_L}" y1="${y}" x2="${W-PAD_R}" y2="${y}" stroke="rgba(148,163,184,0.1)" stroke-width="0.5"/>`;
  }
  const nowX=PAD_L+(nowIdx/(count-1))*cW;
  svg+=`<rect x="${PAD_L}" y="${PAD_T}" width="${nowX-PAD_L}" height="${cH}" fill="rgba(148,163,184,0.03)"/>`;
  svg+=`<line x1="${nowX}" y1="${PAD_T-4}" x2="${nowX}" y2="${H-PAD_B}" stroke="rgba(0,229,255,0.5)" stroke-width="1" stroke-dasharray="3,2"/>`;
  svg+=`<text x="${nowX}" y="${PAD_T-6}" fill="#00e5ff" font-size="7" font-weight="700" text-anchor="middle">NOW</text>`;
  // v5.84: day-boundary lines — a faint vertical rule + weekday label at each local
  // midnight across the window, so you can tell which day each part of the trend is.
  {
    let _pd=null;
    for(let i=0;i<count;i++){
      const _d=new Date(h.time[start+i]);
      const _dk=_d.toDateString();
      if(_pd!==null&&_dk!==_pd){
        const dx=PAD_L+(i/(count-1))*cW;
        svg+=`<line x1="${dx.toFixed(1)}" y1="${PAD_T}" x2="${dx.toFixed(1)}" y2="${H-PAD_B}" stroke="rgba(148,163,184,0.22)" stroke-width="0.75" stroke-dasharray="2,2"/>`;
        svg+=`<text x="${(dx+2).toFixed(1)}" y="${(PAD_T+7).toFixed(1)}" fill="#7c8aa0" font-size="6" font-weight="700">${_d.toLocaleDateString(undefined,{weekday:'short'})}</text>`;
      }
      _pd=_dk;
    }
  }
  const groups=new Map();
  sel.forEach(s=>{const g=s.group||s.id;if(!groups.has(g))groups.set(g,[]);groups.get(g).push(s)});
  const groupKeys=[...groups.keys()];
  const scales=new Map();
  groupKeys.forEach(g=>{
    const series=groups.get(g);
    let allVals=[];
    series.forEach(s=>{
      const arr=h[s.key];
      if(arr)for(let i=start;i<end;i++){if(arr[i]!=null)allVals.push(arr[i])}
    });
    if(!allVals.length)allVals=[0,1];
    let mn=Math.min(...allVals),mx=Math.max(...allVals);
    const rng=mx-mn||1;
    mn-=rng*0.1;mx+=rng*0.1;
    scales.set(g,{mn,mx,rng:mx-mn||1});
  });
  if(barData.length){
    const sc=scales.get(barData[0].group);
    barData.forEach(s=>{
      const arr=h[s.key];if(!arr)return;
      const bw=cW/count*0.7;
      for(let i=0;i<count;i++){
        const v=arr[start+i];if(v==null||v<=0)continue;
        const x=PAD_L+(i/(count-1))*cW-bw/2;
        const ht=Math.max(2,((v-0)/(sc.mx-0||1))*cH);
        const y=PAD_T+cH-ht;
        const isPast=i<nowIdx;
        svg+=`<rect x="${x}" y="${y}" width="${bw}" height="${ht}" rx="1" fill="${s.color}" opacity="${isPast?0.7:0.35}"/>`;
      }
    });
  }
  lineData.forEach((s,si)=>{
    const arr=h[s.key];if(!arr)return;
    const sc=scales.get(s.group);
    const pts=[];
    for(let i=0;i<count;i++){
      const v=arr[start+i];if(v==null)continue;
      const x=PAD_L+(i/(count-1))*cW;
      const y=PAD_T+cH-((v-sc.mn)/sc.rng)*cH;
      pts.push({x,y,v,i});
    }
    if(pts.length<2)return;
    const pastPts=pts.filter(p=>p.i<=nowIdx);
    const futPts=pts.filter(p=>p.i>=nowIdx);
    if(pastPts.length>=2){
      const d=pastPts.map((p,j)=>(j===0?`M${p.x.toFixed(1)},${p.y.toFixed(1)}`:`L${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ');
      svg+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if(futPts.length>=2){
      const d=futPts.map((p,j)=>(j===0?`M${p.x.toFixed(1)},${p.y.toFixed(1)}`:`L${p.x.toFixed(1)},${p.y.toFixed(1)}`)).join(' ');
      svg+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.5" stroke-dasharray="4,3" stroke-linecap="round" opacity="0.5"/>`;
    }
    const dayBuckets=new Map();
    pts.forEach(p=>{
      const dt=new Date(h.time[start+p.i]);
      const dk=dt.toDateString();
      if(!dayBuckets.has(dk))dayBuckets.set(dk,{hi:p,lo:p});
      const b=dayBuckets.get(dk);
      if(p.v>b.hi.v)b.hi=p;
      if(p.v<b.lo.v)b.lo=p;
    });
    const usedPts=new Set();
    dayBuckets.forEach(b=>{
      const hiK=b.hi.i+':hi',loK=b.lo.i+':lo';
      if(!usedPts.has(hiK)){
        usedPts.add(hiK);
        const tx=b.hi.x+5>W-PAD_R-30?b.hi.x-30:b.hi.x+5;
        svg+=`<circle cx="${b.hi.x.toFixed(1)}" cy="${b.hi.y.toFixed(1)}" r="3" fill="${s.color}" stroke="#0f172a" stroke-width="1"/>`;
        svg+=`<text x="${tx.toFixed(1)}" y="${(b.hi.y-5).toFixed(1)}" fill="${s.color}" font-size="6.5" font-weight="700">▲${s.fmt(b.hi.v)}</text>`;
      }
      if(Math.abs(b.lo.i-b.hi.i)>2&&!usedPts.has(loK)){
        usedPts.add(loK);
        const tx=b.lo.x+5>W-PAD_R-30?b.lo.x-30:b.lo.x+5;
        svg+=`<circle cx="${b.lo.x.toFixed(1)}" cy="${b.lo.y.toFixed(1)}" r="3" fill="${s.color}" stroke="#0f172a" stroke-width="1"/>`;
        svg+=`<text x="${tx.toFixed(1)}" y="${(b.lo.y+10).toFixed(1)}" fill="${s.color}" font-size="6.5" font-weight="700" opacity="0.7">▼${s.fmt(b.lo.v)}</text>`;
      }
    });
  });
  const nowLabels=[];
  lineData.forEach(s=>{
    const arr=h[s.key];if(!arr)return;
    const sc=scales.get(s.group);
    const v=arr[start+nowIdx];if(v==null)return;
    const y=PAD_T+cH-((v-sc.mn)/sc.rng)*cH;
    nowLabels.push({y,color:s.color,label:s.fmt(v),id:s.id});
  });
  barData.forEach(s=>{
    const arr=h[s.key];if(!arr)return;
    const sc=scales.get(s.group);
    const v=arr[start+nowIdx];if(v==null)return;
    const ht=Math.max(2,((v-0)/(sc.mx-0||1))*cH);
    const y=PAD_T+cH-ht;
    nowLabels.push({y,color:s.color,label:s.fmt(v),id:s.id});
  });
  if(nowLabels.length){
    nowLabels.sort((a,b)=>a.y-b.y);
    const LBL_H=9;
    const minY=PAD_T+2,maxY=H-PAD_B-4;
    const placed=[];
    nowLabels.forEach(nl=>{
      let py=nl.y;
      for(const prev of placed){
        if(py<prev+LBL_H&&py>prev-LBL_H)py=prev+LBL_H;
      }
      if(py<minY)py=minY;
      if(py>maxY)py=maxY;
      placed.push(py);
      const tx=nowX+5;
      svg+=`<circle cx="${nowX.toFixed(1)}" cy="${nl.y.toFixed(1)}" r="2.5" fill="${nl.color}" stroke="#0f172a" stroke-width="0.8"/>`;
      svg+=`<text x="${tx.toFixed(1)}" y="${(py+2.5).toFixed(1)}" fill="${nl.color}" font-size="7" font-weight="700" text-shadow="0 0 3px #000">${nl.label}</text>`;
    });
  }
  if(groupKeys.length>1||(lineData.length>0&&barData.length>0)){
    let lx=PAD_L+4,ly=PAD_T+10;
    sel.forEach(s=>{
      svg+=`<rect x="${lx}" y="${ly-5}" width="8" height="3" rx="1" fill="${s.color}"/>`;
      svg+=`<text x="${lx+11}" y="${ly-2}" fill="${s.color}" font-size="6" font-weight="600">${s.label}</text>`;
      ly+=10;
    });
  }
  const fmtHr=d=>fmtHrLabel(d);
  const labelCount=7;
  for(let li=0;li<labelCount;li++){
    const idx=Math.round(li*(count-1)/(labelCount-1));
    const t=new Date(h.time[start+idx]);
    const x=PAD_L+(idx/(count-1))*cW;
    svg+=`<text x="${x}" y="${H-4}" fill="#64748b" font-size="6" text-anchor="middle">${idx===nowIdx?'Now':fmtHr(t)}</text>`;
  }
  const yLabels=groupKeys.length<=2?groupKeys:[groupKeys[0]];
  yLabels.forEach((g,gi)=>{
    const sc=scales.get(g);
    const isRight=gi>0;
    [0,0.5,1].forEach(f=>{
      const v=sc.mn+sc.rng*f;
      const y=PAD_T+cH-f*cH;
      const s=groups.get(g)[0];
      const label=s.fmt(v);
      if(isRight)svg+=`<text x="${W-PAD_R+2}" y="${y+2}" fill="#475569" font-size="5" text-anchor="start">${label}</text>`;
      else svg+=`<text x="${PAD_L-2}" y="${y+2}" fill="#475569" font-size="5" text-anchor="end">${label}</text>`;
    });
  });
  svg+=`</svg>`;
  return svg;
}
function initPrecipTaps(){
  document.querySelectorAll('.hourly-chart').forEach(chart=>{
    chart.addEventListener('click',e=>{
      const bar=e.target.closest('.hourly-bar');
      if(!bar)return;
      const wasActive=bar.classList.contains('tapped');
      chart.querySelectorAll('.hourly-bar').forEach(b=>b.classList.remove('tapped'));
      if(!wasActive)bar.classList.add('tapped');
    });
  });
}

function _tempToColor(tempC){
  var f=S.tempUnit===0?(tempC*9/5+32):tempC;
  if(f<=32)return'#4FC3F7';
  if(f<=50)return'#29B6F6';
  if(f<=60)return'#26C6DA';
  if(f<=68)return'#66BB6A';
  if(f<=75)return'#FFA726';
  if(f<=85)return'#FF7043';
  if(f<=95)return'#EF5350';
  return'#E53935';
}
function renderHourlyForecast(h,d){
  if(!h||!h.time)return'';
  const now=new Date();
  const nowIdx=h.time.findIndex(t=>new Date(t)>=now);
  const startIdx=Math.max(0,nowIdx<0?0:nowIdx);
  const hours=Math.min(72,h.time.length-startIdx);
  if(hours<1)return'<div class="card"><p style="color:var(--text-muted);text-align:center;padding:16px">No hourly data available</p></div>';
  const sunrise=d&&d.sunrise?d.sunrise:[];
  const sunset=d&&d.sunset?d.sunset:[];
  function isNight(t){
    const dt=new Date(t);
    const dayStr=t.slice(0,10);
    for(let i=0;i<(d.time||[]).length;i++){
      if(d.time[i]===dayStr){
        const sr=sunrise[i]?new Date(sunrise[i]):null;
        const ss=sunset[i]?new Date(sunset[i]):null;
        if(sr&&ss)return dt<sr||dt>ss;
      }
    }
    const hr=dt.getHours();return hr<6||hr>20;
  }
  let temps=[];
  for(let n=0;n<hours;n++){temps.push(h.temperature_2m[startIdx+n])}
  const minT=Math.min(...temps),maxT=Math.max(...temps);
  const range=maxT-minT||1;
  let lastDay='';
  let items='';
  for(let n=0;n<hours;n++){
    const i=startIdx+n;
    const t=h.time[i];
    const dt=new Date(t);
    const dayStr=dt.toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric'});
    if(dayStr!==lastDay){
      lastDay=dayStr;
      const isToday=dt.toDateString()===now.toDateString();
      const isTomorrow=dt.toDateString()===new Date(now.getTime()+86400000).toDateString();
      const label=isToday?'Today':isTomorrow?'Tomorrow':dayStr;
      items+=`<div class="hbar-day-label">${label}</div>`;
    }
    const hrStr=fmtHrLabel(dt);
    const tempC=h.temperature_2m[i];
    const precip=h.precipitation_probability?h.precipitation_probability[i]:0;
    const precipMm=h.precipitation?h.precipitation[i]:0;
    const precipShow=precip>0?precip+'%':(precipMm>0?fmtPrecip(precipMm):'');
    const wCode=h.weather_code?h.weather_code[i]:0;
    const isD=h.is_day?h.is_day[i]===1:!isNight(t);
    const pct=20+((tempC-minT)/range)*80;
    const col=_tempToColor(tempC);
    items+=`<div class="hbar-col${!isD?' hbar-night':''}">
      <div class="hbar-temp">${fmtTempShort(tempC)}</div>
      <div class="hbar-icon">${animEmoji(wCode,isD,'1.2em')}</div>
      <div class="hbar-bar-wrap"><div class="hbar-bar" style="height:${pct}%;background:${col}"></div></div>
      ${precipShow?`<div class="hbar-precip">💧<br>${precipShow}</div>`:`<div class="hbar-precip-empty"></div>`}
      <div class="hbar-time">${n===0?tStr('Now'):hrStr}</div>
    </div>`;
  }
  return`<div class="card"><div class="card-title"><span class="icon">🕐</span> Hourly Forecast — Next 72h</div>
    <div class="hbar-scroll">${items}</div></div>`;
}
function _fmtSecondary(c){return S.tempUnit===0?'('+c.toFixed(0)+'°C)':'('+cToF(c)+'°F)'}
function _nwsCondToIcon(short,isDaytime){
  const nwsCondMap={'sunny':'clear-day','clear':'clear-night','mostly sunny':'few-clouds-day','mostly clear':'few-clouds-night','partly sunny':'partly-cloudy-day','partly cloudy':'partly-cloudy-night','mostly cloudy':'overcast','cloudy':'overcast','overcast':'overcast',
    'rain':'rain','showers':'few-clouds-day-rain','chance rain':'few-clouds-day-rain','slight chance rain':'few-clouds-day-rain','thunderstorms':'thunderstorm','chance thunderstorms':'thunderstorm','snow':'snow','chance snow':'partly-cloudy-day-snow','fog':'fog','haze':'haze','windy':'overcast','hot':'clear-day','cold':'snow'};
  const sh=(short||'').toLowerCase();let cond=isDaytime?'partly-cloudy-day':'partly-cloudy-night';
  for(const[k,c]of Object.entries(nwsCondMap)){if(sh.includes(k)){cond=c;break}}
  return cond;
}
function _isSevere(short){const s=(short||'').toLowerCase();return s.includes('severe')||s.includes('tornado')||s.includes('thunderstorm')||s.includes('t-storm')||s.includes('hurricane')||s.includes('tropical')}
function _wxTags(short){const tags=[];const s=(short||'').toLowerCase();if(s.includes('thunderstorm')||s.includes('t-storm'))tags.push('Thunderstorm');if(s.includes('tornado'))tags.push('Tornado');if(s.includes('hail'))tags.push('Hail');if(s.includes('snow'))tags.push('Snow');if(s.includes('ice')||s.includes('freezing'))tags.push('Ice');if(s.includes('flood'))tags.push('Flooding');return tags}

function _renderFcPeriodCol(p,label,icon,isNight){
  if(!p)return'';
  const tempC=p.unit==='F'?(p.temp-32)*5/9:p.temp;
  const tempMain=fmtTempShort(tempC);
  const tempSec=_fmtSecondary(tempC);
  const cond=_nwsCondToIcon(p.short,!isNight);
  const em=getWeatherIcon(cond,'1.2em');
  const rain=p.precip||0;
  return`<div class="fc-col">
    <div class="fc-col-label">${icon} ${label}</div>
    <div class="fc-col-icon">${em}</div>
    <div class="fc-col-temp">${tempMain} <span class="fc-sec">${tempSec}</span></div>
    <div class="fc-col-desc">${p.short}</div>
    <div class="fc-col-wind">Wind: ${p.wind} ${p.windDir}</div>
    ${rain>0?`<div class="fc-col-rain">💧 ${rain}%</div>`:''}
  </div>`;
}

function renderDailyForecast(d,tz){
  if(!d||!d.time)return'';
  let safeTz;
  try{Intl.DateTimeFormat('en',{timeZone:tz});safeTz=tz}catch(e){safeTz=undefined}
  let todayStr;
  try{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:safeTz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    todayStr=parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value+'-'+parts.find(p=>p.type==='day').value;
  }catch(e){
    const n=new Date();todayStr=n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0');
  }
  let todayIdx=d.time.indexOf(todayStr);
  if(todayIdx<0){todayIdx=d.time.findIndex(t=>t>=todayStr);if(todayIdx<0)todayIdx=0}
  const futureTime=d.time.slice(todayIdx);
  const allLos=[],allHis=[];
  futureTime.forEach((t,vi)=>{const oi=todayIdx+vi;allLos.push(d.temperature_2m_min[oi]);allHis.push(d.temperature_2m_max[oi])});
  const weekMin=Math.min(...allLos),weekMax=Math.max(...allHis);
  const weekRange=weekMax-weekMin||1;
  const initShow=5;
  const rows=futureTime.map((t,vi)=>{
    const oi=todayIdx+vi;
    const [yy,mm,dd]=t.split('-').map(Number);
    const dt=new Date(Date.UTC(yy,mm-1,dd,12,0,0));
    const dayAbbr=t===todayStr?tStr('Today'):dt.toLocaleDateString(_curLang||'en',{weekday:'short',timeZone:'UTC'});
    const dateNum=dd;
    const hiC=d.temperature_2m_max[oi],loC=d.temperature_2m_min[oi];
    const rain=d.precipitation_probability_max?d.precipitation_probability_max[oi]:0;
    const code=d.weather_code[oi];
    const severe=(code>=95);
    const emDay=animEmoji(code,true,'1.4em');
    const loCol=_tempToColor(loC),hiCol=_tempToColor(hiC);
    const leftPct=0;
    const widthPct=100;
    const hidden=vi>=initShow?' style="display:none" data-fc-extra':'';
    return`<div class="dbar-row" onclick="toggleDailyDetail(this,${oi})"${hidden}>
      <div class="dbar-day"><span class="dbar-day-name">${dayAbbr}</span><span class="dbar-day-date">${dateNum}</span></div>
      <div class="dbar-icon">${emDay}${severe?'<span class="dbar-severe">⚠</span>':''}</div>
      <div class="dbar-rain">${rain>0?'💧'+rain+'%':''}</div>
      <div class="dbar-lo">${fmtTempShort(loC)}</div>
      <div class="dbar-track"><div class="dbar-range" style="left:${leftPct}%;width:${Math.max(widthPct,4)}%;background:linear-gradient(90deg,${loCol},${hiCol})"></div></div>
      <div class="dbar-hi">${fmtTempShort(hiC)}</div>
    </div><div id="fc-detail-${oi}" style="display:none"></div>`;
  }).join('');
  const showMore=futureTime.length>initShow?`<div class="fc-show-more" id="fc-show-more" onclick="toggleFcMore()">Show More ▾</div>`:'';
  return`<div class="card"><div class="card-title"><span class="icon">📊</span> ${tStr('This Week')}</div>${rows}${showMore}</div>`;
}
function toggleFcMore(){
  const extras=document.querySelectorAll('[data-fc-extra]');
  const btn=document.getElementById('fc-show-more');
  if(!extras.length)return;
  const hidden=extras[0].style.display==='none';
  extras.forEach(el=>{el.style.display=hidden?'':'none';if(!hidden){const nb=el.nextElementSibling;if(nb&&nb.id&&nb.id.startsWith('fc-detail-'))nb.style.display='none';el.classList.remove('dbar-row-active')}});
  if(btn)btn.innerHTML=hidden?'Show Less ▴':'Show More ▾';
}
function toggleNwsFcMore(){
  const extras=document.querySelectorAll('[data-nws-extra]');
  const btn=document.getElementById('nws-show-more');
  if(!extras.length)return;
  const hidden=extras[0].style.display==='none';
  extras.forEach(el=>el.style.display=hidden?'':'none');
  if(btn)btn.innerHTML=hidden?'Show Less ▴':'Show More ▾';
}
function toggleDailyDetail(el,idx){
  const d=S.forecast&&S.forecast.daily;if(!d)return;
  const box=document.getElementById('fc-detail-'+idx);
  if(!box)return;
  if(box.style.display!=='none'){box.style.display='none';el.classList.remove('dbar-row-active');return}
  const rain=d.precipitation_probability_max?d.precipitation_probability_max[idx]:0;
  const precip=d.precipitation_sum?d.precipitation_sum[idx]:0;
  const wind=d.wind_speed_10m_max?d.wind_speed_10m_max[idx]:0;
  const sunrise=d.sunrise?fmtClockShort(new Date(d.sunrise[idx])):'—';
  const sunset=d.sunset?fmtClockShort(new Date(d.sunset[idx])):'—';
  const hiC=d.temperature_2m_max[idx],loC=d.temperature_2m_min[idx];
  box.innerHTML=`<div class="forecast-detail">
    <div class="fd-row"><span>🌡️ ${tStr('High / Low')}</span><span class="fw600"><span style="color:var(--accent-red)">${fmtTemp(hiC)}</span> / <span class="c-cyan">${fmtTemp(loC)}</span></span></div>
    <div class="fd-row"><span>💧 ${tStr('Rain Chance')}</span><span class="fw600">${rain}%</span></div>
    <div class="fd-row"><span>🌧️ ${tStr('Precipitation')}</span><span class="fw600">${fmtPrecip(precip)}</span></div>
    <div class="fd-row"><span>💨 ${tStr('Max Wind')}</span><span class="fw600">${fmtWind(wind)}</span></div>
    <div class="fd-row"><span>🌅 ${tStr('Sunrise')}</span><span class="fw600">${sunrise}</span></div>
    <div class="fd-row"><span>🌇 ${tStr('Sunset')}</span><span class="fw600">${sunset}</span></div>
  </div>`;
  box.style.display='';
  el.classList.add('dbar-row-active');
  if(_curLang!=='en')setTimeout(quickTranslate,100);
}

function renderNWSForecast(periods){
  if(!periods||!periods.length)return'';
  S._nwsPeriods=periods;
  const dayPairs=[];
  for(let i=0;i<periods.length;i++){
    const p=periods[i];
    if(p.isDaytime!==false){
      const night=periods[i+1]&&periods[i+1].isDaytime===false?periods[i+1]:null;
      dayPairs.push({day:p,night,idx:i});
      if(night)i++;
    }else{
      dayPairs.push({day:null,night:p,idx:i});
    }
  }
  const initShow=4;
  const cards=dayPairs.map((pair,pi)=>{
    const p=pair.day||pair.night;
    const dayName=p.name.replace(/ Night$/,'').replace(/This /,'');
    const dayShort=pair.day?pair.day.short:'';
    const nightShort=pair.night?pair.night.short:'';
    const combined=dayShort+' '+nightShort;
    const severe=_isSevere(combined);
    const tags=_wxTags(combined);
    const hidden=pi>=initShow?' style="display:none" data-nws-extra':'';
    return`<div class="fc-day-card"${hidden}>
      <div class="fc-day-header">
        <span class="fc-day-name">${dayName}</span>
        ${severe?'<span class="fc-severe-badge">⚠ POSSIBLE SEVERE</span>':''}
      </div>
      ${tags.length?'<div class="fc-tags">'+tags.map(t=>'<span class="fc-tag">'+getWeatherIcon('thunderstorm','0.75em')+' '+t+'</span>').join('')+'</div>':''}
      <div class="fc-cols">
        ${_renderFcPeriodCol(pair.day,'Day','☀️',false)}
        ${_renderFcPeriodCol(pair.night,'Night','🌙',true)}
      </div>
      <div class="fc-detail-toggle" onclick="toggleNWSDetail(this,${pair.idx})">Show Details</div>
      <div class="fc-detail-body" id="nws-detail-${pair.idx}" style="display:none"></div>
    </div>`;
  }).join('');
  const showMore=dayPairs.length>initShow?`<div class="fc-show-more" id="nws-show-more" onclick="toggleNwsFcMore()">Show More ▾</div>`:'';
  return`<div class="card"><div class="card-title"><span class="icon">📊</span> NWS Forecast</div>${cards}${showMore}
    <div style="text-align:right;font-size:0.55em;color:var(--text-muted);margin-top:4px;padding-right:4px">Source: National Weather Service</div></div>`;
}
function toggleNWSDetail(el,idx){
  const periods=S._nwsPeriods;if(!periods)return;
  const box=document.getElementById('nws-detail-'+idx);
  if(!box)return;
  if(box.style.display!=='none'){box.style.display='none';el.textContent='Show Details';return}
  const p=periods[idx];
  const tempC=p.unit==='F'?(p.temp-32)*5/9:p.temp;
  const n=periods[idx+1]&&periods[idx+1].isDaytime===false?periods[idx+1]:null;
  const nightDetail=n?`<div style="font-size:0.8em;color:var(--text-secondary);margin-top:8px;line-height:1.4;border-top:1px solid var(--border-subtle);padding-top:8px"><b>${n.name}:</b> ${n.detail}</div>`:'';
  box.innerHTML=`<div class="forecast-detail">
    <div class="fd-row"><span>🌡️ Temperature</span><span class="fw600">${fmtTemp(tempC)}</span></div>
    <div class="fd-row"><span>💨 Wind</span><span class="fw600">${p.wind} ${p.windDir}</span></div>
    ${p.precip>0?`<div class="fd-row"><span>💧 Rain Chance</span><span class="fw600">${p.precip}%</span></div>`:''}
    <div style="font-size:0.8em;color:var(--text-secondary);margin-top:8px;line-height:1.4;border-top:1px solid var(--border-subtle);padding-top:8px">${p.detail}</div>
    ${nightDetail}
  </div>`;
  box.style.display='';
  el.textContent='Hide Details';
}

// No-op — arrow is now driven purely by forecast spread trend at render time.
function updateWeatherCloudBaseColor(){}


// ===== Rain Clock (RainAware-style 0-180 min circular precip dial) =====
function _nextRainHourFromForecast(){
  const h=S._hourlyData;
  if(!h||!h.time||!h.precipitation)return null;
  const now=Date.now();
  let startIdx=h.time.findIndex(t=>new Date(t).getTime()>=now-1800000);
  if(startIdx<0)return null;
  const end=Math.min(startIdx+36,h.time.length);
  for(let i=startIdx;i<end;i++){
    if((h.precipitation[i]||0)>=0.1){
      const t=new Date(h.time[i]).getTime();
      return{mins:Math.max(0,Math.round((t-now)/60000)),mm:h.precipitation[i],time:t};
    }
  }
  return null;
}

// v4.57: Rain Clock shrunk back to 3 hours (180 minutes), radar-only.
// User explicitly asked: dial should be driven by actual radar and winds
// aloft, not Open-Meteo forecast. The 3-12h forecast overlay introduced in
// v4.46 was too eager to paint forecast arcs even when radar showed nothing,
// AND had a startup timing race where OM hadn't loaded but the dial drew
// anyway. Solution: trim the dial to the radar advection horizon, keep the
// expected-rainfall amount in the center (now a 3-hour total — radar-derived
// when ready, OM fallback otherwise), and leave the 36-hour bar chart below
// to carry the forecast story.
const _RC_TOTAL_MIN=180;
// v4.65: sourced from the shared STORM_MIN_DBZ (15) so the Rain Clock MATCHES
// the Storms-tab cards' floor instead of using its own stricter cutoff (was 25).
// v5.85: the rain-clock floors are now the user-configurable rain floor
// (getRainFloorDbz(), default 25 dBZ), read live at each use site below so a
// Settings change takes effect on the next render. Was a fixed STORM_MIN_DBZ const.
// v4.81: forecast-fallback intensity floor. The forecast dial (shown when NO
// storms are inbound) used to paint any measurable rain (floor ~1 dBZ), so it
// read "raining for hours" even for trace/drizzle. This floor (~28 dBZ ≈
// 0.08 in/hr, light-moderate) hides drizzle while still showing real rain.
// Both rings share the same user rain floor now (getRainFloorDbz()).
// v4.66: intensity-scaled Rain Clock cell radius. Mirrors the Storms-tab cone
// base width clamp((dbz-20)/15,0,3) but with a 0.2 mi floor so even a light
// ~20 dBZ cell has a small but non-zero footprint (~0.2 mi), scaling up to
// ~3 mi for a 60+ dBZ core. Replaces the old flat 1.5 mi radius the dial used
// for every cell regardless of intensity.
function _rcCellRadiusMi(dbz){
  return Math.max(0.2,Math.min(3,(dbz-20)/15));
}
// v4.66: plain-language intensity word for the Rain Clock summary line.
function _rcIntensityWord(dbz){
  if(dbz<30)return'Light';
  if(dbz<40)return'Moderate';
  if(dbz<50)return'Heavy';
  return'Intense';
}
// v4.70: DYNAMIC dial span. The dial used to be a fixed 3-hour (180 min) face,
// so any storm arriving after 3 h was pinned to the edge and several inbound
// cards weren't drawn at their real positions. Now we pick the smallest "nice"
// span (1h…12h) that still contains the furthest inbound storm, so EVERY inbound
// card is drawn where it actually arrives. Buckets are chosen so span/6 (the gap
// between the 6 clock labels) stays a clean number. v5.85: when there's no inbound
// rain, fall back to the FULL 12 h window (was 3 h) so the dial always shows up to
// 12 h of context — with or without rain inbound — per the user's request.
const _RC_SPAN_BUCKETS=[60,120,180,240,360,480,720];
const _RC_IDLE_SPAN=720; // v5.85: idle/empty dial span (12 h). Was _RC_TOTAL_MIN (3 h).
function _rcPickSpan(maxEtaMin){
  if(!(maxEtaMin>0))return _RC_IDLE_SPAN;
  for(const b of _RC_SPAN_BUCKETS){if(maxEtaMin<=b)return b}
  return 720; // cap at 12 h; anything further is pinned to the edge (rare)
}
// v4.70: offset label for a dial position. v4.71: reformatted to read as the
// parenthetical under the wall-clock time, e.g. 0→"now", 30→"+30 min",
// 80→"+1:20 hrs", 120→"+2:00 hrs". Used for the 6 outer clock labels.
function _rcOffLabel(min){
  if(min<=0)return'now';
  if(min<60)return'+'+Math.round(min)+' min';
  const h=Math.floor(min/60),m=Math.round(min%60);
  return '+'+h+':'+String(m).padStart(2,'0')+' hrs';
}
// v4.70: compact span label for the card title, e.g. 60→"1h", 180→"3h",
// 720→"12h", 45→"45m".
function _rcSpanLabel(min){
  if(min<60)return Math.round(min)+'m';
  const h=min/60;
  return (Number.isInteger(h)?h:(Math.round(h*10)/10))+'h';
}
// v5.x: hourly FORECAST rain mapped to dial minutes — shared by the inner
// forecast ring (renderRainClock) and the radar-empty fallback below. Each rainy
// hour -> {start,end} minutes-from-now + an intensity dBZ (mm/hr via Marshall-
// Palmer). Light-moderate+ only, 12 h horizon, current hour included.
function _rcForecastHours(){
  const h=S._hourlyData;
  if(!h||!h.time||!h.precipitation||!h.time.length)return [];
  const nowMs=Date.now();
  const FC_FLOOR_MM=0.1;
  const out=[];
  for(let i=0;i<h.time.length;i++){
    const ts=new Date(h.time[i]).getTime();
    if(isNaN(ts))continue;
    const offMin=(ts-nowMs)/60000;
    if(offMin<-60||offMin>720)continue;
    const mm=h.precipitation[i]||0;
    if(mm<FC_FLOOR_MM)continue;
    const dbz=Math.round(_precipMmToDbz(mm));
    if(dbz<getRainFloorDbz())continue;
    out.push({start:Math.max(0,offMin),end:offMin+60,dbz,mm});
  }
  return out;
}

// v5.x: dial SPAN mode. 'forecast' (default) grows the span so the inner forecast
// ring is always visible; 'radar' keeps the span sized to the nearest radar storm
// (the most readable nowcast). Toggled from the chip in the dial legend.
function _rcSpanMode(){return localStorage.getItem('st_rcSpanMode')||'forecast'}
function _rcToggleSpanMode(){localStorage.setItem('st_rcSpanMode',_rcSpanMode()==='forecast'?'radar':'forecast');if(typeof renderRainClock==='function')renderRainClock()}
if(typeof window!=='undefined')window._rcToggleSpanMode=_rcToggleSpanMode;

function _rainClockProject(){
  const out={ready:false,minutes:new Array(_RC_TOTAL_MIN+1).fill(0),windows:[],
    nearest:null,stale:false,motionUnknown:false,noLoc:false,empty:false,
    forecastReady:false,loading:false,totalMm:0,radarReady:false};
  if(S.lat==null||S.lon==null){out.noLoc=true;return out}
  const hasWeather=!!S._lastWeatherData;
  const pts=S._rawScanPts||[];
  const hasRadar=pts.length>0;
  const h=S._hourlyData;
  const haveHourly=!!(h&&h.time&&h.precipitation&&h.time.length);
  // v4.46: loading state — don't say "all clear" when nothing has loaded yet.
  if(!hasWeather&&!hasRadar&&!haveHourly){out.loading=true;return out}
  const radarStale=hasRadar&&S.scanTime&&(Date.now()-S.scanTime)>15*60000;
  const mv=S.stormMovement;
  const MIN_DBZ=getRainFloorDbz();
  let vx=0,vy=0,haveMv=false;
  if(mv&&mv.speed>1&&mv.direction!=null){
    const th=mv.direction*Math.PI/180;
    vx=mv.speed*Math.sin(th);
    vy=mv.speed*Math.cos(th);
    haveMv=true;
  }
  out.motionUnknown=!haveMv;
  let nearestDist=Infinity,nearestBearing=null;
  for(const p of pts){
    if(p.dbz<MIN_DBZ)continue;
    const d=p.dist!=null?p.dist:haversine(S.lat,S.lon,p.lat,p.lng);
    if(d<nearestDist){nearestDist=d;nearestBearing=bearingDeg(S.lat,S.lon,p.lat,p.lng)}
  }
  if(nearestDist<Infinity&&nearestBearing!=null){out.nearest={mi:nearestDist,dir:degToDir(nearestBearing),brg:nearestBearing}}
  const vMag=Math.sqrt(vx*vx+vy*vy);
  // === v4.68: the Rain Clock dial now mirrors the EXACT inbound storm set the
  // Storms tab shows. Previously this function ran its OWN independent pipeline —
  // it re-clustered the raw radar pixels (S._rawScanPts) with advection + a 2.5 mi
  // spatial hash, which produced a DIFFERENT cell count from the Storms-tab cards
  // (the long-standing "2 inbound on the cards, 3 cells on the clock" mismatch the
  // user reported). Now each cell on the dial IS one inbound storm card. We read
  // the same S._inboundShown list the header pill (core.js) and the Storms-tab
  // cards (storms.js) read, falling back to the unfiltered top-storms list only
  // before the Storms tab has rendered once — so the dial, the pill, and the cards
  // always agree on which storms are inbound and how many there are. The raw scan
  // points are still used above for the "Nearest Precipitation" readout. ===
  const inboundSrc=Array.isArray(S._inboundShown)?S._inboundShown
    :((S._topStormAnalysis&&Array.isArray(S._topStormAnalysis.inbound))?S._topStormAnalysis.inbound
    :(Array.isArray(S._topStorms)?S._topStorms:[]));
  const cellList=[];
  // v4.70: pick the DYNAMIC dial span from the furthest inbound storm's ETA so
  // every inbound card lands at its real arrival position (no more pinning to a
  // fixed 3 h edge). Done in a quick pre-pass before we build the minutes array.
  let _maxEta=0;
  for(const s of inboundSrc){if(!s)continue;const e=s._eta;if(!e||e.eta==null)continue;if(e.eta>_maxEta)_maxEta=e.eta}
  // v5.x: the dial now carries a second (inner) FORECAST ring that must stay
  // visible, so grow the span to also cover the furthest rainy forecast hour
  // (capped at the same 12 h horizon as radar). Computed once and reused below.
  const _fcHrs=_rcForecastHours();
  let _maxFcMin=0;
  for(const f of _fcHrs){if(f.end>_maxFcMin)_maxFcMin=f.end}
  const _spanMode=(typeof _rcSpanMode==='function')?_rcSpanMode():'forecast';
  const span=_rcPickSpan(Math.min(720,_spanMode==='radar'?_maxEta:Math.max(_maxEta,_maxFcMin)));
  out.span=span;
  out.minutes=new Array(span+1).fill(0);
  // v4.68: build cells from the inbound set regardless of radar staleness. The
  // old pipeline skipped stale radar because advecting stale raw PIXELS would be
  // wrong — but we now mirror the storm CARDS, which keep showing their inbound
  // storms (with ETAs) even when the scan is stale. Suppressing the dial here
  // would make it show 0 cells while the cards/header still show inbound storms —
  // exactly the desync this task exists to eliminate. `out.stale` still drives
  // the source tag / messaging; it just no longer drops cells.
  for(const s of inboundSrc){
    if(!s)continue;
    const e=s._eta;
    if(!e||e.eta==null)continue;
    // Arrival minute = the SAME ETA the storm card shows. Clamp into the dial's
    // dynamic 0–span span: an overhead/now cell sits at 0; a card whose ETA is
    // beyond the (up to 12 h) horizon is pinned to the dial edge so it is still
    // COUNTED (one card = one cell, always) without overshooting the dial.
    let centerMin=e.eta-radarAgeMin();
    if(centerMin<0)centerMin=0;
    const beyond=centerMin>span;
    if(beyond)centerMin=span;
    // v4.66 cell radius (intensity-scaled) and pass-duration model, retained:
    // duration over the user is the cell DIAMETER divided by storm speed, centered
    // on the arrival minute — only the SOURCE of the cell changed (card, not pixel).
    const baseR=_rcCellRadiusMi(s.dbz);
    const spd=vMag>0.1?vMag:((e.closingSpeed&&e.closingSpeed>0)?e.closingSpeed:0);
    const passMin=spd>0.1?Math.max(2,(2*baseR)/spd*60):6;
    let tIn,tOut;
    if(centerMin<=0){tIn=0;tOut=Math.min(span,Math.max(1,Math.ceil(passMin)))}
    else{tIn=Math.max(0,Math.floor(centerMin-passMin/2));tOut=Math.min(span,Math.ceil(centerMin+passMin/2))}
    if(tOut<tIn)tOut=tIn;
    for(let t=tIn;t<=tOut;t++){if(s.dbz>out.minutes[t])out.minutes[t]=s.dbz}
    cellList.push({lat:s.lat,lng:s.lng,dbz:s.dbz,dist:s.distance,bearing:s.bearing,tIn,tOut,centerMin,beyond,count:s.pixels||1});
  }
  if(hasRadar&&!radarStale)out.radarReady=true;
  if(radarStale)out.stale=true;
  // v4.56: compute radar-derived per-hour mm/hr for hours 0-2 BEFORE the
  // forecast overlay writes anything. The bar chart reads this so the first
  // 3 hours on BOTH views (clock + bars) come from real radar observations,
  // not forecast models. Per-minute dBZ is converted back to mm/hr via the
  // inverse Marshall-Palmer (Z=200*R^1.6), then averaged across the hour
  // (rain only falls during minutes where a cell is overhead, so dividing by
  // 60 gives the integrated hourly rate).
  // v4.70: integrate over the dynamic span (was a hard-coded 3 hours). Only the
  // dial's own center "expected" amount reads this now — the 36 h bar chart was
  // decoupled in v4.69 — so summing the full span gives the rain expected across
  // whatever horizon the dial is currently showing.
  const _nHours=Math.max(1,Math.ceil(span/60));
  out.radarHourlyMm=new Array(_nHours).fill(0);
  if(out.radarReady){
    for(let hr=0;hr<_nHours;hr++){
      let sumMmHr=0;
      for(let m=hr*60;m<=Math.min((hr+1)*60-1,span);m++){
        const dbz=out.minutes[m];
        if(dbz>0){
          const z=Math.pow(10,dbz/10);
          sumMmHr+=Math.pow(z/200,1/1.6);
        }
      }
      out.radarHourlyMm[hr]=sumMmHr/60;
    }
  }
  // v4.57: forecast overlay no longer writes onto the dial — the dial is
  // radar-only now. We still walk the hourly forecast to compute the
  // expected-rainfall amount shown in the center, used ONLY as a fallback
  // when radar isn't ready yet (radarHourlyMm sum wins when available).
  let _fcstFirst3hMm=0;
  if(haveHourly){
    const nowMs=Date.now();
    for(let i=0;i<h.time.length;i++){
      const ts=new Date(h.time[i]).getTime();
      if(isNaN(ts))continue;
      const mins=(ts-nowMs)/60000;
      if(mins>span)continue;
      if(mins<-30)continue;
      const mm=h.precipitation[i]||0;
      if(mm>0)_fcstFirst3hMm+=mm;
    }
    out.forecastReady=true;
  }
  // v4.57: totalMm reflects expected rainfall in the next 3 hours.
  // Prefer the radar-derived per-hour mm/hr sum (real observed cells crossing
  // the user's location); fall back to the forecast model only when radar
  // isn't ready or shows nothing. This matches the user's ask: dial driven by
  // actual radar/winds aloft, not Open-Meteo.
  const _radarSum=(out.radarHourlyMm||[]).reduce((a,b)=>a+(b||0),0);
  out.totalMm=_radarSum>0.01?_radarSum:_fcstFirst3hMm;
  // Windows builder uses 25 dBZ start threshold — the dial is radar-only now
  // (forecast overlay removed), so we go back to the strict radar-noise floor.
  const _WIN_MIN=getRainFloorDbz();
  let cur=null;
  for(let t=0;t<=span;t++){
    const v=out.minutes[t];
    if(v>=_WIN_MIN){
      if(!cur)cur={startMin:t,endMin:t,peakDbz:v};
      else{cur.endMin=t;if(v>cur.peakDbz)cur.peakDbz=v}
    }else if(cur){out.windows.push(cur);cur=null}
  }
  if(cur)out.windows.push(cur);
  // === v4.74: RAINING-NOW-OVER-THE-USER window. Overhead/proximity storm cells
  // carry a null ETA, so the inbound loop above SKIPS them — that's the root cause
  // of the dial reading "Rain starting at <future>" while radar shows rain right
  // on top of you. Reuse the SAME dBZ-at-user signal the conditions card uses
  // (rainOverUserNow) so the clock and the conditions ☔ can never disagree, and
  // when it fires anchor a cell + window at minute 0 → the summary's startMin===0
  // branch reads "Raining now / Rain until …" instead of a future start time. ===
  const nowRain=(typeof rainOverUserNow==='function')?rainOverUserNow():null;
  out.rainingNow=!!nowRain;
  if(nowRain){
    // v5.47 (Phase 4): the hex-grid oracle (rainOverUserNow → dbzAtLocation) is
    // the ONLY source of the minute-0 INTENSITY, so the clock's now band always
    // equals the hero card and the overhead-alert dBZ — three surfaces, one
    // number. The best overhead storm cell is kept ONLY for motion (pass-duration
    // speed) and position/pixels of the now-cell dot; its clustered dBZ no longer
    // raises the intensity above what radar shows on the user's exact spot.
    const ovList=(S._topStormAnalysis&&Array.isArray(S._topStormAnalysis.overhead))?S._topStormAnalysis.overhead:[];
    let ovStorm=null;
    for(const s of ovList){if(s&&(!ovStorm||(s.dbz||0)>(ovStorm.dbz||0)))ovStorm=s}
    const nowDbz=nowRain.maxDbz||0;
    if(nowDbz>0){
      // Duration over the user = cell DIAMETER / storm speed (same model as the
      // inbound loop). Default to 6 min when motion is unknown / the cell is stalled.
      const baseR=_rcCellRadiusMi(nowDbz);
      const _ovEta=ovStorm&&ovStorm._eta?ovStorm._eta:null;
      const spd=vMag>0.1?vMag:((_ovEta&&_ovEta.closingSpeed>0)?_ovEta.closingSpeed:0);
      const passMin=spd>0.1?Math.max(2,(2*baseR)/spd*60):6;
      const tOut=Math.min(span,Math.max(1,Math.ceil(passMin)));
      for(let t=0;t<=tOut;t++){if(nowDbz>out.minutes[t])out.minutes[t]=nowDbz}
      // Ensure a window COVERS minute 0 so this becomes windows[0] (the summary's
      // "Rain until …" branch). Without this, a sub-floor now-cell would otherwise
      // attach to the nearest FUTURE window and the dial would mis-report the start.
      let nowWin=out.windows.find(w=>w.startMin<=0&&w.endMin>=0);
      if(!nowWin){nowWin={startMin:0,endMin:tOut,peakDbz:nowDbz};out.windows.push(nowWin)}
      else{if(tOut>nowWin.endMin)nowWin.endMin=tOut;if(nowDbz>nowWin.peakDbz)nowWin.peakDbz=nowDbz}
      // Add a now-cell unless an inbound cell already sits at minute 0 (avoid a
      // double count — the cell list total must still equal the inbound card count).
      if(!cellList.some(c=>c.centerMin<=0)){
        cellList.push({lat:ovStorm?ovStorm.lat:S.lat,lng:ovStorm?ovStorm.lng:S.lon,dbz:nowDbz,dist:ovStorm?(ovStorm.distance||0):0,bearing:ovStorm?(ovStorm.bearing||0):0,tIn:0,tOut,centerMin:0,beyond:false,count:ovStorm?(ovStorm.pixels||1):1,now:true});
      }
      // The now-window can overlap a future window that starts within its pass
      // (e.g. an inbound cell painted minutes a few minutes out). Merge any
      // OVERLAPPING windows so one continuous rain period stays a single window
      // with the correct end time. Only true overlaps merge — distinct forecast
      // windows separated by a sub-floor gap (startMin > prev endMin) are kept.
      if(out.windows.length>1){
        out.windows.sort((a,b)=>a.startMin-b.startMin);
        const merged=[out.windows[0]];
        for(let i=1;i<out.windows.length;i++){
          const w=out.windows[i],last=merged[merged.length-1];
          if(w.startMin<=last.endMin){
            if(w.endMin>last.endMin)last.endMin=w.endMin;
            if(w.peakDbz>last.peakDbz)last.peakDbz=w.peakDbz;
          }else merged.push(w);
        }
        out.windows=merged;
      }
    }
  }
  // v4.68: assign each inbound storm-cell to exactly ONE window — the window whose
  // time span contains the cell's arrival minute. Because every cell is placed
  // exactly once and NEVER capped (the old code did clusters.slice(0,5), which
  // could undercount), the total number of cells across all windows always equals
  // the number of inbound storm cards. That equality is the whole point of this
  // change: tap-tooltips, the detail list, and the cards can never disagree again.
  for(const w of out.windows)w.cells=[];
  for(const c of cellList){
    let target=null;
    for(const w of out.windows){
      if(c.centerMin>=w.startMin&&c.centerMin<=w.endMin){target=w;break}
    }
    if(!target){
      // Rounding can leave a cell's arrival just outside its painted run — attach
      // it to the nearest window by time so it is never silently dropped.
      let bestD=Infinity;
      for(const w of out.windows){
        const d=Math.min(Math.abs(c.centerMin-w.startMin),Math.abs(c.centerMin-w.endMin));
        if(d<bestD){bestD=d;target=w}
      }
    }
    if(!target){
      // No window exists yet (its minutes fell below the paint floor) — create one
      // so the cell still counts toward the total the user sees.
      target={startMin:c.tIn,endMin:c.tOut,peakDbz:c.dbz,cells:[]};
      out.windows.push(target);
    }
    target.cells.push(c);
    if(c.dbz>target.peakDbz)target.peakDbz=c.dbz;
  }
  // Keep windows chronological (a fallback window may have been appended) and show
  // the strongest cell first inside each window's detail list.
  out.windows.sort((a,b)=>a.startMin-b.startMin);
  for(const w of out.windows)w.cells.sort((a,b)=>b.dbz-a.dbz);
  // === v4.80: FORECAST FALLBACK. The dial above is built purely from the live
  // radar / inbound-storm pipeline. When that produced NOTHING (no windows, no
  // cells, not raining now) we fall back to the hourly precipitation FORECAST —
  // the same data behind the "Total Precipitation Next 36 Hrs" chart — instead of
  // the empty "No rain expected" face. Each rainy forecast hour's mm/hr is
  // converted to dBZ (Marshall-Palmer, _precipMmToDbz) and plotted on the dial
  // with a one-hour duration, so expected rain reads like a real storm (windows,
  // arcs, tap-details, center summary). Strictly a fallback: it never runs when
  // the radar path drew anything, so live storms always win. Forecast wins are
  // tagged out.forecast so the renderer can label them "FORECAST" and word the
  // summary as a forecast rather than a live-radar nowcast.
  if(!out.windows.length&&!out.rainingNow&&cellList.length===0&&haveHourly){
    const nowMs=Date.now();
    const FC_FLOOR_MM=0.1; // measurable rain in the hour; below this is trace/noise
    const fcHours=[];
    let fcMaxMin=0;
    for(let i=0;i<h.time.length;i++){
      const ts=new Date(h.time[i]).getTime();
      if(isNaN(ts))continue;
      const offMin=(ts-nowMs)/60000; // minutes from now to the START of this hour
      if(offMin<-60)continue;        // skip fully-past hours (allow the current hour)
      if(offMin>720)continue;        // 12 h horizon cap (same as the storm span cap)
      const mm=h.precipitation[i]||0;// mm accumulated in this hour == mm/hr
      if(mm<FC_FLOOR_MM)continue;
      const dbz=Math.round(_precipMmToDbz(mm));
      if(dbz<getRainFloorDbz())continue; // v4.81: only light-moderate+ forecast rain
      const start=Math.max(0,offMin);
      fcHours.push({start,end:offMin+60,dbz,mm});
      if(offMin+60>fcMaxMin)fcMaxMin=offMin+60;
    }
    if(fcHours.length){
      // Re-pick the dial span to cover the furthest rainy forecast hour, then
      // repaint the minutes array over that span (it was sized for the empty
      // 3 h default above).
      const fspan=_rcPickSpan(Math.min(720,fcMaxMin));
      out.span=fspan;
      // v5.52: keep out.minutes as the RADAR layer (empty here) — the forecast is
      // drawn on the INNER ring (out.fcMinutes), never promoted to the solid outer
      // ring. Resize the (empty) radar array; build the center-summary windows from
      // a LOCAL forecast array so the wording/tap-details still work.
      out.minutes=new Array(fspan+1).fill(0);
      const fmins=new Array(fspan+1).fill(0);
      for(const f of fcHours){
        const tIn=Math.max(0,Math.floor(f.start));
        const tOut=Math.min(fspan,Math.ceil(f.end));
        for(let t=tIn;t<=tOut;t++){if(f.dbz>fmins[t])fmins[t]=f.dbz}
      }
      const fwins=[];
      let fc=null;
      for(let t=0;t<=fspan;t++){
        const v=fmins[t];
        if(v>=getRainFloorDbz()){if(!fc)fc={startMin:t,endMin:t,peakDbz:v};else{fc.endMin=t;if(v>fc.peakDbz)fc.peakDbz=v}}
        else if(fc){fwins.push(fc);fc=null}
      }
      if(fc)fwins.push(fc);
      // One synthetic forecast cell per window (anchored at the user's location)
      // so the tap-detail + cell-count UX work exactly like the radar windows.
      for(const w of fwins){
        w.cells=[{lat:S.lat,lng:S.lon,dbz:w.peakDbz,dist:0,bearing:0,
          tIn:w.startMin,tOut:w.endMin,centerMin:Math.round((w.startMin+w.endMin)/2),
          beyond:false,count:1,forecast:true}];
      }
      out.windows=fwins;
      out.forecast=true; // dial is forecast-sourced; renderer labels & words accordingly
      // Center "expected rain" amount = sum of forecast mm across the shown span.
      let fcTotal=0;
      for(const f of fcHours){if(f.start<=fspan)fcTotal+=f.mm}
      out.totalMm=fcTotal;
    }
  }
  // v5.x: inner-ring FORECAST minutes (predicted rain timing), computed from the
  // hourly forecast over the dial's current span so the dial can show forecast
  // timing on an INNER ring beside the outer radar ring. fcReady is false when the
  // dial itself already fell back to forecast (out.forecast) — one ring is enough.
  const _fcSpan=out.span||_RC_TOTAL_MIN;
  out.fcMinutes=new Array(_fcSpan+1).fill(0);
  const _fcH=_fcHrs;
  out.fcReady=_fcH.length>0;   // inner forecast ring shows whenever forecast rain exists (radar present OR fallback)
  for(const f of _fcH){
    const tIn=Math.max(0,Math.floor(f.start));
    const tOut=Math.min(_fcSpan,Math.ceil(f.end));
    for(let t=tIn;t<=tOut;t++){if(f.dbz>out.fcMinutes[t])out.fcMinutes[t]=f.dbz}
  }
  // === v5.82: hold the dial blank until storm MOTION is known. On first load a
  // quick pre-winds-aloft scan can drop a transient echo inside the user's ~1.5 mi
  // hex (the rainOverUserNow oracle → "rain right over you · 1 mi ENE") that the
  // NEXT scan corrects to the real cell (e.g. "2 mi S") once the winds-aloft
  // steering (S.stormMovement) resolves. Rather than paint that walk-back, suppress
  // the radar projection (arcs, nearest, summary) while motion is still pending and
  // show a "determining storm motion" state instead — this is exactly the ask:
  // nothing until the scan finishes WITH a movement direction. Bounded by the SAME
  // 30 s budget ensureWindsAloft uses (+2 s slack) so a winds-aloft OUTAGE can't
  // freeze the dial — after that we fall back to the (honestly footnoted)
  // projection. Motion is cached ~30 min, so this only bites the initial load and
  // right after a location change (both reset S.stormMovement). Forecast-only dials
  // (no radar yet) are NOT gated — they don't depend on motion and are already
  // labelled as forecast. ===
  const _motionKnown=(S.stormMovement!=null);
  const _radarRain=out.radarReady&&(out.rainingNow||out.nearest!=null||out.windows.length>0);
  if(_radarRain&&!_motionKnown){if(S._rcAwaitSince==null)S._rcAwaitSince=Date.now();}
  else S._rcAwaitSince=null;
  out.awaitingMotion=(S._rcAwaitSince!=null)&&((Date.now()-S._rcAwaitSince)<32000);
  if(out.awaitingMotion){
    const _z=(out.span||_RC_TOTAL_MIN)+1;
    out.windows=[];out.minutes=new Array(_z).fill(0);out.fcMinutes=new Array(_z).fill(0);
    out.fcReady=false;out.nearest=null;out.rainingNow=false;out.totalMm=0;out.forecast=false;
  }
  out.ready=true;
  return out;
}

// v4.46: Rain Clock redesigned as a 12-hour analog face with dynamic outer
// wall-clock labels (one per hour position, recomputed every minute), and
// per-minute gradient arc segments that blend colors along each rain window
// instead of painting one flat color per window.
function renderRainClock(){
  const el=document.getElementById('rain-clock');
  if(!el)return;
  const data=_rainClockProject();
  S._rainClockData=data;
  // v5.82: while holding for storm motion, poll a re-render so the dial lifts the
  // hold the instant winds-aloft/motion resolves (or the grace window elapses),
  // even if no scan fires in between. Self-cancels once we're no longer waiting.
  if(data.awaitingMotion){if(!S._rcAwaitTimer)S._rcAwaitTimer=setTimeout(()=>{S._rcAwaitTimer=null;try{renderRainClock()}catch(e){}},2000);}
  else if(S._rcAwaitTimer){clearTimeout(S._rcAwaitTimer);S._rcAwaitTimer=null;}
  // v4.48 geometry rework: dial canvas grew from 320 to 360 so the hour
  // labels can live OUTSIDE the dial circle (between R_OUTER and the viewBox
  // edge) instead of competing with the rain arc on the dial face. The arc
  // also moved OUT to sit just inside the outer rim, between the tick ring
  // and the dial edge — much larger and easier to read on a phone.
  const SIZE=360,CX=180,CY=180;
  const R_OUTER=132,R_TICK_OUT=108,R_TICK_IN=96;
  const R_LABEL=154,R_ARC=122,R_ARC_W=18;
  // v4.70: TOTAL is now the DYNAMIC span chosen in _rainClockProject (1h–12h),
  // not a fixed 180. All angle math below scales to it automatically.
  const TOTAL=(data&&data.span)?data.span:_RC_TOTAL_MIN;
  // v4.70: human-friendly span strings for the title / center / text view.
  const _spanLabel=_rcSpanLabel(TOTAL);
  const _spanH=Math.round(TOTAL/60);
  const _spanWord='next '+(TOTAL<60?(Math.round(TOTAL)+' min'):(_spanH+' hour'+(_spanH!==1?'s':'')));
  const now=Date.now();
  const nowD=new Date(now);
  function ang(min){return (min/TOTAL)*2*Math.PI-Math.PI/2}
  function ptAt(min,r){const a=ang(min);return [CX+r*Math.cos(a),CY+r*Math.sin(a)]}
  // v4.57: 120 minor ticks (every 1.5 min on a 180-min dial), major every
  // 30 min (every 20th tick) so the major ticks align with the 6 hour labels.
  let ticks='';
  for(let i=0;i<120;i++){
    const a=(i/120)*2*Math.PI-Math.PI/2;
    const major=i%20===0;
    const r1=major?R_TICK_IN-3:R_TICK_IN+4;
    const r2=R_TICK_OUT;
    ticks+=`<line x1="${(CX+r1*Math.cos(a)).toFixed(1)}" y1="${(CY+r1*Math.sin(a)).toFixed(1)}" x2="${(CX+r2*Math.cos(a)).toFixed(1)}" y2="${(CY+r2*Math.sin(a)).toFixed(1)}" stroke="${major?'#9fb3c8':'#3a4a5e'}" stroke-width="${major?2:1}"/>`;
  }
  // v4.47: ONE combined label per hour position — stacked two-line text inside
  // a single <text> element. Top line = offset ("Now" / "+1h" / ... / "+11h").
  // Bottom line = dynamic wall-clock time, refreshed every 60s by
  // _rainClockStartTick(). The time tspan carries data-rc-outer so the tick
  // can find and update only the time, leaving the offset untouched.
  // v4.57: 6 labels at 30-minute intervals around the 3-hour dial:
  // Now / +30m / +1h / +1h30m / +2h / +2h30m. Top line is the offset (static),
  // bottom line is the live wall-clock time (refreshed every 60s by the tick).
  // v4.70: 6 labels spaced span/6 apart (e.g. 30 min on a 3 h dial, 2 h on a 12 h
  // dial). The offset text is computed from the live span via _rcOffLabel, and the
  // wall-clock tspan carries data-rc-min (the offset in minutes) so the per-minute
  // tick can refresh the time for ANY span — the old data-rc-outer assumed a fixed
  // hourly step and drifted once the span stopped being 6×60.
  let hourLabels='';
  const _step=TOTAL/6;
  for(let i=0;i<6;i++){
    const offMin=i*_step;
    const [x,y]=ptAt(offMin,R_LABEL);
    // v4.71: wall-clock ETA is now the primary (top) line and the offset is the
    // parenthetical underneath, e.g. "1422" over "(+1:20 hrs)". data-rc-min stays
    // on the TIME tspan so the per-minute tick keeps refreshing the right line.
    const off=_rcOffLabel(offMin);
    const tStr=fmtClock(new Date(now+offMin*60000));
    hourLabels+=`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">`
      +`<tspan x="${x.toFixed(1)}" dy="-6" fill="#e6edf3" font-size="11" font-weight="700" data-rc-min="${offMin.toFixed(2)}">${tStr}</tspan>`
      +`<tspan x="${x.toFixed(1)}" dy="13" fill="#9fb3c8" font-size="9" font-weight="600">(${off})</tspan>`
      +`</text>`;
  }
  // Per-minute gradient arc segments — each minute where dBZ ≥ 25 paints a
  // tiny colored chord at that angular position, so colors blend along the
  // arc instead of being flat per-window.
  // v5.52: TWO rings, always the same layout — OUTER = live radar (solid),
  // INNER = hourly forecast (dashed). Kept on SEPARATE rings so radar and forecast
  // never overlap/conflict at the same time slot. The forecast ALSO stays on the
  // inner ring when radar is empty (the fallback no longer promotes it to a solid
  // outer ring), so it never appears to jump between rings as radar loads/clears.
  let arcs='';
  let segHandlers='';
  if(data.ready){
    // faint full-circle track
    arcs+=`<circle cx="${CX}" cy="${CY}" r="${R_ARC}" stroke="rgba(80,140,200,0.10)" stroke-width="${R_ARC_W}" fill="none"/>`;
    // OUTER: live radar only (solid per-minute segments). Empty in forecast fallback,
    // where data.minutes holds no radar — the forecast is on the inner ring instead.
    for(let m=0;m<TOTAL;m++){
      const v=data.minutes[m];
      if(v<getRainFloorDbz())continue;
      const [x0,y0]=ptAt(m,R_ARC);
      const [x1,y1]=ptAt(m+1,R_ARC);
      const col=(typeof dbzHex==='function')?dbzHex(v):'#39ff14';
      arcs+=`<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="${col}" stroke-width="${R_ARC_W}" stroke-linecap="butt" opacity="0.95"/>`;
    }
    // Invisible clickable overlay arc per window (for the tap-to-see-cells UX)
    data.windows.forEach((w,wi)=>{
      if(!w.cells||!w.cells.length)return;
      const s=Math.max(0,w.startMin),e=Math.min(TOTAL,Math.max(w.startMin+1,w.endMin));
      if(e<=s)return;
      const [x0,y0]=ptAt(s,R_ARC);
      const [x1,y1]=ptAt(e,R_ARC);
      const large=((e-s)/TOTAL)>0.5?1:0;
      segHandlers+=`<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R_ARC} ${R_ARC} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="rgba(0,0,0,0.001)" stroke-width="${R_ARC_W+10}" fill="none" stroke-linecap="butt" style="cursor:pointer" onclick="_rainClockSelectWindow(${wi})"><title>Tap for details · ${w.cells.length} cell${w.cells.length!==1?'s':''}</title></path>`;
    });
  }
  // INNER forecast ring — dashed, coloured by peak dBZ. Shown whenever there's
  // forecast rain (INCLUDING the radar-empty fallback), so the forecast is always
  // the inner ring and never moves out to the radar ring.
  let fcArcs='';
  const R_ARC_IN=80, R_ARC_IN_W=9;
  if(data.ready&&data.fcReady&&data.fcMinutes){
    const fm=data.fcMinutes;
    const flush=(a,b)=>{
      let peak=0;for(let t=a;t<=b;t++)if(fm[t]>peak)peak=fm[t];
      const e=Math.min(TOTAL,b+1);
      const [x0,y0]=ptAt(a,R_ARC_IN);
      const [x1,y1]=ptAt(e,R_ARC_IN);
      const large=(((e-a)/TOTAL)>0.5)?1:0;
      const col=(typeof dbzHex==='function')?dbzHex(peak):'#39ff14';
      fcArcs+=`<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R_ARC_IN} ${R_ARC_IN} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${col}" stroke-width="${R_ARC_IN_W}" fill="none" stroke-linecap="butt" stroke-dasharray="5 4" opacity="0.55"/>`;
    };
    let a=null;
    for(let m=0;m<=TOTAL;m++){
      if(fm[m]>=getRainFloorDbz()){if(a==null)a=m}
      else if(a!=null){flush(a,m-1);a=null}
    }
    if(a!=null)flush(a,TOTAL);
  }
  // Center text: status + optional total rain estimate
  // v4.49: text view (toggled by tapping the dial center) builds richer
  // friendly phrasings for the first two rain windows — start/end times,
  // duration, and the next round if any. Computed here so both the dial
  // center summary and the text view stay in lock-step.
  const _omPart=S._lastWeatherData&&S._lastWeatherData._omPartial;
  const _fmtDur=(min)=>{
    if(min<60)return Math.max(1,Math.round(min))+' min';
    const h=Math.floor(min/60),m=Math.round(min%60);
    return m===0?h+' h':h+' h '+m+' min';
  };
  const _phrases=[];
  let centerLines=[];
  if(data.noLoc){centerLines=['Location','needed'];_phrases.push({title:'Location needed',body:'Allow location access or pick a spot manually so the Rain Clock can pull forecast and radar for you.'});}
  else if(data.loading){centerLines=['Loading','rain forecast…'];_phrases.push({title:'Loading…',body:'Pulling forecast and radar — give it a few seconds.'});}
  else if(data.awaitingMotion){centerLines=['Scanning…','storm motion'];_phrases.push({title:'Determining storm motion',body:'Holding the projection until the scan resolves which way the storms are moving — so a nearby echo isn\'t shown as if it were right over you, then corrected a moment later.'});}
  else if(!data.windows.length){
    if(_omPart){centerLines=['Waiting on','Open-Meteo…'];_phrases.push({title:'Waiting on Open-Meteo',body:'Forecast service is slow or unreachable right now. The Rain Clock will fill in as soon as data arrives.'});}
    else if(data.stale&&!data.forecastReady){centerLines=['Radar stale','run a scan'];_phrases.push({title:'Radar is stale',body:'Run a fresh scan to update the Rain Clock with the latest radar.'});}
    else{centerLines=['No rain expected',_spanWord];_phrases.push({title:'No rain expected',body:`Nothing showing up on radar for the ${_spanWord}. Disclaimer: radar can sometimes be delayed or miss certain conditions (like light drizzle or mist). If you're seeing or feeling it but it's not on here — congratulations, you beat the radar to it! 🤣`});}
  } else {
    const w=data.windows[0];
    const w2=data.windows[1];
    const startStr=fmtClock(new Date(now+w.startMin*60000));
    const endStr=fmtClock(new Date(now+w.endMin*60000));
    // v4.67: plain-language summary built from the dominant cell's intensity
    // (peak dBZ → Light/Moderate/Heavy/Intense) plus arrival/end times in the
    // app's single chosen clock format (12h or 24h, via fmtClock — startStr/endStr
    // above), and a duration that reflects the cell DIAMETER passing overhead at
    // the storm's speed (computed in _rainClockProject).
    const peak=w.peakDbz;
    const word=_rcIntensityWord(peak);
    if(data.forecast){
      // v4.80: forecast-sourced summary — no live radar rain, plotted from the
      // hourly precipitation forecast. Worded as a forecast (not a nowcast) so
      // the user knows the dial is showing expected, not observed, rain.
      const fcNote=' (From the hourly forecast — no storms on radar yet.)';
      if(w.startMin===0){
        centerLines=['Rain forecast','until '+endStr];
        const dur=Math.max(1,w.endMin);
        const head={title:`${word} rain forecast · ~${peak} dBZ`,
          body:`Forecast shows ${word.toLowerCase()} rain this hour, easing around ${endStr} — about ${_fmtDur(dur)}.${fcNote}`};
        if(w2){const w2start=fmtClock(new Date(now+w2.startMin*60000));const w2dur=Math.max(1,w2.endMin-w2.startMin);head.body+=` Next round forecast around ${w2start} (~${_fmtDur(w2dur)}).`}
        _phrases.push(head);
      } else {
        centerLines=['Rain forecast at',startStr];
        const inMin=Math.max(1,Math.round(w.startMin));
        const dur=Math.max(1,w.endMin-w.startMin);
        const head={title:`${word} rain forecast in ${_fmtDur(inMin)}`,
          body:`Forecast shows ${word.toLowerCase()} rain (~${peak} dBZ) starting around ${startStr}, lasting about ${_fmtDur(dur)} (until ${endStr}).${fcNote}`};
        if(w2){const w2start=fmtClock(new Date(now+w2.startMin*60000));const w2dur=Math.max(1,w2.endMin-w2.startMin);head.body+=` Then more forecast around ${w2start} (~${_fmtDur(w2dur)}).`}
        _phrases.push(head);
      }
    } else if(w.startMin===0){
      centerLines=['Rain until',endStr];
      const dur=Math.max(1,w.endMin);
      const head={title:`${word} rain @ ${peak} dBZ overhead`,
        body:`A ${word.toLowerCase()} rain cell @ ${peak} dBZ is overhead now, ending around ${endStr} — about ${_fmtDur(dur)} more.`};
      if(w2){
        const w2start=fmtClock(new Date(now+w2.startMin*60000));
        const w2dur=Math.max(1,w2.endMin-w2.startMin);
        head.body+=` Next round starts around ${w2start} (~${_fmtDur(w2dur)}).`;
      }
      _phrases.push(head);
    } else {
      centerLines=['Rain starting at',startStr];
      const inMin=Math.max(1,Math.round(w.startMin));
      const dur=Math.max(1,w.endMin-w.startMin);
      const head={title:`${word} rain @ ${peak} dBZ in ${_fmtDur(inMin)}`,
        body:`A ${word.toLowerCase()} rain cell @ ${peak} dBZ arriving around ${startStr}, ending about ${_fmtDur(dur)} later (around ${endStr}).`};
      if(w2){
        const w2start=fmtClock(new Date(now+w2.startMin*60000));
        const w2dur=Math.max(1,w2.endMin-w2.startMin);
        head.body+=` Then a second round around ${w2start} (~${_fmtDur(w2dur)}).`;
      }
      _phrases.push(head);
    }
  }
  // v4.57: rain amount estimate over the next 3 hours (radar-preferred,
  // forecast fallback). See totalMm assignment above.
  // v4.58: suppress the amount line when the dial has no rain windows AND
  // the amount came from the forecast fallback — otherwise the card reads
  // "No rain on radar" right next to "~0.06 in expected", which is the
  // confusing contradiction the user reported.
  let amountLine='';
  const _amtFromRadar=(data.radarHourlyMm||[]).reduce((a,b)=>a+(b||0),0)>0.01;
  const _hasWindows=data.windows&&data.windows.length;
  if(data.totalMm>0.05 && (_amtFromRadar||_hasWindows)){
    let amtTxt;
    if(typeof fmtPrecip==='function'){amtTxt=fmtPrecip(data.totalMm)}
    else{const inches=data.totalMm/25.4;amtTxt=inches<0.1?data.totalMm.toFixed(1)+' mm':inches.toFixed(2)+' in'}
    // v6.16: state the HORIZON so this short-range figure doesn't look like it
    // contradicts the 48 h Total Precipitation graph (heavier rain can arrive
    // beyond the dial's ≤12 h window — that rain lives on the 48 h graph, not here).
    amountLine=`~${amtTxt} · next ${(typeof _rcSpanLabel==='function')?_rcSpanLabel(data.span||720):'12h'}`;
  }
  let center='';
  const totalLines=centerLines.length+(amountLine?1:0);
  const cy0=CY-((totalLines-1)*9);
  centerLines.forEach((line,i)=>{
    const fs=i===0?13:17;
    const fw=i===0?600:700;
    const col=i===0?'#9fb3c8':'#e6edf3';
    center+=`<text x="${CX}" y="${(cy0+i*19).toFixed(1)}" fill="${col}" font-size="${fs}" font-weight="${fw}" text-anchor="middle" dominant-baseline="middle">${line}</text>`;
  });
  if(amountLine){
    center+=`<text x="${CX}" y="${(cy0+centerLines.length*19+2).toFixed(1)}" fill="#5eead4" font-size="11" font-weight="600" text-anchor="middle" dominant-baseline="middle">${amountLine}</text>`;
  }
  // "Now" pointer — small triangle at the top tick
  const nowPointer=`<polygon points="${CX},${CY-R_OUTER+2} ${CX-5},${CY-R_OUTER+10} ${CX+5},${CY-R_OUTER+10}" fill="#fbbf24"/>`;
  // v4.57: boundary marker removed — the 3-hour position is now the top of
  // the dial (same place as "Now"), so a marker there would be redundant.
  const boundary='';
  // Sub + footer
  let sub='';
  if(data.nearest){
    const dStr=S.radarMetric?(data.nearest.mi*1.609).toFixed(0)+' km':data.nearest.mi.toFixed(0)+' mi';
    // v5.44: when the dial is empty but rain exists in range, estimate how far
    // out it is at the current storm speed — an empty 3H dial with storms on
    // radar 50 mi away otherwise reads like a bug (rain is simply >3 hrs out).
    // Honesty gate: only show the estimate when the fleet movement actually
    // points from the precip TOWARD the user (cos of the angle between the
    // movement heading and the precip→user bearing > 0.3, i.e. within ~72°);
    // otherwise the rain is sliding past or receding and no ETA is honest.
    let etaTxt='';
    if(!(data.windows&&data.windows.length)&&data.nearest.brg!=null){
      const _mv=(typeof getSteeringMv==='function')?getSteeringMv():null;
      if(_mv&&_mv.speed>=2){
        const _toUser=(data.nearest.brg+180)%360;
        const _cos=Math.cos((_mv.direction-_toUser)*Math.PI/180);
        if(_cos>0.3){
          const _h=data.nearest.mi/(_mv.speed*_cos);
          if(_h>0.1){
            const _t=_h<1?Math.round(_h*60)+' min':(Math.round(_h*10)/10)+' hrs';
            etaTxt=` · ≈ ${_t} out at current storm speed`;
          }
        }else if(_cos<-0.3){
          etaTxt=' · moving away';
        }
      }
    }
    sub=`<div style="font-size:0.7em;color:var(--text-secondary);text-align:center;margin-top:6px"><span style="color:var(--text-muted)">Nearest Precipitation:</span> <strong>${dStr}</strong> to the ${data.nearest.dir}${etaTxt}</div>`;
  }
  let foot='';
  if(data.motionUnknown&&data.radarReady&&!data.awaitingMotion){
    foot=`<div style="font-size:0.6em;color:var(--text-muted);text-align:center;margin-top:4px;font-style:italic">Motion unknown — radar projection limited</div>`;
  }
  const hasClickable=data.ready&&data.windows.some(w=>w.cells&&w.cells.length);
  const hint=hasClickable?`<div style="font-size:0.6em;color:var(--text-muted);text-align:center;margin-top:2px;font-style:italic">${data.forecast?'Tap a colored arc for forecast details':'Tap a colored arc to see which storms cause it'}</div>`:'';
  // v4.70: confidence note. The dial is a LIVE-radar projection, which is very
  // accurate in the very short term but degrades the further out it reaches —
  // a cell that's "arriving" can weaken or veer before it gets here. Spell that
  // out so users read the dial as a guide, not a guarantee. Only shown when
  // there's actually rain projected.
  const accNote=hasClickable?(data.forecast
    ?`<div style="font-size:0.58em;color:var(--text-muted);text-align:center;margin-top:5px;line-height:1.45">Forecast-based — plotted from the hourly precipitation forecast, not live radar. Timing and amounts can shift.</div>`
    :`<div style="font-size:0.58em;color:var(--text-muted);text-align:center;margin-top:5px;line-height:1.45">≈95% accurate within 30&nbsp;min · further out is a live-radar projection — storms can still weaken, build, or shift</div>`):'';
  // v4.72: tell the user arrival times have been shifted earlier to account for
  // radar latency, using the same canonical age every ETA consumer subtracts.
  const _ageMin=Math.round(radarAgeMin());
  const radarAgeNote=(data.radarReady&&_ageMin>0)?`<div style="font-size:0.56em;color:var(--text-muted);text-align:center;margin-top:3px;font-style:italic;line-height:1.4">Arrival times shifted ~${_ageMin}&nbsp;min earlier to account for radar age</div>`:'';
  // v4.58: dial is radar-only now, so drop the "+ FORECAST" tag. Forecast is
  // still consulted for the 3h amount when radar isn't ready, but it doesn't
  // paint anything on the dial — labelling it would be misleading.
  // v4.80: a forecast-sourced dial is labelled FORECAST regardless of radar
  // readiness — radar may be "ready" but show nothing, in which case the dial is
  // showing the hourly forecast and must say so.
  const sourceTag=data.forecast?'FORECAST':data.radarReady?'RADAR':data.forecastReady?'FORECAST (fallback)':'';
  // v5.x: legend for the dual-ring dial — solid outer = observed radar, dashed
  // inner = hourly forecast. Only shown in dial view when the forecast ring is drawn.
  const _spanModeNow=(typeof _rcSpanMode==='function')?_rcSpanMode():'forecast';
  const _spanChip=`<span onclick="_rcToggleSpanMode()" title="Dial span: ${_spanModeNow==='forecast'?'grows to keep forecast rain in view':'follows the nearest radar storm'} — tap to switch" style="cursor:pointer;border:1px solid var(--text-muted);border-radius:5px;padding:1px 7px">Span: ${_spanModeNow==='forecast'?'fits forecast':'radar'} ⇄</span>`;
  const fcLegend=(!S._rainClockTextView&&data.ready&&data.fcReady)
    ?`<div style="display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:14px;font-size:0.6em;color:var(--text-muted);margin-top:6px"><span><span style="display:inline-block;width:18px;border-top:3px solid #7fb0e0;vertical-align:middle;margin-right:5px"></span>Radar (observed)</span><span><span style="display:inline-block;width:18px;border-top:3px dashed #7fb0e0;vertical-align:middle;margin-right:5px"></span>Forecast</span>${_spanChip}</div>`
    :'';
  // Header tag uses secBtns when the helper exists, so the rain clock card
  // joins the up/down reorder system used by the other Weather sections.
  const reorder=(typeof secBtns==='function')?secBtns('rainclock'):'';
  // v4.49: a transparent circle in the center is the dial→text toggle target.
  // Sized to roughly cover the center status text so users naturally tap it.
  const centerTap=`<circle cx="${CX}" cy="${CY}" r="55" fill="rgba(0,0,0,0.001)" style="cursor:pointer" onclick="_rainClockToggleView()"><title>Tap to switch to text view</title></circle>`;
  const toggleBtn=`<button type="button" onclick="_rainClockToggleView()" style="background:transparent;border:1px solid var(--text-muted);color:var(--text-muted);font-size:0.55em;padding:2px 6px;border-radius:4px;cursor:pointer;letter-spacing:0.04em">${S._rainClockTextView?'DIAL':'TEXT'}</button>`;
  // v4.49: text view — friendlier prose summary of the next two rain windows.
  // Built from the same `_phrases` list the dial center already uses, so the
  // two views never disagree. Tap anywhere on the text card to flip back to
  // the dial.
  let viewBody;
  if(S._rainClockTextView){
    const phrase=_phrases[0]||{title:'Rain Clock',body:'No data yet.'};
    viewBody=`
      <div onclick="_rainClockToggleView()" style="cursor:pointer;background:rgba(10,16,32,0.55);border:1px solid #1e2a3c;border-radius:12px;padding:22px 18px;min-height:200px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;max-width:380px;margin:0 auto" title="Tap to switch back to dial view">
        <div style="font-size:1.05em;font-weight:700;color:#e6edf3;line-height:1.3;margin-bottom:8px">${phrase.title}</div>
        <div style="font-size:0.85em;color:#cfd8e3;line-height:1.45;max-width:32em">${phrase.body}</div>
        ${amountLine?`<div style="font-size:0.8em;color:#5eead4;font-weight:600;margin-top:10px">~${(typeof fmtPrecip==='function'?fmtPrecip(data.totalMm):(data.totalMm/25.4).toFixed(2)+' in')} expected ${_spanWord}</div>`:''}
        <div style="font-size:0.62em;color:var(--text-muted);font-style:italic;margin-top:14px">Tap to switch back to dial view</div>
      </div>`;
  } else {
    viewBody=`
      <div style="display:flex;justify-content:center">
        <svg viewBox="0 0 ${SIZE} ${SIZE}" width="100%" style="max-width:380px;height:auto" xmlns="http://www.w3.org/2000/svg">
          <circle cx="${CX}" cy="${CY}" r="${R_OUTER}" fill="rgba(10,16,32,0.55)" stroke="#1e2a3c" stroke-width="1"/>
          ${ticks}${fcArcs}${hourLabels}${arcs}${boundary}${segHandlers}${nowPointer}${center}${centerTap}
        </svg>
      </div>`;
  }
  el.innerHTML=`
    <div class="card weather-section" data-sec="rainclock" style="padding:10px 8px;margin-bottom:8px">
      <div class="sec-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span class="card-title m-0"><span class="icon">🌧️</span> Rain Clock · ${_spanLabel}</span>
        <div style="display:flex;align-items:center;gap:8px">
          ${reorder}
        </div>
      </div>
      ${viewBody}
      ${fcLegend}
      ${sub}${foot}${hint}${accNote}${radarAgeNote}
      <div id="rain-clock-detail" style="margin-top:8px"></div>
    </div>`;
  if(S._rainClockSelectedIdx!=null&&data.ready&&data.windows[S._rainClockSelectedIdx]){
    _rainClockRenderDetail(S._rainClockSelectedIdx);
  }
}

// v4.49: dial ↔ text view toggle. Tapping the dial center (or the TEXT/DIAL
// button in the card header) flips S._rainClockTextView and re-renders. State
// is intentionally NOT persisted — each session starts on the dial.
function _rainClockToggleView(){
  S._rainClockTextView=!S._rainClockTextView;
  if(typeof renderRainClock==='function')renderRainClock();
}
window._rainClockToggleView=_rainClockToggleView;

// v4.46: outer wall-clock labels redraw every 60s without rebuilding the
// whole SVG, so the "Now" position always matches the current minute.
let _rainClockTickTimer=null;
function _rainClockStartTick(){
  if(_rainClockTickTimer)return;
  _rainClockTickTimer=setInterval(()=>{
    // v4.48: selector targets the tspan (not text), because v4.47 moved
    // data-rc-outer from the parent <text> onto the inner time <tspan> when
    // the labels were collapsed into combined offset+time stacks.
    // v4.70: labels carry data-rc-min (offset in minutes for the current dynamic
    // span). The old code used data-rc-outer * 1 hour, which only matched a 6×60
    // dial and showed wrong times on any other span.
    const els=document.querySelectorAll('[data-rc-min]');
    if(!els.length)return;
    const now=Date.now();
    els.forEach(t=>{
      const m=parseFloat(t.getAttribute('data-rc-min'));
      if(isNaN(m))return;
      t.textContent=fmtClock(new Date(now+m*60000));
    });
  },60000);
}
if(typeof window!=='undefined'){try{_rainClockStartTick()}catch(e){}}

function _rainClockSelectWindow(idx){
  const data=S._rainClockData;
  if(!data||!data.windows||!data.windows[idx])return;
  S._rainClockSelectedIdx=(S._rainClockSelectedIdx===idx)?null:idx;
  if(S._rainClockSelectedIdx==null){
    const panel=document.getElementById('rain-clock-detail');
    if(panel)panel.innerHTML='';
    return;
  }
  _rainClockRenderDetail(S._rainClockSelectedIdx);
}

function _rainClockRenderDetail(idx){
  const panel=document.getElementById('rain-clock-detail');
  if(!panel)return;
  const data=S._rainClockData;
  if(!data||!data.windows||!data.windows[idx]){panel.innerHTML='';return}
  const w=data.windows[idx];
  const now=Date.now();
  const startClock=fmtClock(new Date(now+w.startMin*60000));
  const endClock=fmtClock(new Date(now+w.endMin*60000));
  const etaTxt=w.startMin===0?`now → ${endClock}`:`${startClock} → ${endClock}`;
  const cells=w.cells||[];
  let rows='';
  if(!cells.length){
    rows=`<div style="font-size:0.7em;color:var(--text-muted);padding:4px 6px">No contributing cells identified for this window.</div>`;
  } else {
    cells.forEach(c=>{
      const color=(typeof dbzHex==='function')?dbzHex(c.dbz):'#39ff14';
      const cellEta=c.tIn===0?'overhead':`+${c.tIn}-${c.tOut} min`;
      // Distance is only meaningful for ACTUAL radar storm cells. Synthetic
      // forecast cells sit at the user's location (dist 0) and overhead cells are
      // at ~0 mi, so a "0.0 mi" readout there is just confusing — omit it and let
      // the ETA ("overhead"/projection) speak for those. Real (>0 mi) storms keep it.
      const distTxt=(c.forecast||!(c.dist>0))?'':(()=>{const distStr=S.radarMetric?(c.dist*1.609).toFixed(1)+' km':c.dist.toFixed(1)+' mi';return ` · ${distStr} ${degToDir(c.bearing)}`;})();
      // v4.70: per-cell confidence — anything arriving within ~30 min is a
      // high-confidence nowcast; further out it's a projection that can shift.
      const _conf=(c.centerMin!=null&&c.centerMin<=30)
        ?{t:'High confidence',c:'#34d399'}
        :{t:'Projection · may shift',c:'#fbbf24'};
      const confTag=`<span style="color:${_conf.c};font-weight:600">${_conf.t}</span>`;
      const safeLat=c.lat.toFixed(5),safeLng=c.lng.toFixed(5);
      rows+=`<div style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="width:10px;height:24px;background:${color};border-radius:3px;flex-shrink:0"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.78em;color:var(--text-primary);font-weight:600">${c.dbz} dBZ${distTxt}</div>
          <div style="font-size:0.65em;color:var(--text-muted)">ETA ${cellEta}${c.count>1?' · '+c.count+' pixels':''} · ${confTag}</div>
        </div>
        <button onclick="_rainClockViewCellOnRadar(${safeLat},${safeLng})" style="font-size:0.65em;padding:4px 8px;border-radius:6px;background:var(--accent-blue,#3b82f6);color:#fff;border:none;cursor:pointer;flex-shrink:0">View on radar</button>
      </div>`;
    });
  }
  panel.innerHTML=`
    <div style="background:rgba(10,16,32,0.4);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:0.72em;color:var(--accent-cyan);font-weight:700">Rain window · ${etaTxt}</span>
        <span onclick="_rainClockSelectWindow(${idx})" style="font-size:0.7em;color:var(--text-muted);cursor:pointer;padding:0 4px">✕</span>
      </div>
      <div style="font-size:0.65em;color:var(--text-muted);margin-bottom:6px">Peak ${w.peakDbz} dBZ · ${cells.length} cell${cells.length!==1?'s':''} contributing</div>
      ${rows}
    </div>`;
}

function _rainClockViewCellOnRadar(lat,lng){
  if(typeof switchPage==='function')switchPage('radar');
  const tryPan=()=>{
    if(S.map){
      try{S.map.setView([lat,lng],10,{animate:true,duration:0.5})}catch(e){}
      return true;
    }
    return false;
  };
  if(!tryPan()){
    let n=0;
    const iv=setInterval(()=>{if(tryPan()||++n>=10)clearInterval(iv)},250);
  }
}

let _rainClockLastDraw=0;
function refreshRainClock(force){
  const n=Date.now();
  if(!force&&n-_rainClockLastDraw<10000)return;
  _rainClockLastDraw=n;
  try{renderRainClock()}catch(e){console.log('rain clock failed:',e.message)}
  try{renderRainForecastBars()}catch(e){console.log('rain bars failed:',e.message)}
}
// v5.85: user rain floor (Settings → 🌧️ Rain Sensitivity). Stored in
// st_rainFloorDbz, read live by getRainFloorDbz() everywhere the Rain Clock
// decides "what counts as rain". Re-render the dial immediately on change.
function setRainFloorDbz(v){
  const n=parseInt(v,10);
  if(!(isFinite(n)&&n>=5&&n<=40))return;
  try{localStorage.setItem('st_rainFloorDbz',String(n))}catch(e){}
  if(typeof refreshRainClock==='function')refreshRainClock(true);
  if(typeof refreshHeroFromZone==='function')refreshHeroFromZone();
  if(typeof toast==='function')toast('🌧️ Rain floor set to ≥'+n+' dBZ');
}
if(typeof window!=='undefined'){window.setRainFloorDbz=setRainFloorDbz}

function _precipMmToDbz(mmPerHr){
  if(mmPerHr==null||mmPerHr<=0)return 0;
  return 10*Math.log10(200*Math.pow(mmPerHr,1.6));
}
// v4.46: per-graph gridlines+labels toggle helper. Used by Rain Forecast Bars
// (and ready for trend charts to opt in). Persists in localStorage so the
// user's choice survives reloads. Default ON.
function _graphGridOn(key){try{const v=localStorage.getItem('st_grid_'+key);if(v==='0')return false;if(v==='1')return true}catch(e){}return true}
function toggleGraphGrid(key){const cur=_graphGridOn(key);try{localStorage.setItem('st_grid_'+key,cur?'0':'1')}catch(e){}
  if(key==='rainbars')try{renderRainForecastBars()}catch(e){}
  if(key==='trends'&&S.forecast)try{renderWeather(S.forecast)}catch(e){}
}
function renderRainForecastBars(){
  const el=document.getElementById('rain-forecast-bars');
  if(!el)return;
  const h=S._hourlyData;
  const reorder=(typeof secBtns==='function')?secBtns('rainbars'):'';
  const gridOn=_graphGridOn('rainbars');
  const gridBtn=`<button onclick="toggleGraphGrid('rainbars')" title="${gridOn?'Hide':'Show'} gridlines & labels" style="background:none;border:1px solid var(--text-muted);color:${gridOn?'var(--accent-cyan)':'var(--text-muted)'};font-size:0.6em;padding:1px 6px;border-radius:4px;cursor:pointer;line-height:1.4">📊</button>`;
  // v4.53: always render the card frame — never let `el.innerHTML=''` make
  // the whole graph vanish silently. If hourly precipitation is missing, show
  // the card with a "waiting on forecast data" placeholder so the user can
  // see the section exists and that it's a data issue, not a missing widget.
  if(!h||!h.time||!h.precipitation||!h.time.length){
    const _omPart=S._lastWeatherData&&S._lastWeatherData._omPartial;
    const msg=_omPart
      ?'⏳ Waiting on Open-Meteo — 48-hour rain forecast will appear once the service is back.'
      :'⏳ Hourly precipitation forecast not available right now — will appear on the next refresh.';
    el.innerHTML=`<div class="card weather-section" data-sec="rainbars" style="padding:8px;margin-bottom:8px"><div class="sec-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span class="card-title m-0" style="font-size:0.78em"><span class="icon">📊</span> Total Precipitation Next 48 hrs</span><div style="display:flex;gap:4px;align-items:center">${gridBtn}${reorder}</div></div><div style="font-size:0.7em;color:var(--text-secondary);text-align:center;padding:14px 6px">${msg}</div></div>`;
    return;
  }
  const now=Date.now();
  let startIdx=h.time.findIndex(t=>{const ts=new Date(t).getTime();return ts>=now-1800000});
  if(startIdx<0)startIdx=0;
  const HOURS=48;   // v5.83: 48 h horizon (future only), matching the 48h Trends window.
  const slots=[];
  for(let i=0;i<HOURS;i++){
    const idx=startIdx+i;
    if(idx>=h.time.length)break;
    // v5.83: plot the RAW hourly precipitation forecast — the SAME h.precipitation
    // the 48h Trends "Precip" series uses — so the two graphs never disagree. The
    // old v5.54 25 dBZ floor zeroed light rain (<~1.3 mm/hr) here, which made this
    // "Total Precipitation" chart read "no measurable rain" while the 48h Trends
    // (and the NWS forecast) still showed it. This chart is a multi-day FORECAST,
    // separate from the Rain Clock's 0-3 h radar nowcast, so it shows all forecast
    // precip; the Rain Clock keeps its own 25 dBZ nowcast floor.
    let mm=h.precipitation[idx]||0;
    // v6.56: filter below the USER rain floor (st_rainFloorDbz, default 25) so
    // this chart, the Rain Clock rings and the hero line all honor the SAME
    // setting. v5.83 had removed the old FIXED 25 floor entirely, which left
    // this the one rain surface the setting couldn't reach. Lower the setting
    // to 5 to see all forecast precip again.
    if(mm>0&&typeof _precipMmToDbz==='function'&&typeof getRainFloorDbz==='function'&&_precipMmToDbz(mm)<getRainFloorDbz())mm=0;
    slots.push({t:new Date(h.time[idx]).getTime(),mm});
  }
  // v4.69: this 36-hour chart is now FULLY INDEPENDENT of the Rain Clock. It
  // shows the forecast-model precipitation only (Open-Meteo, with the NWS QPF
  // merge already applied to S._hourlyData) across all 36 hours. Previously hours
  // 0-2 were overridden with the rain clock's radar nowcast so the two surfaces
  // agreed about "right now" — but the clock is a short-range radar nowcast and
  // this is a 36-hour forecast; mixing them was confusing. They are deliberately
  // separate measurements now: the clock = inbound radar cells (0-3h), this chart
  // = the precipitation forecast (0-36h).
  if(!slots.length){el.innerHTML=`<div class="card weather-section" data-sec="rainbars" style="padding:8px;margin-bottom:8px"><div class="sec-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span class="card-title m-0" style="font-size:0.78em"><span class="icon">📊</span> Total Precipitation Next 48 hrs</span><div style="display:flex;gap:4px;align-items:center">${gridBtn}${reorder}</div></div><div style="font-size:0.7em;color:var(--text-secondary);text-align:center;padding:14px 6px">⏳ Forecast hours haven't refreshed yet — graph will fill in on the next update.</div></div>`;return;}
  const total=slots.reduce((a,s)=>a+s.mm,0);
  const maxMm=Math.max(0.05,...slots.map(s=>s.mm));
  const W=300,H=110,padL=8,padR=8,padT=14,padB=22;
  const innerW=W-padL-padR,innerH=H-padT-padB;
  const barW=innerW/slots.length;
  let bars='';
  for(let i=0;i<slots.length;i++){
    const s=slots[i];
    const hPx=s.mm>0?Math.max(2,(s.mm/maxMm)*innerH):0;
    if(hPx<=0)continue;
    const x=padL+i*barW;
    const y=padT+innerH-hPx;
    const dbz=_precipMmToDbz(s.mm);
    const col=(typeof dbzHex==='function')?dbzHex(dbz):'#39ff14';
    bars+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1,barW-0.5).toFixed(1)}" height="${hPx.toFixed(1)}" fill="${col}" opacity="0.92" rx="1"/>`;
  }
  const baseY=padT+innerH;
  let axisLine=`<line x1="${padL}" y1="${baseY}" x2="${W-padR}" y2="${baseY}" stroke="#3a4a5e" stroke-width="1"/>`;
  // v4.46: horizontal gridlines + Y-axis labels at 25 / 50 / 75 / 100% of max
  // (only rendered when the per-graph toggle is on; default ON).
  let gridLines='',yLabels='';
  if(gridOn){
    const steps=[0.25,0.5,0.75,1];
    for(const f of steps){
      const y=padT+innerH-f*innerH;
      gridLines+=`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="#2a3548" stroke-width="0.5" stroke-dasharray="2,3" opacity="0.7"/>`;
      const valMm=maxMm*f;
      const lbl=(typeof fmtPrecip==='function')?fmtPrecip(valMm):(valMm.toFixed(2)+' mm');
      yLabels+=`<text x="${(W-padR-2).toFixed(1)}" y="${(y-1).toFixed(1)}" fill="#6b7a8e" font-size="7" text-anchor="end">${lbl}</text>`;
    }
  }
  const tickHours=[0,12,24,36,48];
  let xTicks='';
  for(const th of tickHours){
    if(th>slots.length)continue;
    const x=padL+th*barW;
    let lbl;
    if(th===0)lbl='Now';
    else if(th<slots.length)lbl=fmtClock(new Date(slots[th].t));
    else lbl=fmtClock(new Date(slots[slots.length-1].t+3600000));
    xTicks+=`<line x1="${x.toFixed(1)}" y1="${baseY}" x2="${x.toFixed(1)}" y2="${baseY+3}" stroke="#5a6a7e" stroke-width="1"/>`;
    xTicks+=`<text x="${x.toFixed(1)}" y="${(baseY+13).toFixed(1)}" fill="#9fb3c8" font-size="8" text-anchor="${th===48?'end':'middle'}">${lbl}</text>`;
  }
  // v5.84: day-boundary lines — a faint vertical rule + weekday label at each local
  // midnight across the 48 h span, so the days are readable at a glance.
  let dayLines='';
  {
    let _pd=null;
    for(let i=0;i<slots.length;i++){
      const _d=new Date(slots[i].t);
      const _dk=_d.toDateString();
      if(_pd!==null&&_dk!==_pd){
        const dx=padL+i*barW;
        dayLines+=`<line x1="${dx.toFixed(1)}" y1="${padT}" x2="${dx.toFixed(1)}" y2="${(padT+innerH).toFixed(1)}" stroke="#3a4a5e" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.85"/>`;
        dayLines+=`<text x="${(dx+2).toFixed(1)}" y="${(padT+7).toFixed(1)}" fill="#7c8aa0" font-size="6.5" font-weight="700">${_d.toLocaleDateString(undefined,{weekday:'short'})}</text>`;
      }
      _pd=_dk;
    }
  }
  const maxLbl=(typeof fmtPrecip==='function')?fmtPrecip(maxMm):(maxMm.toFixed(2)+' mm');
  const totalLbl=(typeof fmtPrecip==='function')?fmtPrecip(total):(total.toFixed(2)+' mm');
  const peakBadge=`<text x="${W-padR}" y="10" fill="#9fb3c8" font-size="8" text-anchor="end">peak ${maxLbl}/hr</text>`;
  const empty=total<=0.01;
  el.innerHTML=`
    <div class="card weather-section" data-sec="rainbars" style="padding:8px 8px 6px;margin-bottom:8px">
      <div class="sec-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span class="card-title m-0" style="font-size:0.78em"><span class="icon">📊</span> Total Precipitation Next 48 hrs</span>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:0.6em;color:var(--text-muted)">total ${totalLbl}</span>
          ${gridBtn}${reorder}
        </div>
      </div>
      <div style="display:flex;justify-content:center">
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:340px;height:auto" xmlns="http://www.w3.org/2000/svg">
          ${gridLines}${dayLines}${empty?'':peakBadge}${bars}${axisLine}${xTicks}${yLabels}
          ${empty?`<text x="${(W/2).toFixed(1)}" y="${(padT+innerH/2).toFixed(1)}" fill="var(--text-secondary)" font-size="9" text-anchor="middle">No measurable rain forecast</text>`:''}
        </svg>
      </div>
      ${empty?`<div style="font-size:0.62em;color:var(--text-muted);text-align:center;margin-top:2px">Forecast model shows no measurable rain in the next 48 hours.</div>`:''}
    </div>`;
}
