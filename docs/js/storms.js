// ==========================================
// RADAR-BASED STORM DETECTION
// Two-phase adaptive scan matching main app approach
// NEXRAD primary (US) + RainViewer fallback (global)
// ==========================================
function isUSLocation(lat,lon){
  return lat>=24&&lat<=50&&lon>=-125&&lon<=-66;
}
function isNWSCoverage(lat,lon){
  if(lat>=24&&lat<=50&&lon>=-125&&lon<=-66)return true;
  if(lat>=51&&lat<=72&&lon>=-180&&lon<=-129)return true;
  if(lat>=18.5&&lat<=22.5&&lon>=-161&&lon<=-154)return true;
  if(lat>=17.5&&lat<=18.7&&lon>=-67.5&&lon<=-65)return true;
  if(lat>=17&&lat<=19&&lon>=-65.5&&lon<=-64)return true;
  if(lat>=13&&lat<=14&&lon>=144&&lon<=145)return true;
  if(lat>=-15&&lat<=-14&&lon>=-171&&lon<=-170)return true;
  return false;
}

function loadTileImage(url){
  return new Promise((resolve)=>{
    const img=new Image();
    img.crossOrigin='anonymous';
    // v5.29: bound the tile load so one stalled image on a slow/flaky link
    // can't hang the whole Promise.all scan forever. A stuck tile resolves null
    // (treated as "no returns here") after 15s instead of blocking the scan.
    let done=false;
    const finish=(v)=>{if(done)return;done=true;clearTimeout(to);resolve(v)};
    const to=setTimeout(()=>{try{img.src=''}catch(e){}finish(null)},15000);
    img.onload=()=>finish(img);
    img.onerror=()=>finish(null);
    img.src=url;
  });
}

async function decodeRvRgba(buf){
  const v=new DataView(buf);
  if(buf.byteLength<29)throw new Error('PNG too small');
  let o=8,w=0,h=0,bd=0,ct=0;
  const idats=[];
  while(o+8<=v.byteLength){
    const len=v.getUint32(o);
    if(len>buf.byteLength)break;
    const t=String.fromCharCode(v.getUint8(o+4),v.getUint8(o+5),v.getUint8(o+6),v.getUint8(o+7));
    if(t==='IHDR'&&o+17<v.byteLength){w=v.getUint32(o+8);h=v.getUint32(o+12);bd=v.getUint8(o+16);ct=v.getUint8(o+17)}
    else if(t==='IDAT'){
      if(o+8+len<=buf.byteLength)idats.push(new Uint8Array(buf,o+8,len));
    }
    else if(t==='IEND')break;
    o+=12+len;
    if(o<0)break;
  }
  const total=idats.reduce((s,c)=>s+c.length,0);
  const comp=new Uint8Array(total);
  let p=0;for(const c of idats){comp.set(c,p);p+=c.length}
  const ds=new DecompressionStream('deflate');
  const wr=ds.writable.getWriter();
  wr.write(comp);wr.close();
  const rd=ds.readable.getReader();
  const chunks=[];
  while(true){const{done,value}=await rd.read();if(done)break;chunks.push(value)}
  const dLen=chunks.reduce((s,c)=>s+c.length,0);
  const raw=new Uint8Array(dLen);
  p=0;for(const c of chunks){raw.set(c,p);p+=c.length}
  const bpp=ct===6?4:ct===4?2:ct===2?3:1;
  const stride=w*bpp;
  if(!w||!h||dLen<h*(stride+1))throw new Error('PNG decode: bad dimensions');
  const rgba=new Uint8Array(w*h*4);
  const prev=new Uint8Array(stride);
  for(let y=0;y<h;y++){
    const fi=y*(stride+1);
    if(fi+1+stride>raw.length)break;
    const filter=raw[fi];
    const line=new Uint8Array(stride);
    for(let x=0;x<stride;x++){
      let val=raw[fi+1+x];
      const a=x>=bpp?line[x-bpp]:0;
      const b=prev[x];
      const c=x>=bpp?prev[x-bpp]:0;
      if(filter===1)val=(val+a)&255;
      else if(filter===2)val=(val+b)&255;
      else if(filter===3)val=(val+((a+b)>>1))&255;
      else if(filter===4){const pa=Math.abs(b-c),pb=Math.abs(a-c),pc=Math.abs(a+b-2*c);val=(val+(pa<=pb&&pa<=pc?a:pb<=pc?b:c))&255}
      line[x]=val;
    }
    for(let x=0;x<w;x++){
      const di=(y*w+x)*4;
      if(bpp===4){rgba[di]=line[x*4];rgba[di+1]=line[x*4+1];rgba[di+2]=line[x*4+2];rgba[di+3]=line[x*4+3]}
      else if(bpp===2){rgba[di]=line[x*2];rgba[di+1]=line[x*2];rgba[di+2]=line[x*2];rgba[di+3]=line[x*2+1]}
    }
    prev.set(line);
  }
  return{w,h,data:rgba};
}
async function scanTileForPoints(url,tx,ty,zoom,colorFn,minDbz,scanRadius,stepOverride,centerLat,centerLon){
  const tileSize=256,step=stepOverride||S._scanStep||2;
  // v5.44: center coords are passed in explicitly by runRadarScan so the
  // distance filter no longer reads S.lat/S.lon (killed the scan-center hack
  // where scanRadarForView/HiRes temporarily overwrote those globals).
  const cLat=centerLat!=null?centerLat:S.lat,cLon=centerLon!=null?centerLon:S.lon;
  const isRV=url.includes('rainviewer');
  if(isRV){
    try{
      const res=await fetch(url,{signal:AbortSignal.timeout(15000)});
      if(!res.ok)return[];
      const buf=await res.arrayBuffer();
      const{w,h,data}=await decodeRvRgba(buf);
      const pts=[];
      for(let x=0;x<w;x+=step){
        for(let y=0;y<h;y+=step){
          const i=(y*w+x)*4;
          if(data[i+3]<30)continue;
          const dbz=rvToDbz(data[i],data[i+1],data[i+2],data[i+3]);
          if(dbz<minDbz)continue;
          const ptLon=(tx+x/w)*360/Math.pow(2,zoom)-180;
          const ptLatRad=Math.atan(Math.sinh(Math.PI*(1-2*(ty+y/h)/Math.pow(2,zoom))));
          const ptLat=ptLatRad*180/Math.PI;
          const dist=haversine(cLat,cLon,ptLat,ptLon);
          if(dist<=scanRadius)pts.push({lat:ptLat,lng:ptLon,dbz,dist});
        }
      }
      return pts;
    }catch(e){return[]}
  }
  const img=await loadTileImage(url);
  if(!img)return[];
  const c=document.createElement('canvas');c.width=tileSize;c.height=tileSize;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(img,0,0);
  let data;
  try{data=ctx.getImageData(0,0,tileSize,tileSize).data}catch(e){return[]}
  const pts=[];
  for(let x=0;x<tileSize;x+=step){
    for(let y=0;y<tileSize;y+=step){
      const i=(y*tileSize+x)*4;
      if(data[i+3]<30)continue;
      const dbz=colorFn(data[i],data[i+1],data[i+2],data[i+3]);
      if(dbz>=minDbz){
        const ptLon=(tx+x/tileSize)*360/Math.pow(2,zoom)-180;
        const ptLatRad=Math.atan(Math.sinh(Math.PI*(1-2*(ty+y/tileSize)/Math.pow(2,zoom))));
        const ptLat=ptLatRad*180/Math.PI;
        const dist=haversine(cLat,cLon,ptLat,ptLon);
        if(dist<=scanRadius)pts.push({lat:ptLat,lng:ptLon,dbz,dist});
      }
    }
  }
  return pts;
}
(function initAdaptiveScan(){
  S._scanStep=2;
  const t0=performance.now();
  const c=document.createElement('canvas');c.width=256;c.height=256;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.fillRect(0,0,256,256);
  const d=ctx.getImageData(0,0,256,256).data;
  let s=0;for(let i=0;i<d.length;i+=8)s+=d[i];
  const ms=performance.now()-t0;
  if(ms>50)S._scanStep=4;
  else if(ms>20)S._scanStep=3;
  else S._scanStep=2;
  console.log('Adaptive scan: step='+S._scanStep+' (bench='+ms.toFixed(1)+'ms)');
})();

// v4.44: Optional Skylink (RapidAPI) winds-aloft provider. Returns FAA-standard
// altitude bands (3k/6k/9k/12k/18k/24k/30k/34k/39k ft). We snap each band to
// the nearest pressure-level slot the existing downstream consumers expect
// (1013/925/850/700/500 hPa) using the US Standard Atmosphere. Requires a
// user-supplied RapidAPI key in localStorage (key: 'st_skylinkKey') — when
// absent or on any error, the orchestrator falls through to the free chain.
function getSkylinkKey(){try{return localStorage.getItem('st_skylinkKey')||''}catch(e){return''}}
function saveSkylinkKey(v){
  const t=(v||'').trim();
  try{localStorage.setItem('st_skylinkKey',t)}catch(e){}
  // Invalidate cache so the next fetch re-runs through Skylink (or back to free chain).
  S._windCache=null;
  if(typeof toast==='function')toast(t?'✓ Skylink key saved':'Skylink key cleared');
}
function toggleSkylinkKeyVis(){
  const inp=document.getElementById('settings-skylink-key');
  if(!inp)return;
  inp.type=inp.type==='password'?'text':'password';
}
// ⚡ Lightning (WarPulse) — user-supplied API key from lightning.warpulse.com,
// stored ONLY in localStorage ('st_lightningKey'). It is read locally and sent
// only to the WarPulse lightning API (once the strike fetch is wired up); it is
// never transmitted anywhere else and never leaves the device otherwise. Without
// a key the app keeps using its radar-derived lightning estimate (cells ≥48 dBZ).
function getLightningKey(){try{return localStorage.getItem('st_lightningKey')||''}catch(e){return''}}
function saveLightningKey(v){
  const t=(v||'').trim();
  try{localStorage.setItem('st_lightningKey',t)}catch(e){}
  // Fresh key = fresh start: clear any bad-key backoff and cached strikes,
  // then fetch immediately so the user sees live data without waiting a scan.
  _ltgBackoffUntil=0;_ltgBadKeyWarned=false;_ltgLastAt=0;
  if(!t){S._ltgStrikes=null;if(S.map&&typeof plotLightningStrikes==='function')plotLightningStrikes(S.map);if(typeof drawMiniSonar==='function')drawMiniSonar();}
  else refreshLightningStrikes(true);
  if(typeof toast==='function')toast(t?'✓ Lightning key saved':'Lightning key cleared');
}
function toggleLightningKeyVis(){
  const inp=document.getElementById('settings-lightning-key');
  if(!inp)return;
  inp.type=inp.type==='password'?'text':'password';
}
// --- Live lightning strikes (WarPulse via the Cloudflare worker proxy) ---
// WarPulse blocks browser CORS, so the fetch goes through the worker's
// /lightning pass-through route; the key travels per-request in X-API-Key and
// is never stored server-side. Quota safety (free plan = 50k units/month,
// cost = ceil(flashes/100) per call, min 1): calls ride the scan pipeline,
// throttled to one per 60s, since_minutes=15, limit=500 (free-plan cap).
const LTG_FRESH_MS=10*60000;   // strikes older than this = fall back to radar estimate
const LTG_MIN_GAP_MS=60000;    // min spacing between API calls
let _ltgLastAt=0,_ltgBackoffUntil=0,_ltgBadKeyWarned=false;
function ltgLive(){return !!(S._ltgStrikes&&S._ltgStrikes.flashes.length&&Date.now()-S._ltgStrikes.ts<LTG_FRESH_MS)}
async function refreshLightningStrikes(force){
  const key=getLightningKey();
  if(!key||S.lat==null||S.lon==null)return;
  const now=Date.now();
  if(now<_ltgBackoffUntil)return;
  if(!force&&now-_ltgLastAt<LTG_MIN_GAP_MS)return;
  if(S._ltgFetching)return;
  S._ltgFetching=true;_ltgLastAt=now;
  try{
    const radMi=Math.max(S.scanRadius||80,60);
    const latPad=radMi/69;
    const lonPad=radMi/(69*Math.max(0.2,Math.cos(S.lat*Math.PI/180)));
    const base=(typeof _pushApiUrl==='function')?_pushApiUrl():'https://stormtracker-proxy.joshua-622.workers.dev';
    const u=base+'/lightning?since_minutes=15&limit=500'
      +'&min_lat='+(S.lat-latPad).toFixed(3)+'&max_lat='+(S.lat+latPad).toFixed(3)
      +'&min_lon='+(S.lon-lonPad).toFixed(3)+'&max_lon='+(S.lon+lonPad).toFixed(3);
    const opts={headers:{'X-API-Key':key}};
    if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)opts.signal=AbortSignal.timeout(12000);
    const r=await fetch(u,opts);
    if(r.status===401||r.status===403){
      _ltgBackoffUntil=now+30*60000;
      if(!_ltgBadKeyWarned){_ltgBadKeyWarned=true;if(typeof toast==='function')toast('⚡ Lightning key rejected — check Settings → Lightning')}
      return;
    }
    if(r.status===429){_ltgBackoffUntil=now+10*60000;console.warn('[ltg] quota/rate limited — backing off 10 min');return}
    if(!r.ok)throw new Error('HTTP '+r.status);
    const j=await r.json();
    const flashes=[];
    for(const f of (j&&j.flashes)||[]){
      if(typeof f.lat!=='number'||typeof f.lon!=='number')continue;
      let t=0;
      if(f.flash_timestamp_utc){
        // API returns "2026-07-19 20:21:57.797745" (UTC, space, no zone marker)
        let s=String(f.flash_timestamp_utc).replace(' ','T');
        if(!/[zZ]$|[+-]\d\d:?\d\d$/.test(s))s+='Z';
        t=Date.parse(s)||0;
      }
      // Precompute polar coords relative to the fetch location once, so the
      // sonar (redrawn every animation frame) doesn't haversine 500 strikes
      // per frame. The bbox is centered on this same location, so these stay
      // consistent with the data itself.
      const distMi=haversine(S.lat,S.lon,f.lat,f.lon);
      const bear=(bearingDeg(S.lat,S.lon,f.lat,f.lon)+360)%360;
      flashes.push({lat:f.lat,lon:f.lon,t,distMi,bear});
    }
    S._ltgStrikes={ts:Date.now(),flashes};
    console.log('[ltg] '+flashes.length+' live strikes (quota cost '+(r.headers.get('X-Quota-Cost')||'?')+')');
    if(S.map&&typeof plotLightningStrikes==='function')plotLightningStrikes(S.map);
    if(typeof drawMiniSonar==='function')drawMiniSonar();
    // v5.77: in-app lightning proximity alert (browser notification while the app
    // is open — background push can't use the device-local WarPulse key). At most
    // once per 10 min when a fresh observed strike lands within ~10 mi.
    try{
      let _near=Infinity,_nBrg=null;
      for(const f of flashes){
        const d=(f.distMi!=null)?f.distMi:haversine(S.lat,S.lon,f.lat,f.lon);
        if(d<_near){_near=d;_nBrg=(f.bear!=null)?f.bear:bearingDeg(S.lat,S.lon,f.lat,f.lon);}
      }
      if(isFinite(_near)&&_near<=10&&Date.now()-(S._ltgNotifyAt||0)>10*60000){
        S._ltgNotifyAt=Date.now();
        const nd=S.radarMetric?(_near*1.60934).toFixed(1)+' km':_near.toFixed(1)+' mi';
        const dirStr=(_nBrg!=null)?` to the ${degToDir(_nBrg)} (${Math.round(_nBrg)}°)`:'';
        if(typeof _sendBrowserNotification==='function')_sendBrowserNotification('⚡ Lightning nearby',`Observed strike ${nd}${dirStr} away — seek shelter (30/30 rule).`);
        if(typeof toast==='function')toast(`⚡ Real lightning ${nd}${dirStr}`);
      }
    }catch(e){}
  }catch(e){console.warn('[ltg] fetch failed:',e&&e.message||e)}
  finally{S._ltgFetching=false}
}
function _ftToHPa(ft){
  // ISA: P = 1013.25 * (1 - 0.0065*h/288.15)^5.255 ; h in meters
  const h=ft*0.3048;
  return 1013.25*Math.pow(1-0.0065*h/288.15,5.255);
}
async function fetchWindsAloftSkylink(lat,lon){
  const key=getSkylinkKey();
  if(!key)throw new Error('no key');
  const url='https://skylinkapi.p.rapidapi.com/winds-aloft?lat='+lat.toFixed(4)+'&lon='+lon.toFixed(4);
  const r=await fetch(url,{
    method:'GET',
    headers:{'X-RapidAPI-Key':key,'X-RapidAPI-Host':'skylinkapi.p.rapidapi.com','Accept':'application/json'},
    signal:AbortSignal.timeout(7000)
  });
  if(r.status===401||r.status===403)throw new Error('bad key (HTTP '+r.status+')');
  if(r.status===429)throw new Error('quota exhausted (HTTP 429)');
  if(!r.ok)throw new Error('HTTP '+r.status);
  const j=await r.json();
  // Defensive: Skylink shape may vary. Accept root array OR common wrapper keys.
  let rows=null;
  if(Array.isArray(j))rows=j;
  else if(j&&Array.isArray(j.winds))rows=j.winds;
  else if(j&&Array.isArray(j.windsAloft))rows=j.windsAloft;
  else if(j&&Array.isArray(j.data))rows=j.data;
  else if(j&&j.forecast&&Array.isArray(j.forecast.winds))rows=j.forecast.winds;
  if(!rows||!rows.length)throw new Error('unexpected response shape');
  // Parse each row defensively. Accept common field-name variants.
  const bands=[];
  for(const row of rows){
    if(!row||typeof row!=='object')continue;
    const altFt=row.altitude_ft??row.altitudeFt??row.altitude??row.alt??row.level??row.ft;
    const dir=row.wind_direction??row.windDirection??row.direction??row.dir;
    const spdRaw=row.wind_speed_kt??row.wind_speed_kts??row.windSpeedKt??row.wind_speed??row.windSpeed??row.speed??row.spd;
    if(altFt==null||dir==null||spdRaw==null)continue;
    const altN=parseFloat(altFt),dirN=parseFloat(dir),spdN=parseFloat(spdRaw);
    if(!isFinite(altN)||!isFinite(dirN)||!isFinite(spdN))continue;
    // If altitude looks like meters (Skylink rarely uses meters but be safe), convert.
    const ft=altN<1000?altN*3.281:altN;
    // Speed unit: assume kt unless an explicit unit field says otherwise.
    let spdKt=spdN;
    const unit=(row.wind_speed_unit||row.speedUnit||row.unit||'kt').toString().toLowerCase();
    if(unit==='mph')spdKt=spdN*0.8689;
    else if(unit==='kmh'||unit==='km/h'||unit==='kph')spdKt=spdN*0.5400;
    else if(unit==='ms'||unit==='m/s')spdKt=spdN*1.9438;
    bands.push({ft,dir:dirN,spdKt});
  }
  if(!bands.length)throw new Error('no parseable bands');
  // Snap each band to closest of the wanted pressure slots; keep best (smallest |Δp|).
  const wanted=[925,850,700,500];
  const slots={};
  for(const b of bands){
    const p=_ftToHPa(b.ft);
    let best=null,bestDp=Infinity;
    for(const tp of wanted){
      const dp=Math.abs(p-tp);
      if(dp<bestDp){bestDp=dp;best=tp}
    }
    if(best==null)continue;
    if(!slots[best]||slots[best]._dp>bestDp){
      const rawMs=b.spdKt*0.5144;
      slots[best]={p:best,spd:rawMs*3.6,dir:b.dir,rawMs,isSfc:false,_dp:bestDp};
    }
  }
  const out=[];
  for(const p of wanted){if(slots[p]){const s=slots[p];delete s._dp;out.push(s)}}
  if(out.length<2)throw new Error('insufficient pressure levels mapped ('+out.length+')');
  return out;
}

// v4.43: NOAA GSL rucsoundings serves the same NCEP GFS model output that
// NOMADS distributes, but as plain GSL-format text with CORS=*. Browser-
// fetchable without GRIB2 parsing, fully independent of Open-Meteo's pipeline.
async function fetchWindsAloftNOMADS(lat,lon){
  const url='https://rucsoundings.noaa.gov/get_soundings.cgi?'
    +'data_source=GFS&latest=latest&n_hrs=1&fcst_len=shortest'
    +'&airport='+lat.toFixed(4)+','+lon.toFixed(4)
    +'&start=latest&text=Ascii%20text%20%28GSL%20format%29&hydrometeors=false';
  const r=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error('HTTP '+r.status);
  const txt=await r.text();
  if(!txt||txt.length<100)throw new Error('empty response');
  // GSL format columns: type pressure(*mb) height(m) temp dewpt windDir windSpd(kt)
  // Type codes: 4=mandatory level, 5=significant level, 9=surface.
  const wanted=[1000,925,850,700,500];
  const hits={};let sfc=null;
  for(const ln of txt.split(/\r?\n/)){
    const parts=ln.trim().split(/\s+/);
    if(parts.length<7)continue;
    const t=parseInt(parts[0],10);
    if(t!==4&&t!==5&&t!==9)continue;
    let p=parseFloat(parts[1]);
    if(isNaN(p)||p<=0)continue;
    if(p>1100)p=p/10;  // some GSL outputs encode pressure in tenths of mb
    const dir=parseFloat(parts[5]);
    const spdKt=parseFloat(parts[6]);
    if(isNaN(dir)||isNaN(spdKt)||dir>=9999||spdKt>=9999)continue;
    if(t===9&&!sfc)sfc={dir,spdKt};
    for(const tp of wanted){
      if(!hits[tp]&&Math.abs(p-tp)<=5){hits[tp]={dir,spdKt};break}
    }
  }
  const out=[];
  if(sfc){const rawMs=sfc.spdKt*0.5144;out.push({p:1013,spd:rawMs*3.6,dir:sfc.dir,rawMs,isSfc:true})}
  for(const p of wanted){
    const w=hits[p];if(!w)continue;
    const rawMs=w.spdKt*0.5144;
    out.push({p,spd:rawMs*3.6,dir:w.dir,rawMs,isSfc:false});
  }
  if(out.length<2)throw new Error('insufficient pressure levels parsed ('+out.length+')');
  return out;
}

// v4.43: Compute & store wind-shear, steering, and stormMovement from a
// parsed aloftSpeeds array. Extracted so both Open-Meteo and NOMADS-GFS
// providers can drive the same downstream consumers.
function _applyAloftData(aloftSpeeds,providerInfo,lat,lon){
  S._aloftData=aloftSpeeds;
  if(aloftSpeeds.length>=2){
    const sfc=aloftSpeeds.find(a=>a.p>=1000)||aloftSpeeds[0];
    const upper=aloftSpeeds[aloftSpeeds.length-1];
    const shearSpd=Math.abs(upper.spd-sfc.spd);
    let dd=Math.abs(upper.dir-sfc.dir);if(dd>180)dd=360-dd;
    S._windShear={speedDiff:shearSpd,dirDiff:dd,factor:Math.min(2.0,0.5+shearSpd/60+dd/180)};
    S._upperWindDir=upper.dir;S._upperWindSpd=upper.spd;
    console.log('Wind shear: Δspd='+shearSpd.toFixed(1)+'km/h Δdir='+dd+'° turbFactor='+S._windShear.factor.toFixed(2));
  }
  const steering=aloftSpeeds.filter(a=>a.p<=850);
  if(!steering.length)return;
  let tx=0,ty=0;
  steering.forEach(a=>{
    const spdKt=a.rawMs*1.944;
    const movDir=(a.dir+180)%360;
    const rad=movDir*Math.PI/180;
    tx+=Math.sin(rad)*spdKt;
    ty+=Math.cos(rad)*spdKt;
  });
  const ax=tx/steering.length,ay=ty/steering.length;
  const spdKt=Math.sqrt(ax*ax+ay*ay);
  let dir=(Math.atan2(ax,ay)*180/Math.PI+360)%360;
  const spdMph=Math.round(spdKt*1.151);
  S.stormMovement={direction:Math.round(dir),speed:spdMph};
  S._windCache={lat,lon,ts:Date.now(),dir:Math.round(dir),speed:spdMph,provider:providerInfo.provider,host:providerInfo.host||null};
  console.log('[WindsAloft] Per-level: '+aloftSpeeds.map(a=>a.p+'hPa='+a.rawMs.toFixed(1)+'m/s@'+a.dir+'°').join(', '));
  console.log('[WindsAloft] Steering ('+providerInfo.provider+(providerInfo.host?'/'+providerInfo.host:'')+'): '+steering.map(a=>a.p+'hPa').join(',')+' Vx='+ax.toFixed(2)+' Vy='+ay.toFixed(2)+' → '+spdKt.toFixed(1)+'kt '+Math.round(dir)+'° → '+spdMph+' mph');
  if(S.map&&S._showPathArrows)buildPathArrows(S.map);
  if(typeof _bootStepDone==='function')_bootStepDone('wind',`Winds aloft: ${spdMph} mph @ ${Math.round(dir)}° · ${providerInfo.label}`);
}

// v6.23: WINDS-ALOFT FIELD groundwork for the 200-mi outer awareness layer.
// Steering flow varies across a 200-mi field, so a single sample at the user can't
// steer a rainband 150 mi away. These pure helpers (a) lay out a coarse ~100-mi grid
// of sample points within a radius, and (b) look up the nearest sample's steering for
// any point. Additive + unit-tested; not yet wired to a fetch/scan (that stage needs
// live data to validate). S._steeringField will hold [{lat,lon,dir,speed}] once fetched.
function _steeringGridPoints(lat, lon, radiusMi, spacingMi) {
  const out = [{ lat, lon }]; // always include the user's point
  const sp = spacingMi || 100, R = radiusMi || 200;
  const dLat = sp / 69.0;
  const cosL = Math.max(0.05, Math.cos(lat * Math.PI / 180));
  const dLon = sp / (69.0 * cosL);
  const steps = Math.ceil(R / sp);
  for (let iy = -steps; iy <= steps; iy++) {
    for (let ix = -steps; ix <= steps; ix++) {
      if (ix === 0 && iy === 0) continue;
      const gLat = lat + iy * dLat, gLon = lon + ix * dLon;
      if (typeof haversine === 'function' && haversine(lat, lon, gLat, gLon) <= R) out.push({ lat: gLat, lon: gLon });
    }
  }
  return out;
}
function _steeringAt(field, lat, lon) {
  if (!Array.isArray(field) || !field.length) return null;
  let best = null, bd = Infinity;
  for (const s of field) {
    if (s == null || s.lat == null || s.lon == null) continue;
    const d = (typeof haversine === 'function') ? haversine(lat, lon, s.lat, s.lon) : Math.hypot(lat - s.lat, lon - s.lon);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { dir: best.dir, speed: best.speed, sampleMi: bd } : null;
}

async function fetchWindsAloft(overrideLat,overrideLon){
  const lat=overrideLat!=null?overrideLat:S.lat;
  const lon=overrideLon!=null?overrideLon:S.lon;
  if(!lat)return;
  const cache=S._windCache;
  if(cache&&(Date.now()-cache.ts<30*60000)){
    const d=haversine(lat,lon,cache.lat,cache.lon);
    if(d<100){
      console.log('Winds aloft: using cache ('+d.toFixed(0)+'mi from last fetch, '+((Date.now()-cache.ts)/60000).toFixed(0)+'m old)');
      if(typeof _bootStepDone==='function')_bootStepDone('wind','Winds aloft (cached)');
      return;
    }
  }
  if(typeof _bootStep==='function')_bootStep('wind','Getting winds aloft…');
  // v4.44: Skylink (RapidAPI) opt-in upgrade. When the user has saved a key,
  // try Skylink first; on any error fall through to the existing free chain
  // (Open-Meteo main → customer-api → NOMADS GFS for US).
  if(getSkylinkKey()){
    if(typeof _bootStep==='function')_bootStep('wind','Getting winds aloft… (Skylink)');
    try{
      const skSpeeds=await fetchWindsAloftSkylink(lat,lon);
      _applyAloftData(skSpeeds,{provider:'skylink',host:null,label:'Skylink'},lat,lon);
      console.log('Winds aloft: Skylink ✓ ('+skSpeeds.length+' levels)');
      return;
    }catch(e){
      console.log('Winds aloft: Skylink failed ('+e.message+') — falling through to free chain');
    }
  }
  try{
    const params=new URLSearchParams({
      latitude:lat,longitude:lon,
      current:['wind_speed_10m','wind_direction_10m',
        'wind_speed_925hPa','wind_direction_925hPa',
        'wind_speed_850hPa','wind_direction_850hPa',
        'wind_speed_700hPa','wind_direction_700hPa',
        'wind_speed_500hPa','wind_direction_500hPa'].join(','),
      wind_speed_unit:'ms',forecast_days:'1',timezone:'auto'
    });
    // v4.42: sibling-subdomain fallback. api.open-meteo.com sometimes
    // returns HTTP 502 from nginx for stretches while customer-api stays up.
    // Try main first, then fall over to customer-api on 5xx/timeout/network.
    const _hosts=[{tag:'api',fqdn:'api.open-meteo.com'},{tag:'customer-api',fqdn:'customer-api.open-meteo.com'}];
    let r=null,usedHost=null,lastErr=null;
    for(let i=0;i<_hosts.length;i++){
      const host=_hosts[i];
      const _wUrl='https://'+host.fqdn+'/v1/forecast?'+params;
      const timeoutMs=i===0?5000:6000;
      try{
        const rr=await fetch(_wUrl,{signal:AbortSignal.timeout(timeoutMs)});
        if(!rr.ok){
          lastErr=new Error('HTTP '+rr.status);
          console.log('Winds aloft: '+host.fqdn+' returned HTTP '+rr.status);
          // Only fall over on 5xx — 4xx is a bad-request signal the sibling host would also reject.
          if(rr.status>=500&&rr.status<600&&i<_hosts.length-1){await new Promise(w=>setTimeout(w,500));continue}
          break;
        }
        r=rr;usedHost=host.tag;
        if(i>0)console.log('Winds aloft: fell over to '+host.fqdn+' successfully');
        break;
      }catch(e){
        // Network/timeout/abort — always retry on next host
        lastErr=e;
        console.log('Winds aloft: '+host.fqdn+' failed ('+e.message+')');
        if(i<_hosts.length-1)await new Promise(w=>setTimeout(w,500));
      }
    }
    let aloftSpeeds=null,provInfo=null;
    if(r){
      const d=await r.json();
      const c=d.current;
      const levels=[
        {p:1013,sk:'wind_speed_10m',dk:'wind_direction_10m',w:0.5,isSfc:true},
        {p:925,sk:'wind_speed_925hPa',dk:'wind_direction_925hPa',w:0.8},
        {p:850,sk:'wind_speed_850hPa',dk:'wind_direction_850hPa',w:1.5},
        {p:700,sk:'wind_speed_700hPa',dk:'wind_direction_700hPa',w:2.5},
        {p:500,sk:'wind_speed_500hPa',dk:'wind_direction_500hPa',w:1.5}
      ];
      aloftSpeeds=[];
      levels.forEach(l=>{
        const spd=c[l.sk],dir=c[l.dk];
        if(spd==null||dir==null)return;
        aloftSpeeds.push({p:l.p,spd:spd*3.6,dir,rawMs:spd,isSfc:!!l.isSfc});
      });
      provInfo={provider:'open-meteo',host:usedHost,label:usedHost==='customer-api'?'Open-Meteo (customer-api)':'Open-Meteo'};
    }
    // v4.43: NOMADS GFS fallback for US locations when every Open-Meteo
    // subdomain failed (or returned too few usable levels). Operationally
    // independent NOAA pipeline, key-less, browser-fetchable.
    if((!aloftSpeeds||aloftSpeeds.length<2)&&typeof isUSLocation==='function'&&isUSLocation(lat,lon)){
      if(typeof _bootStep==='function')_bootStep('wind','Getting winds aloft… (NOMADS GFS)');
      try{
        aloftSpeeds=await fetchWindsAloftNOMADS(lat,lon);
        provInfo={provider:'nomads-gfs',host:null,label:'NOMADS GFS'};
        console.log('Winds aloft: NOMADS GFS ✓ ('+aloftSpeeds.length+' levels)');
      }catch(e){
        console.log('Winds aloft: NOMADS GFS failed ('+e.message+')');
        lastErr=lastErr||e;
      }
    }
    if(!aloftSpeeds||aloftSpeeds.length<2){
      const msg=lastErr?lastErr.message:'all providers failed';
      console.log('Winds aloft: all providers failed ('+msg+')');
      if(typeof _bootStepFail==='function')_bootStepFail('wind','Winds aloft failed ('+msg+')');
      _scheduleWindsAloftRetry(lat,lon,0);
      return;
    }
    _applyAloftData(aloftSpeeds,provInfo,lat,lon);
  }catch(e){console.log('Winds aloft fetch failed:',e.message);if(typeof _bootStepFail==='function')_bootStepFail('wind','Winds aloft failed');_scheduleWindsAloftRetry(lat,lon,0)}
}
// v4.58: background retry for winds aloft. Mirrors the Open-Meteo background
// retry in weather.js — when every aloft provider times out on a slow
// connection, schedule a fresh attempt instead of giving up until the next
// autorefresh. Storm-cone projections (which use the aloft vector to predict
// where cells will track) silently quietly went stale otherwise.
const _ALOFT_RETRY_DELAYS=[6000,15000,30000,60000];
function _scheduleWindsAloftRetry(lat,lon,attempt){
  if(attempt>=_ALOFT_RETRY_DELAYS.length){console.log('Winds aloft retry: giving up after '+_ALOFT_RETRY_DELAYS.length+' attempts');return}
  if(S._aloftRetryTimer){clearTimeout(S._aloftRetryTimer);S._aloftRetryTimer=null}
  S._aloftRetryTimer=setTimeout(async()=>{
    S._aloftRetryTimer=null;
    // Bail if the user has moved or the cache filled in via some other path.
    if(S.lat!==lat||S.lon!==lon)return;
    if(S._aloftData&&S._aloftData.length>=2)return;
    console.log('Winds aloft retry '+(attempt+1)+'/'+_ALOFT_RETRY_DELAYS.length+'…');
    const before=S._aloftData?S._aloftData.length:0;
    await fetchWindsAloft(lat,lon);
    if(S._aloftData&&S._aloftData.length>=2){
      console.log('Winds aloft retry succeeded — refreshing ALL storm surfaces');
      refreshStormViewsForWinds();
    } else if((S._aloftData?S._aloftData.length:0)===before) {
      _scheduleWindsAloftRetry(lat,lon,attempt+1);
    }
  },_ALOFT_RETRY_DELAYS[attempt]);
}
// v5.29: complete storm-surface refresh for when winds aloft arrives AFTER a
// scan already rendered (slow connection: the 30s gate fell through, or a
// staggered background retry finally landed). The MAP layer (hex zones, cone,
// flashing) is driven by S._topStormAnalysis (set by computeTopStorms), but the
// COUNT/LIST surfaces — Storms-tab cards, header pill, nav badge, Rain Clock
// dial, forecast banner — are driven by S._inboundShown, which is ONLY ever set
// by renderStorms()/_renderStormsCore(). The old retries refreshed those two
// worlds separately (the post-scan retry repainted the storm list; the
// background retry repainted only the Rain Clock), so on a slow link the map
// could light up with inbound hexes in the cone while every count still read 0.
// renderStorms() is the single source of truth — it re-runs computeTopStorms,
// rebuilds S._inboundShown, and repaints the badges + Rain Clock in lockstep —
// so route every late-winds refresh through here to keep map and counts in sync.
function refreshStormViewsForWinds(){
  if(!(S.storms&&S.storms.length))return;
  if(typeof renderStorms==='function')renderStorms();
  if(typeof drawMiniSonar==='function')drawMiniSonar();
  if(typeof refreshHeroFromZone==='function')refreshHeroFromZone();
  if(S.map&&S._showPathArrows&&typeof buildPathArrows==='function')buildPathArrows(S.map);
  if(typeof updateThreatTicker==='function')updateThreatTicker();
  // v5.82: winds aloft just resolved storm motion — re-render the Rain Clock so it
  // lifts its "determining storm motion" hold and shows the real projection now.
  if(typeof renderRainClock==='function')renderRainClock();
}
// v4.76: blocking winds-aloft GATE. Storm steering, movement vectors, ETAs,
// cones and the Rain Clock all depend on winds aloft. The startup scan used to
// kick off fetchWindsAloft() without waiting — on a slow/failed fetch it only
// scheduled a background retry and returned, so points/projections rendered
// with no steering data on first load. Scan entry points now AWAIT this gate
// before plotting points or running storm calcs: it force-refreshes WA and
// retries until S._aloftData has >=2 levels or a ~30s budget elapses. If the
// budget is spent the gate resolves false and the caller falls through and
// renders anyway (graceful fallback) with a clear "winds aloft unavailable"
// notice, rather than hanging forever. The background retry above keeps trying
// afterward so projections fill in once WA finally arrives.
const _WA_GATE_BUDGET_MS=30000;
const _WA_GATE_PAUSE_MS=3000;
// Winds-aloft is "ready" only when we have >=2 aloft levels AND that data was
// fetched FOR the requested location. S._windCache records the lat/lon the aloft
// data was fetched at and is cleared on every location change (setLoc /
// prepHdTarget), so stale data from a previous location can't satisfy the gate:
// after a move the cache is null until a fresh fetch repopulates it.
function _waReady(lat,lon){
  if(!(S._aloftData&&S._aloftData.length>=2))return false;
  const c=S._windCache;
  if(!c)return false;
  if(lat==null||lon==null)return true;
  return haversine(lat,lon,c.lat,c.lon)<100;
}
async function ensureWindsAloft(lat,lon,reqId){
  lat=lat!=null?lat:S.lat;lon=lon!=null?lon:S.lon;
  if(!lat)return false;
  // Idempotent PER REQUEST: share one in-flight gate only when it belongs to
  // the same location request (reqId). A newer request (e.g. the user changed
  // location mid-gate) must run its OWN full retry budget rather than inherit an
  // older gate that will bail early on the reqId guard — otherwise the new scan
  // would fall through to render with no winds aloft.
  // Reuse must match BOTH the request id AND the location: some location changes
  // (e.g. HD target) reuse the same scan path, so a same-reqId-but-different-loc
  // call must NOT inherit a gate aimed at the old coordinates.
  if(S._waGatePromise&&S._waGateReqId===reqId&&S._waGateLat!=null&&haversine(lat,lon,S._waGateLat,S._waGateLon)<25)return S._waGatePromise;
  const gate=(async()=>{
    const deadline=Date.now()+_WA_GATE_BUDGET_MS;
    let attempt=0;
    while(Date.now()<deadline){
      if(reqId!=null&&reqId!==S._locReqId)return false; // user moved on
      // Drive retries here; cancel the background timer so it can't also fire a
      // duplicate fetch mid-loop.
      if(S._aloftRetryTimer){clearTimeout(S._aloftRetryTimer);S._aloftRetryTimer=null}
      attempt++;
      if(typeof _bootStep==='function')_bootStep('wind',attempt>1?'Getting winds aloft… (retry '+attempt+')':'Getting winds aloft…');
      try{await fetchWindsAloft(lat,lon)}catch(e){}
      if(_waReady(lat,lon)){if(typeof _bootStepDone==='function')_bootStepDone('wind','Winds aloft ✓');return true}
      if(reqId!=null&&reqId!==S._locReqId)return false;
      const remain=deadline-Date.now();
      if(remain<=0)break;
      await new Promise(r=>setTimeout(r,Math.min(_WA_GATE_PAUSE_MS,remain)));
    }
    if(!_waReady(lat,lon)&&typeof _bootStepFail==='function')_bootStepFail('wind','Winds aloft unavailable — retrying in background');
    return _waReady(lat,lon);
  })();
  S._waGatePromise=gate;S._waGateReqId=reqId;S._waGateLat=lat;S._waGateLon=lon;
  // Only clear the in-flight slot if it's still OURS — a newer request may have
  // superseded us with its own gate, which must not be wiped out here.
  try{return await gate}finally{if(S._waGatePromise===gate){S._waGatePromise=null;S._waGateReqId=null;S._waGateLat=null;S._waGateLon=null}}
}

async function fetchAFD(){
  if(!S.lat||!S.lon)return;
  if(!isUSLocation(S.lat,S.lon)){console.log('[non-US] Skipped: NWS Area Forecast Discussion');S._afd=null;return;}
  const cache=S._afdCache;
  if(cache&&(Date.now()-cache.ts<60*60000)){S._afd=cache.data;return;}
  try{
    const ptRes=await fetch(`https://api.weather.gov/points/${S.lat.toFixed(4)},${S.lon.toFixed(4)}`,{
      headers:{'User-Agent':'StormTracker/2.30 (weather analysis)','Accept':'application/geo+json'},
      signal:AbortSignal.timeout(6000)
    });
    if(!ptRes.ok){S._afd=null;return;}
    const ptData=await ptRes.json();
    const office=ptData.properties?.cwa;
    if(!office){S._afd=null;return;}
    const prodRes=await fetch(`https://api.weather.gov/products/types/AFD/locations/${office}`,{
      headers:{'User-Agent':'StormTracker/2.30','Accept':'application/ld+json'},
      signal:AbortSignal.timeout(6000)
    });
    if(!prodRes.ok){S._afd=null;return;}
    const prodData=await prodRes.json();
    const products=prodData['@graph']||[];
    if(!products.length){S._afd=null;return;}
    const latest=products[0];
    const afdRes=await fetch(latest['@id'],{
      headers:{'User-Agent':'StormTracker/2.30','Accept':'application/ld+json'},
      signal:AbortSignal.timeout(6000)
    });
    if(!afdRes.ok){S._afd=null;return;}
    const afdData=await afdRes.json();
    const fullText=afdData.productText||'';
    let discussion='';
    const SECTIONS=['SYNOPSIS','DISCUSSION','NEAR TERM','SHORT TERM','LONG TERM','AVIATION','MARINE'];
    const parts=[];
    for(const name of SECTIONS){
      const re=new RegExp('\\.'+name.replace(/ /g,'\\s+')+'\\.\\.\\.([\\s\\S]*?)(?=\\n\\.\\w|\\n\\$\\$|$)','i');
      const m=fullText.match(re);
      if(m&&m[1]&&m[1].trim().length>20)parts.push(name+': '+m[1].trim());
    }
    if(parts.length)discussion=parts.join('\n\n');
    if(!discussion||discussion.length<50){
      const lines=fullText.split('\n');
      const start=lines.findIndex(l=>/^\.\w/.test(l));
      if(start>=0)discussion=lines.slice(start,start+80).join('\n').substring(0,3000);
    }
    if(discussion&&discussion.length>12000)discussion=discussion.substring(0,12000);
    const officeName=ptData.properties?.cwa||office;
    S._afd={office:officeName,discussion,issuedAt:latest.issuanceTime||''};
    S._afdCache={ts:Date.now(),data:S._afd};
    console.log('AFD fetched from NWS '+officeName+' ('+discussion.length+' chars)');
  }catch(e){
    console.log('AFD fetch failed:',e.message);
    S._afd=null;
  }
}

function getStabilityData(){
  if(!S.forecast||!S.forecast.hourly)return null;
  const h=S.forecast.hourly;
  if(!h.cape||!h.lifted_index)return null;
  const now=new Date();
  const idx=h.time?h.time.findIndex(t=>new Date(t).getHours()===now.getHours()):0;
  if(idx<0)return null;
  const cape=h.cape[idx];
  const li=h.lifted_index[idx];
  const cin=h.convective_inhibition?h.convective_inhibition[idx]:null;
  const dewp=h.dew_point_2m?h.dew_point_2m[idx]:null;
  const temp=h.temperature_2m?h.temperature_2m[idx]:null;
  const humid=h.relative_humidity_2m?h.relative_humidity_2m[idx]:null;
  let capeRat=1;
  if(cape>=2500)capeRat=9;else if(cape>=1500)capeRat=7;else if(cape>=1000)capeRat=5;else if(cape>=500)capeRat=3;
  let liRat=1;
  if(li<=-6)liRat=9;else if(li<=-3)liRat=7;else if(li<=0)liRat=5;else if(li<=3)liRat=3;
  let cinRat=1;
  if(cin!=null){if(cin<=25)cinRat=9;else if(cin<=75)cinRat=7;else if(cin<=150)cinRat=5;else if(cin<=250)cinRat=3;}
  const stabRat=Math.round((capeRat+liRat+cinRat)/3);
  let stabDesc='Very stable atmosphere';
  if(stabRat>=8)stabDesc='Extremely unstable — high thunderstorm potential';
  else if(stabRat>=6)stabDesc='Unstable — good thunderstorm potential';
  else if(stabRat>=4)stabDesc='Marginally unstable — some thunderstorm potential';
  else if(stabRat>=2)stabDesc='Stable atmosphere — low thunderstorm potential';
  let moistRat=1;
  if(humid!=null&&dewp!=null&&temp!=null){
    const spread=temp-dewp;
    if(humid>=70&&spread<=2)moistRat=9;else if(humid>=60&&spread<=4)moistRat=7;else if(humid>=50&&spread<=8)moistRat=5;else if(humid>=40)moistRat=2;
  }
  let liftRat=1;
  if(S._windShear){
    const shearMag=S._windShear.speedDiff;
    if(shearMag>=20)liftRat=8;else if(shearMag>=10)liftRat=6;else if(shearMag>=5)liftRat=4;else liftRat=2;
  }
  const overall=Math.round((moistRat+stabRat+liftRat)/3);
  let risk='LOW';
  if(overall>=8)risk='EXTREME';else if(overall>=6)risk='HIGH';else if(overall>=4)risk='MODERATE';
  return{cape,li,cin,stabRat,stabDesc,moistRat,liftRat,overall,risk,dewp,temp,humid};
}

// v6.09: transparent "how is this scored?" explainer for the Thunderstorm
// Potential index. Kept OUT of the briefing prose — the phrase in the briefing
// is tappable and opens this clean second window instead (see fmtAIText).
function closeTstormIndexInfo(){ const el=document.getElementById('tstorm-index-panel'); if(el)el.remove(); }
function showTstormIndexInfo(){
  const d = (typeof getStabilityData==='function') ? getStabilityData() : null;
  const shear = (S._windShear && S._windShear.speedDiff!=null) ? Math.round(S._windShear.speedDiff) : null;
  const _row = (icon,name,score,inputs,scale) => `
    <div style="padding:9px 0;border-top:1px solid var(--border-subtle,#243040)">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1.1em">${icon}</span>
        <span style="font-weight:700;flex:1">${name}</span>
        <span style="font-weight:800;color:var(--accent-cyan,#22d3ee)">${score==null?'—':score+'/10'}</span>
      </div>
      ${inputs?`<div style="font-size:0.82em;color:var(--text-secondary,#9fb0c3);margin:3px 0 0 27px">${inputs}</div>`:''}
      <div style="font-size:0.72em;color:var(--text-muted,#7a8699);margin:2px 0 0 27px">${scale}</div>
    </div>`;
  const cape=d?d.cape:null, li=d?d.li:null, cin=d?d.cin:null, humid=d?d.humid:null;
  const spread=(d&&d.temp!=null&&d.dewp!=null)?Math.round((d.temp-d.dewp)*10)/10:null;
  const moistIn = d?`RH ${humid!=null?Math.round(humid)+'%':'—'}${spread!=null?` · temp–dewpoint spread ${spread}°C`:''}`:'live values unavailable';
  const stabIn = d?`CAPE ${cape!=null?Math.round(cape)+' J/kg':'—'} · Lifted Index ${li!=null?li+'°C':'—'}${cin!=null?` · CIN ${Math.round(cin)} J/kg`:''}`:'live values unavailable';
  const liftIn = shear!=null?`0–6 km bulk wind shear ${shear} mph`:'shear data unavailable';
  const overall = d?d.overall:null, risk = d?d.risk:'';
  const riskColor = overall>=8?'#ff3355':overall>=6?'#f97316':overall>=4?'#eab308':'#22c55e';
  closeTstormIndexInfo();
  const panel=document.createElement('div');
  panel.id='tstorm-index-panel';
  panel.setAttribute('style','position:fixed;top:8vh;left:50%;transform:translateX(-50%);width:min(400px,92vw);max-height:82vh;display:flex;flex-direction:column;background:var(--bg-surface,#0f1520);border:1px solid var(--border-subtle,#243040);border-radius:14px;box-shadow:0 12px 44px rgba(0,0,0,0.62);z-index:5000;overflow:hidden;font-family:system-ui;color:var(--text-primary,#e6edf5)');
  panel.innerHTML=`
    <div style="display:flex;align-items:center;gap:9px;padding:12px 14px;border-bottom:1px solid var(--border-subtle,#243040)">
      <span style="font-size:1.3em">⛈️</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">Thunderstorm Potential</div>
        <div style="font-size:0.72em;color:var(--text-secondary,#9fb0c3)">StormTracker's own 0–10 gauge — how it's scored</div>
      </div>
      <button onclick="closeTstormIndexInfo()" aria-label="Close" style="background:none;border:none;color:var(--text-secondary,#9fb0c3);font-size:1.4em;line-height:1;cursor:pointer;padding:2px 6px">&times;</button>
    </div>
    <div style="overflow-y:auto;padding:6px 16px 14px">
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0 8px">
        <div style="width:58px;height:58px;border-radius:50%;border:4px solid ${riskColor};display:flex;align-items:center;justify-content:center;flex:0 0 auto">
          <span style="font-size:1.25em;font-weight:800">${overall==null?'—':overall}</span>
        </div>
        <div>
          <div style="font-weight:800;color:${riskColor};font-size:1.05em">${risk||''} risk</div>
          <div style="font-size:0.8em;color:var(--text-secondary,#9fb0c3)">Average of the three pillars below, each scored 0–10.</div>
        </div>
      </div>
      ${_row('💧','Moisture', d?d.moistRat:null, moistIn, 'Higher when the air is humid and near saturation (small temp–dewpoint spread).')}
      ${_row('🌡️','Instability', d?d.stabRat:null, stabIn, 'Average of CAPE (≥2500 = 9), Lifted Index (≤ −6 = 9) and CIN (a small cap scores higher).')}
      ${_row('💨','Lift / shear', d?d.liftRat:null, liftIn, '0–6 km wind shear: ≥20 mph = 8, ≥10 = 6, ≥5 = 4. Helps organize and sustain storms.')}
      <div style="margin-top:12px;padding:10px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border-subtle,#243040);border-radius:9px;font-size:0.76em;color:var(--text-secondary,#9fb0c3);line-height:1.5">
        Bands: <b>0–3 Low</b> · <b>4–5 Moderate</b> · <b>6–7 High</b> · <b>8–10 Extreme</b>.
        This is a quick at-a-glance composite from live model data (Open-Meteo) — a screening tool, <b>not</b> an official NWS Convective Outlook. Always defer to NWS watches/warnings.
      </div>
    </div>`;
  document.body.appendChild(panel);
}

function getWindShearAnalysis(){
  if(!S._windShear||!S._aloftData||S._aloftData.length<2)return null;
  const sfc=S._aloftData.find(a=>a.isSfc)||S._aloftData[0];
  const upper=S._aloftData[S._aloftData.length-1];
  const vecShearKmh=S._windShear.speedDiff;
  const vecShearMph=vecShearKmh*0.621371;
  // v6.11: classify by the STANDARD 0–6 km bulk-shear m/s bands (<10 weak, 10–18
  // moderate, ≥18 strong) so the aviation + structured briefings agree with the
  // convective read — a deep-layer bulk value of ~12 m/s is moderate, not "strong".
  const vecShearMs=vecShearKmh/3.6;
  let severity='Weak';
  if(vecShearMs>=18)severity='Strong';else if(vecShearMs>=10)severity='Moderate';
  let impact='Minimal deep-layer shear — turbulence unlikely outside convection';
  if(vecShearMs>=18)impact='Strong deep-layer shear — turbulence likely in and near storms; caution for light aircraft';
  else if(vecShearMs>=10)impact='Moderate deep-layer shear — expect turbulence mainly in and near storm cores';
  else if(vecShearMs>=6)impact='Light chop possible near convection';
  const pToAlt={1013:'Surface',925:'~2,500 ft',850:'~5,000 ft',700:'~10,000 ft',500:'~18,000 ft'};
  return{
    vectorShear:fmtWind(vecShearKmh),
    severity,
    dirDiff:S._windShear.dirDiff,
    surfaceWind:`${degToDir(sfc.dir)} at ${fmtWind(sfc.spd)}`,
    upperWind:`${degToDir(upper.dir)} at ${fmtWind(upper.spd)} (${pToAlt[upper.p]||upper.p+'hPa'})`,
    impact
  };
}

function directImpactPct(diff){
  if(diff<=1)return 1.0;
  if(diff<=5)return 0.95;
  if(diff<=10)return 0.85;
  if(diff<=15)return 0.65;
  if(diff<=20)return 0.40;
  if(diff<=25)return 0.20;
  return 0;
}
S._scanHistory=[];
S._cellTracks={};
// v4.73: persistent per-cell track DB accumulating multiple position deltas so
// a smoothed observed direction/speed + consistency/confidence can be built
// over 2-3 scans. Winds-aloft stays the prior; observed motion is blended in
// with weight = confidence (see getHybridMovement). Bounded + lightweight.
S._cellTrackDB={};
S._cellTrackSeq=0;
S._fleetHybrid=null;
function recordScanSnapshot(){
  if(!S.storms||!S.storms.length)return;
  const cells=S.storms.filter(s=>s.dbz>=25&&s.lat!=null&&s.lng!=null).map(s=>({lat:s.lat,lng:s.lng,dbz:s.dbz,distance:s.distance,bearing:s.bearing}));
  // v4.73: track the storm-field centroid so a big jump (Scan Here / HD Scan to a
  // different region) wipes the persistent track DB — otherwise old-region tracks
  // would linger up to 30 min and bias the fleet steering for the new area.
  let cLat=null,cLng=null;
  if(cells.length){let sLat=0,sLng=0;for(const c of cells){sLat+=c.lat;sLng+=c.lng;}cLat=sLat/cells.length;cLng=sLng/cells.length;}
  const prev=S._scanHistory[S._scanHistory.length-1];
  if(cLat!=null&&prev&&prev.cLat!=null&&typeof haversine==='function'&&haversine(prev.cLat,prev.cLng,cLat,cLng)>50){
    S._scanHistory=[];S._cellTrackDB={};S._cellTracks={};S._fleetHybrid=null;S._cellTrackSeq=0;
  }
  const snap={ts:Date.now(),cLat,cLng,cells};
  S._scanHistory.push(snap);
  if(S._scanHistory.length>5)S._scanHistory.shift();
  updateCellTracks();
}
function _recomputeTrack(t){
  const ds=t.deltas;
  t.updates=ds.length;
  if(!ds.length){t.smoothedDir=null;t.smoothedSpd=0;t.consistency=0;t.confidence=0;return;}
  let vx=0,vy=0,spdSum=0;
  for(const d of ds){const r=d.dir*Math.PI/180;vx+=Math.sin(r);vy+=Math.cos(r);spdSum+=d.spd;}
  const resultant=Math.sqrt(vx*vx+vy*vy)/ds.length; // 0..1 circular agreement
  t.smoothedDir=(Math.atan2(vx,vy)*180/Math.PI+360)%360;
  t.smoothedSpd=spdSum/ds.length;
  t.consistency=resultant;
  // Need >=2 agreeing deltas (3 scans) before observed motion is trusted, so a
  // single noisy frame can never flip the prediction.
  if(ds.length<2)t.confidence=0;
  else{const countFactor=Math.min(1,(ds.length-1)/2);t.confidence=Math.max(0,Math.min(1,countFactor*resultant));}
}
function updateCellTracks(){
  const hist=S._scanHistory;
  const curr=hist[hist.length-1];
  if(!curr){S._cellTracks={};S._fleetHybrid=null;return;}
  const now=curr.ts;
  const used={};
  for(const c of curr.cells){
    let best=null,bestD=Infinity;
    for(const id in S._cellTrackDB){
      if(used[id])continue;
      const t=S._cellTrackDB[id];
      const dtH=(now-t.lastTs)/3600000;
      if(dtH<=0||dtH>0.5)continue;
      let pLat=t.toLat,pLng=t.toLng;
      if(t.smoothedSpd>0&&t.smoothedDir!=null&&typeof destPoint==='function'){
        const pred=destPoint(t.toLat,t.toLng,t.smoothedDir,t.smoothedSpd*dtH);
        pLat=pred[0];pLng=pred[1];
      }
      const d=haversine(c.lat,c.lng,pLat,pLng);
      const dbzDiff=Math.abs(c.dbz-t.dbz);
      if(d<bestD&&d<15&&dbzDiff<25){bestD=d;best=t;}
    }
    if(best){
      const dtH=(now-best.lastTs)/3600000;
      if(dtH>0&&dtH<=0.5){
        const dxMi=haversine(best.toLat,best.toLng,c.lat,c.lng);
        const spdMph=dxMi/dtH;
        if(spdMph<=120){
          const dy=c.lat-best.toLat,dx=(c.lng-best.toLng)*Math.cos(c.lat*Math.PI/180);
          const dir=(Math.atan2(dx,dy)*180/Math.PI+360)%360;
          best.deltas.push({dir,spd:spdMph,ts:now});
          if(best.deltas.length>4)best.deltas.shift();
        }
      }
      best.fromLat=best.toLat;best.fromLng=best.toLng;
      best.toLat=c.lat;best.toLng=c.lng;best.dbz=c.dbz;best.lastTs=now;
      _recomputeTrack(best);
      used[best.id]=1;
    }else{
      const id='ct'+(S._cellTrackSeq++);
      S._cellTrackDB[id]={id,fromLat:c.lat,fromLng:c.lng,toLat:c.lat,toLng:c.lng,dbz:c.dbz,lastTs:now,deltas:[],smoothedDir:null,smoothedSpd:0,consistency:0,confidence:0,updates:0};
      used[id]=1;
    }
  }
  for(const id in S._cellTrackDB){if((now-S._cellTrackDB[id].lastTs)/3600000>0.5)delete S._cellTrackDB[id];}
  const ids=Object.keys(S._cellTrackDB);
  if(ids.length>80){ids.sort((a,b)=>S._cellTrackDB[a].lastTs-S._cellTrackDB[b].lastTs);for(let i=0;i<ids.length-80;i++)delete S._cellTrackDB[ids[i]];}
  const tracks={};let confCount=0;
  for(const id in S._cellTrackDB){
    const t=S._cellTrackDB[id];
    if(t.smoothedDir==null||t.deltas.length<1)continue;
    const key=`${t.toLat.toFixed(2)}_${t.toLng.toFixed(2)}`;
    tracks[key]={dir:Math.round(t.smoothedDir),speed:Math.round(t.smoothedSpd),fromLat:t.fromLat,fromLng:t.fromLng,toLat:t.toLat,toLng:t.toLng,dbz:t.dbz,confidence:Math.round(t.confidence*100)/100,consistency:Math.round(t.consistency*100)/100,updates:t.updates};
    if(t.confidence>0)confCount++;
  }
  S._cellTracks=tracks;
  computeFleetHybrid();
  if(Object.keys(tracks).length)console.log(`[TRACK] ${Object.keys(tracks).length} cell tracks (${confCount} confident) from ${curr.cells.length} cells`);
}
function computeFleetHybrid(){
  // Only aggregate tracks that were matched/updated in the latest scan, so stale
  // tracks (e.g. from a previous scan area still inside the 30-min prune window)
  // cannot bias the fleet steering.
  const _hist=S._scanHistory;const _curr=_hist&&_hist.length?_hist[_hist.length-1]:null;const _now=_curr?_curr.ts:null;
  let vx=0,vy=0,spdSum=0,spdW=0,confSum=0,n=0;
  for(const id in S._cellTrackDB){
    const t=S._cellTrackDB[id];
    if(t.confidence<=0||t.smoothedDir==null)continue;
    if(_now!=null&&t.lastTs!==_now)continue;
    const w=t.confidence*Math.max(0.3,Math.min(1,(t.dbz-20)/40));
    const r=t.smoothedDir*Math.PI/180;
    vx+=Math.sin(r)*w;vy+=Math.cos(r)*w;
    spdSum+=t.smoothedSpd*w;spdW+=w;confSum+=t.confidence;n++;
  }
  if(spdW<=0||!n){S._fleetHybrid=null;return;}
  const dir=(Math.atan2(vx,vy)*180/Math.PI+360)%360;
  const resultant=Math.sqrt(vx*vx+vy*vy)/spdW; // agreement across cells
  const avgConf=confSum/n;
  const conf=Math.max(0,Math.min(0.9,avgConf*resultant)); // cap so aloft keeps ≥10% on aggregate displays
  S._fleetHybrid={direction:Math.round(dir),speed:Math.round(spdSum/spdW),confidence:Math.round(conf*100)/100,cells:n};
}
function getCellTrack(storm){
  if(!S._cellTracks||!storm)return null;
  const lng=storm.lng!=null?storm.lng:storm.lon;
  if(storm.lat==null||lng==null)return null;
  const key=`${storm.lat.toFixed(2)}_${lng.toFixed(2)}`;
  return S._cellTracks[key]||null;
}
function _blendDir(a,b,w){
  const ar=a*Math.PI/180,br=b*Math.PI/180;
  const x=Math.sin(ar)*(1-w)+Math.sin(br)*w;
  const y=Math.cos(ar)*(1-w)+Math.cos(br)*w;
  return (Math.atan2(x,y)*180/Math.PI+360)%360;
}
function _aloftMv(){
  const hasMv=S.stormMovement&&S.stormMovement.speed&&S.stormMovement.speed>=2;
  const hasAl=S._upperWindDir!=null;
  return hasMv?{direction:S.stormMovement.direction,speed:S.stormMovement.speed}
       :hasAl?{direction:(S._upperWindDir+180)%360,speed:S._upperWindSpd?Math.round(S._upperWindSpd*0.621371):10}
       :null;
}
// Per-storm confidence-weighted blend: winds-aloft prior + observed cell track.
function getHybridMovement(storm){
  const aloft=_aloftMv();
  const ct=storm?getCellTrack(storm):null;
  if(ct&&ct.confidence>0){
    const w=ct.confidence;
    if(!aloft)return{direction:ct.dir,speed:ct.speed,source:'observed',confidence:w,obsDir:ct.dir,aloftDir:null};
    return{direction:Math.round(_blendDir(aloft.direction,ct.dir,w)),speed:Math.round(aloft.speed*(1-w)+ct.speed*w),source:w>=0.6?'observed':'hybrid',confidence:w,obsDir:ct.dir,aloftDir:aloft.direction};
  }
  if(aloft)return{direction:aloft.direction,speed:aloft.speed,source:'aloft',confidence:0,obsDir:ct?ct.dir:null,aloftDir:aloft.direction};
  return null;
}
// Fleet-level blend for aggregate displays (path arrows, sonar, 3D steering).
function getSteeringMv(){
  const aloft=_aloftMv();
  const fh=S._fleetHybrid;
  if(fh&&fh.confidence>0&&aloft){
    const w=fh.confidence;
    return{direction:Math.round(_blendDir(aloft.direction,fh.direction,w)),speed:Math.round(aloft.speed*(1-w)+fh.speed*w),source:w>=0.5?'observed':'hybrid',confidence:w};
  }
  if(fh&&fh.confidence>0&&!aloft)return{direction:fh.direction,speed:fh.speed,source:'observed',confidence:fh.confidence};
  return aloft?{direction:aloft.direction,speed:aloft.speed,source:'aloft',confidence:0}:null;
}
function _movSourceBadge(h){
  if(!h||!h.source)return'';
  if(h.source==='aloft')return ` <span style="font-size:0.72em;color:#7f8c9b;font-weight:600" title="${tStr('Direction from winds-aloft steering')}">· ${tStr('aloft')}</span>`;
  const pct=Math.round((h.confidence||0)*100);
  const col=h.source==='observed'?'#22d3ee':'#a3e635';
  const lbl=h.source==='observed'?tStr('observed'):tStr('hybrid');
  return ` <span style="font-size:0.72em;color:${col};font-weight:700" title="${tStr('Based on radar-observed cell motion')} (${pct}%)">· 📡 ${lbl} ${pct}%</span>`;
}
S._terrainData=null;
S._terrainLastLat=null;
S._terrainLastLon=null;
async function fetchTerrainGrid(){
  if(!S.lat||!S.lon)return;
  const reqId=S._locReqId;
  if(S._terrainLastLat&&Math.abs(S.lat-S._terrainLastLat)<0.05&&Math.abs(S.lon-S._terrainLastLon)<0.05&&S._terrainData)return;
  try{
    const pts=[];
    const gridN=9,span=0.35;
    const step=span*2/(gridN-1);
    for(let r=0;r<gridN;r++){
      for(let c=0;c<gridN;c++){
        pts.push({lat:S.lat-span+r*step,lon:S.lon-span+c*step});
      }
    }
    const lats=pts.map(p=>p.lat.toFixed(4)).join(',');
    const lons=pts.map(p=>p.lon.toFixed(4)).join(',');
    const res=await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`,{signal:AbortSignal.timeout(8000)});
    const data=await res.json();
    const elevs=data.elevation||[];
    if(elevs.length!==gridN*gridN)return;
    const grid=[];
    for(let r=0;r<gridN;r++){
      const row=[];
      for(let c=0;c<gridN;c++) row.push(elevs[r*gridN+c]);
      grid.push(row);
    }
    const channels=[];
    const userElev=grid[Math.floor(gridN/2)][Math.floor(gridN/2)];
    for(let ang=0;ang<360;ang+=15){
      const rad=ang*Math.PI/180;
      let sumElev=0,cnt=0,lowCount=0;
      for(let d=1;d<=4;d++){
        const dr=d*(gridN-1)/(2*4);
        const rr=Math.round(gridN/2+Math.cos(rad+Math.PI/2)*dr);
        const cc=Math.round(gridN/2+Math.cos(rad)*dr);
        if(rr>=0&&rr<gridN&&cc>=0&&cc<gridN){
          sumElev+=grid[rr][cc];cnt++;
          if(grid[rr][cc]<userElev+50)lowCount++;
        }
      }
      if(cnt>0){
        const avgElev=sumElev/cnt;
        channels.push({dir:ang,avgElev,lowRatio:lowCount/cnt,diff:avgElev-userElev});
      }
    }
    const valleys=channels.filter(c=>c.diff<-30&&c.lowRatio>=0.5);
    const ridges=channels.filter(c=>c.diff>80);
    const relief=Math.max(...channels.map(c=>c.avgElev))-Math.min(...channels.map(c=>c.avgElev));
    if(reqId!==S._locReqId)return;
    S._terrainData={userElev,grid,channels,valleys,ridges,relief,gridN,span};
    S._terrainLastLat=S.lat;
    S._terrainLastLon=S.lon;
    console.log(`[TERRAIN] elev=${userElev.toFixed(0)}m relief=${relief.toFixed(0)}m valleys=${valleys.length} ridges=${ridges.length}`);
  }catch(e){console.log('[TERRAIN] fetch failed:',e.message)}
}
function getTerrainEffect(stormDir){
  if(!S._terrainData||S._terrainData.relief<50)return{channelBoost:0,ridgeBlock:0,valleyAlign:false,desc:null};
  const td=S._terrainData;
  let bestValley=null,bestValleyDiff=Infinity;
  for(const v of td.valleys){
    const d1=Math.abs(((stormDir-v.dir+180)%360)-180);
    const d2=Math.abs(((stormDir-(v.dir+180)%360+180)%360)-180);
    const d=Math.min(d1,d2);
    if(d<bestValleyDiff){bestValleyDiff=d;bestValley=v;}
  }
  let channelBoost=0,valleyAlign=false,valleyDesc=null;
  if(bestValley&&bestValleyDiff<30){
    channelBoost=Math.round(Math.max(0,Math.min(12,(30-bestValleyDiff)/30*12*(Math.abs(bestValley.diff)/100))));
    valleyAlign=true;
    valleyDesc=`Valley channel ${bestValley.dir}° (${Math.abs(bestValley.diff).toFixed(0)}m below)`;
  }
  let ridgeBlock=0,ridgeDesc=null;
  for(const r of td.ridges){
    const d=Math.abs(((stormDir-r.dir+180)%360)-180);
    if(d<25){
      const block=Math.round(Math.min(10,(r.diff-80)/150*10));
      if(block>ridgeBlock){ridgeBlock=block;ridgeDesc=`Ridge barrier ${r.dir}° (${r.diff.toFixed(0)}m above)`;}
    }
  }
  const desc=valleyDesc||ridgeDesc||null;
  return{channelBoost,ridgeBlock,valleyAlign,desc};
}
function pointInNWSPolygon(lat,lon){
  if(!S.alerts||!S.alerts.length)return[];
  const matched=[];
  for(const a of S.alerts){
    const geo=a.geometry;
    if(!geo||geo.type!=='Polygon'||!geo.coordinates||!geo.coordinates.length)continue;
    const ring=geo.coordinates[0];
    if(!ring||ring.length<3)continue;
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const xi=ring[i][1],yi=ring[i][0];
      const xj=ring[j][1],yj=ring[j][0];
      if(((yi>lon)!==(yj>lon))&&(lat<(xj-xi)*(lon-yi)/(yj-yi)+xi))inside=!inside;
    }
    if(inside){
      const p=a.properties||{};
      matched.push({event:p.event||'Alert',severity:p.severity||'Unknown',urgency:p.urgency||'',headline:p.headline||''});
    }
  }
  return matched;
}
function calcStormETA(storm){
  if(storm._eta&&storm._etaScanId===S._stormScanId)return storm._eta;
  const _hyb=getHybridMovement(storm);
  if(!_hyb||_hyb.speed<2){const _r={eta:null,impact:0,approaching:false};storm._eta=_r;storm._etaScanId=S._stormScanId;return _r;}
  const cellTrack=getCellTrack(storm);
  const _obsBased=_hyb.source==='observed'||_hyb.source==='hybrid';
  const movDir=_hyb.direction;
  const movSpd=_hyb.speed;
  const baseWidthMi=Math.max(0,Math.min(3,(storm.dbz-20)/15));
  const widthAngle=storm.distance>0.5?Math.atan2(baseWidthMi,storm.distance)*180/Math.PI:15;
  const CONE_HALF=15+widthAngle;
  const bearingToUser=(storm.bearing+180)%360;
  const diff=Math.abs(((movDir-bearingToUser+180)%360)-180);
  const inCone=diff<=CONE_HALF;
  const closingSpeed=movSpd*Math.cos(Math.min(diff,60)*Math.PI/180);
  const proxRange=Math.max(1.5,baseWidthMi+0.5);
  const nwsWarnings=pointInNWSPolygon(storm.lat,storm.lng);
  const nwsBoost=nwsWarnings.length>0?15:0;
  const hasSevereWarning=nwsWarnings.some(w=>w.severity==='Severe'||w.severity==='Extreme');
  const terrain=getTerrainEffect(movDir);
  const terrainNet=terrain.channelBoost-terrain.ridgeBlock;
  if(!inCone||closingSpeed<=1){
    if(storm.distance<=proxRange){
      const proxPct=Math.round(Math.min(90,Math.max(0,(proxRange-storm.distance)/proxRange*60+storm.dbz/2.5+nwsBoost+Math.max(0,terrainNet))));
      const _r={eta:null,impact:proxPct,approaching:false,closingSpeed:0,proximity:true,cellTrack:!!cellTrack,nwsWarnings,terrain:terrain.desc};
      storm._eta=_r;storm._etaScanId=S._stormScanId;return _r;
    }
    if(hasSevereWarning&&storm.distance<=30){
      const warnPct=Math.round(Math.min(60,25+storm.dbz/3));
      const _r={eta:null,impact:warnPct,approaching:false,closingSpeed:0,nwsWarning:true,nwsWarnings,terrain:terrain.desc};
      storm._eta=_r;storm._etaScanId=S._stormScanId;return _r;
    }
    const _r={eta:null,impact:Math.max(0,nwsBoost+terrainNet),approaching:false,nwsWarnings,terrain:terrain.desc};
    storm._eta=_r;storm._etaScanId=S._stormScanId;return _r;
  }
  if(storm.distance<=proxRange){
    const proxPct=Math.round(Math.min(95,Math.max(0,(proxRange-storm.distance)/proxRange*60+storm.dbz/2.5+20+nwsBoost+Math.max(0,terrainNet))));
    const _r={eta:null,impact:proxPct,approaching:false,closingSpeed:0,proximity:true,cellTrack:!!cellTrack,nwsWarnings,terrain:terrain.desc};
    storm._eta=_r;storm._etaScanId=S._stormScanId;return _r;
  }
  const etaHrs=storm.distance/closingSpeed;
  const etaMin=Math.round(etaHrs*60*100)/100;
  const distScore=Math.max(0,1-storm.distance/80);
  const spdScore=Math.min(1,movSpd/20);
  const intScore=Math.min(1,(storm.dbz-15)/40);
  const widthScore=Math.min(1,baseWidthMi/3);
  const directMult=directImpactPct(diff);
  const trackBonus=cellTrack?5:0;
  const baseScore=directMult*50+distScore*15+spdScore*8+intScore*15+widthScore*12+nwsBoost+trackBonus+terrainNet;
  const closeBoost=storm.distance<20?Math.round((20-storm.distance)/20*25):0;
  let pct=Math.round(Math.min(100,baseScore+closeBoost));
  if(storm.distance<=5&&diff<=15)pct=Math.max(pct,92);
  else if(storm.distance<=10&&diff<=15)pct=Math.max(pct,82);
  else if(storm.distance<=20&&diff<=12)pct=Math.max(pct,72);
  if(storm._rotation)pct=Math.max(pct,Math.min(100,pct+15));
  if(hasSevereWarning)pct=Math.max(pct,Math.min(95,pct+20));
  if(storm.distance<=proxRange)pct=Math.max(pct,Math.round(75+(proxRange-storm.distance)/proxRange*20));
  let _tierKey=null,_brief=null;
  try{_brief=calcStormETAForBriefing(storm);_tierKey=_brief&&_brief.classification;}catch(e){}
  const _isApproaching=(typeof isApproachingTier==='function')?isApproachingTier(_tierKey)&&pct>0&&etaMin!=null:(pct>0&&etaMin!=null);
  let _etaOut=etaMin;
  if(_brief&&_brief.etaMin!=null&&(_tierKey==='direct'||_tierKey==='near_direct'))_etaOut=_brief.etaMin;
  const _closingOut=(_brief&&_brief.closingMph!=null)?_brief.closingMph:Math.round(closingSpeed*100)/100;
  const _perpMiss=(_brief&&_brief.perpMissMi!=null&&isFinite(_brief.perpMissMi))?_brief.perpMissMi:null;
  const _eta={eta:_etaOut,impact:pct,approaching:_isApproaching,perpTier:_tierKey,perpMissMi:_perpMiss,closingSpeed:_closingOut,angleDiff:Math.round(diff),cellTrack:!!cellTrack,trackDir:cellTrack?cellTrack.dir:null,trackSpd:cellTrack?cellTrack.speed:null,movDir,movSpd,source:_hyb.source,confidence:_hyb.confidence,obsBased:_obsBased,nwsWarnings,terrain:terrain.desc};
  storm._eta=_eta;storm._etaScanId=S._stormScanId;
  return _eta;
}
function buildStormCone(storm,mv,rangeOverride){
  if(!mv||!mv.speed||mv.speed<2||typeof destPoint!=='function')return null;
  const range=(rangeOverride!=null&&rangeOverride>0)?rangeOverride:Math.max((S&&S.scanRadius)||80,storm.distance*1.3,20);
  const dir=mv.direction;
  const baseWidthMi=Math.max(0,Math.min(3,(storm.dbz-20)/15));
  const perpL=(dir-90+360)%360;
  const perpR=(dir+90)%360;
  if(baseWidthMi>0.1){
    const bL=destPoint(storm.lat,storm.lng,perpL,baseWidthMi);
    const bR=destPoint(storm.lat,storm.lng,perpR,baseWidthMi);
    const fL=destPoint(bL[0],bL[1],dir-15,range);
    const fC=destPoint(storm.lat,storm.lng,dir,range);
    const fR=destPoint(bR[0],bR[1],dir+15,range);
    return[bL,fL,fC,fR,bR];
  }
  const fL=destPoint(storm.lat,storm.lng,dir-15,range);
  const fC=destPoint(storm.lat,storm.lng,dir,range);
  const fR=destPoint(storm.lat,storm.lng,dir+15,range);
  return[[storm.lat,storm.lng],fL,fC,fR,[storm.lat,storm.lng]];
}
// v4.83: in-path rain coverage for a storm's projected track cone, shown on the Storms-tab
// card (replaces the old per-cone 💧 text label that cluttered the radar map). Cached per
// storm per scan so re-renders don't re-run the raw-point loop. Returns {count, maxDbz}
// (count 0 when no track/coverage).
// v5.10: the MAP cone always projects the full scan radius (≥80 mi) to show where a storm
// MIGHT go, but for the card's "in path" stat that swept the whole radius and reported a
// distant strong core (e.g. 55 dBZ) as the max even when THIS cell is only 30 dBZ. For the
// stat we clamp the cone length to roughly the path between the storm and you (scales with
// distance, floored so close storms still show their near-path core, capped at scan radius),
// so "in path" reflects the rain this storm actually brings toward you — not the whole radius.
function getStormConeRain(s){
  if(!s)return{count:0,minDbz:0,avgDbz:0,maxDbz:0};
  if(s._coneRainScanId===S._stormScanId&&s._coneRain)return s._coneRain;
  let res={count:0,minDbz:0,avgDbz:0,maxDbz:0};
  try{
    const mv=(typeof getHybridMovement==='function'?getHybridMovement(s):null)
      ||(typeof getSteeringMv==='function'?getSteeringMv():null)
      ||((S.stormMovement&&S.stormMovement.speed>=2)?S.stormMovement:null);
    if(mv&&mv.speed>=2&&typeof buildStormCone==='function'&&typeof _coneRainStats==='function'){
      const rng=Math.max(10,Math.min((S.scanRadius||80),(s.distance||0)+6));
      const pts=buildStormCone(s,mv,rng);
      if(pts)res=_coneRainStats(pts)||res;
    }
  }catch(e){}
  // v6.32: the cone samples the corridor AHEAD of the storm (from its apex
  // forward), so its numbers describe the rain already sitting in the path
  // between this cell and you — reported as a min·avg·max spread rather than a
  // lone max that just duplicated the card's Peak dBZ.
  s._coneRain=res;s._coneRainScanId=S._stormScanId;
  return res;
}
function isUserInStormCone(storm,mv,uLat,uLon){
  const pts=buildStormCone(storm,mv);
  if(!pts||pts.length<3||uLat==null||uLon==null)return false;
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const yi=pts[i][0],xi=pts[i][1],yj=pts[j][0],xj=pts[j][1];
    if(((yi>uLat)!==(yj>uLat))&&(uLon<(xj-xi)*(uLat-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}
function _stormHashKey(s){return `${(s.lat||0).toFixed(2)}_${(s.lng||0).toFixed(2)}`}
function calcStormETAForBriefing(storm){
  if(storm._brief&&storm._briefScanId===S._stormScanId)return storm._brief;
  const cellTrack=(typeof getCellTrack==='function')?getCellTrack(storm):null;
  const _hyb=(typeof getHybridMovement==='function')?getHybridMovement(storm):null;
  const _mv=_hyb?{direction:_hyb.direction,speed:_hyb.speed}:null;
  const distRound=Math.round(storm.distance*10)/10;
  if(!_mv||_mv.speed<2){
    return{classification:'unknown',etaMin:null,closingMph:0,perpMissMi:distRound,distanceMi:distRound,sideBearing:null,movDirDeg:null,movSpdMph:null,source:'none',inCone:false,coneConfidence:null};
  }
  if(!S._lastStormClass)S._lastStormClass={};
  const stormKey=_stormHashKey(storm);
  const movRad=_mv.direction*Math.PI/180;
  const Vx=_mv.speed*Math.sin(movRad);
  const Vy=_mv.speed*Math.cos(movRad);
  const vMag=_mv.speed;
  const bRad=storm.bearing*Math.PI/180;
  const Rx=-Math.sin(bRad)*storm.distance;
  const Ry=-Math.cos(bRad)*storm.distance;
  const rMag=storm.distance;
  const source=_hyb?_hyb.source:(cellTrack?'cell':'aloft');
  if(rMag<0.05){
    S._lastStormClass[stormKey]='direct';
    const _if=Math.max(0,Math.min(1,(storm.dbz-20)/55));
    return{classification:'direct',etaMin:0,closingMph:Math.round(vMag*10)/10,perpMissMi:0,distanceMi:distRound,sideBearing:null,movDirDeg:Math.round(_mv.direction),movSpdMph:Math.round(_mv.speed),source,inCone:true,coneConfidence:1,closeness:1.0,intensityFactor:Math.round(_if*100)/100,impactScore:Math.round(_if*100)/100,estDbzAtUser:storm.dbz};
  }
  const Vhx=Vx/vMag,Vhy=Vy/vMag;
  const Rhx=Rx/rMag,Rhy=Ry/rMag;
  const closing=Vx*Rhx+Vy*Rhy;
  const tHrs=(Rx*Vhx+Ry*Vhy)/vMag;
  const perpMiss=Math.abs(Rx*Vhy-Ry*Vhx);
  const cpx=-Rx+Vx*tHrs;
  const cpy=-Ry+Vy*tHrs;
  const sideBearing=(Math.atan2(cpx,cpy)*180/Math.PI+360)%360;
  const baseWidthMi=Math.max(0,Math.min(3,(storm.dbz-20)/15));
  const userInCone=(S.lat!=null&&S.lon!=null)&&isUserInStormCone(storm,_mv,S.lat,S.lon);
  let coneConfidence=null;
  if(userInCone){
    const distAlongV=Math.max(0,Rx*Vhx+Ry*Vhy);
    const halfWidthAtUser=baseWidthMi+distAlongV*Math.tan(15*Math.PI/180);
    const rawConf=Math.max(0,Math.min(1,1-perpMiss/Math.max(halfWidthAtUser,0.001)));
    coneConfidence=0.30+0.70*rawConf;
  }
  const m=perpMiss;
  // v5.63: closeness anchored to the 1.5-mi DIRECT range (per user spec) —
  //   0.0mi=100% · 0.5mi=80% · 1.0mi=60% · 1.5mi=40%  (linear 100%−40%·miles),
  // reaching 0 by 2.5 mi. estDbzAtUser = peak dBZ × closeness, so a cell whose
  // track passes well to your side estimates little/no rain ON you (it used to
  // read near-full strength). The badge, the "Est. at you" dBZ and the threat
  // score now all key off this same cross-track distance.
  let closeness=Math.max(0,1-0.4*m);
  const intensityFactor=Math.max(0,Math.min(1,(storm.dbz-20)/55));
  const inboundLive=userInCone&&closing>0;
  const isClosing=closing>0;
  const impactScore=isClosing?(closeness*intensityFactor):0;
  const estDbzAtUser=isClosing?Math.round(storm.dbz*closeness):null;
  let closenessPct=null;
  if(m<=3)closenessPct=Math.round(100-(m/3)*14);
  else if(m<=6)closenessPct=Math.round(85-((m-3)/3)*19);
  else if(m<=12)closenessPct=Math.round(65-((m-6)/6)*20);
  else if(m<=24)closenessPct=Math.round(44-((m-12)/12)*14);
  else if(m<=48)closenessPct=Math.round(30-((m-24)/24)*15);
  else closenessPct=Math.max(0,Math.round(15-((m-48)/12)*5));
  const base={
    closingMph:Math.round(closing*10)/10,
    perpMissMi:Math.round(perpMiss*10)/10,
    distanceMi:distRound,
    movDirDeg:Math.round(_mv.direction),
    movSpdMph:Math.round(_mv.speed),
    source,
    inCone:userInCone,
    coneConfidence,
    closeness:Math.round(closeness*100)/100,
    intensityFactor:Math.round(intensityFactor*100)/100,
    impactScore:Math.round(impactScore*100)/100,
    estDbzAtUser,
    closenessPct
  };
  let classification;
  let etaMinOut=null;
  let sideBearingOut=Math.round(sideBearing);
  if(inboundLive){
    const _t=(typeof perpTier==='function')?perpTier(perpMiss):null;
    classification=_t?_t.key:'far';
    if(classification==='direct')etaMinOut=Math.round((rMag/Math.max(closing,1))*60);
    else if(classification==='near_direct')etaMinOut=Math.round((rMag/Math.max(closing,1))*60);
  }else if(closing<=0||tHrs<=0){
    classification='moving_away';
    sideBearingOut=null;
  }else{
    classification='passing';
  }
  S._lastStormClass[stormKey]=classification;
  const _out=Object.assign({},base,{classification,etaMin:etaMinOut,sideBearing:sideBearingOut});
  storm._brief=_out;storm._briefScanId=S._stormScanId;
  return _out;
}
if(typeof window!=='undefined'){
  window.calcStormETAForBriefing=calcStormETAForBriefing;
  window.buildStormCone=buildStormCone;
  window.isUserInStormCone=isUserInStormCone;
  try{
    const params=new URLSearchParams(window.location.search);
    if(params.get('debugBriefing')==='1'){
      const _saveMv=S.stormMovement,_saveCt=S._cellTracks;
      S.stormMovement={direction:45,speed:24};S._cellTracks=null;
      const _saveLat=S.lat,_saveLon=S.lon;S.lat=0;S.lon=0;S._lastStormClass={};
      const r=calcStormETAForBriefing({lat:0,lng:0,distance:20,bearing:292.5,dbz:55});
      console.log('[briefing-test] 20mi WNW NE@24mph →',r);
      console.assert(r.classification==='passing','expected passing, got '+r.classification);
      console.assert(r.etaMin==null,'expected null ETA, got '+r.etaMin);
      console.assert(r.impactScore>0,'expected impactScore>0 (closing>0 should populate impact even for passing), got '+r.impactScore);
      console.assert(r.estDbzAtUser!=null,'expected estDbzAtUser non-null (closing>0 should populate even for passing), got '+r.estDbzAtUser);
      S._lastStormClass={};
      S.stormMovement={direction:90,speed:24};
      const r3=calcStormETAForBriefing({lat:0,lng:0,distance:20,bearing:270,dbz:55});
      console.log('[briefing-test] 20mi W E@24mph (direct) →',r3);
      console.assert(r3.classification==='direct','expected direct, got '+r3.classification);
      console.assert(r3.etaMin>=48&&r3.etaMin<=52,'expected ETA ~50min, got '+r3.etaMin);
      console.assert(r3.impactScore>=0.60,'expected impactScore>=0.60 (closeness=1×intensity≈0.64), got '+r3.impactScore);
      console.assert(r3.estDbzAtUser===55,'expected estDbzAtUser=55, got '+r3.estDbzAtUser);
      S._lastStormClass={};
      S.stormMovement={direction:270,speed:24};
      const r4=calcStormETAForBriefing({lat:0,lng:0,distance:20,bearing:270,dbz:55});
      console.log('[briefing-test] 20mi W W@24mph (away) →',r4);
      console.assert(r4.classification==='moving_away','expected moving_away, got '+r4.classification);
      console.assert(r4.impactScore===0,'expected impactScore=0 for moving_away, got '+r4.impactScore);
      console.assert(r4.estDbzAtUser==null,'expected estDbzAtUser=null for moving_away, got '+r4.estDbzAtUser);
      S._lastStormClass={};
      S.stormMovement={direction:280,speed:30};
      const r5=calcStormETAForBriefing({lat:0,lng:0,distance:10,bearing:90,dbz:55});
      console.log('[briefing-test] Hawkinsville (10mi E, motion 280°@30mph, perpMiss≈1.7) →',r5);
      console.assert(r5.classification==='direct'||r5.classification==='near_miss','expected direct/near_miss, got '+r5.classification);
      console.assert(r5.impactScore>=0.16&&r5.impactScore<=0.24,'expected impactScore≈0.20 (v5.63 curve), got '+r5.impactScore);
      console.assert(r5.estDbzAtUser>=16&&r5.estDbzAtUser<=20,'expected estDbz≈18 (v5.63 curve), got '+r5.estDbzAtUser);
      S._lastStormClass={};
      S.stormMovement={direction:19,speed:18};
      const r6=calcStormETAForBriefing({lat:0,lng:0,distance:75,bearing:199,dbz:42});
      console.log('[briefing-test] 75mi SSW NNE@18mph (repro screenshot) →',r6);
      console.assert(r6.classification!=='passing','expected non-passing for 75mi inbound storm at scanRadius 80, got '+r6.classification);
      console.assert(r6.impactScore>0,'expected impactScore>0 for closing storm, got '+r6.impactScore);
      console.assert(r6.estDbzAtUser!=null,'expected estDbzAtUser non-null for closing storm, got '+r6.estDbzAtUser);
      S.lat=_saveLat;S.lon=_saveLon;
      S.stormMovement=_saveMv;S._cellTracks=_saveCt;
    }
  }catch(e){}
}
function impactLabel(pct){
  if(pct>=81)return{text:'CRITICAL',color:'#ef4444'};
  if(pct>=61)return{text:'HIGH',color:'#f97316'};
  if(pct>=41)return{text:'MODERATE',color:'#eab308'};
  if(pct>=21)return{text:'LOW',color:'#60a5fa'};
  if(pct>=1)return{text:'MINIMAL',color:'#94a3b8'};
  return{text:'NONE',color:'#6b7280'};
}

function computeTopStorms(){
  S._topStorms=[];
  S._topStormAnalysis={inbound:[],overhead:[],nearby:[],allWithEta:[]};
  if(!S.storms||!S.storms.length)return;
  for(const s of S.storms){s._eta=calcStormETA(s)}
  S._topStormAnalysis.allWithEta=S.storms;
  const inbound=[],overhead=[],nearby=[];
  for(const s of S.storms){
    const e=s._eta;
    if(e&&e.proximity){overhead.push(s);continue}
    let _cls=null;
    try{if(!s._brief)s._brief=calcStormETAForBriefing(s);_cls=s._brief&&s._brief.classification}catch(err){}
    const _inboundTier=(_cls==='direct'||_cls==='near_direct'||_cls==='near_miss');
    if(e&&e.approaching&&e.impact>0&&e.eta!=null&&_inboundTier){inbound.push(s)}
    else{nearby.push(s)}
  }
  inbound.sort((a,b)=>b.dbz===a.dbz?(a._eta.eta-b._eta.eta):(b.dbz-a.dbz));
  S._topStorms=inbound.slice(0,12);
  const overflow=inbound.slice(12);
  S._topStormAnalysis.inbound=S._topStorms;
  S._topStormAnalysis.overhead=overhead;
  S._topStormAnalysis.nearby=nearby.concat(overflow);
}

async function scanRadarForStorms(){
  if(S._radarAnimPlaying)stopRadarAnim(S.map);
  if(!S.lat)return;
  const reqId=S._locReqId;
  if(!S._etaRescanInProgress)S._stormETAs={};
  clearViewScanCircle();
  const useNexrad=S.radarSource==='nexrad';
  showScanOverlay();
  if(reqId!==S._locReqId){hideScanOverlay();return}
  S._fullScanActive=true;
  if(typeof _bootStep==='function')_bootStep('scan','Scanning radar…');
  // v4.76: block on the winds-aloft gate before scanning/rendering any points,
  // so storm steering / ETAs / cones never run without aloft data on first
  // load. AFD is fetched in parallel since it doesn't gate point rendering.
  const _waGateP=ensureWindsAloft(S.lat,S.lon,reqId);
  const _afdP=fetchAFD();
  const _waOk=await _waGateP;await _afdP;
  if(reqId!==S._locReqId){hideScanOverlay();return}
  if(!_waOk)toast('⚠️ Winds aloft unavailable — storm motion & ETAs may be limited');
  scanStep(2,'Scanning radar tiles...');
  try{
    // v5.44: thin wrapper over the unified runRadarScan engine (radar.js).
    // Scan floor is the shared STORM_MIN_DBZ so the Rain Clock (same constant)
    // always matches the cards' detection floor.
    const result=await runRadarScan({
      lat:S.lat,lon:S.lon,
      radiusMi:S.scanRadius,
      minDbz:(typeof STORM_MIN_DBZ!=='undefined')?STORM_MIN_DBZ:15,
      source:useNexrad?'nexrad':'rainviewer'
    });
    if(!result){toast('No radar data available');S.storms=[];if(typeof bumpStormScanId==='function')bumpStormScanId();computeTopStorms();renderStorms();updateStormBadges();return}
    if(!useNexrad)S.radarFrames=result.frames;
    const rawPoints=result.points;
    console.log('[SCAN] src='+S.radarSource+' zoom='+result.zoom+' rawPoints='+rawPoints.length);

    // v5.46: unified commit pipeline (radar.js) — state + consumer updates in
    // ONE place; only the storms-scan extras (polygons, boot step, tiered
    // hi-res, etc.) remain below.
    const committed=await commitScanResults(rawPoints,{
      useNexrad,
      radarAgeMs:result.radarAgeMs,
      fullDetect:true,
      plotLabel:n=>`Plotting ${n} storm points...`,
      abortCheck:()=>reqId===S._locReqId
    });
    if(!committed){hideScanOverlay();return}
    const srcLabel=useNexrad?'NEXRAD':'RainViewer';
    if(S.map){plotSPCWatchPolygons(S.map);plotNWSWarningPolygons(S.map);plotSPCReports(S.map);plotNHCTracks(S.map)}
    // v6.23 (Stage 2): fire-and-forget the outer 80–200 mi awareness scan (gated to
    // tropical systems in range + zones on; throttled internally). Fully additive —
    // it can't affect the inner scan / storm cards / ETA above.
    if(typeof maybeRunOuterScan==='function')maybeRunOuterScan();
    hideScanOverlay();
    toast(`${S.storms.length} cell${S.storms.length!==1?'s':''} found (${srcLabel})`);
    if(typeof _bootStepDone==='function')_bootStepDone('scan',`Radar scan: ${S.storms.length} cell${S.storms.length!==1?'s':''}`);
    if(S.map&&S._showPathArrows)setTimeout(()=>buildPathArrows(S.map),150);
    scheduleAutoScan();
    _checkTieredHiRes();
    setTimeout(()=>{checkStormCellAlerts()},600);
    if(!S._windCache||(Date.now()-S._windCache.ts)>32*60000){
      console.log('[WindsAloft] Timed out during scan — scheduling auto-retry in 4s...');
      setTimeout(async()=>{
        await fetchWindsAloft();
        if(S._windCache&&(Date.now()-S._windCache.ts)<6000&&S.storms.length){
          if(typeof refreshStormViewsForWinds==='function')refreshStormViewsForWinds();
          console.log('[WindsAloft] All storm surfaces refreshed with fresh winds');
        }
      },4000);
    }
  }catch(e){hideScanOverlay();toast('Radar scan failed: '+e.message);console.error('Scan error:',e);if(typeof _bootStepFail==='function')_bootStepFail('scan','Radar scan failed')}
  finally{S._fullScanActive=false}
}

let _hiResTierDismissed={15:false,10:false,5:false};
let _hiResPopupActive=false;
let _hiResPopupTimer=null;
function _resetHiResTiers(){_hiResTierDismissed={15:false,10:false,5:false}}
function _checkTieredHiRes(){
  if(!S.map||S._lastScanWasHiRes||_hiResPopupActive)return;
  const severe=S.storms.filter(s=>s.dbz>=60);
  if(!severe.length){_resetHiResTiers();return}
  const closest=Math.min(...severe.map(s=>s.distance));
  const tiers=[15,10,5];
  for(const tier of tiers){
    if(closest<=tier&&!_hiResTierDismissed[tier]){
      if(tier===5){
        _showHiResPopup(tier,closest,severe[0].dbz,true);
      }else{
        _showHiResPopup(tier,closest,severe[0].dbz,false);
      }
      return;
    }
  }
}
function _showHiResPopup(tierMi,distMi,peakDbz,autoTrigger){
  _hiResPopupActive=true;
  const existing=document.getElementById('hires-popup');
  if(existing)existing.remove();
  if(_hiResPopupTimer){clearTimeout(_hiResPopupTimer);_hiResPopupTimer=null}
  const popup=document.createElement('div');popup.id='hires-popup';
  const urgent=tierMi<=5;
  const borderClr=urgent?'#ff3333':'#ff8800';
  const bgClr=urgent?'rgba(40,8,8,0.96)':'rgba(20,12,4,0.96)';
  popup.style.cssText=`position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:${bgClr};border:2px solid ${borderClr};border-radius:12px;padding:18px 22px;max-width:320px;width:90%;box-shadow:0 0 30px rgba(0,0,0,0.8),0 0 15px ${borderClr}40;backdrop-filter:blur(8px);text-align:center;animation:hiresPopIn 0.3s ease`;
  const icon=urgent?'🚨':'⚠️';
  const title=urgent?'SEVERE STORM NEARBY':'Storm Cell Detected';
  const action=autoTrigger?'Launching deep analysis for your safety...':'Would you like a deep analysis?';
  const distUnit=S.radarMetric?Math.round(distMi*1.60934)+' km':distMi.toFixed(1)+' mi';
  let html=`<div style="font-size:1.4em;margin-bottom:6px">${icon}</div>`;
  html+=`<div style="color:${borderClr};font-weight:700;font-size:0.85em;margin-bottom:6px">${title}</div>`;
  html+=`<div style="color:#e2e8f0;font-size:0.7em;margin-bottom:4px">≥50 dBZ cell at <b>${distUnit}</b> (peak ${peakDbz} dBZ)</div>`;
  html+=`<div style="color:rgba(255,255,255,0.6);font-size:0.6em;margin-bottom:12px">${action}</div>`;
  if(autoTrigger){
    html+=`<div id="hires-countdown" style="color:${borderClr};font-size:0.65em;font-weight:600;margin-bottom:8px">Scanning in 5s...</div>`;
    html+=`<button onclick="_hiResAccept()" style="width:100%;padding:8px;border-radius:8px;border:1px solid ${borderClr};background:${borderClr}22;color:${borderClr};font-weight:700;font-size:0.7em;cursor:pointer">Scan Now</button>`;
  }else{
    html+=`<div id="hires-countdown" style="color:rgba(255,255,255,0.4);font-size:0.55em;margin-bottom:10px">Auto-dismiss in 30s</div>`;
    html+=`<div class="flex-gap-8">`;
    html+=`<button onclick="_hiResAccept()" style="flex:1;padding:8px;border-radius:8px;border:1px solid #00cc44;background:rgba(0,204,68,0.15);color:#00cc44;font-weight:700;font-size:0.7em;cursor:pointer">Yes, Scan</button>`;
    html+=`<button onclick="_hiResDecline(${tierMi})" style="flex:1;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.5);font-weight:600;font-size:0.7em;cursor:pointer">Not Now</button>`;
    html+=`</div>`;
  }
  popup.innerHTML=html;
  document.body.appendChild(popup);
  const timeoutSec=autoTrigger?5:30;
  let remaining=timeoutSec;
  const countEl=()=>document.getElementById('hires-countdown');
  const interval=setInterval(()=>{
    remaining--;
    const el=countEl();
    if(remaining<=0){
      clearInterval(interval);
      if(autoTrigger){_hiResAccept()}
      else{_hiResDecline(tierMi)}
      return;
    }
    if(el){
      if(autoTrigger)el.textContent=`Scanning in ${remaining}s...`;
      else el.textContent=`Auto-dismiss in ${remaining}s`;
    }
  },1000);
  _hiResPopupTimer=interval;
}
function _hiResAccept(){
  _hiResPopupActive=false;
  if(_hiResPopupTimer){clearInterval(_hiResPopupTimer);_hiResPopupTimer=null}
  const p=document.getElementById('hires-popup');if(p)p.remove();
  _resetHiResTiers();
  if(S.map){
    toast('🔍 Launching Hi-Res deep analysis...');
    S.map.setView([S.lat,S.lon],11,{animate:true,duration:0.5});
    setTimeout(()=>scanRadarHiRes(S.map,true),800);
  }
}
function _hiResDecline(tierMi){
  _hiResPopupActive=false;
  if(_hiResPopupTimer){clearInterval(_hiResPopupTimer);_hiResPopupTimer=null}
  const p=document.getElementById('hires-popup');if(p)p.remove();
  _hiResTierDismissed[tierMi]=true;
}
function loadImage(url){
  return fetch(url).then(r=>{
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.blob();
  }).then(blob=>{
    if(typeof createImageBitmap==='function'){
      return createImageBitmap(blob,{premultiplyAlpha:'none'});
    }
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.crossOrigin='anonymous';
      img.onload=()=>resolve(img);
      img.onerror=reject;
      img.src=URL.createObjectURL(blob);
    });
  });
}
// lonToTileX / latToTileY moved to radar-shared.js (loaded first; globals) —
// shared with the Node scanner. tileXToLon / tileYToLat stay here (app-only).
function tileXToLon(x,z){return x/Math.pow(2,z)*360-180}
function tileYToLat(y,z){const n=Math.PI-2*Math.PI*y/Math.pow(2,z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)))}

function spacingFilter(points,hiRes){
  const validPoints=points.filter(p=>{
    if(p.dbz>=30)return true;
    if(hiRes&&p.dbz>=20)return true;
    const radius=p.dbz>=25?5:8;
    let nearby=0;
    for(const q of points){
      if(q===p)continue;
      const dx=(p.lat-q.lat)*69,dy=(p.lng-q.lng)*69*Math.cos(p.lat*Math.PI/180);
      if(Math.sqrt(dx*dx+dy*dy)<radius)nearby++;
      if(nearby>=1)return true;
    }
    return false;
  });
  validPoints.sort((a,b)=>b.dbz-a.dbz);
  const out=[];
  for(const p of validPoints){
    const minSpacing=hiRes?(p.dbz>=45?0.3:p.dbz>=35?0.4:0.5):(p.dbz>=45?0.8:p.dbz>=35?1.2:1.8);
    let merged=false;
    for(const e of out){
      if(haversine(p.lat,p.lng,e.lat,e.lng)<minSpacing){
        e.pixels++;
        if(p.dbz>e.dbz)e.dbz=p.dbz;
        merged=true;break;
      }
    }
    if(!merged){
      const dist=haversine(S.lat,S.lon,p.lat,p.lng);
      const bear=bearingDeg(S.lat,S.lon,p.lat,p.lng);
      out.push({lat:p.lat,lng:p.lng,dbz:p.dbz,distance:dist,bearing:bear,pixels:1});
    }
  }
  return out;
}

// ==========================================
// HOOK ECHO / TORNADIC SIGNATURE DETECTION
// ==========================================
function detectHookEchoes(rawPts, storms) {
  if (!rawPts || rawPts.length < 20 || !storms || !storms.length) return;
  const strongCells = storms.filter(s => s.dbz >= 55);
  if (!strongCells.length) return;
  for (const cell of strongCells) {
    let hasGradient = false;
    for (const p of rawPts) {
      if (p.dbz > 35) continue;
      const dlat = p.lat - cell.lat;
      const dlng = (p.lng - cell.lng) * Math.cos(cell.lat * Math.PI / 180);
      const distMi = Math.sqrt(dlat * dlat + dlng * dlng) * 69;
      if (distMi <= 1) { hasGradient = true; break; }
    }
    if (!hasGradient) { cell._hookScore = 0; cell._hookEcho = false; continue; }
    const score = _computeHookScore(rawPts, cell);
    cell._hookScore = score;
    cell._hookEcho = score >= 0.45;
    if (cell._hookEcho) {
      console.log('[HOOK] Possible rotation detected at', cell.lat.toFixed(3), cell.lng.toFixed(3), 'dBZ=' + cell.dbz, 'hookScore=' + score.toFixed(3));
    }
  }
}
function _computeHookScore(rawPts, cell) {
  const coreRadius = 0.08;
  const hookRadius = 0.22;
  const corePts = [];
  const ringPts = [];
  for (const p of rawPts) {
    const dlat = p.lat - cell.lat;
    const dlng = (p.lng - cell.lng) * Math.cos(cell.lat * Math.PI / 180);
    const dist = Math.sqrt(dlat * dlat + dlng * dlng);
    if (dist <= coreRadius && p.dbz >= 35) corePts.push({ ...p, _dx: dlng, _dy: dlat, _dist: dist });
    else if (dist <= hookRadius && p.dbz >= 15) ringPts.push({ ...p, _dx: dlng, _dy: dlat, _dist: dist });
  }
  if (corePts.length < 5 || ringPts.length < 3) return 0;
  const coreAngles = corePts.map(p => Math.atan2(p._dy, p._dx));
  const ringAngles = ringPts.map(p => Math.atan2(p._dy, p._dx));
  const sectors = 12;
  const sectorSize = (2 * Math.PI) / sectors;
  const coreSectorCounts = new Array(sectors).fill(0);
  const ringSectorCounts = new Array(sectors).fill(0);
  const ringSectorMaxDbz = new Array(sectors).fill(0);
  coreAngles.forEach(a => {
    const idx = Math.floor(((a + Math.PI) / (2 * Math.PI)) * sectors) % sectors;
    coreSectorCounts[idx]++;
  });
  ringPts.forEach(p => {
    const a = Math.atan2(p._dy, p._dx);
    const idx = Math.floor(((a + Math.PI) / (2 * Math.PI)) * sectors) % sectors;
    ringSectorCounts[idx]++;
    if (p.dbz > ringSectorMaxDbz[idx]) ringSectorMaxDbz[idx] = p.dbz;
  });
  let asymmetryScore = 0;
  const coreFilledSectors = coreSectorCounts.filter(c => c > 0).length;
  const coreCompactness = coreFilledSectors / sectors;
  let bestHookRun = 0;
  let bestGapRun = 0;
  let hookRun = 0;
  let gapRun = 0;
  for (let i = 0; i < sectors * 2; i++) {
    const idx = i % sectors;
    if (ringSectorCounts[idx] > 0 && ringSectorMaxDbz[idx] >= 20) {
      hookRun++;
      if (gapRun > bestGapRun) bestGapRun = gapRun;
      gapRun = 0;
    } else {
      if (hookRun > bestHookRun) bestHookRun = hookRun;
      hookRun = 0;
      gapRun++;
    }
  }
  if (hookRun > bestHookRun) bestHookRun = hookRun;
  if (gapRun > bestGapRun) bestGapRun = gapRun;
  const hookArcFraction = Math.min(bestHookRun, sectors) / sectors;
  const gapFraction = Math.min(bestGapRun, sectors) / sectors;
  const hasArc = hookArcFraction >= 0.25 && hookArcFraction <= 0.75;
  const hasNotch = gapFraction >= 0.15;
  if (!hasArc) return 0;
  const notchBonus = hasNotch ? 0.2 : 0;
  asymmetryScore = 1 - coreCompactness;
  const intensityBonus = cell.dbz >= 55 ? 0.15 : cell.dbz >= 50 ? 0.1 : 0;
  let score = (hookArcFraction * 0.4) + (asymmetryScore * 0.2) + notchBonus + intensityBonus;
  const mv = S.stormMovement;
  if (mv && mv.speed >= 15) score += 0.05;
  if (_spcData && _spcData.watches) {
    const inTorWatch = _spcData.watches.some(w => w.type === 'tornado' && _isPointInSpcWatch(cell.lat, cell.lng, w));
    if (inTorWatch) score += 0.1;
  }
  const torWarn = (S.alerts || []).some(a => {
    const ev = (a.properties?.event || '').toLowerCase();
    if (!ev.includes('tornado warning')) return false;
    const geom = a.geometry;
    if (!geom || !geom.coordinates) return false;
    return _pointInAlertPoly(cell.lat, cell.lng, geom);
  });
  if (torWarn) score += 0.15;
  return Math.min(score, 1.0);
}
function _pointInAlertPoly(lat, lng, geom) {
  try {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0];
      if (!ring) continue;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      if (inside) return true;
    }
  } catch (e) {}
  return false;
}
function _isPointInSpcWatch(lat, lng, watch) {
  if (!watch.coords || !watch.coords.length) return false;
  const ring = watch.coords;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0];
    const xj = ring[j][1], yj = ring[j][0];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
// ==========================================
// NWS TORNADO-WARNING ROTATION (v4.82)
// ==========================================
// The hook-echo shape heuristic (detectHookEchoes) is kept ONLY as an internal
// tiebreaker — it no longer triggers any "Rotation" display or risk boost on its
// own, because a hook-shaped echo often has no tornado and the marker was
// misleading. Rotation is now shown ONLY when an active NWS Tornado Warning
// covers the cell. The marker is anchored by a hybrid of the official warning and
// live radar: pick the strongest radar cell inside the warning polygon, and when
// the warning carries a storm-motion point (eventMotionDescription) prefer the
// strongest cell nearest that point. US-only (NWS warnings don't exist elsewhere).
function _warnStormPoint(a){
  try{
    const params=a.properties&&a.properties.parameters;
    let emd=params&&(params.eventMotionDescription||params.EVENTMOTIONDESCRIPTION);
    if(Array.isArray(emd))emd=emd[0];
    if(!emd||typeof emd!=='string')return null;
    // e.g. "...storm...261DEG...26KT...3429,9829" → lat 34.29, lon -98.29
    const ms=[...emd.matchAll(/(\d{3,4}),\s?(\d{3,5})/g)];
    if(!ms.length)return null;
    const m=ms[ms.length-1];
    const lat=parseInt(m[1],10)/100;
    const lon=-parseInt(m[2],10)/100;
    if(!isFinite(lat)||!isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return null;
    return {lat,lon};
  }catch(e){return null}
}
function _pickRotationCell(cells){
  let best=null;
  for(const c of cells){
    if(!best){best=c;continue}
    if(c.dbz>best.dbz||(c.dbz===best.dbz&&(c._hookScore||0)>(best._hookScore||0)))best=c;
  }
  return best;
}
function detectWarningRotation(storms){
  if(!storms||!storms.length)return;
  for(const s of storms)s._rotation=false;
  const torWarnings=(S.alerts||[]).filter(a=>{
    const ev=((a.properties&&a.properties.event)||'').toLowerCase();
    return ev.includes('tornado warning')&&a.geometry&&a.geometry.coordinates;
  });
  if(!torWarnings.length)return;
  for(const a of torWarnings){
    const inside=storms.filter(s=>_pointInAlertPoly(s.lat,s.lng,a.geometry));
    if(!inside.length)continue;
    const pt=_warnStormPoint(a);
    let pool=inside;
    if(pt){
      const near=inside.filter(s=>haversine(s.lat,s.lng,pt.lat,pt.lon)<=10);
      if(near.length)pool=near;
    }
    const chosen=_pickRotationCell(pool);
    if(chosen)chosen._rotation=true;
  }
}
// ==========================================
// SPC DATA (WATCHES, REPORTS, MESOSCALE DISCUSSIONS)
// ==========================================
let _spcData = { watches: null, reports: null, md: null, _lastFetch: 0 };
async function fetchSPCData() {
  if (!isUSLocation(S.lat, S.lon)) { _spcData.watches = []; _spcData.reports = []; _spcData.md = []; return; }
  const now = Date.now();
  if (now - _spcData._lastFetch < 300000 && _spcData.watches !== null) return;
  _spcData._lastFetch = now;
  await Promise.allSettled([_fetchSPCWatches(), _fetchSPCReports(), _fetchSPCMesoscale()]);
}
async function _fetchSPCWatches() {
  try {
    const res = await fetch('https://www.spc.noaa.gov/products/watch/ActiveWW.json', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const watches = [];
    const features = data.features || [];
    for (const f of features) {
      const p = f.properties || {};
      const geom = f.geometry;
      let coords = [];
      if (geom && geom.type === 'Polygon') coords = geom.coordinates[0] || [];
      else if (geom && geom.type === 'MultiPolygon') coords = (geom.coordinates[0] || [])[0] || [];
      const type = (p.WATCH_TYPE || '').toLowerCase().includes('tornado') ? 'tornado' : 'severe';
      const expStr = p.EXPIRATION || p.END_TIME || '';
      let expTime = null;
      if (expStr) { try { expTime = new Date(expStr).getTime(); } catch (e) {} }
      if (expTime && expTime < Date.now()) continue;
      const watchNum = p.WATCH_NUMBER || p.WW || '';
      watches.push({
        type,
        number: watchNum,
        issued: p.ISSUED || p.START_TIME || '',
        expires: expStr,
        expTime,
        states: p.STATES || '',
        coords: coords.map(c => [c[1], c[0]])
      });
    }
    _spcData.watches = watches;
  } catch (e) {
    console.log('[SPC] Watch fetch error:', e.message);
    if (!_spcData.watches) _spcData.watches = [];
  }
}
async function _fetchSPCReports() {
  try {
    const today = new Date();
    const ymd = today.getFullYear().toString().slice(2) + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    const csvUrl = `https://www.spc.noaa.gov/climo/reports/${ymd}_rpts_filtered.csv`;
    const res = await fetch(csvUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      _spcData.reports = [];
      return;
    }
    const text = await res.text();
    const lines = text.trim().split('\n');
    const reports = [];
    let currentType = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('Time,') || line.startsWith('F_Scale,') || line.startsWith('Speed,') || line.startsWith('Size,')) {
        if (line.includes('F_Scale') || line.includes('f_scale')) currentType = 'tornado';
        else if (line.includes('Speed') || line.includes('speed')) currentType = 'wind';
        else if (line.includes('Size') || line.includes('size')) currentType = 'hail';
        else currentType = currentType || 'tornado';
        continue;
      }
      const cols = line.split(',');
      if (cols.length < 6) continue;
      const lat = parseFloat(cols[5]);
      const lon = parseFloat(cols[6]);
      if (isNaN(lat) || isNaN(lon)) continue;
      const dist = haversine(S.lat, S.lon, lat, lon);
      if (dist > 500) continue;
      reports.push({
        type: currentType || 'unknown',
        time: cols[0] || '',
        magnitude: cols[1] || '',
        location: cols[2] || '',
        county: cols[3] || '',
        state: cols[4] || '',
        lat, lon, dist,
        comment: cols[7] || ''
      });
    }
    reports.sort((a, b) => a.dist - b.dist);
    _spcData.reports = reports;
  } catch (e) {
    console.log('[SPC] Reports fetch error:', e.message);
    if (!_spcData.reports) _spcData.reports = [];
  }
}
async function _fetchSPCMesoscale() {
  try {
    const res = await fetch('https://www.spc.noaa.gov/products/md/', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const mdList = [];
    const regex = /md(\d{4})\.html/g;
    let match;
    const seen = new Set();
    while ((match = regex.exec(html)) !== null) {
      const num = match[1];
      if (seen.has(num)) continue;
      seen.add(num);
      mdList.push({ number: num });
    }
    const detailPromises = mdList.slice(0, 10).map(async (md) => {
      try {
        const dRes = await fetch(`https://www.spc.noaa.gov/products/md/md${md.number}.html`, { signal: AbortSignal.timeout(6000) });
        if (!dRes.ok) return md;
        const dHtml = await dRes.text();
        const titleMatch = dHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
        md.title = titleMatch ? titleMatch[1].trim() : 'Mesoscale Discussion #' + md.number;
        const concernMatch = dHtml.match(/CONCERNING\.\.\.([^\n]+)/i);
        md.concerning = concernMatch ? concernMatch[1].trim() : '';
        const areaMatch = dHtml.match(/AREAS?\s+AFFECTED\.\.\.([^\n]+)/i) || dHtml.match(/AREAS?\s*\.\.\.([^\n]+)/i);
        md.area = areaMatch ? areaMatch[1].trim() : '';
        const validMatch = dHtml.match(/VALID\s+(\d{6}Z)\s*-\s*(\d{6}Z)/i);
        if (validMatch) {
          md.validFrom = validMatch[1];
          md.validTo = validMatch[2];
        }
        const isTornado = /tornado|tornad/i.test(dHtml);
        const isSevere = /severe|svr|hail|wind damage/i.test(dHtml);
        md.type = isTornado ? 'tornado' : isSevere ? 'severe' : 'general';
        const llMatch = dHtml.match(/LAT\.{3}LON\s+([\d\s]+)/i);
        if (llMatch) {
          const nums = llMatch[1].trim().split(/\s+/);
          const pts = [];
          for (const n of nums) {
            if (n.length >= 7 && n.length <= 9) {
              const lat = parseInt(n.substring(0, 4)) / 100;
              const lonRaw = parseInt(n.substring(4));
              const lon = lonRaw > 999 ? -(lonRaw / 100) : -(lonRaw / 10);
              if (lat > 15 && lat < 60 && lon > -180 && lon < -50) pts.push({ lat, lon });
            }
          }
          if (pts.length > 0) {
            md._pts = pts;
            let sumLat = 0, sumLon = 0;
            pts.forEach(p => { sumLat += p.lat; sumLon += p.lon; });
            md.lat = sumLat / pts.length; md.lon = sumLon / pts.length;
          }
        }
        return md;
      } catch (e) { return md; }
    });
    const details = await Promise.allSettled(detailPromises);
    _spcData.md = details.filter(d => d.status === 'fulfilled').map(d => d.value);
    console.log('[SPC] Mesoscale discussions:', _spcData.md.length);
  } catch (e) {
    console.log('[SPC] MD fetch error:', e.message);
    if (!_spcData.md) _spcData.md = [];
  }
}
S._spcReportMarkers = [];
function plotSPCReports(map) {
  S._spcReportMarkers.forEach(m => { try { map.removeLayer(m); } catch (e) {} });
  S._spcReportMarkers = [];
  if (!_spcData.reports || !_spcData.reports.length || !S._showSPCReports) return;
  const reports = _spcData.reports.filter(r => r.dist <= (S.scanRadius || 80) * 2);
  for (const r of reports.slice(0, 50)) {
    const icon = r.type === 'tornado' ? '🌪️' : r.type === 'hail' ? '🧊' : r.type === 'wind' ? '💨' : '⚠️';
    const color = r.type === 'tornado' ? '#ff1744' : r.type === 'hail' ? '#00e5ff' : '#ff9800';
    const hailIn = r.type === 'hail' && r.magnitude ? (parseFloat(r.magnitude) / 100).toFixed(2) : r.magnitude;
    const label = r.type === 'tornado' ? 'Tornado' : r.type === 'hail' ? 'Hail (' + hailIn + '")' : 'Wind (' + r.magnitude + ' mph)';
    const marker = L.marker([r.lat, r.lon], {
      icon: L.divIcon({
        className: '',
        html: `<div style="font-size:16px;text-shadow:0 0 4px ${color};filter:drop-shadow(0 0 3px ${color})">${icon}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    });
    marker.bindPopup(`<div style="text-align:center;font-family:system-ui;min-width:140px">
      <div style="font-size:1.1em;font-weight:700;color:${color}">${icon} ${label}</div>
      <div style="font-size:0.75em;color:#ccc;margin-top:4px">${r.location}, ${r.state}</div>
      <div style="font-size:0.7em;color:#aaa;margin-top:2px">${r.time} UTC · ${Math.round(r.dist)} mi away</div>
      ${r.comment ? '<div style="font-size:0.65em;color:#888;margin-top:4px;font-style:italic">' + r.comment + '</div>' : ''}
    </div>`);
    marker.addTo(map);
    S._spcReportMarkers.push(marker);
  }
}
S._showSPCReports = (() => { try { const v = localStorage.getItem('st_spc_reports'); return v === null ? true : v === '1'; } catch(e) { return true; } })();
S._spcWatchPolys = [];
function plotSPCWatchPolygons(map) {
  S._spcWatchPolys.forEach(l => { try { map.removeLayer(l); } catch (e) {} });
  S._spcWatchPolys = [];
  if (!_spcData.watches || !_spcData.watches.length) return;
  for (const w of _spcData.watches) {
    if (!w.coords || w.coords.length < 3) continue;
    const color = w.type === 'tornado' ? '#ff1744' : '#ff9800';
    const poly = L.polygon(w.coords, {
      color: color,
      fillColor: color,
      fillOpacity: 0.08,
      weight: 2,
      dashArray: '6,4',
      interactive: false
    });
    poly.addTo(map);
    S._spcWatchPolys.push(poly);
  }
}
S._nwsWarnPolys = [];
S._showAlertPolygons = true;
function _alertPolyColor(ev) {
  const t = (ev || '').toLowerCase();
  if (t.includes('tornado')) return '#DC2626';
  if (t.includes('severe thunderstorm')) return '#F97316';
  if (t.includes('flash flood') || t.includes('flood')) return '#3B82F6';
  if (t.includes('hurricane') || t.includes('typhoon') || t.includes('tropical storm')) return '#9333EA';
  if (t.includes('winter storm') || t.includes('blizzard') || t.includes('ice storm')) return '#06B6D4';
  if (t.includes('fire') || t.includes('red flag')) return '#B91C1C';
  if (t.includes('watch')) return '#EAB308';
  if (t.includes('warning')) return '#F97316';
  if (t.includes('advisory')) return '#A3E635';
  return '#F59E0B';
}
function _pointInRingHTML(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0];
    const xj = ring[j][1], yj = ring[j][0];
    if (((yi > lon) !== (yj > lon)) && (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function isUserInAlertZone(alert) {
  if (!S.lat || !S.lon) return false;
  const geom = alert.geometry;
  if (!geom || !geom.coordinates) return false;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const rings of polys) {
    if (!rings[0] || rings[0].length < 3) continue;
    if (!_pointInRingHTML(S.lat, S.lon, rings[0])) continue;
    let inHole = false;
    for (let h = 1; h < rings.length; h++) { if (_pointInRingHTML(S.lat, S.lon, rings[h])) { inHole = true; break; } }
    if (!inHole) return true;
  }
  return false;
}
function toggleAlertPolygons() {
  S._showAlertPolygons = !S._showAlertPolygons;
  const btn = document.getElementById('btn-alert-polys');
  if (btn) btn.style.opacity = S._showAlertPolygons ? '1' : '0.4';
  if (S.map) plotNWSWarningPolygons(S.map);
}
function plotNWSWarningPolygons(map) {
  S._nwsWarnPolys.forEach(l => { try { map.removeLayer(l); } catch (e) {} });
  S._nwsWarnPolys = [];
  if (!S._showAlertPolygons || !S.alerts || !S.alerts.length) return;
  for (const a of S.alerts) {
    const ev = a.properties?.event || '';
    const geom = a.geometry;
    if (!geom || !geom.coordinates) continue;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    const color = _alertPolyColor(ev);
    const isTor = ev.toLowerCase().includes('tornado warning');
    for (const coords of polys) {
      const ring = coords[0];
      if (!ring || ring.length < 3) continue;
      const latlngs = ring.map(c => [c[1], c[0]]);
      const poly = L.polygon(latlngs, {
        color: color,
        fillColor: color,
        fillOpacity: isTor ? 0.18 : 0.15,
        weight: isTor ? 3 : 2,
        dashArray: isTor ? null : '4,4'
      });
      const sev = a.properties?.severity || '';
      const headline = a.properties?.headline || ev;
      const expires = a.properties?.expires ? new Date(a.properties.expires).toLocaleString() : 'Unknown';
      poly.bindPopup(`<div style="max-width:260px;font-family:system-ui,sans-serif"><div style="font-weight:700;font-size:13px;color:${color};margin-bottom:3px">${escHtml(ev)}</div><div style="font-size:11px;margin-bottom:5px">${escHtml(headline)}</div><div style="font-size:10px;color:#888"><b>Severity:</b> ${escHtml(sev)}<br><b>Expires:</b> ${expires}</div></div>`);
      poly.addTo(map);
      S._nwsWarnPolys.push(poly);
    }
  }
}
// ==========================================
// NHC TROPICAL CYCLONE TRACKING
// ==========================================
const _nhcData = { systems: null, forecast: null, observed: null, cones: null, windRadii: null, fcstPoints: null, _lastFetch: 0 };
S._nhcTrackLayers = [];
S._nhcSelectedStorm = null;
S._showNHCTracks = (() => { try { const v = localStorage.getItem('st_nhc_tracks'); return v === null ? true : v === '1'; } catch(e) { return true; } })();
// v5.92: granular 🌀 layer options (Map Layers panel). tracks: all|off ·
// wind: all|h64|off · fronts/st/flow/dots: on|off. Persisted; read live.
const _NHC_OPT_DEFAULTS = { tracks: 'all', wind: 'all', fronts: 'on', st: 'on', flow: 'on', dots: 'on' };
S._nhcLayerOpts = (() => { try { return Object.assign({}, _NHC_OPT_DEFAULTS, JSON.parse(localStorage.getItem('st_nhcLayers') || '{}')); } catch(e) { return Object.assign({}, _NHC_OPT_DEFAULTS); } })();
function _nhcOpt(k) {
  // v6.0: our CUSTOM hurricane overlays are off for now — the map shows only the
  // OFFICIAL NHC source (cone + forecast track + forecast points/positions). The
  // ST Model prediction, surface fronts, flow particles and wind fields are our
  // own additions; disabled here until we revisit them. Re-enable by deleting
  // this override (the panel controls and tropical-model.js are left intact).
  if (k === 'st' || k === 'fronts' || k === 'flow' || k === 'wind') return 'off';
  return (S._nhcLayerOpts || _NHC_OPT_DEFAULTS)[k];
}
function setNHCLayerOpt(k, v) {
  S._nhcLayerOpts[k] = v;
  try { localStorage.setItem('st_nhcLayers', JSON.stringify(S._nhcLayerOpts)); } catch(e) {}
  if (k === 'flow' && v !== 'on' && typeof stopSTFlow === 'function') stopSTFlow();
  if (S.map) plotNHCTracks(S.map);
  if (typeof _syncLayersPanel === 'function') _syncLayersPanel();
}
if (typeof window !== 'undefined') { window._nhcOpt = _nhcOpt; window.setNHCLayerOpt = setNHCLayerOpt; }
S._nhcProxRadius = (() => { try { const v = parseInt(localStorage.getItem('st_nhc_prox_radius')); return v > 0 ? v : 200; } catch(e) { return 200; } })();
const _STORM_REGIONS = [
  { id: 'all', label: 'All Basins' },
  { id: 'gulf', label: 'Gulf of Mexico' },
  { id: 'caribbean', label: 'Caribbean' },
  { id: 'atlantic', label: 'Atlantic' },
  { id: 'epac', label: 'E. Pacific' },
  { id: 'wpac', label: 'W. Pacific' },
  { id: 'io', label: 'Indian Ocean' },
  { id: 'spac', label: 'S. Pacific' }
];
S._nhcRegionFilter = (() => { try { const v = localStorage.getItem('st_nhc_region'); return v && _STORM_REGIONS.some(r => r.id === v) ? v : 'all'; } catch(e) { return 'all'; } })();
function _classifyStormRegion(lat, lon) {
  if (lat == null || lon == null) return 'atlantic';
  if (lat >= 18 && lat <= 31 && lon >= -98 && lon <= -81) return 'gulf';
  if (lat >= 8 && lat <= 22 && lon >= -90 && lon <= -58) return 'caribbean';
  if (lat >= 0) {
    if (lon >= -140 && lon < -80) return 'epac';
    if ((lon >= -180 && lon < -140) || (lon >= 100 && lon <= 180)) return 'wpac';
    if (lon >= 40 && lon < 100) return 'io';
    return 'atlantic';
  }
  if (lon >= 20 && lon < 135) return 'io';
  if ((lon >= 135 && lon <= 180) || (lon >= -180 && lon < -120)) return 'spac';
  return 'atlantic';
}
function _getFilteredSystems() {
  const systems = _nhcData.systems;
  if (!systems || S._nhcRegionFilter === 'all') return systems;
  return systems.filter(s => s._region === S._nhcRegionFilter);
}
function setNHCRegionFilter(val) {
  S._nhcRegionFilter = val;
  try { localStorage.setItem('st_nhc_region', val); } catch(e) {}
  _updateTropicalUI();
  if (S.map) plotNHCTracks(S.map);
  if (S.activePage === 'alerts') renderAlerts();
  const label = (_STORM_REGIONS.find(r => r.id === val) || {}).label || val;
  toast('Region filter: ' + label);
}
function _recomputeNHCUserFields() {
  if (!_nhcData.systems) return;
  _nhcData.systems.forEach(s => {
    s.category = _saffirSimpson(s.maxWind);
    s._region = _classifyStormRegion(s.lat, s.lon);
    if (s.lat != null && s.lon != null && S.lat) s.dist = haversine(S.lat, S.lon, s.lat, s.lon);
    else s.dist = null;
    s._inCone = _isUserInCone(s);
    s._tropAlerts = _getTropicalAlertsForStorm(s);
  });
  _nhcData.systems.sort((a, b) => (a.dist || 99999) - (b.dist || 99999));
}
async function fetchNHCData() {
  const now = Date.now();
  if (now - _nhcData._lastFetch < 900000 && _nhcData.systems !== null) {
    _recomputeNHCUserFields();
    return;
  }
  _nhcData._lastFetch = now;
  try {
    const [gisRes, rssRes, surgeRes, jtwcRes, gdacsRes] = await Promise.allSettled([
      _fetchNHCGIS(),
      _fetchNHCActiveStorms(),
      fetch('https://www.nhc.noaa.gov/CurrentSurges.json', { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null).catch(() => null),
      _fetchJTWCStorms(),
      _fetchGDACSStorms()
    ]);
    const gis = gisRes.status === 'fulfilled' ? gisRes.value : null;
    const rssStorms = rssRes.status === 'fulfilled' ? rssRes.value : [];
    const surgeData = surgeRes.status === 'fulfilled' ? surgeRes.value : null;
    const jtwcStorms = jtwcRes.status === 'fulfilled' ? jtwcRes.value : [];
    const gdacsStorms = gdacsRes.status === 'fulfilled' ? gdacsRes.value : [];
    let storms = [];
    if (gis && gis.positions && gis.positions.length) {
      storms = gis.positions;
      _nhcData.forecast = gis.tracks || [];
      _nhcData.observed = gis.observedTracks || []; // v6.22: NOAA's own past-track line
      _nhcData.cones = gis.cones || [];
      _nhcData.windRadii = gis.windRadii || [];
      for (const rs of rssStorms) {
        const existing = storms.find(s => s.name.toLowerCase() === rs.name.toLowerCase());
        if (existing) {
          if (!existing.maxWind && rs.maxWind) existing.maxWind = rs.maxWind;
          if (!existing.minPressure && rs.minPressure) existing.minPressure = rs.minPressure;
          if (!existing.moveDir && rs.moveDir) { existing.moveDir = rs.moveDir; existing.moveSpeed = rs.moveSpeed; }
          if (!existing.gusts && rs.gusts) existing.gusts = rs.gusts;
          if (!existing.link) existing.link = rs.link;
        } else {
          storms.push(rs);
        }
      }
    } else {
      storms = rssStorms;
      _nhcData.forecast = [];
      _nhcData.observed = [];
      _nhcData.cones = [];
      _nhcData.windRadii = [];
    }
    if (surgeData && surgeData.activeStorms) {
      for (const surge of surgeData.activeStorms) {
        const existing = storms.find(s => s.id === surge.id || s.name === surge.name);
        if (existing) existing.surgeData = surge;
      }
    }
    if (jtwcStorms && jtwcStorms.length) {
      for (const js of jtwcStorms) {
        const dup = storms.find(s => s.name.toLowerCase() === js.name.toLowerCase());
        if (!dup) storms.push(js);
      }
    }
    // ── GDACS merge (v5.86): match each GDACS event to a known storm by name
    // (GDACS "FAUSTO-26" → "Fausto") or proximity (<300 mi), then fill the gaps:
    // movement dir/speed + past-track history for EVERY storm, plus cone +
    // forecast track for storms NHC's ArcGIS doesn't cover (JTWC basins) — which
    // also lights up IN-CONE detection and "Tap for forecast track" globally.
    _nhcData.history = [];
    _nhcData.fcstPoints = [];
    // v6.03: forecast-track dots carry per-point intensity when NHC provides it.
    // Group NHC's forecast points (all taus, each with max wind / gust / pressure)
    // by storm; GDACS points (time only) fill in for storms NHC doesn't cover.
    // v6.07: past observed positions (layer 1) are merged in too, so the track
    // table and map dots span the FULL history → forecast, not just the forecast.
    if (gis && ((gis.forecastPoints && gis.forecastPoints.length) || (gis.pastPoints && gis.pastPoints.length))) {
      const byStorm = {};
      const bucket = q => { const k = (q.stormId || '') + '|' + (q.stormName || '').toLowerCase(); return (byStorm[k] || (byStorm[k] = { stormId: q.stormId, stormName: q.stormName, pts: [], _src: 'nhc' })); };
      for (const q of (gis.forecastPoints || [])) {
        bucket(q).pts.push({
          lat: q.lat, lon: q.lon, t: (q.validTime || (Date.now() + (q.tau || 0) * 3600000)),
          label: q.label || (q.tau != null ? ('+' + q.tau + 'h') : ''),
          maxWind: q.maxWind, gusts: q.gusts, minPressure: q.minPressure, type: q.type, tau: q.tau
        });
      }
      for (const q of (gis.pastPoints || [])) {
        if (q.validTime == null) continue; // need a real time to place it on the timeline
        bucket(q).pts.push({
          lat: q.lat, lon: q.lon, t: q.validTime, label: q.label || '',
          maxWind: q.maxWind, gusts: q.gusts, minPressure: q.minPressure, type: q.type, tau: null, past: true
        });
      }
      // v6.19: order each storm's track. Forecast points carry a reliable tau, so
      // they order by tau. The OBSERVED-position layer's timestamps are unreliable
      // (they scrambled the past trail into a zig-zag), so DON'T time-sort the past:
      // a cyclone track is a simple open path, so rebuild it SPATIALLY — start at the
      // current center and walk nearest-neighbour outward, dropping any fix that would
      // imply an impossible jump (a real fix is never ~>350 mi from its neighbour).
      const _R2 = 3958.8;
      const _gc = (a, c) => {
        const φ1 = a.lat * Math.PI / 180, φ2 = c.lat * Math.PI / 180;
        const dφ = φ2 - φ1, dλ = (c.lon - a.lon) * Math.PI / 180;
        const hv = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
        return 2 * _R2 * Math.asin(Math.min(1, Math.sqrt(hv)));
      };
      for (const k in byStorm) {
        const b = byStorm[k];
        const withPos = b.pts.filter(p => p.lat != null && p.lon != null);
        const fcst = withPos.filter(p => !p.past).sort((a, c) => ((a.tau != null ? a.tau : 0) - (c.tau != null ? c.tau : 0)) || ((a.t || 0) - (c.t || 0)));
        const past = withPos.filter(p => p.past);
        const anchor = fcst[0] || past[0]; // current center = tau-0 forecast fix
        const chained = [];
        if (anchor && past.length) {
          let cur = anchor; const rem = past.slice();
          while (rem.length) {
            let bi = -1, bd = Infinity;
            for (let i = 0; i < rem.length; i++) { const d = _gc(cur, rem[i]); if (d < bd) { bd = d; bi = i; } }
            if (bi < 0 || bd > 350) break; // next fix is incoherently far — stop the trail
            cur = rem[bi]; chained.push(cur); rem.splice(bi, 1);
          }
        }
        // chained runs newest→oldest; reverse to chronological, then append forecast.
        let ordered = chained.reverse().concat(fcst);
        // collapse near-duplicate fixes at the same spot (keep the richer record).
        const out = [];
        for (const pt of ordered) {
          const prev = out[out.length - 1];
          if (prev && _gc(prev, pt) < 5) {
            if ((pt.minPressure && !prev.minPressure) || (pt.tau != null && prev.tau == null)) out[out.length - 1] = pt;
            continue;
          }
          out.push(pt);
        }
        out.forEach((p, i) => { p._ord = i; }); // monotonic path index (drives table + line order)
        b.pts = out;
      }
      // Only use NHC as the dot source when it's a real multi-point track; if it
      // only returned a single fix, leave GDACS to supply the dots.
      for (const k in byStorm) { if (byStorm[k].pts.length >= 2) _nhcData.fcstPoints.push(byStorm[k]); }
    }
    const _normName = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const _attachGdacsGeo = (gd, stormId, stormName) => {
      const sid = stormId || '', sname = (stormName || '').toLowerCase();
      if (gd.histTrack && gd.histTrack.length >= 2) _nhcData.history.push({ stormId: sid, stormName: stormName || '', coords: gd.histTrack, _src: 'gdacs' });
      const hasFP = (_nhcData.fcstPoints || []).some(f => (sid && f.stormId === sid) || (f.stormName && sname && f.stormName.toLowerCase() === sname));
      if (!hasFP && gd.fcstPoints && gd.fcstPoints.length) _nhcData.fcstPoints.push({ stormId: sid, stormName: stormName || '', pts: gd.fcstPoints, _src: 'gdacs' });
      const hasCone = (_nhcData.cones || []).some(c => (sid && c.stormId === sid) || (c.stormName && sname && c.stormName.toLowerCase() === sname));
      if (!hasCone && gd.cone && gd.cone.length >= 3) _nhcData.cones.push({ stormId: sid, stormName: stormName || '', coords: gd.cone, forecastPeriod: '120', _src: 'gdacs' });
      const hasTrack = (_nhcData.forecast || []).some(t => (sid && t.stormId === sid) || (t.stormName && sname && t.stormName.toLowerCase() === sname));
      if (!hasTrack && gd.fcstTrack && gd.fcstTrack.length >= 2) _nhcData.forecast.push({ stormId: sid, stormName: stormName || '', coords: gd.fcstTrack, forecastPeriod: '120', _src: 'gdacs' });
    };
    for (const gd of gdacsStorms) {
      let match = storms.find(s => _normName(s.name) === _normName(gd.name));
      // proximity fallback kept TIGHT (~2° / 150 mi) so a Fujiwhara pair or two
      // same-basin storms can't cross-match; feed position lag stays well inside
      if (!match && gd.lat != null) match = storms.find(s => s.lat != null && haversine(s.lat, s.lon, gd.lat, gd.lon) < 150);
      if (match) {
        match._gdacs = { alertlevel: gd.alertlevel, eventid: gd.eventid, reportUrl: gd.reportUrl, countries: gd.countries };
        // v6.47: when GDACS supplies the wind, its record age travels with it.
        if (!match.maxWind && gd.maxWind) { match.maxWind = gd.maxWind; if (gd.updated) match._asOf = gd.updated; }
        if (!match.moveDir && gd.moveDir) { match.moveDir = gd.moveDir; match.moveSpeed = gd.moveSpeed; match._moveSrc = 'gdacs'; }
        _attachGdacsGeo(gd, match.id, match.name);
      } else if (gd.lat != null) {
        // a current storm no other feed reported — carry it from GDACS alone
        const tt = gd.typeText || '';
        const type = /hurricane|typhoon|cyclone.*(hurricane|typhoon)/i.test(tt) ? 'Hurricane' : /storm/i.test(tt) ? 'Tropical Storm' : 'Tropical Depression';
        const ns = {
          id: 'GDACS_' + gd.eventid, name: gd.name, type, basin: '', _asOf: gd.updated || null,
          lat: gd.lat, lon: gd.lon, maxWind: gd.maxWind, gusts: null,
          minPressure: null, category: null, moveDir: gd.moveDir, moveSpeed: gd.moveSpeed,
          dist: null, link: gd.reportUrl, surgeData: null, _source: 'gdacs',
          _gdacs: { alertlevel: gd.alertlevel, eventid: gd.eventid, reportUrl: gd.reportUrl, countries: gd.countries }
        };
        storms.push(ns);
        _attachGdacsGeo(gd, ns.id, ns.name);
      }
    }
    // v6.45: classification honesty pass, AFTER every feed has merged its winds —
    // no storm leaves here labelled "Tropical Depression" while its own maxWind
    // says tropical-storm force (see _reconcileTropicalType). Runs on all feeds'
    // storms alike, so the banner, map popup, cards and AI can't contradict the
    // wind figure they display right next to the name.
    for (const s of storms) _reconcileTropicalType(s);
    // v6.48: drop storms whose feed has repeated identical data for >=12 h.
    _nhcData.systems = _stormFreezeGate(storms);
    _nhcData.surgeRaw = surgeData;
    _recomputeNHCUserFields();
    console.log('[NHC+JTWC+GDACS] Tropical systems:', storms.length, 'tracks:', (_nhcData.forecast||[]).length, 'cones:', (_nhcData.cones||[]).length, 'history:', (_nhcData.history||[]).length, 'JTWC:', jtwcStorms.length, 'GDACS:', gdacsStorms.length);
  } catch (e) {
    console.log('[NHC] Fetch error:', e.message);
    if (!_nhcData.systems) _nhcData.systems = [];
  }
}
async function _fetchNHCGIS() {
  const base = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';
  const q = 'where=1%3D1&outFields=*&f=geojson&resultRecordCount=500';
  const result = { positions: [], tracks: [], observedTracks: [], cones: [], windRadii: [], forecastPoints: [], pastPoints: [] };
  try {
    // Layer 1 = Observed Position (past track fixes, each with its own wind/gust/
    // pressure) — pulled alongside the forecast layers so the track table can show
    // the FULL history, not just the forecast half. (v6.07)
    // Layer 3 = Observed/best-track LINE — NOAA's own past-track polyline, already in
    // correct time order. We draw THIS as the past track (v6.22) so it matches the
    // official NOAA tracker exactly, instead of reconstructing it from points.
    const [posRes, pastRes, trkRes, obsTrkRes, coneRes, wr34Res, wr50Res, wr64Res] = await Promise.allSettled([
      fetch(`${base}/0/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/1/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/2/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/3/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/4/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/7/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/8/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/9/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null)
    ]);
    const posData = posRes.status === 'fulfilled' ? posRes.value : null;
    const pastData = pastRes.status === 'fulfilled' ? pastRes.value : null;
    const trkData = trkRes.status === 'fulfilled' ? trkRes.value : null;
    const obsTrkData = obsTrkRes.status === 'fulfilled' ? obsTrkRes.value : null;
    const coneData = coneRes.status === 'fulfilled' ? coneRes.value : null;
    const wr34Data = wr34Res.status === 'fulfilled' ? wr34Res.value : null;
    const wr50Data = wr50Res.status === 'fulfilled' ? wr50Res.value : null;
    const wr64Data = wr64Res.status === 'fulfilled' ? wr64Res.value : null;
    if (pastData && pastData.features) {
      // find a plausible valid-time epoch among the numeric props, whatever the
      // observed layer happens to call its date field (DTG/SYNOPTIME/esri date…).
      const _findT = props => {
        const lo = Date.now() - 90 * 86400000, hi = Date.now() + 3 * 86400000;
        for (const k in props) { const v = props[k]; if (typeof v === 'number' && v > lo && v < hi && v > 1e11) return v; }
        return null;
      };
      for (const f of pastData.features) {
        const p = f.properties || {};
        const coords = f.geometry?.coordinates;
        // guard: this layer must be points ([lon,lat]); ignore anything else so a
        // schema surprise can't scatter bogus markers across the map.
        if (f.geometry?.type !== 'Point' || !Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') continue;
        const name = p.STORMNAME || p.NAME || 'Unknown';
        const stormId = p.STORMID || p.ATCFID || '';
        const _valKt = v => (typeof v === 'number' && isFinite(v) && v > 0 && v < 999) ? v : null;
        const windKt = _valKt(p.MAXWIND) || _valKt(p.INTENSITY);
        const maxWind = windKt ? Math.round(windKt * 1.15078) : null;
        const gustKt = _valKt(p.GUST);
        const gusts = gustKt ? Math.round(gustKt * 1.15078) : null;
        const minPressure = (typeof p.MSLP === 'number' && p.MSLP >= 850 && p.MSLP <= 1050) ? p.MSLP : null;
        const stormType = p.STORMTYPE || p.DVLBL || (maxWind >= 74 ? 'Hurricane' : maxWind >= 39 ? 'Tropical Storm' : 'Tropical Depression');
        result.pastPoints.push({ stormId, stormName: name, lat: coords[1], lon: coords[0], validTime: _findT(p), maxWind, gusts, minPressure, type: stormType, label: p.DATELBL || p.FLDATELBL || null });
      }
    }
    if (posData && posData.features) {
      const seen = new Set();
      for (const f of posData.features) {
        const p = f.properties || {};
        const coords = f.geometry?.coordinates;
        if (!coords) continue;
        const name = p.STORMNAME || p.NAME || 'Unknown';
        const stormId = p.STORMID || p.ATCFID || '';
        const tauRaw = (p.TAU != null ? p.TAU : (p.ADVDATE != null ? p.ADVDATE : 0));
        const tau = (typeof tauRaw === 'number') ? tauRaw : (parseInt(tauRaw, 10) || 0);
        // NHC uses 9999 / -9999 / 0 as "missing" sentinels for MSLP, wind and gust
        // in the forecast-point layer — never let those leak into the popup.
        const _valKt = v => (typeof v === 'number' && isFinite(v) && v > 0 && v < 999) ? v : null;
        const windKt = _valKt(p.MAXWIND) || _valKt(p.INTENSITY);
        const maxWind = windKt ? Math.round(windKt * 1.15078) : null;
        const gustKt = _valKt(p.GUST);
        const gusts = gustKt ? Math.round(gustKt * 1.15078) : null;
        const minPressure = (typeof p.MSLP === 'number' && p.MSLP >= 850 && p.MSLP <= 1050) ? p.MSLP : null;
        const stormType = p.STORMTYPE || (maxWind >= 74 ? 'Hurricane' : maxWind >= 39 ? 'Tropical Storm' : 'Tropical Depression');
        // v6.03: keep EVERY forecast point (all forecast hours), each with its own
        // max wind / gust / pressure, so the track-dot popups can show the forecast
        // strength — not just the timestamp. (result.positions below still dedups
        // to the current position per storm for the big center marker.)
        // ArcGIS esriFieldTypeDate fields come back as epoch ms (UTC). Capture the
        // real valid time so the popup can render it in the USER's local zone,
        // instead of NHC's pre-formatted label (which is in the basin's zone).
        const vtRaw = (p.VALIDTIME != null ? p.VALIDTIME : (p.FLDATELBL_DT != null ? p.FLDATELBL_DT : null));
        const validTime = (typeof vtRaw === 'number' && isFinite(vtRaw) && vtRaw > 1e11) ? vtRaw : null;
        result.forecastPoints.push({ stormId, stormName: name, lat: coords[1], lon: coords[0], tau, maxWind, gusts, minPressure, type: stormType, validTime, label: p.FLDATELBL || p.DATELBL || (typeof p.VALIDTIME === 'string' ? p.VALIDTIME : null) || null });
        const key = name + '_' + stormId;
        if (seen.has(key)) continue;
        seen.add(key);
        const basin = stormId.startsWith('EP') ? 'ep' : 'at';
        result.positions.push({
          id: stormId, name, type: stormType, basin,
          lat: coords[1], lon: coords[0],
          maxWind, gusts,
          minPressure,
          moveDir: p.STORMDIR ? _degToCompass(p.STORMDIR) : null,
          moveSpeed: p.STORMSPED ? Math.round(p.STORMSPED * 1.15078) : null,
          link: null, surgeData: null, forecastHr: tau
        });
      }
    }
    if (trkData && trkData.features) {
      for (const f of trkData.features) {
        const p = f.properties || {};
        const coords = f.geometry?.coordinates;
        if (!coords) continue;
        result.tracks.push({
          stormId: p.STORMID || p.ATCFID || '',
          stormName: p.STORMNAME || '',
          coords: Array.isArray(coords[0]) && Array.isArray(coords[0][0]) ? coords[0] : coords,
          forecastPeriod: p.FCSTPRD || '120'
        });
      }
    }
    // v6.22: layer 3 = NOAA's observed/best-track line (already time-ordered).
    if (obsTrkData && obsTrkData.features) {
      for (const f of obsTrkData.features) {
        const p = f.properties || {};
        const geom = f.geometry;
        if (!geom || !geom.coordinates) continue;
        // LineString → [[lon,lat],...]; MultiLineString → [[[lon,lat],...],...]
        const parts = (geom.type === 'MultiLineString') ? geom.coordinates : [geom.coordinates];
        for (const seg of parts) {
          if (!Array.isArray(seg) || seg.length < 2) continue;
          result.observedTracks.push({
            stormId: p.STORMID || p.ATCFID || '',
            stormName: p.STORMNAME || '',
            coords: seg
          });
        }
      }
    }
    if (coneData && coneData.features) {
      for (const f of coneData.features) {
        const p = f.properties || {};
        const geom = f.geometry;
        if (!geom || !geom.coordinates) continue;
        const polyCoords = geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : (geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates);
        result.cones.push({
          stormId: p.STORMID || p.ATCFID || '',
          stormName: p.STORMNAME || '',
          coords: polyCoords,
          forecastPeriod: p.FCSTPRD || '120'
        });
      }
    }
    const _parseWindRadii = (data, ktLevel) => {
      if (!data || !data.features) return;
      for (const f of data.features) {
        const p = f.properties || {};
        const geom = f.geometry;
        if (!geom || !geom.coordinates) continue;
        const polyCoords = geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : (geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates);
        result.windRadii.push({
          stormId: p.STORMID || p.ATCFID || '',
          stormName: p.STORMNAME || '',
          ktLevel,
          coords: polyCoords
        });
      }
    };
    _parseWindRadii(wr34Data, 34);
    _parseWindRadii(wr50Data, 50);
    _parseWindRadii(wr64Data, 64);
  } catch (e) {
    console.log('[NHC] ArcGIS fetch error:', e.message);
  }
  return result;
}
function _degToCompass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
async function _fetchNHCActiveStorms() {
  const storms = [];
  const basins = [
    { code: 'at', url: 'https://www.nhc.noaa.gov/index-at.xml', prefix: 'AL' },
    { code: 'ep', url: 'https://www.nhc.noaa.gov/index-ep.xml', prefix: 'EP' }
  ];
  for (const basin of basins) {
    try {
      const res = await fetch(basin.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const text = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const items = doc.querySelectorAll('item');
      const seen = new Set();
      items.forEach(item => {
        const title = item.querySelector('title')?.textContent || '';
        const desc = item.querySelector('description')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '';
        const stormMatch = title.match(/(Hurricane|Tropical Storm|Tropical Depression|Post-Tropical|Subtropical|Remnants of)\s+(.+?)(?:\s+(?:Advisory|Forecast|Update|Graphics|Key Messages|Discussion|Watches|Warnings|Wind Speed|Public|Intermediate|Special))/i)
          || title.match(/(Hurricane|Tropical Storm|Tropical Depression|Post-Tropical|Subtropical|Remnants of)\s+(\w[\w\s-]*\w)/i);
        if (!stormMatch) return;
        const stormType = stormMatch[1];
        const stormName = stormMatch[2].trim().replace(/\s+(Advisory|Forecast|Update|Public).*$/i, '');
        if (seen.has(stormName)) return;
        seen.add(stormName);
        const latMatch = desc.match(/(\d+\.?\d*)\s*°?\s*([NS])/i);
        const lonMatch = desc.match(/(\d+\.?\d*)\s*°?\s*([EW])/i);
        const windMatch = desc.match(/(?:Max(?:imum)?\s+)?(?:sustained\s+)?winds?[:\s]+(\d+)\s*(mph|kt|knots)/i);
        const pressMatch = desc.match(/(?:min(?:imum)?\s+)?(?:central\s+)?pressure[:\s]+(\d+)\s*mb/i);
        const moveMatch = desc.match(/(?:moving|headed?)\s+([\w-]+(?:\s*[\w-]+)?)\s+(?:at\s+)?(\d+)\s*(mph|kt|knots)/i);
        const gustMatch = desc.match(/gusts?\s+(?:up\s+to\s+)?(\d+)\s*(mph|kt|knots)/i);
        let lat = null, lon = null;
        if (latMatch) lat = parseFloat(latMatch[1]) * (latMatch[2].toUpperCase() === 'S' ? -1 : 1);
        if (lonMatch) lon = parseFloat(lonMatch[1]) * (lonMatch[2].toUpperCase() === 'W' ? -1 : 1);
        const _ktToMph = (v, unit) => (unit && (unit.toLowerCase() === 'kt' || unit.toLowerCase() === 'knots')) ? Math.round(v * 1.15078) : v;
        const maxWind = windMatch ? _ktToMph(parseInt(windMatch[1]), windMatch[2]) : null;
        const minPressure = pressMatch ? parseInt(pressMatch[1]) : null;
        const moveDir = moveMatch ? moveMatch[1] : null;
        const moveSpeed = moveMatch ? _ktToMph(parseInt(moveMatch[2]), moveMatch[3]) : null;
        const gusts = gustMatch ? _ktToMph(parseInt(gustMatch[1]), gustMatch[2]) : null;
        const idMatch = link.match(/\/([AE][LP]\d{6})/i);
        const stormId = idMatch ? idMatch[1].toUpperCase() : basin.prefix + stormName.substring(0, 4).toUpperCase();
        storms.push({
          id: stormId, name: stormName, type: stormType, basin: basin.code,
          lat, lon, maxWind, gusts, minPressure, category: null,
          moveDir, moveSpeed, dist: null,
          link, surgeData: null
        });
      });
    } catch (e) {
      console.log('[NHC] Basin ' + basin.code + ' RSS error:', e.message);
    }
  }
  return storms;
}
async function _fetchJTWCStorms() {
  const storms = [];
  try {
    const jtwcUrl = 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss';
    const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(jtwcUrl);
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return storms;
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/xml');
    const items = doc.querySelectorAll('item');
    const seen = new Set();
    items.forEach(item => {
      const title = item.querySelector('title')?.textContent || '';
      const desc = item.querySelector('description')?.textContent || '';
      const link = item.querySelector('link')?.textContent || '';
      const stormMatch = title.match(/(Typhoon|Tropical Storm|Tropical Depression|Super Typhoon|Tropical Cyclone|Post-Tropical|Subtropical)\s+(\d{2}[WSEABICP])\s*[\(:\s]+([^)]+)/i)
        || title.match(/(Typhoon|Tropical Storm|Tropical Depression|Super Typhoon|Tropical Cyclone)\s+(.+?)(?:\s+(?:Warning|Advisory|Prognostic|TCFA))/i)
        || title.match(/(Typhoon|Super Typhoon|Tropical Storm|Tropical Depression|Tropical Cyclone)\s+(.+)/i);
      if (!stormMatch) return;
      const stormType = stormMatch[1];
      let stormName = (stormMatch[3] || stormMatch[2]).trim().replace(/\s*\(.*$/, '');
      const stormCode = stormMatch[2] || '';
      if (seen.has(stormName.toUpperCase())) return;
      seen.add(stormName.toUpperCase());
      const latMatch = desc.match(/(\d+\.?\d*)\s*°?\s*([NS])/i);
      const lonMatch = desc.match(/(\d+\.?\d*)\s*°?\s*([EW])/i);
      const windMatch = desc.match(/(?:max(?:imum)?\s+)?(?:sustained\s+)?winds?[:\s]+(\d+)\s*(mph|kt|knots|kph)/i);
      const pressMatch = desc.match(/(?:min(?:imum)?\s+)?(?:central\s+)?pressure[:\s]+(\d+)\s*(?:mb|hpa)/i);
      const moveMatch = desc.match(/(?:moving|headed?)\s+([\w-]+(?:\s*[\w-]+)?)\s+(?:at\s+)?(\d+)\s*(mph|kt|knots|kph)/i);
      const gustMatch = desc.match(/gusts?\s+(?:up\s+to\s+)?(\d+)\s*(mph|kt|knots|kph)/i);
      let lat = null, lon = null;
      if (latMatch) lat = parseFloat(latMatch[1]) * (latMatch[2].toUpperCase() === 'S' ? -1 : 1);
      if (lonMatch) lon = parseFloat(lonMatch[1]) * (lonMatch[2].toUpperCase() === 'W' ? -1 : 1);
      const _convertWind = (v, unit) => {
        if (!unit) return v;
        const u = unit.toLowerCase();
        if (u === 'kt' || u === 'knots') return Math.round(v * 1.15078);
        if (u === 'kph') return Math.round(v * 0.621371);
        return v;
      };
      const maxWind = windMatch ? _convertWind(parseInt(windMatch[1]), windMatch[2]) : null;
      const minPressure = pressMatch ? parseInt(pressMatch[1]) : null;
      const moveDir = moveMatch ? moveMatch[1] : null;
      const moveSpeed = moveMatch ? _convertWind(parseInt(moveMatch[2]), moveMatch[3]) : null;
      const gusts = gustMatch ? _convertWind(parseInt(gustMatch[1]), gustMatch[2]) : null;
      let basin = 'wp';
      if (stormCode.match(/\d{2}[ABI]/i)) basin = 'io';
      else if (stormCode.match(/\d{2}[SP]/i)) basin = 'sp';
      else if (stormCode.match(/\d{2}[C]/i)) basin = 'cp';
      const stormId = 'JTWC_' + (stormCode || stormName.substring(0, 6).toUpperCase());
      storms.push({
        id: stormId, name: stormName, type: stormType, basin,
        lat, lon, maxWind, gusts, minPressure, category: null,
        moveDir, moveSpeed, dist: null,
        link: link || 'https://www.metoc.navy.mil/jtwc/jtwc.html',
        surgeData: null, _source: 'jtwc'
      });
    });
  } catch (e) {
    console.log('[JTWC] Fetch error:', e.message);
  }
  return storms;
}
// ── GDACS (Global Disaster Alert & Coordination System — EU/UN, gdacs.org) ────
// v5.86: free, no key, CORS-open. ONE list call returns every CURRENT tropical
// cyclone worldwide WITH its geometry embedded per event: the uncertainty cone
// (Class "Poly_Cones"), track segments ("Line_Line_N", polygonlabel = intensity
// like "TD"/"TS"), timestamped positions ("Point_Polygon_Point_N", polygonlabel
// like "20/07 03:00 UTC" — small circle POLYGONS we reduce to centroids), wind
// polygons ("Poly_Green/Orange/Red" = 60/90/120 km/h) and "Point_Centroid".
// Used to (1) gap-fill cone + track for storms NHC's ArcGIS doesn't cover —
// JTWC basins: W. Pacific typhoons, Indian Ocean, S. Hemisphere — so IN-CONE
// detection and "Tap for forecast track" work globally, (2) attach the GDACS
// humanitarian alert level (Green/Orange/Red) to every matched storm, and
// (3) catch any current storm the NHC/JTWC feeds missed. NOTE: the per-event
// "details" endpoint (geteventdata) does NOT return JSON — never fetch it.
// v6.47: parse whatever date shape a GDACS property carries — ISO strings
// ("2026-07-25T00:00:00") or .NET "/Date(1769...)/"-style tick wrappers.
function _parseGdacsAnyDate(v) {
  if (v == null) return null;
  const m = String(v).match(/\/Date\((\d+)\)\//);
  if (m) return +m[1];
  const t = Date.parse(String(v));
  return isNaN(t) ? null : t;
}
async function _fetchGDACSStorms() {
  const out = [];
  try {
    const res = await fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtypes=TC', { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return out;
    const data = await res.json();
    const byEvent = {};
    for (const f of (data.features || [])) {
      const p = f.properties || {};
      if (String(p.iscurrent).toLowerCase() !== 'true') continue;
      const id = p.eventid;
      if (id == null) continue;
      const ev = byEvent[id] || (byEvent[id] = { eventid: id, props: null, lat: null, lon: null, cone: null, lines: [], points: [] });
      const cls = String(p.Class || p.class || '');
      const g = f.geometry || {};
      let m;
      if (cls === 'Point_Centroid' && g.type === 'Point' && Array.isArray(g.coordinates)) {
        ev.lat = g.coordinates[1]; ev.lon = g.coordinates[0]; ev.props = p;
      } else if (cls === 'Poly_Cones' && g.type === 'Polygon' && g.coordinates && g.coordinates[0]) {
        ev.cone = g.coordinates[0];
      } else if ((m = cls.match(/^Line_Line_(\d+)$/)) && g.type === 'LineString' && Array.isArray(g.coordinates)) {
        ev.lines.push({ idx: +m[1], coords: g.coordinates });
      } else if ((m = cls.match(/^Point_Polygon_Point_(\d+)$/)) && g.type === 'Polygon' && g.coordinates && g.coordinates[0]) {
        const ring = g.coordinates[0];
        if (ring.length) {
          let sx = 0, sy = 0;
          for (const c of ring) { sx += c[0]; sy += c[1]; }
          ev.points.push({ idx: +m[1], lon: sx / ring.length, lat: sy / ring.length, label: p.polygonlabel || '' });
        }
      }
      if (!ev.props) ev.props = p;
    }
    for (const id in byEvent) {
      const ev = byEvent[id];
      const p = ev.props || {};
      const rawName = String(p.eventname || '').replace(/-\d+$/, '').trim();
      const name = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase() : ('TC-' + id);
      const sev = p.severitydata || {};
      const maxWind = sev.severity ? Math.round(sev.severity * 0.621371) : null; // km/h → mph
      ev.lines.sort((a, b) => a.idx - b.idx);
      ev.points.sort((a, b) => a.idx - b.idx);
      // stitch ordered track segments into one polyline (drop duplicated joints)
      let track = [];
      for (const ln of ev.lines) {
        let cs = ln.coords || [];
        if (track.length && cs.length) {
          const last = track[track.length - 1], first = cs[0];
          if (last[0] === first[0] && last[1] === first[1]) cs = cs.slice(1);
        }
        track = track.concat(cs);
      }
      // Timestamped fixes → split PAST (history) vs FUTURE (forecast) at "now",
      // and derive movement direction + speed from the two most recent past
      // fixes (GDACS carries what NHC ArcGIS/JTWC RSS often omit).
      const nowT = Date.now();
      const pts = ev.points.map(pt => ({ lat: pt.lat, lon: pt.lon, label: pt.label, t: _parseGdacsPtTime(pt.label) }));
      const past = pts.filter(pt => pt.t != null && pt.t <= nowT).sort((a, b) => a.t - b.t);
      const future = pts.filter(pt => pt.t != null && pt.t > nowT).sort((a, b) => a.t - b.t);
      let moveDir = null, moveSpeed = null;
      if (past.length >= 2) {
        const a = past[past.length - 2], b = past[past.length - 1];
        const hrs = (b.t - a.t) / 3600000;
        const mi = haversine(a.lat, a.lon, b.lat, b.lon);
        if (hrs >= 0.5 && mi > 0.5) {
          moveSpeed = Math.round(mi / hrs);
          moveDir = degToDir(bearingDeg(a.lat, a.lon, b.lat, b.lon));
        }
      }
      // history polyline: past fixes → current centroid; forecast polyline:
      // current centroid → future fixes. Falls back to the raw stitched track
      // as forecast when the point labels didn't parse.
      const histTrack = past.map(pt => [pt.lon, pt.lat]);
      if (ev.lat != null && histTrack.length) {
        const lastH = histTrack[histTrack.length - 1];
        if (lastH[0] !== ev.lon || lastH[1] !== ev.lat) histTrack.push([ev.lon, ev.lat]);
      }
      let fcstTrack = future.map(pt => [pt.lon, pt.lat]);
      if (fcstTrack.length) {
        if (ev.lat != null) fcstTrack.unshift([ev.lon, ev.lat]);
        else if (past.length) fcstTrack.unshift([past[past.length - 1].lon, past[past.length - 1].lat]);
      }
      if (!histTrack.length && !fcstTrack.length && track.length >= 2) fcstTrack = track;
      // v6.47: when THIS record was last updated by GDACS. Their severity value
      // refreshes only per advisory (~6-hourly) and can freeze entirely after
      // NHC's final advisory while the event stays "current" — so remember its
      // age and let the UI say so instead of presenting the numbers as live.
      // Prefer the record's own modification date; fall back to the newest PAST
      // track fix (the last advisory time in practice).
      const updated = _parseGdacsAnyDate(p.datemodified) ?? _parseGdacsAnyDate(p.todate)
        ?? (past.length ? past[past.length - 1].t : null);
      out.push({
        eventid: ev.eventid, name, updated,
        lat: ev.lat, lon: ev.lon, maxWind,
        typeText: sev.severitytext || '',
        alertlevel: p.alertlevel || 'Green',
        countries: (Array.isArray(p.affectedcountries) ? p.affectedcountries : []).map(c => c && c.countryname).filter(Boolean),
        reportUrl: (p.url && p.url.report) || null,
        moveDir, moveSpeed,
        cone: ev.cone, histTrack, fcstTrack, fcstPoints: pts
      });
    }
  } catch (e) {
    console.log('[GDACS] Fetch error:', e.message);
  }
  return out;
}
// GDACS point labels look like "20/07 03:00 UTC" (day/month). Resolve to a Date
// using whichever year lands the timestamp closest to now (handles New Year).
function _parseGdacsPtTime(label) {
  const m = String(label || '').match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const yr = new Date().getUTCFullYear();
  let best = null;
  for (const y of [yr - 1, yr, yr + 1]) {
    const t = Date.UTC(y, +m[2] - 1, +m[1], +m[3], +m[4]);
    if (best == null || Math.abs(t - Date.now()) < Math.abs(best - Date.now())) best = t;
  }
  return best;
}
const _GDACS_LEVEL_COLORS = { Green: '#22c55e', Orange: '#f97316', Red: '#ef4444' };
// v5.88: GDACS's Green/Orange/Red is a HUMANITARIAN impact scale (population-
// level consequences estimated by the UN/EU system) — NOT "all clear for you."
// A storm can be GDACS Green while you sit inside its cone. So the UI leads
// with a plain word (Low/Medium/High impact) and keeps the color as accent.
const _GDACS_IMPACT_WORDS = { Green: 'Low', Orange: 'Medium', Red: 'High' };
const _GDACS_TITLE = 'GDACS humanitarian impact estimate (population-scale, from the UN/EU Global Disaster Alert system) — NOT your personal risk. Check the cone and alerts for your own exposure.';
// ── Projected ("Future:") name for an UNNAMED depression ──────────────────────
// NHC labels a depression "Tropical Depression <Number>" until it reaches
// tropical-storm strength, when it takes the next name on the season's list. The
// season's Nth cyclone gets the Nth name, so we map the storm's ATCF number to
// the WMO rotating list for its basin and show that as a projection. It's an
// estimate: the real name can shift if an earlier depression never got named.
// Lists rotate on a 6-year cycle → index = (year-2019) % 6. Full rotation from
// the NHC (nhc.noaa.gov/aboutnames.shtml), current through 2031 with the latest
// WMO retirements applied (Melissa→Molly, Beryl→Brianna, Helene→Holly,
// Milton→Miguel; EP Otis→Otilio, Dora→Debora, John→Jake). UPDATE when the WMO
// retires more names or the cycle turns past 2031.
const _STORM_NAMES = {
  at: {
    0: ['Andrea','Barry','Chantal','Dexter','Erin','Fernand','Gabrielle','Humberto','Imelda','Jerry','Karen','Lorenzo','Molly','Nestor','Olga','Pablo','Rebekah','Sebastien','Tanya','Van','Wendy'], // 2025 / 2031 (Melissa→Molly)
    1: ['Arthur','Bertha','Cristobal','Dolly','Edouard','Fay','Gonzalo','Hanna','Isaias','Josephine','Kyle','Leah','Marco','Nana','Omar','Paulette','Rene','Sally','Teddy','Vicky','Wilfred'], // 2026 (Laura→Leah)
    2: ['Ana','Bill','Claudette','Danny','Elsa','Fred','Grace','Henri','Imani','Julian','Kate','Larry','Mindy','Nicholas','Odette','Peter','Rose','Sam','Teresa','Victor','Wanda'], // 2027 (Ida→Imani)
    3: ['Alex','Bonnie','Colin','Danielle','Earl','Farrah','Gaston','Hermine','Idris','Julia','Karl','Lisa','Martin','Nicole','Owen','Paula','Richard','Shary','Tobias','Virginie','Walter'], // 2028 (Fiona→Farrah, Ian→Idris)
    4: ['Arlene','Bret','Cindy','Don','Emily','Franklin','Gert','Harold','Idalia','Jose','Katia','Lee','Margot','Nigel','Ophelia','Philippe','Rina','Sean','Tammy','Vince','Whitney'], // 2029
    5: ['Alberto','Brianna','Chris','Debby','Ernesto','Francine','Gordon','Holly','Isaac','Joyce','Kirk','Leslie','Miguel','Nadine','Oscar','Patty','Rafael','Sara','Tony','Valerie','William'], // 2030 (Beryl→Brianna, Helene→Holly, Milton→Miguel)
  },
  ep: {
    0: ['Alvin','Barbara','Cosme','Dalila','Erick','Flossie','Gil','Henriette','Ivo','Juliette','Kiko','Lorena','Mario','Narda','Octave','Priscilla','Raymond','Sonia','Tico','Velma','Wallis','Xina','York','Zelda'], // 2025 / 2031
    1: ['Amanda','Boris','Cristina','Douglas','Elida','Fausto','Genevieve','Hernan','Iselle','Julio','Karina','Lowell','Marie','Norbert','Odalys','Polo','Rachel','Simon','Trudy','Vance','Winnie','Xavier','Yolanda','Zeke'], // 2026
    2: ['Andres','Blanca','Carlos','Dolores','Enrique','Felicia','Guillermo','Hilda','Ignacio','Jimena','Kevin','Linda','Marty','Nora','Olaf','Pamela','Rick','Sandra','Terry','Vivian','Waldo','Xina','York','Zelda'], // 2027
    3: ['Agatha','Blas','Celia','Darby','Estelle','Frank','Georgette','Howard','Ivette','Javier','Kay','Lester','Madeline','Newton','Orlene','Paine','Roslyn','Seymour','Tina','Virgil','Winifred','Xavier','Yolanda','Zeke'], // 2028
    4: ['Adrian','Beatriz','Calvin','Debora','Eugene','Fernanda','Greg','Hilary','Irwin','Jova','Kenneth','Lidia','Max','Norma','Otilio','Pilar','Ramon','Selma','Todd','Veronica','Wiley','Xina','York','Zelda'], // 2029 (Dora→Debora, Otis→Otilio)
    5: ['Aletta','Bud','Carlotta','Daniel','Emilia','Fabio','Gilma','Hector','Ileana','Jake','Kristy','Lane','Miriam','Norman','Olivia','Paul','Rosa','Sergio','Tara','Vicente','Willa','Xavier','Yolanda','Zeke'], // 2030 (John→Jake)
  },
};
// Atlantic supplemental list (used when a season exhausts the main 21 names).
const _STORM_NAMES_SUPP_AT = ['Adria','Braylen','Caridad','Deshawn','Emery','Foster','Gemma','Heath','Isla','Jacobus','Kenzie','Lucio','Marina','Nasir','Orlanda','Pax','Ronin','Sophie','Tayshaun','Viviana','Will'];
const _NUM_WORDS = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20 };
function _stormNumber(storm) {
  const id = (storm.id || '').toUpperCase();
  const m = id.match(/^(AL|EP|CP)(\d{2})\d{2,4}$/); // ATCF: basin + number + year
  if (m) return parseInt(m[2], 10);
  let nm = (storm.name || '').trim().toLowerCase().replace(/^tropical depression\s*/, '');
  if (/^\d+$/.test(nm)) return parseInt(nm, 10);
  const parts = nm.split(/[\s-]+/);
  if (parts.length === 1 && _NUM_WORDS[parts[0]] != null) return _NUM_WORDS[parts[0]];
  if (parts.length === 2 && parts[0] === 'twenty' && _NUM_WORDS[parts[1]] != null) return 20 + _NUM_WORDS[parts[1]];
  return null;
}
function _isUnnamedDepression(storm) {
  // A real name is letters (e.g. "Elida"); an unnamed depression's name field is
  // the spelled number ("Two") or a digit — that's what we project a name for.
  const nm = (storm.name || '').trim().toLowerCase().replace(/^tropical depression\s*/, '');
  if (!nm) return false;
  if (/^\d+$/.test(nm)) return true;
  const parts = nm.split(/[\s-]+/);
  if (parts.length === 1) return _NUM_WORDS[parts[0]] != null;
  if (parts.length === 2) return parts[0] === 'twenty' && _NUM_WORDS[parts[1]] != null;
  return false;
}
function _futureStormName(storm) {
  if (!_isUnnamedDepression(storm)) return null;
  const num = _stormNumber(storm);
  if (!num || num < 1) return null;
  const basin = (storm.basin === 'ep' || /^(EP|CP)/i.test(storm.id || '')) ? 'ep' : 'at';
  const year = (new Date()).getFullYear();
  const list = (_STORM_NAMES[basin] || {})[(((year - 2019) % 6) + 6) % 6];
  if (!list) return null;
  if (num <= list.length) return list[num - 1];
  if (basin === 'at' && num - list.length <= _STORM_NAMES_SUPP_AT.length) return _STORM_NAMES_SUPP_AT[num - list.length - 1];
  return null;
}
function _isUserInCone(storm) {
  if (!S.lat || !S.lon || !_nhcData.cones) return false;
  // Match the storm to ITS cone with the SAME strict rule the push scanner uses
  // (scanner/tropical.js fetchTropical): only match on a NON-EMPTY id, or a
  // non-empty name that equals the cone's. The old loose test (c.stormId ===
  // storm.id || name === name) matched '' === '' / undefined === undefined, so a
  // system whose id/name didn't parse grabbed the FIRST cone with a blank id —
  // which is how a far-basin storm (e.g. an Eastern-Pacific system off Baja) read
  // "IN CONE" from Florida while the correctly-scoped push notification did not.
  const sid = storm.id || '';
  const sname = (storm.name || '').toLowerCase();
  const cone = _nhcData.cones.find(c =>
    (sid && c.stormId === sid) ||
    (c.stormName && sname && c.stormName.toLowerCase() === sname)
  );
  if (!cone || !cone.coords || cone.coords.length < 3) return false;
  const ring = cone.coords; // GeoJSON [lon, lat]
  // Integrity guard: a real forecast cone starts AT the storm, so the storm's own
  // position must fall within its cone's bounding box. If it doesn't, the match is
  // bogus and we must never report the user "in cone" a basin away.
  if (storm.lat != null && storm.lon != null) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of ring) {
      if (c[0] < minLon) minLon = c[0];
      if (c[0] > maxLon) maxLon = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    }
    const M = 2.5; // degrees of slack (reported position vs cone apex rounding)
    if (storm.lon < minLon - M || storm.lon > maxLon + M ||
        storm.lat < minLat - M || storm.lat > maxLat + M) return false;
  }
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1] != null ? ring[i][1] : ring[i][0];
    const yi = ring[i][0] != null ? ring[i][0] : ring[i][1];
    const xj = ring[j][1] != null ? ring[j][1] : ring[j][0];
    const yj = ring[j][0] != null ? ring[j][0] : ring[j][1];
    if (((yi > S.lon) !== (yj > S.lon)) && (S.lat < (xj - xi) * (S.lon - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function _getTropicalAlertsForStorm(storm) {
  if (!S.alerts) return { watches: [], warnings: [] };
  const name = (storm.name || '').toLowerCase();
  const stormId = (storm.id || '').toLowerCase();
  const watches = [];
  const warnings = [];
  for (const a of S.alerts) {
    const ev = (a.properties?.event || '').toLowerCase();
    const desc = (a.properties?.description || '').toLowerCase();
    const headline = (a.properties?.headline || '').toLowerCase();
    const isTropical = ev.includes('hurricane') || ev.includes('tropical storm') || ev.includes('storm surge') || ev.includes('tropical depression');
    if (!isTropical) continue;
    const matchesStorm = (name.length >= 3 && (desc.includes(name) || headline.includes(name))) || (stormId && desc.includes(stormId));
    if (!matchesStorm) continue;
    const inZone = isUserInAlertZone(a);
    if (ev.includes('warning')) warnings.push({ event: a.properties?.event, inZone });
    else if (ev.includes('watch')) watches.push({ event: a.properties?.event, inZone });
  }
  return { watches, warnings };
}
// v6.46: ascending "<" ladder — each band is checked as "below its upper bound"
// until Cat 5, which is the only ">=" (157+ mph). Official NHC mph boundaries:
// TD <39 · TS 39-73 · C1 74-95 · C2 96-110 · C3 111-129 · C4 130-156 · C5 ≥157.
function _saffirSimpson(windMph) {
  if (!windMph) return { cat: 'Unknown', label: 'Unknown', color: '#888', num: -1 };
  if (windMph < 39) return { cat: 'TD', label: 'Tropical Depression', color: '#90caf9', num: -1 };
  if (windMph < 74) return { cat: 'TS', label: 'Tropical Storm', color: '#4fc3f7', num: 0 };
  if (windMph < 96) return { cat: 'Cat 1', label: 'Category 1', color: '#ffeb3b', num: 1 };
  if (windMph < 111) return { cat: 'Cat 2', label: 'Category 2', color: '#ffc107', num: 2 };
  if (windMph < 130) return { cat: 'Cat 3', label: 'Category 3', color: '#ff9800', num: 3 };
  if (windMph < 157) return { cat: 'Cat 4', label: 'Category 4', color: '#ff5722', num: 4 };
  return { cat: 'Cat 5', label: 'Category 5', color: '#ff1744', num: 5 }; // >= 157
}
// v6.45: reconcile a storm's TYPE label with its own reported winds. Every feed's
// text lags its numbers: GDACS's severitytext and NHC/JTWC advisory titles can
// still read "Tropical Depression" after the same feed's wind field crossed the
// 39 mph naming threshold — the app then renders "Tropical Depression Bertha —
// Tropical Storm · Max Wind 58 mph", a self-contradiction (a depression is BY
// DEFINITION <39 mph). UPGRADE-ONLY, and only within the plain tropical ladder:
//  • Post-Tropical / Subtropical / Remnants / Potential / Invest are never touched
//    (their winds don't define them), and
//  • a type is never DOWNgraded on a low wind reading (official naming wins on
//    the way down; feed winds can lag low or go missing between advisories).
// At hurricane force the label is basin-aware: west Pacific says Typhoon, the
// Indian-Ocean/southern basins keep the generic Tropical Cyclone, the Atlantic /
// central+east Pacific (NHC's area) say Hurricane; unknown-basin storms fall back
// to their position, then to the globally-correct generic "Tropical Cyclone".
function _reconcileTropicalType(s) {
  const w = s && s.maxWind;
  if (!w) return;
  const t = String(s.type || '').trim();
  if (!/^(tropical (depression|storm|cyclone)|td|ts)$/i.test(t)) return;
  if (w >= 74) {
    const b = String(s.basin || '').toLowerCase();
    const id = String(s.id || '');
    if (b === 'at' || b === 'ep' || /^(AL|EP|CP)\d/i.test(id)) s.type = 'Hurricane';
    else if (b === 'wp' || /\d{2}W$/i.test(id)) s.type = 'Typhoon';
    else if (/\d{2}[SPABI]$/i.test(id)) s.type = 'Tropical Cyclone';
    else if (s.lat > 0 && s.lon != null && s.lon < -20) s.type = 'Hurricane';
    else if (s.lat > 0 && s.lon != null && s.lon >= 100 && s.lon <= 180) s.type = 'Typhoon';
    else s.type = 'Tropical Cyclone';
  } else if (w >= 39 && !/storm/i.test(t)) {
    s.type = 'Tropical Storm';
  }
}
// v6.47: data-age line for feed-lagged storms. GDACS refreshes ~6-hourly and can
// freeze after NHC's final advisory, so wind/pressure can be hours old while the
// popup looks live — say WHEN the numbers are from once they're >3 h old, and
// add a caution past 12 h (post-landfall storms weaken fast).
function _stormAsOfHtml(s) {
  if (!s || !s._asOf) return '';
  const age = Date.now() - s._asOf;
  if (age < 3 * 3600000) return '';
  const rel = (typeof _relativeTime === 'function') ? _relativeTime(s._asOf) : new Date(s._asOf).toLocaleString();
  const warn = age > 12 * 3600000 ? ' — storm may have changed since' : '';
  return `<div style="font-size:0.66em;color:var(--text-muted,#7a8699);margin-top:3px">📡 Wind/pressure as of ${rel}${warn}</div>`;
}
// v6.48: FREEZE FAIL-SAFE. Tropical feeds (GDACS ~6-hourly, NHC/JTWC RSS) can
// keep returning the SAME record long after a storm's final advisory, so a dead
// system lingers on the cards/ticker/AI looking live (the "data seems old"
// complaint). This gate fingerprints each storm's meaningful fields and
// remembers, in localStorage, WHEN that exact data was first seen. If nothing
// has changed for >= _STORM_FREEZE_MS (12 h) — or a GDACS `_asOf` stamp is
// itself >= 12 h old — the storm is ARCHIVED (dropped from the active list). It
// is NEVER hard-deleted: the instant any field changes the fingerprint resets
// and the storm returns, so a merely-stalled-but-live storm can't be lost. A
// live system issues a new advisory (new position/wind/pressure) at least every
// ~6 h, so 12 h of byte-identical data is a definitive dead-feed signal. The
// separate NHC GIS cone/track layers are authoritative and left untouched.
const _STORM_FREEZE_MS = 12 * 3600000;
function _stormFingerprint(s) {
  // Round position to 0.1 deg so float noise isn't mistaken for movement;
  // include the intensity/motion fields a real advisory would revise.
  const r1 = v => (typeof v === 'number' && isFinite(v)) ? Math.round(v * 10) / 10 : 'x';
  return [
    s.type || '', r1(s.lat), r1(s.lon),
    s.maxWind ?? 'x', s.minPressure ?? 'x',
    s.moveDir || 'x', s.moveSpeed ?? 'x'
  ].join('|');
}
// v6.49: STORM LIFECYCLE — an in-app "email" triage (Live / Archived / Deleted)
// surfaced in the 📢 bell. The freeze gate auto-moves stale storms to Archived
// (with a label + snapshot) instead of vanishing them; the user can Delete an
// archived storm to Trash, which SELF-PURGES after _STORM_DELETE_TTL (1 h) —
// with an "Archive instead" rescue while it waits. A frozen storm that starts
// updating again returns to Live automatically. Snapshots are kept so an
// archived/deleted storm still renders after it drops out of the live feed.
const _STORM_LC_KEY = 'st_stormLifecycle';
const _STORM_DELETE_TTL = 3600000; // 1 h — Trash auto-empties after this
function _loadStormLC() { try { return JSON.parse(localStorage.getItem(_STORM_LC_KEY) || '{}') || {}; } catch (e) { return {}; } }
function _saveStormLC(m) { try { localStorage.setItem(_STORM_LC_KEY, JSON.stringify(m)); } catch (e) {} }
// Drop deleted entries past their TTL. Returns true if anything was purged.
function _stormLCPurge(m) {
  const now = Date.now(); let changed = false;
  for (const id in m) {
    const e = m[id];
    if (e && e.state === 'deleted' && e.deletedAt && now - e.deletedAt >= _STORM_DELETE_TTL) { delete m[id]; changed = true; }
  }
  return changed;
}
function _stormSnapshot(s) {
  return { name: s.name || '', type: s.type || '', maxWind: s.maxWind ?? null, minPressure: s.minPressure ?? null, lat: s.lat ?? null, lon: s.lon ?? null, category: s.category ?? null };
}
function _stormFreezeGate(storms) {
  const now = Date.now();
  let store = {};
  try { store = JSON.parse(localStorage.getItem('st_stormFreeze') || '{}') || {}; } catch (e) { store = {}; }
  const lc = _loadStormLC();
  _stormLCPurge(lc);
  const next = {}; // only ids seen THIS run → stale freeze-fingerprints auto-pruned
  const seen = new Set();
  const active = [];
  let archived = 0;
  for (const s of storms) {
    const id = String(s.id || s.name || '');
    if (!id) { active.push(s); continue; }
    seen.add(id);
    const fp = _stormFingerprint(s);
    const prev = store[id];
    // First time this EXACT data is seen → stamp 'since' now; unchanged → carry it.
    const since = (prev && prev.fp === fp) ? prev.since : now;
    next[id] = { fp, since };
    const frozenMs = now - since;
    const asOfMs = (typeof s._asOf === 'number') ? now - s._asOf : -1;
    const frozen = frozenMs >= _STORM_FREEZE_MS || asOfMs >= _STORM_FREEZE_MS;
    const e = lc[id];
    // Respect an explicit USER hold (manual Archive/Delete) — the storm stays in
    // that bucket AND off the live cards/ticker — until its data MATERIALLY
    // changes (fingerprint differs from when it was pinned = a new advisory), at
    // which point the hold releases and the fresh data flows back to Live.
    if (e && e.pinned) {
      if (e.fpAtPin && fp !== e.fpAtPin) {
        e.pinned = false; // real change → let the feed drive it again (falls through)
      } else {
        e.snap = _stormSnapshot(s); e.fp = fp; e.updatedAt = now;
        if (frozen) { s._frozen = true; s._frozenSince = since; }
        continue; // archived/deleted → NOT added to active
      }
    }
    if (frozen) {
      s._frozen = true;
      s._frozenSince = since;
      archived++;
      const wasArchived = e && e.state === 'archived';
      lc[id] = { id, state: 'archived', reason: 'stale', snap: _stormSnapshot(s), fp, since, archivedAt: wasArchived ? e.archivedAt : now, updatedAt: now };
      // Frozen storms are NOT pushed to `active` → they leave the live cards/ticker.
    } else {
      active.push(s);
      lc[id] = { id, state: 'live', reason: '', snap: _stormSnapshot(s), fp, since, updatedAt: now };
    }
  }
  // Prune non-pinned 'live' entries not seen this run — the storm dissipated / NHC
  // dropped it before it ever froze. Archived + Deleted + any pinned entry persist
  // (keep the label/history even after the feed drops the storm).
  for (const id in lc) {
    if (lc[id].state === 'live' && !lc[id].pinned && !seen.has(id)) delete lc[id];
  }
  try { localStorage.setItem('st_stormFreeze', JSON.stringify(next)); } catch (e) {}
  _saveStormLC(lc);
  _nhcData.archivedSystems = storms.filter(s => s._frozen);
  if (archived) console.log('[NHC] Freeze fail-safe archived ' + archived + ' stale storm(s) — data unchanged >=12 h');
  if (typeof _updateNotifBadge === 'function') _updateNotifBadge();
  if (typeof _refreshNotifPanelIfOpen === 'function') _refreshNotifPanelIfOpen();
  return active;
}
// Lifecycle actions invoked from the 📢 panel (defined here so the store lives in
// one place; the panel UI in core.js calls these by name). A manual Archive/Delete
// PINS the storm — it holds that state (and stays off the live cards) until the
// feed reports materially changed data, so a user dismissal actually sticks.
function stormLCDelete(id) {
  const lc = _loadStormLC(); if (!lc[id]) return;
  lc[id].state = 'deleted'; lc[id].deletedAt = Date.now();
  lc[id].pinned = true; lc[id].fpAtPin = lc[id].fp || '';
  _saveStormLC(lc);
  if (typeof _refreshNotifPanelIfOpen === 'function') _refreshNotifPanelIfOpen();
  if (typeof renderStorms === 'function') renderStorms();
}
function stormLCArchive(id) {
  const lc = _loadStormLC(); if (!lc[id]) return;
  const wasStale = lc[id].reason === 'stale' && lc[id].state === 'archived';
  lc[id].state = 'archived'; lc[id].reason = wasStale ? 'stale' : 'manual'; delete lc[id].deletedAt;
  lc[id].pinned = true; lc[id].fpAtPin = lc[id].fp || '';
  if (!lc[id].archivedAt) lc[id].archivedAt = Date.now();
  _saveStormLC(lc);
  if (typeof _refreshNotifPanelIfOpen === 'function') _refreshNotifPanelIfOpen();
  if (typeof renderStorms === 'function') renderStorms();
}
function stormLCRestore(id) {
  const lc = _loadStormLC(); if (!lc[id]) return;
  lc[id].pinned = false; lc[id].state = 'live'; lc[id].reason = ''; delete lc[id].deletedAt;
  _saveStormLC(lc);
  if (typeof _refreshNotifPanelIfOpen === 'function') _refreshNotifPanelIfOpen();
  if (typeof renderStorms === 'function') renderStorms();
}
if (typeof window !== 'undefined') { window.stormLCDelete = stormLCDelete; window.stormLCArchive = stormLCArchive; window.stormLCRestore = stormLCRestore; }
function _tropicalStatusLabel(storm) {
  const w = storm._tropAlerts || { watches: [], warnings: [] };
  const inCone = storm._inCone;
  const warnInZone = w.warnings.some(x => x.inZone);
  const watchInZone = w.watches.some(x => x.inZone);
  if (warnInZone) return { text: '⚠️ WARNING', color: '#ff1744', bg: 'rgba(255,23,68,0.15)' };
  if (watchInZone) return { text: '👁️ WATCH', color: '#ffc107', bg: 'rgba(255,193,7,0.15)' };
  if (inCone) return { text: '🎯 IN CONE', color: '#ff9800', bg: 'rgba(255,152,0,0.15)' };
  if (storm.dist != null && storm.dist <= S._nhcProxRadius) return { text: '📡 TRACKING', color: '#4fc3f7', bg: 'rgba(79,195,247,0.15)' };
  return null;
}
function _escStormName(name) {
  return (name || '').replace(/['"\\<>&]/g, '');
}
// v6.30: the storm-cell card badge's cross-track (X-TRK) proximity scale is now
// derived from the ONE global XTRK_TIERS table (core.js) — 5 tiers matching the
// ticker's own bands: 🎯 direct ≤1.5 · 🟠 nearby ≤6 · 🟡 near-miss ≤12 ·
// 🔵 tracking ≤48 · ⚪ distant >48. This thin wrapper keeps the long-standing
// `_xtrkTier(...)` call sites working while the definition lives in one place.
// (Display only — the internal 6-tier PERP classification still drives sorting,
// alert thresholds and the background push scanner.)
function _xtrkTier(missMi){
  return (typeof xtrkTier==='function')?xtrkTier(missMi):null;
}
// v5.64: storm-card view mode — 'hybrid' (plain-English line above the boxes,
// default) · 'text' (readout only) · 'cards' (boxes only, the pre-v5.64 look).
function _stormView(){try{const v=localStorage.getItem('st_stormView');return(v==='text'||v==='cards')?v:'hybrid'}catch(e){return'hybrid'}}
function cycleStormView(){const cur=_stormView();const nx=cur==='hybrid'?'text':cur==='text'?'cards':'hybrid';try{localStorage.setItem('st_stormView',nx)}catch(e){}if(typeof renderStorms==='function')renderStorms()}
if(typeof window!=='undefined')window.cycleStormView=cycleStormView;
// v5.64: one plain-English sentence tying a cell's sections together, e.g.
// "⛈️ Strong storm — 26.7 mi to your N (12°), moving S (188°) at 12 mph.
//  🎯 Direct impact, XTK 0.2 mi, arriving ~3:23 PM · Heavy rain (~48 dBZ) expected."
function _stormTextSummary(s,_b,_sMv,eta){
  const icon=s._rotation?'🌪️':s.dbz>=60?'🚨':s.dbz>=52?'⛈️':s.dbz>=41?'🌧️':'🌦️';
  const strength=s._rotation?'Rotating storm':s.dbz>=65?'Extreme storm':s.dbz>=60?'Severe storm':s.dbz>=52?'Strong storm':s.dbz>=41?'Storm':'Rain cell';
  // v5.65: distance ticks live like the Distance box — the shared
  // [data-dist-mi] updater in startEtaCountdowns() recomputes it every second
  // from closing speed × time-remaining, interpolating down toward arrival.
  const _cs=(eta&&eta.closingSpeed)?eta.closingSpeed:0;
  const _tgt=(eta&&eta._targetMs)?eta._targetMs:0;
  const _liveDist=(_cs>0&&_tgt>Date.now())?Math.max(0,(_tgt-Date.now())/3600000)*_cs:s.distance;
  const distStr=`<span data-dist-mi="${s.distance}" data-closing-mph="${_cs}" data-target-ms="${_tgt}">${fmtStormDist(_liveDist)}</span>`;
  const posDir=degToDir(s.bearing);
  const hasMv=!!(_sMv&&_sMv.speed>=2);
  const moveClause=hasMv?`moving ${degToDir(_sMv.direction)} (${Math.round(_sMv.direction)}°) at ${S.radarMetric?Math.round(_sMv.speed*1.60934)+' km/h':_sMv.speed+' mph'}`:'motion unknown';
  const closing=!!(_b&&_b.closingMph>0&&_b.classification!=='moving_away');
  let impact;
  if(_b&&_b.classification==='moving_away'){
    impact='🟢 Drifting away — not a threat to you.';
  }else if(closing&&_b.perpMissMi!=null){
    const t=_xtrkTier(_b.perpMissMi);
    const word=t.word;
    const missStr=S.radarMetric?(_b.perpMissMi*1.60934).toFixed(1)+' km':_b.perpMissMi.toFixed(1)+' mi';
    // v5.65: arrival shows a LIVE countdown (ticks via the shared eta-countdown
    // updater) next to the fixed clock time. No data-storm-key here so it never
    // double-triggers the auto-rescan the box's countdown already owns.
    // v6.30: ETA phrasing keys off the tier's `eta` flag (from XTRK_TIERS).
    // 'live' (direct ≤1.5 mi) gets a live ticking countdown next to the clock
    // time — it's aimed at you. 'fixed' (nearby 1.5–6 mi) gets a fixed possible
    // arrival time plus a "path may shift" nudge, no countdown. 'none' (>6 mi:
    // near-miss/tracking/distant) gets no ETA — too far / track-dependent to put
    // a clock on. The presence of a countdown alone now reads direct.
    let arr='';
    const _clock=(_tgt&&_tgt>Date.now())?fmtClockShort(new Date(_tgt)):((eta&&eta.eta!=null)?fmtArrivalTime(eta.eta):null);
    if(t.eta==='live'&&_clock){
      if(_tgt&&_tgt>Date.now()){
        const _cd=fmtCountdown(Math.max(0,Math.round((_tgt-Date.now())/1000)));
        arr=`, arriving ~${_clock} (in <span class="eta-countdown" data-eta-sec="${Math.round(_tgt)}">${_cd}</span>)`;
      }else{
        arr=`, arriving ~${_clock}`;
      }
    }else if(t.eta==='fixed'&&_clock){
      arr=`, possible ETA ~${_clock} — path may still shift, keep an eye on the radar`;
    }
    // t.eta==='none' (>6 mi): no ETA
    const est=_b.estDbzAtUser;
    const rain=(est!=null&&est>=15)?`${stormCat(est).label} (~${est} dBZ) expected`:'little/no rain expected at you';
    impact=`${t.emoji} ${word}, XTK ${missStr}${arr} · ${rain}.`;
  }else{
    impact='Track uncertain — watching.';
  }
  return `${icon} ${strength} — ${distStr} to your ${posDir} (${Math.round(s.bearing)}°), ${moveClause}. ${impact}`;
}
// ── v6.1: Thunderstorm shear + storm-relative inflow (Stull, Practical
// Meteorology §14.5). The winds-aloft profile (S._aloftData: surface / 925 /
// 850 / 700 / 500 hPa ≈ the 0–6 km layer) tells us how a convective cell will
// evolve, independent of the radar dBZ trend:
//   • 0–6 km BULK SHEAR = vector diff (surface → ~500 hPa) → organization &
//     longevity. WEAK (<10 m/s ≈ 20 kt): a single "pulse" cell rains into its
//     own updraft and rides along WITH its boundary-layer fuel, depleting it →
//     dies in ~15–60 min. MODERATE (10–18): organized multicell. STRONG
//     (≥18 m/s ≈ 35 kt): tilted updraft, long-lived, supercell-capable.
//   • MEAN 0–6 km WIND = the "normal" storm motion; a cell tracking to the
//     RIGHT of it in strong shear is a right-moving supercell signature (Bunkers).
//   • STORM-RELATIVE low-level inflow = low-level wind − the cell's own motion;
//     near-zero means it's riding with its air (starving), large means it's
//     ingesting fresh fuel (Stull's "vacuum cleaner").
// Winds aloft are sampled at the user's location, so this is the LOCAL
// environment — a good approximation across one radar scan, not a per-pixel value.
function _windToward(spdMs, dirFromDeg){ const r = dirFromDeg * Math.PI / 180; return { u: -spdMs * Math.sin(r), v: -spdMs * Math.cos(r) }; }
function computeShearProfile(){
  const a = S._aloftData;
  if(!a || a.length < 2) return null;
  if(S._shearProfile && S._shearProfileFor === a) return S._shearProfile; // cache until winds-aloft refetched
  const sfc = a.find(x => x.isSfc || x.p >= 1000) || a[0];
  let top = null; for(const x of a){ if(x.p >= 470 && x.p <= 530){ top = x; break; } }
  if(!top) top = a[a.length - 1]; // deepest available if no ~500 hPa level
  const vs = _windToward(sfc.rawMs, sfc.dir), vt = _windToward(top.rawMs, top.dir);
  const bulkShearMs = Math.hypot(vt.u - vs.u, vt.v - vs.v);
  let mu = 0, mvv = 0, n = 0; for(const x of a){ const w = _windToward(x.rawMs, x.dir); mu += w.u; mvv += w.v; n++; }
  mu /= n; mvv /= n;
  const meanDirTo = (Math.atan2(mu, mvv) * 180 / Math.PI + 360) % 360;
  const tier = bulkShearMs >= 18 ? 'strong' : bulkShearMs >= 10 ? 'moderate' : 'weak';
  const org = bulkShearMs >= 18 ? 'supercell-capable' : bulkShearMs >= 10 ? 'organized multicell' : 'pulse';
  const prof = { bulkShearMs, meanU: mu, meanV: mvv, meanSpdMs: Math.hypot(mu, mvv), meanDirTo, tier, org, lowU: vs.u, lowV: vs.v, topP: top.p };
  S._shearProfile = prof; S._shearProfileFor = a;
  return prof;
}
// Per-cell convective signal. mv = cell movement { direction(toward,°), speed(mph) }.
function _cellShearSignal(mv, dbz){
  if(dbz == null || dbz < 30) return null; // only genuinely convective cells
  const prof = computeShearProfile();
  if(!prof) return null;
  let srInflowMs = null, rightMover = false;
  if(mv && mv.speed >= 2 && mv.direction != null){
    const cMs = mv.speed * 0.44704; // mph → m/s
    const cu = cMs * Math.sin(mv.direction * Math.PI / 180), cv = cMs * Math.cos(mv.direction * Math.PI / 180); // toward
    srInflowMs = Math.hypot(prof.lowU - cu, prof.lowV - cv);
    const cross = prof.meanU * cv - prof.meanV * cu; // < 0 → cell is right of the mean wind
    let dAng = Math.abs(mv.direction - prof.meanDirTo); if(dAng > 180) dAng = 360 - dAng;
    rightMover = (prof.tier === 'strong' && cross < 0 && dAng >= 15 && dAng <= 90);
  }
  const starving = (srInflowMs != null && srInflowMs < 4); // riding with its own air
  let trend, note;
  if(prof.tier === 'weak' || starving){
    trend = 'weakening';
    note = (starving && prof.tier !== 'weak')
      ? 'moving with the low-level flow — starving its own inflow, likely to weaken'
      : 'weak shear — pulse cell, likely to weaken within ~30–60 min';
  } else if(prof.tier === 'strong'){
    trend = 'organized';
    note = rightMover ? 'strong shear — supercell-capable, right-moving' : 'strong shear — supercell-capable, long-lived';
  } else {
    trend = 'steady'; note = 'moderate shear — organized multicell';
  }
  return { bulkShearMs: prof.bulkShearMs, tier: prof.tier, org: prof.org, srInflowMs, rightMover, trend, note, starving: !!starving };
}
// v5.99: THE single per-scan "master" record for a storm cell. Cards, the ETA
// box, the ticker, notifications, the storm-cell alert gate and sorting all read
// THIS one X-TRK model instead of independently re-deriving impact / ETA / tier.
// Computed once and cached by S._stormScanId; the underlying helpers
// (calcStormETAForBriefing / calcStormETA / getHybridMovement) each cache per
// scan too, so nothing recomputes. This REPLACES the old separate cone-angle
// impact model (_calcStormImpact, deleted) — impactPct now comes from the same
// X-TRK impactScore the cards show, and impactTier maps the X-TRK tier onto the
// legacy high/medium/low buckets the Alerts tab renders.
function stormMaster(storm){
  if(!storm)return null;
  if(storm._m&&storm._mScanId===S._stormScanId)return storm._m;
  let brief=null;try{if(typeof calcStormETAForBriefing==='function')brief=calcStormETAForBriefing(storm);}catch(e){}
  const eta=(typeof calcStormETA==='function')?calcStormETA(storm):null;
  const mv=(typeof getHybridMovement==='function')?getHybridMovement(storm):null;
  const perpMissMi=(brief&&brief.perpMissMi!=null&&isFinite(brief.perpMissMi))?brief.perpMissMi:((eta&&eta.perpMissMi!=null)?eta.perpMissMi:null);
  const tierObj=(typeof _xtrkTier==='function')?_xtrkTier(perpMissMi):null;
  const tier=tierObj?tierObj.key:null;
  const impactPct=(brief&&brief.impactScore!=null)?Math.round(brief.impactScore*100):(eta?eta.impact||0:0);
  const impactTier=tierObj?tierObj.impact:'none';
  const m={
    brief,eta,mv,perpMissMi,tier,impactTier,impactPct,
    classification:brief?brief.classification:(eta?eta.perpTier:null),
    etaMin:eta?eta.eta:null,
    closingSpeed:(brief&&brief.closingMph!=null)?brief.closingMph:(eta?eta.closingSpeed:0),
    estDbzAtUser:brief?brief.estDbzAtUser:null,
    sideBearing:brief?brief.sideBearing:null,
    approaching:eta?eta.approaching:false,
    shear:_cellShearSignal(mv,storm.dbz), // v6.1: convective shear/inflow read
  };
  storm._m=m;storm._mScanId=S._stormScanId;
  return m;
}
// v5.97/v5.99: storm-cell NOTIFICATION text, read straight off the master record
// (one X-TRK model). Returns a SHORT line for the phone/browser notification
// (which truncates) and a FULL, detailed line for the 📢 log. ETA follows the
// tier's `eta` flag (XTRK_TIERS): live → ETA+clock, fixed → possible ETA,
// none (>6 mi) → no clock.
function _stormNotifMsg(storm){
  const m=(typeof stormMaster==='function')?stormMaster(storm):null;
  const b=m?m.brief:null;
  const mv=m?m.mv:null;
  const miss=m?m.perpMissMi:null;
  const key=(m&&m.tier)?m.tier:'distant';
  const tObj=(typeof xtrkTierByKey==='function')?xtrkTierByKey(key):null;
  const label=tObj?`${tObj.emoji} ${tObj.word}`:'⚪ Distant';
  const shortTier=tObj?tObj.plain.toLowerCase():'distant';
  let etaMin=null,arrMs=null;
  if(m&&m.etaMin!=null&&m.etaMin>0){etaMin=Math.max(0,m.etaMin-radarAgeMin());arrMs=Date.now()+etaMin*60000;}
  let etaFull='',etaShort='';
  if(arrMs&&tObj&&tObj.eta==='live'){etaFull=` — ETA ${formatStormEta(etaMin)} (~${fmtClockShort(new Date(arrMs))})`;etaShort=` · ETA ${formatStormEta(etaMin)}`;}
  else if(arrMs&&tObj&&tObj.eta==='fixed'){etaFull=` — possible ETA ~${fmtClockShort(new Date(arrMs))} (path may shift)`;etaShort=` · ~${fmtClockShort(new Date(arrMs))}`;}
  const distStr=fmtStormDist(storm.distance);
  const posDir=degToDir(storm.bearing);
  const strength=storm._rotation?'Rotating storm':storm.dbz>=65?'Extreme storm':storm.dbz>=60?'Severe storm':storm.dbz>=52?'Strong storm':storm.dbz>=41?'Storm':'Rain cell';
  const mvClause=(mv&&mv.speed>=2)?`moving ${degToDir(mv.direction)} (${Math.round(mv.direction)}°) at ${S.radarMetric?Math.round(mv.speed*1.60934)+' km/h':mv.speed+' mph'}`:'motion uncertain';
  const missStr=miss!=null?(S.radarMetric?`, X-TRK ${(miss*1.60934).toFixed(1)} km`:`, X-TRK ${miss.toFixed(1)} mi`):'';
  const est=(b&&b.estDbzAtUser!=null)?b.estDbzAtUser:null;
  const rain=(est!=null&&est>=15)?` ${stormCat(est).label} (~${est} dBZ) expected at you.`:((tObj&&tObj.eta==='none')?'':' Little/no rain expected at you.');
  const full=`🌩️ ${strength} — ${storm.dbz} dBZ, ${distStr} to your ${posDir} (${Math.round(storm.bearing)}°), ${mvClause}. ${label}${missStr}${etaFull}.${rain}`;
  const short=`🌩️ ${storm.dbz} dBZ ${shortTier} · ${distStr} ${posDir}${etaShort}`;
  return {short,full,key,etaMin,arrMs,dbz:storm.dbz,dist:storm.distance};
}
function _renderTropicalSection() {
  const allSystems = _nhcData.systems;
  if (allSystems === null) {
    return `<div class="card mt-12"><div class="card-title"><span class="icon">🌀</span> Tropical Cyclones</div>
      <div style="text-align:center;padding:16px;color:var(--text-muted);font-size:0.8em">🔄 Loading tropical data...</div></div>`;
  }
  const systems = _getFilteredSystems() || [];
  const regionPills = _STORM_REGIONS.map(r => {
    const count = r.id === 'all' ? allSystems.length : allSystems.filter(s => s._region === r.id).length;
    const isActive = S._nhcRegionFilter === r.id;
    return `<button onclick="setNHCRegionFilter('${r.id}')" style="font-size:0.6em;padding:2px 8px;border-radius:12px;border:1px solid ${isActive ? 'var(--accent-cyan)' : 'var(--border-subtle)'};background:${isActive ? 'rgba(0,229,255,0.15)' : 'var(--bg-surface)'};color:${isActive ? 'var(--accent-cyan)' : 'var(--text-muted)'};cursor:pointer;font-weight:${isActive ? '700' : '500'};white-space:nowrap">${r.label}${count ? ' (' + count + ')' : ''}</button>`;
  }).join('');
  if (!allSystems.length) {
    return `<div class="card mt-12"><div class="card-title"><span class="icon">🌀</span> Tropical Cyclones</div>
      <div style="text-align:center;padding:16px;color:var(--accent-green);font-size:0.8em">✅ No active tropical systems</div>
      <div style="font-size:0.6em;color:var(--text-muted);text-align:center;padding:0 8px 8px">Data: NHC + JTWC + GDACS</div></div>`;
  }
  let html = `<div class="card mt-12"><div class="card-title flex-between"><span><span class="icon">🌀</span> Tropical Cyclones (${systems.length}${S._nhcRegionFilter !== 'all' ? '/' + allSystems.length : ''})</span><label style="display:flex;align-items:center;gap:4px;font-size:0.65em;font-weight:500;color:var(--text-muted);cursor:pointer"><span>Map</span><input type="checkbox" ${S._showNHCTracks ? 'checked' : ''} onchange="toggleNHCTracks(this.checked)" class="accent-cyan-check"></label></div>`;
  html += `<div style="display:flex;gap:4px;margin-bottom:8px;padding:0 4px;flex-wrap:wrap;overflow-x:auto">${regionPills}</div>`;
  const catScale = `<div style="display:flex;gap:2px;margin-bottom:8px;padding:0 4px;flex-wrap:wrap">
    <span style="font-size:0.55em;padding:1px 5px;border-radius:4px;background:#90caf920;color:#90caf9;font-weight:600">TD</span>
    <span style="font-size:0.55em;padding:1px 5px;border-radius:4px;background:#4fc3f720;color:#4fc3f7;font-weight:600">TS</span>
    <span style="font-size:0.55em;padding:1px 5px;border-radius:4px;background:#ffeb3b20;color:#ffeb3b;font-weight:600">Cat 1</span>
    <span style="font-size:0.55em;padding:1px 5px;border-radius:4px;background:#ffc10720;color:#ffc107;font-weight:600">Cat 2</span>
    <span style="font-size:0.55em;padding:1px 5px;border-radius:4px;background:#ff980020;color:#ff9800;font-weight:600">Cat 3</span>
    <span style="font-size:0.55em;padding:1px 5px;border-radius:4px;background:#ff572220;color:#ff5722;font-weight:600">Cat 4</span>
    <span style="font-size:0.55em;padding:1px 5px;border-radius:4px;background:#ff174420;color:#ff1744;font-weight:600">Cat 5</span>
  </div>`;
  html += catScale;
  if (!systems.length) {
    const filterLabel = (_STORM_REGIONS.find(r => r.id === S._nhcRegionFilter) || {}).label || S._nhcRegionFilter;
    html += `<div class="text-center-muted" style="padding:12px">No active systems in ${filterLabel}</div>`;
  }
  systems.forEach((s, idx) => {
    const cat = s.category || _saffirSimpson(s.maxWind);
    const distStr = s.dist != null ? (S.radarMetric ? Math.round(s.dist * 1.60934) + ' km' : Math.round(s.dist) + ' mi') : 'Unknown';
    const bearing = (s.lat != null && s.lon != null) ? degToDir(bearingDeg(S.lat, S.lon, s.lat, s.lon)) : '';
    const isNear = s.dist != null && s.dist <= S._nhcProxRadius;
    const status = _tropicalStatusLabel(s);
    const hasForecast = (_nhcData.forecast || []).some(t => t.stormId === s.id || t.stormName.toLowerCase() === s.name.toLowerCase());
    const safeId = _escStormName(s.id || s.name);
    html += `<div style="padding:10px;border-left:4px solid ${cat.color};background:${cat.color}08;border-radius:0 8px 8px 0;margin-bottom:8px;cursor:pointer${isNear ? ';border:1px solid ' + cat.color + '44' : ''}" onclick="_selectNHCStorm('${safeId}')">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span class="text-13">🌀</span>
        <div class="flex-1">
          <div style="font-weight:700;font-size:0.95em;color:var(--text-primary)">${s.type} ${s.name}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-size:0.7em;color:${cat.color};font-weight:700">${cat.label}${cat.num >= 1 ? ' (Category ' + cat.num + ')' : ''}</span>
            ${_futureStormName(s) ? `<span style="font-size:0.55em;padding:1px 6px;border-radius:8px;background:rgba(120,200,255,0.12);color:var(--accent-cyan);font-weight:700">Future: ${_futureStormName(s)}</span>` : ''}
            ${status ? `<span style="font-size:0.55em;padding:1px 6px;border-radius:8px;background:${status.bg};color:${status.color};font-weight:700">${status.text}</span>` : ''}
            ${s._gdacs ? `<span style="font-size:0.55em;padding:1px 6px;border-radius:8px;background:${(_GDACS_LEVEL_COLORS[s._gdacs.alertlevel] || '#22c55e')}20;color:${_GDACS_LEVEL_COLORS[s._gdacs.alertlevel] || '#22c55e'};font-weight:700" title="${_GDACS_TITLE}">🌍 ${(_GDACS_IMPACT_WORDS[s._gdacs.alertlevel] || s._gdacs.alertlevel).toUpperCase()} IMPACT</span>` : ''}
          </div>
        </div>
        <div style="text-align:right;font-size:0.75em">
          <div class="c-muted">${distStr}</div>
          <div class="c-muted-85">${bearing}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px">
        ${s.maxWind != null ? `<div class="text-center-box"><div class="tile-label-upper" style="letter-spacing:normal">Max Wind</div><div style="font-size:0.9em;font-weight:700;color:${cat.color}">${s.maxWind} mph${s.gusts ? '<span class="text-muted-sm"> G' + s.gusts + '</span>' : ''}</div></div>` : ''}
        ${s.minPressure != null ? `<div class="text-center-box"><div class="tile-label-upper" style="letter-spacing:normal">Pressure</div><div style="font-size:0.9em;font-weight:700;color:var(--text-primary)">${s.minPressure} mb</div></div>` : ''}
        ${s.moveDir ? `<div class="text-center-box"><div class="tile-label-upper" style="letter-spacing:normal">Movement</div><div style="font-size:0.9em;font-weight:700;color:var(--text-primary)">${s.moveDir}${s.moveSpeed ? ' ' + s.moveSpeed + ' mph' : ''}</div></div>` : ''}
      </div>
      ${_stormAsOfHtml(s)}
      ${s.lat != null ? `<div style="font-size:0.65em;color:var(--text-muted);margin-top:4px">📍 ${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}, ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'} · ${(_STORM_REGIONS.find(r => r.id === s._region) || {}).label || s.basin}${s._source === 'jtwc' ? ' (JTWC)' : s._source === 'gdacs' ? ' (GDACS)' : ''}${hasForecast ? ' · <span class="c-cyan">Tap for forecast track</span>' : ''}</div>` : ''}
    </div>`;
  });
  html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px 2px">
    <div class="flex-center-gap4"><span class="text-hint">Alert radius:</span>
      <select onchange="setNHCProxRadius(this.value)" style="font-size:0.6em;padding:1px 4px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px">${[100,200,300,500,750,1000].map(r=>`<option value="${r}"${r===S._nhcProxRadius?' selected':''}>${r} mi</option>`).join('')}</select></div>
    <span class="text-hint">NHC + JTWC + GDACS · 15-min</span></div></div>`;
  return html;
}
function setNHCProxRadius(val) {
  S._nhcProxRadius = parseInt(val) || 200;
  try { localStorage.setItem('st_nhc_prox_radius', String(S._nhcProxRadius)); } catch(e) {}
  if (S.activePage === 'alerts' || S.activePage === 'weather') { if (S.activePage === 'alerts') renderAlerts(); _updateTropicalUI(); }
}
function _selectNHCStorm(idOrName, nameHint) {
  S._nhcSelectedStorm = idOrName;
  switchPage('radar');
  // v6.46: same stale-key resilience as the track table — the embedded id can
  // be a feed-hop old one, so resolve via _resolveTrackRefs (id → name → GDACS
  // event id) instead of an exact-match find.
  const findStorm = () => _resolveTrackRefs(idOrName, nameHint).storm;
  const tryPlot = () => {
    if (S.map) {
      plotNHCTracks(S.map);
      const storm = findStorm();
      if (storm && storm.lat != null) S.map.setView([storm.lat, storm.lon], 5);
      return true;
    }
    return false;
  };
  if (!tryPlot()) {
    let attempts = 0;
    const interval = setInterval(() => {
      if (tryPlot() || ++attempts >= 10) clearInterval(interval);
    }, 300);
  }
  const storm = findStorm();
  toast(`Showing forecast for ${storm ? storm.name : idOrName}`);
}
// v6.06: Zoom.earth-style scrollable track table — the whole track in one card,
// FUTURE on top → PAST/now at the bottom, current position highlighted, and a
// "Forecast" tag in place of any value NHC didn't provide.
function _trackBadge(maxWind) {
  const c = _saffirSimpson(maxWind);
  let ltr;
  if (c.num >= 1) ltr = String(c.num);        // hurricane category number
  else if (maxWind >= 39) ltr = 'S';          // tropical storm
  else if (maxWind > 0) ltr = 'D';            // tropical depression
  else ltr = '•';
  return { ltr, color: c.color, label: c.label };
}
function closeStormTrackTable() {
  const el = document.getElementById('storm-track-panel');
  if (el) el.remove();
}
// v6.46: resolve a track-table request to its live storm + forecast points.
// Popup links embed their storm key STATICALLY at plot time, but the tropical
// data rebuilds every ~15 min and a storm's id can CHANGE between cycles as it
// hops feeds (e.g. GDACS-carried "GDACS_1001290" becomes an NHC id the moment
// NHC picks it up) — so a tap on an older popup missed both lookups and toasted
// "No track data for GDACS_1001290". Resolution now falls back progressively:
// exact id/name → the nameHint the link also carries (names survive feed hops;
// Bertha is Bertha in every feed) → the GDACS event id remembered on the merged
// storm (s._gdacs.eventid) → then fcstPoints re-looked-up under the RESOLVED
// storm's current id/name. Pure data-in/data-out so it can be unit-replayed.
function _resolveTrackRefs(idOrName, nameHint) {
  const keys = [idOrName, nameHint].map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
  const sysList = (_nhcData.systems || []);
  const fpList = (_nhcData.fcstPoints || []);
  const byKey = (id, nm) => keys.some(k => String(id || '').toLowerCase() === k || String(nm || '').toLowerCase() === k);
  let storm = sysList.find(s => byKey(s.id, s.name));
  if (!storm) {
    // stale GDACS_<eventid> key → match the event id remembered on the merged storm
    const gid = keys.map(k => (k.match(/^gdacs_(\d+)$/) || [])[1]).find(Boolean);
    if (gid) storm = sysList.find(s => s._gdacs && String(s._gdacs.eventid) === gid);
  }
  let fp = fpList.find(f => byKey(f.stormId, f.stormName));
  if (!fp && storm) {
    const sid = String(storm.id || '').toLowerCase();
    const snm = String(storm.name || '').toLowerCase();
    fp = fpList.find(f => String(f.stormId || '').toLowerCase() === sid || (snm && String(f.stormName || '').toLowerCase() === snm));
  }
  const name = (storm && storm.name) || (fp && fp.stormName) || nameHint || idOrName;
  const type = (storm && storm.type) || 'Storm';
  return { fp, storm, name, type };
}
function showStormTrackTable(idOrName, nameHint) {
  const { fp, storm, name, type } = _resolveTrackRefs(idOrName, nameHint);
  if (!fp || !fp.pts || !fp.pts.length) { if (typeof toast === 'function') toast('No track data for ' + name); return; }
  const nowT = Date.now();
  // v6.19: order by the reliable path index (_ord), newest/forecast on top — NOT by
  // the observed layer's unreliable timestamps (which scrambled the row order).
  const _hasOrd = fp.pts.length && fp.pts.every(p => p._ord != null);
  const rows = fp.pts.slice().filter(p => p.lat != null).sort((a, b) => _hasOrd ? (b._ord - a._ord) : ((b.t || 0) - (a.t || 0)));
  // "current" = the current center (tau-0 forecast fix), the row we highlight + scroll to
  const _curPt = fp.pts.find(p => !p.past && p.tau != null && p.tau <= 0) || fp.pts.find(p => !p.past && p.tau != null);
  const _curOrd = _curPt ? _curPt._ord : null;
  const off = -new Date().getTimezoneOffset() / 60;
  const offStr = (Number.isInteger(off) ? Math.abs(off) : Math.abs(off).toFixed(1));
  const tzStr = 'UTC' + (off >= 0 ? '+' : '−') + offStr;
  const headCat = _saffirSimpson(storm ? storm.maxWind : (_curPt || rows[0] || {}).maxWind);
  let bodyRows = '';
  for (const p of rows) {
    const d = new Date(p.t);
    const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = (typeof fmtClock === 'function') ? fmtClock(d) : d.toLocaleTimeString();
    const bd = _trackBadge(p.maxWind);
    const isCur = (_curOrd != null && p._ord != null) ? (p._ord === _curOrd) : (p.t === (_curPt ? _curPt.t : null));
    // forecast vs past without trusting the observed timestamp
    const future = p.past ? false : (p.tau != null ? p.tau > 0 : (p.t != null && p.t > nowT));
    const _fc = '<span style="color:var(--text-muted,#7a8699);font-style:italic">Forecast</span>';
    const windCell = (p.maxWind != null)
      ? (p.maxWind + (p.gusts ? `<span style="color:var(--text-muted,#7a8699);font-size:0.85em"> G${p.gusts}</span>` : ''))
      : _fc;
    const presCell = p.minPressure ? (p.minPressure + '') : _fc;
    bodyRows += `<tr style="border-top:1px solid var(--border-subtle,#243040);${isCur ? 'background:rgba(34,211,238,0.16)' : (future ? '' : 'opacity:0.6')}">
      <td style="padding:4px 8px;white-space:nowrap;font-weight:${isCur ? '700' : '500'}">${escHtml(dateStr)}<span style="font-size:0.85em;color:var(--text-secondary,#9fb0c3);margin-left:5px">${escHtml(timeStr)}</span></td>
      <td style="padding:4px 4px;text-align:center"><span title="${escHtml(bd.label)}" style="display:inline-block;min-width:18px;padding:1px 5px;border-radius:4px;background:${bd.color};color:#0b1220;font-weight:800;font-size:0.85em">${bd.ltr}</span></td>
      <td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums;font-weight:${isCur ? '700' : '500'}">${windCell}</td>
      <td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums">${presCell}</td>
    </tr>`;
  }
  closeStormTrackTable();
  const panel = document.createElement('div');
  panel.id = 'storm-track-panel';
  panel.setAttribute('style', 'position:fixed;top:56px;left:50%;transform:translateX(-50%);width:min(340px,90vw);max-height:64vh;display:flex;flex-direction:column;background:var(--bg-surface,#0f1520);border:1px solid var(--border-subtle,#243040);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,0.6);z-index:4000;overflow:hidden;font-family:system-ui;color:var(--text-primary,#e6edf5)');
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:7px;padding:8px 11px;border-bottom:1px solid var(--border-subtle,#243040)">
      <span style="display:inline-block;min-width:19px;padding:1px 6px;border-radius:5px;background:${headCat.color};color:#0b1220;font-weight:800;font-size:0.9em">${_trackBadge(storm ? storm.maxWind : (rows[0] || {}).maxWind).ltr}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:0.95em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(type)} ${escHtml(name)}</div>
        <div style="font-size:0.66em;color:var(--text-secondary,#9fb0c3)">Full track · your local time (${tzStr})</div>
      </div>
      <button onclick="closeStormTrackTable()" aria-label="Close" style="background:none;border:none;color:var(--text-secondary,#9fb0c3);font-size:1.3em;line-height:1;cursor:pointer;padding:2px 5px">&times;</button>
    </div>
    <div style="overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch">
      <table style="width:100%;border-collapse:collapse;font-size:0.8em">
        <thead><tr style="position:sticky;top:0;background:var(--bg-surface,#0f1520);color:var(--text-muted,#7a8699);font-size:0.8em;text-align:left">
          <th style="padding:5px 8px;font-weight:600">DATE / TIME</th>
          <th style="padding:5px 4px;text-align:center;font-weight:600">TYPE</th>
          <th style="padding:5px 8px;text-align:right;font-weight:600">WIND<span style="font-weight:400;opacity:0.7"> mph</span></th>
          <th style="padding:5px 8px;text-align:right;font-weight:600">PRESS<span style="font-weight:400;opacity:0.7"> mb</span></th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div style="padding:6px 11px;border-top:1px solid var(--border-subtle,#243040);font-size:0.64em;color:var(--text-muted,#7a8699);display:flex;justify-content:space-between;align-items:center">
      <span>▲ later · now · earlier ▼</span>
      <span>NHC/JTWC</span>
    </div>`;
  document.body.appendChild(panel);
  // scroll so the current row sits near the middle (future above, past below)
  try {
    const cur = panel.querySelector('tr[style*="34,211,238"]');
    const scroller = panel.querySelector('div[style*="overflow-y:auto"]');
    if (cur && scroller) scroller.scrollTop = Math.max(0, cur.offsetTop - scroller.clientHeight / 2);
  } catch (e) {}
}
function toggleNHCTracks(on) {
  S._showNHCTracks = on;
  try { localStorage.setItem('st_nhc_tracks', on ? '1' : '0'); } catch(e) {}
  if (S.map) plotNHCTracks(S.map);
  const btn = document.getElementById('btn-nhc-tracks');
  if (btn) btn.style.opacity = on ? '1' : '0.4';
  toast(on ? 'Hurricane tracks shown on map' : 'Hurricane tracks hidden');
}
// v6.20: Catmull-Rom spline — hurricanes/storms curve, so draw their tracks as a
// smooth curve THROUGH the real fixes rather than straight segments between them.
// Passes exactly through every input point; only the between-point path is curved.
// Input/output are [lat,lon] arrays. segsPerSpan = interpolation density.
function _smoothTrack(latlngs, segsPerSpan) {
  const pts = (latlngs || []).filter(p => p && p[0] != null && p[1] != null);
  if (pts.length < 3) return pts; // nothing to curve
  const seg = segsPerSpan || 14;
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || pts[i + 1];
    for (let t = 0; t < seg; t++) {
      const s = t / seg, s2 = s * s, s3 = s2 * s;
      const lat = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * s + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3);
      const lon = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * s + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3);
      out.push([lat, lon]);
    }
  }
  out.push(pts[n - 1]); // ensure the final real fix is included
  return out;
}
// v6.21: a past trail can come from a source (GDACS) that places the storm slightly
// differently than the authoritative marker (NHC), so its newest end doesn't touch
// the center. Shift the WHOLE trail so its endpoint nearest the marker lands exactly
// on it — keeps the trail's shape, just re-anchors it. Skips a wildly-different track
// (>3° offset ≈ >200 mi) so a genuinely wrong trail isn't dragged onto the marker.
function _anchorTrail(latlngs, mk) {
  if (!mk || mk[0] == null || mk[1] == null || !latlngs || latlngs.length < 2) return latlngs;
  const a = latlngs[0], b = latlngs[latlngs.length - 1];
  const da = (a[0] - mk[0]) ** 2 + (a[1] - mk[1]) ** 2, db = (b[0] - mk[0]) ** 2 + (b[1] - mk[1]) ** 2;
  const near = da <= db ? a : b;
  const dLat = mk[0] - near[0], dLon = mk[1] - near[1];
  if (Math.abs(dLat) > 3 || Math.abs(dLon) > 3) return latlngs;
  if (Math.abs(dLat) < 1e-6 && Math.abs(dLon) < 1e-6) return latlngs; // already aligned
  return latlngs.map(c => [c[0] + dLat, c[1] + dLon]);
}
// v6.24: past-track history is DISABLED for now (the observed/reconstructed/GDACS
// trail wasn't matching reliably). Forecast track, cone, marker and forecast dots
// still draw. Flip this back to true to re-enable the past trail.
const _SHOW_PAST_TRACK = false;
function plotNHCTracks(map) {
  // v5.87: generation counter — the async ST Model draw checks this so a slow
  // model run can never paint onto a map that has since been re-plotted.
  S._nhcPlotGen = (S._nhcPlotGen || 0) + 1;
  S._nhcTrackLayers.forEach(l => { try { map.removeLayer(l); } catch(e) {} });
  S._nhcTrackLayers = [];
  if (!S._showNHCTracks || !_nhcData.systems || !_nhcData.systems.length) return;
  const filtered = _getFilteredSystems() || [];
  if (!filtered.length) return;
  const filteredIds = new Set(filtered.map(s => (s.id || '').toLowerCase()));
  const filteredNames = new Set(filtered.map(s => (s.name || '').toLowerCase()));
  const _isStormVisible = (stormId, stormName) => filteredIds.has((stormId||'').toLowerCase()) || filteredNames.has((stormName||'').toLowerCase());
  const selectedName = S._nhcSelectedStorm;
  const showAll = !selectedName;
  const _lpTracks = (typeof _nhcOpt === 'function') ? _nhcOpt('tracks') : 'all'; // v5.92 layer opt
  for (const cone of (_lpTracks === 'off' ? [] : (_nhcData.cones || []))) {
    if (!_isStormVisible(cone.stormId, cone.stormName)) continue;
    if (!showAll && cone.stormName.toLowerCase() !== selectedName?.toLowerCase() && cone.stormId !== selectedName) continue;
    if (!cone.coords || cone.coords.length < 3) continue;
    const storm = (_nhcData.systems || []).find(s => s.id === cone.stormId || s.name.toLowerCase() === cone.stormName.toLowerCase());
    const cat = storm ? (storm.category || _saffirSimpson(storm.maxWind)) : { color: '#9333EA' };
    const latlngs = cone.coords.map(c => [c[1], c[0]]);
    // v5.88: outline only — the filled cone stacked with wind swaths + tracks
    // made the map read as one big blob; the dashes alone carry the shape.
    const poly = L.polygon(latlngs, {
      color: cat.color || '#9333EA', fillColor: cat.color || '#9333EA',
      fillOpacity: 0, weight: 1.5, dashArray: '6,4', interactive: false
    });
    poly.addTo(map);
    S._nhcTrackLayers.push(poly);
  }
  // v6.22: NOAA's OWN observed/best-track line (layer 3) is the authoritative past
  // track. Draw it (anchored to the marker, lightly smoothed) and remember which
  // storms have it so we can suppress the reconstructed + GDACS trails for them —
  // that way the past track matches the official NOAA tracker exactly.
  const _obsKeys = new Set();
  for (const ot of (_nhcData.observed || [])) {
    if (ot.stormId) _obsKeys.add('id:' + String(ot.stormId).toLowerCase());
    if (ot.stormName) _obsKeys.add('nm:' + String(ot.stormName).toLowerCase());
  }
  const _hasObs = (id, name) => _obsKeys.has('id:' + String(id || '').toLowerCase()) || _obsKeys.has('nm:' + String(name || '').toLowerCase());
  for (const ot of ((!_SHOW_PAST_TRACK || _lpTracks === 'off') ? [] : (_nhcData.observed || []))) {
    if (!_isStormVisible(ot.stormId, ot.stormName)) continue;
    if (!showAll && ot.stormName.toLowerCase() !== selectedName?.toLowerCase() && ot.stormId !== selectedName) continue;
    if (!ot.coords || ot.coords.length < 2) continue;
    const storm = (_nhcData.systems || []).find(s => s.id === ot.stormId || s.name.toLowerCase() === ot.stormName.toLowerCase());
    const cat = storm ? (storm.category || _saffirSimpson(storm.maxWind)) : { color: '#9333EA' };
    const _obsLL = _anchorTrail(ot.coords.map(c => [c[1], c[0]]), storm ? [storm.lat, storm.lon] : null);
    const line = L.polyline(_smoothTrack(_obsLL), { color: cat.color || '#9333EA', weight: 2, opacity: 0.55, interactive: false });
    line.addTo(map);
    S._nhcTrackLayers.push(line);
  }
  for (const track of (_lpTracks === 'off' ? [] : (_nhcData.forecast || []))) {
    if (!_isStormVisible(track.stormId, track.stormName)) continue;
    if (!showAll && track.stormName.toLowerCase() !== selectedName?.toLowerCase() && track.stormId !== selectedName) continue;
    if (!track.coords || track.coords.length < 2) continue;
    const storm = (_nhcData.systems || []).find(s => s.id === track.stormId || s.name.toLowerCase() === track.stormName.toLowerCase());
    const cat = storm ? (storm.category || _saffirSimpson(storm.maxWind)) : { color: '#9333EA' };
    const latlngs = _smoothTrack(track.coords.map(c => [c[1], c[0]]));
    const line = L.polyline(latlngs, {
      color: cat.color || '#9333EA', weight: 3, opacity: 0.9,
      dashArray: '8,6', interactive: false
    });
    line.addTo(map);
    S._nhcTrackLayers.push(line);
  }
  // v5.86: PAST track (history) from GDACS — solid muted trail behind the storm
  for (const hist of ((!_SHOW_PAST_TRACK || _lpTracks === 'off') ? [] : (_nhcData.history || []))) {
    if (!_isStormVisible(hist.stormId, hist.stormName)) continue;
    if (!showAll && hist.stormName.toLowerCase() !== selectedName?.toLowerCase() && hist.stormId !== selectedName) continue;
    if (_hasObs(hist.stormId, hist.stormName)) continue; // NOAA observed track wins
    if (!hist.coords || hist.coords.length < 2) continue;
    const storm = (_nhcData.systems || []).find(s => s.id === hist.stormId || s.name.toLowerCase() === hist.stormName.toLowerCase());
    const cat = storm ? (storm.category || _saffirSimpson(storm.maxWind)) : { color: '#9333EA' };
    const _histLL = _anchorTrail(hist.coords.map(c => [c[1], c[0]]), storm ? [storm.lat, storm.lon] : null);
    const line = L.polyline(_smoothTrack(_histLL), {
      color: cat.color || '#9333EA', weight: 2, opacity: 0.5, interactive: false
    });
    line.addTo(map);
    S._nhcTrackLayers.push(line);
  }
  // v5.91: surface fronts (NOAA/WPC analysis) join the 🌀 overlay group —
  // async + gen-guarded in tropical-model.js; cached 30 min.
  if (typeof drawFronts === 'function' && _nhcOpt('fronts') !== 'off') drawFronts(map);
  // v5.86: timestamped position fixes (GDACS) — dots shown for the SELECTED
  // storm only (past = grey, forecast = cyan); tap a dot for its date/time.
  if (selectedName) {
    const _drawnFp = new Set(); // v6.11: one source per storm — the same storm can
    // appear in fcstPoints from BOTH NHC and GDACS; drawing both crisscrosses the
    // map with "ghost" track lines. Draw only the first (NHC preferred, pushed first).
    for (const fp of ((typeof _nhcOpt === 'function' && _nhcOpt('dots') === 'off') ? [] : (_nhcData.fcstPoints || []))) {
      if (fp.stormName.toLowerCase() !== selectedName.toLowerCase() && fp.stormId !== selectedName) continue;
      const _fpKey = (fp.stormName || fp.stormId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (_drawnFp.has(_fpKey)) continue;
      _drawnFp.add(_fpKey);
      const nowT = Date.now();
      const _pts = fp.pts || [];
      // v6.05: forecast movement (direction + speed) at each dot. NHC's point layer
      // has no per-tau motion vector, so derive it from the leg to the NEXT dot
      // (great-circle bearing + distance ÷ time). Last dot reuses the leg into it.
      const _R = 3958.8; // Earth radius, miles
      const _mvBetween = (a, b) => {
        if (!a || !b || a.lat == null || b.lat == null || a.t == null || b.t == null) return null;
        const φ1 = a.lat * Math.PI / 180, φ2 = b.lat * Math.PI / 180;
        const dφ = φ2 - φ1, dλ = (b.lon - a.lon) * Math.PI / 180;
        const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
        const distMi = 2 * _R * Math.asin(Math.min(1, Math.sqrt(h)));
        const y = Math.sin(dλ) * Math.cos(φ2);
        const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
        const brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        const hrs = (b.t - a.t) / 3600000;
        const mph = (hrs > 0 && distMi >= 0) ? Math.round(distMi / hrs) : null;
        return { dir: (typeof _degToCompass === 'function' ? _degToCompass(brg) : Math.round(brg) + '°'), mph };
      };
      // v6.08: CONNECT the past fixes into a continuous trail (they read as
      // scattered dots otherwise). Solid muted line in the storm's category color,
      // built from the SAME points the dots use so the two always agree. The
      // forecast half already has its own dashed track line (layer 2) + cone.
      const _fpStorm = (_nhcData.systems || []).find(s => (s.name || '').toLowerCase() === fp.stormName.toLowerCase() || s.id === fp.stormId);
      const _fpCat = _fpStorm ? (_fpStorm.category || _saffirSimpson(_fpStorm.maxWind)) : { color: '#94a3b8' };
      // v6.19: the past trail is now pre-ordered SPATIALLY in the grouping (nearest-
      // neighbour chain from the current center), so the past fixes sit contiguously
      // at the START of _pts, up to and including the current center (the first
      // forecast/tau point). Draw that ordered slice as ONE clean polyline — no more
      // time-based segment-breaking, which the unreliable observed timestamps defeated
      // and which produced the zig-zag trail.
      let _curIdx = _pts.findIndex(p => !p.past && p.tau != null);
      if (_curIdx < 0) _curIdx = _pts.length - 1;
      const _pastLL = _pts.slice(0, _curIdx + 1).filter(p => p.lat != null && p.lon != null).map(p => [p.lat, p.lon]);
      // Skip the reconstructed past line when NOAA's observed track (layer 3) exists
      // for this storm — that authoritative line is drawn above and matches NOAA.
      if (_SHOW_PAST_TRACK && _pastLL.length >= 2 && !_hasObs(fp.stormId, fp.stormName)) {
        const _pastAnchored = _fpStorm ? _anchorTrail(_pastLL, [_fpStorm.lat, _fpStorm.lon]) : _pastLL;
        const _pl = L.polyline(_smoothTrack(_pastAnchored), { color: _fpCat.color || '#94a3b8', weight: 2, opacity: 0.5, interactive: false });
        _pl.addTo(map);
        S._nhcTrackLayers.push(_pl);
      }
      for (let _i = 0; _i < _pts.length; _i++) {
        const pt = _pts[_i];
        if (pt.lat == null || pt.lon == null) continue;
        // reliable past/future without trusting observed timestamps: past fixes carry
        // the `past` flag; forecast fixes carry a tau (>0 = future, 0 = current).
        const future = pt.past ? false : (pt.tau != null ? pt.tau > 0 : (pt.t != null && pt.t > nowT));
        if (!_SHOW_PAST_TRACK && !future) continue; // v6.24: history off — draw forecast dots only
        const _mv = _mvBetween(pt, _pts[_i + 1]) || _mvBetween(_pts[_i - 1], pt);
        const dot = L.circleMarker([pt.lat, pt.lon], {
          radius: 3.5, color: future ? '#22d3ee' : '#94a3b8',
          fillColor: future ? '#22d3ee' : '#94a3b8', fillOpacity: 0.85, weight: 1, interactive: false
        });
        dot.addTo(map);
        S._nhcTrackLayers.push(dot);
        // v5.92: the visible dot is tiny — a big invisible circle carries the tap
        // v6.03: show the FORECAST intensity at this point (max wind / gusts /
        // pressure / category) when NHC provides it, not just the timestamp.
        if (pt.label || pt.maxWind != null) {
          const _cat = (pt.maxWind != null && typeof _saffirSimpson === 'function') ? _saffirSimpson(pt.maxWind) : null;
          const _lines = [];
          if (pt.type || (_cat && _cat.label)) _lines.push(`<div style="font-weight:700;color:${_cat ? _cat.color : '#22d3ee'}">${escHtml(pt.type || (_cat ? _cat.label : ''))}</div>`);
          if (pt.maxWind != null) _lines.push(`💨 ${pt.maxWind} mph${pt.gusts ? ' (G' + pt.gusts + ')' : ''}`);
          if (pt.minPressure) _lines.push(`🔵 ${pt.minPressure} mb`);
          if (_mv && _mv.mph != null) _lines.push(`➡️ ${escHtml(_mv.dir)} at ${_mv.mph} mph`);
          const _intHtml = _lines.length ? '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.14);margin:4px 0">' + _lines.join('<br>') : '';
          // v6.04: show the valid time in the USER's local zone (weekday + date +
          // clock, honoring their 12/24h setting), not NHC's basin-zone label.
          let _timeHtml = '';
          if (pt.t != null) {
            const _d = new Date(pt.t);
            if (!isNaN(_d)) {
              const _day = _d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
              const _clk = (typeof fmtClock === 'function') ? fmtClock(_d) : _d.toLocaleTimeString();
              _timeHtml = '<br>' + escHtml(_day + ' · ' + _clk);
            }
          }
          if (!_timeHtml && pt.label) _timeHtml = '<br>' + escHtml(pt.label);
          const _tblKey = _escStormName(fp.stormId || fp.stormName);
          const _tblName = _escStormName(fp.stormName || '');
          const hit = L.circleMarker([pt.lat, pt.lon], { radius: 12, stroke: false, fillColor: '#000', fillOpacity: 0.02 });
          hit.bindPopup(`<div style="font-family:system-ui;font-size:0.8em;text-align:center;min-width:120px"><b>${future ? 'Forecast' : 'Past'} position</b>${_timeHtml}${_intHtml}<div style="margin-top:5px"><a href="#" onclick="event.preventDefault();showStormTrackTable('${_tblKey}','${_tblName}')" style="color:var(--accent-cyan)">📋 Full track table</a></div></div>`);
          hit.addTo(map);
          S._nhcTrackLayers.push(hit);
        }
      }
    }
    // v5.87: ST Model — StormTracker's own BAM-style steering track for the
    // selected storm (tropical-model.js). Async; guarded by S._nhcPlotGen.
    const _selStorm = (_nhcData.systems || []).find(s => s.id === selectedName || (s.name || '').toLowerCase() === String(selectedName).toLowerCase());
    if (_selStorm && typeof drawSTModelTrack === 'function' && _nhcOpt('st') !== 'off') drawSTModelTrack(_selStorm, map);
  }
  for (const s of filtered) {
    if (s.lat == null || s.lon == null) continue;
    const cat = s.category || _saffirSimpson(s.maxWind);
    const isSelected = !!selectedName && (s.id === selectedName || s.name.toLowerCase() === selectedName.toLowerCase());
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: isSelected ? 14 : (cat.num >= 3 ? 12 : cat.num >= 1 ? 10 : 8),
      color: cat.color, fillColor: cat.color,
      fillOpacity: isSelected ? 0.7 : 0.5,
      weight: isSelected ? 4 : 3
    });
    const status = _tropicalStatusLabel(s);
    marker.bindPopup(`<div style="text-align:center;font-family:system-ui;min-width:180px">
      <div style="font-size:1.2em;font-weight:700;color:${cat.color}">🌀 ${s.type} ${s.name}</div>
      <div style="font-size:0.85em;font-weight:600;color:${cat.color}">${cat.label}</div>
      ${_futureStormName(s) ? `<div style="font-size:0.72em;color:var(--accent-cyan);margin-top:2px">Future name: <b>${_futureStormName(s)}</b></div>` : ''}
      ${status ? `<div style="font-size:0.7em;font-weight:700;color:${status.color};margin:2px 0">${status.text}</div>` : ''}
      ${s.maxWind ? `<div style="font-size:0.8em;margin-top:4px">💨 Max Wind: <b>${s.maxWind} mph</b>${s.gusts ? ' (G' + s.gusts + ')' : ''}</div>` : ''}
      ${s.minPressure ? `<div class="text-sm">🔵 Pressure: <b>${s.minPressure} mb</b></div>` : ''}
      ${s.moveDir ? `<div class="text-sm">➡️ Moving: <b>${s.moveDir} ${s.moveSpeed || ''} mph</b></div>` : ''}
      ${_stormAsOfHtml(s)}
      ${s._gdacs ? `<div title="${_GDACS_TITLE}" style="font-size:0.72em;color:${_GDACS_LEVEL_COLORS[s._gdacs.alertlevel] || '#22c55e'};font-weight:700;margin-top:2px">🌍 Humanitarian impact: ${_GDACS_IMPACT_WORDS[s._gdacs.alertlevel] || s._gdacs.alertlevel} (GDACS ${s._gdacs.alertlevel})</div><div style="font-size:0.58em;color:#94a3b8;margin-top:1px">population-scale estimate — not your personal risk</div>` : ''}
      ${s.dist != null ? `<div style="font-size:0.75em;color:#aaa;margin-top:4px">${Math.round(s.dist)} mi from you</div>` : ''}
      <div style="margin-top:6px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <a href="#" onclick="event.preventDefault();_selectNHCStorm('${_escStormName(s.id||s.name)}','${_escStormName(s.name||'')}')" style="font-size:0.75em;color:var(--accent-cyan)">Show track →</a>
        <a href="#" onclick="event.preventDefault();showStormTrackTable('${_escStormName(s.id||s.name)}','${_escStormName(s.name||'')}')" style="font-size:0.75em;color:var(--accent-cyan)">📋 Track table</a>
      </div>
    </div>`);
    marker.addTo(map);
    S._nhcTrackLayers.push(marker);
    const labelIcon = L.divIcon({
      className: '',
      html: `<div style="font-size:10px;font-weight:700;color:${cat.color};text-shadow:0 0 4px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.7);white-space:nowrap;pointer-events:none">${s.name}${isSelected ? ' ★' : ''}</div>`,
      iconSize: [80, 14], iconAnchor: [-8, 7]
    });
    const label = L.marker([s.lat, s.lon], { icon: labelIcon, interactive: false });
    label.addTo(map);
    S._nhcTrackLayers.push(label);
    if (cat.num >= 0) {
      const pulseR = cat.num >= 3 ? 30 : cat.num >= 1 ? 22 : 16;
      const pulse = L.circleMarker([s.lat, s.lon], {
        radius: pulseR, color: cat.color, fillColor: cat.color,
        fillOpacity: 0.1, weight: 1, dashArray: '4,4', interactive: false,
        className: 'nhc-pulse-ring'
      });
      pulse.addTo(map);
      S._nhcTrackLayers.push(pulse);
    }
    if (isSelected) try { // v5.90: isolated — a radii hiccup must never blank other layers
      const radiiColors = { 34: '#4fc3f7', 50: '#ffc107', 64: '#ff5722' };
      const radiiLabels = { 34: '34 kt (TS)', 50: '50 kt (Strong TS)', 64: '64 kt (Hurricane)' };
      const _wOpt = (typeof _nhcOpt === 'function') ? _nhcOpt('wind') : 'all'; // v5.92 layer opt
      const stormRadii = _wOpt === 'off' ? [] : (_nhcData.windRadii || []).filter(wr => (wr.stormId === s.id || wr.stormName.toLowerCase() === s.name.toLowerCase()) && (_wOpt !== 'h64' || wr.ktLevel == 64));
      // v5.90: radii features routinely vanish upstream right after an advisory
      // swap (ArcGIS layers republish) — note it so a blank isn't a mystery.
      if (!stormRadii.length && _wOpt !== 'off') console.log('[NHC] no wind-radii features for', s.name, 'this cycle — upstream advisory gap');
      if (stormRadii.length) {
        // v5.88: declutter — the ArcGIS feed carries one radii ring per forecast
        // hour per wind band, and labeling EVERY ring stamped "34 kt (TS)" six
        // times across the map. Rings are now thinner with a whisper of fill
        // (color alone identifies the band: blue 34 / amber 50 / red 64), and
        // each band gets ONE label, placed on its northernmost ring.
        const _bandBest = {};
        for (const wr of stormRadii) {
          if (!wr.coords || wr.coords.length < 3) continue;
          const latlngs = wr.coords.map(c => [c[1], c[0]]);
          const color = radiiColors[wr.ktLevel] || '#4fc3f7';
          const poly = L.polygon(latlngs, {
            color, fillColor: color, fillOpacity: 0.03, weight: 1, dashArray: '4,3', interactive: false
          });
          poly.addTo(map);
          S._nhcTrackLayers.push(poly);
          const bounds = poly.getBounds();
          if (bounds.getNorth) {
            const n = bounds.getNorth();
            const prev = _bandBest[wr.ktLevel];
            if (!prev || n > prev.north) _bandBest[wr.ktLevel] = { north: n, lng: bounds.getCenter().lng };
          }
        }
        for (const kt of Object.keys(_bandBest)) {
          const b = _bandBest[kt];
          const color = radiiColors[kt] || '#4fc3f7';
          const rLabel = L.divIcon({
            className: '',
            html: `<div style="font-size:8px;color:${color};font-weight:600;text-shadow:0 0 3px #000;pointer-events:none">${radiiLabels[kt] || kt + ' kt'}</div>`,
            iconSize: [80, 10], iconAnchor: [40, 12]
          });
          const rm = L.marker(L.latLng(b.north, b.lng), { icon: rLabel, interactive: false });
          rm.addTo(map);
          S._nhcTrackLayers.push(rm);
        }
      }
    } catch(e) { console.warn('[NHC] radii draw failed:', e && e.message); }
  }
}
function _renderStormSurgeSection() {
  const surgeAlerts = (S.alerts || []).filter(a => {
    const ev = (a.properties?.event || '').toLowerCase();
    return ev.includes('storm surge') || ev.includes('coastal flood') || (ev.includes('hurricane') && ev.includes('warning'));
  });
  if (!surgeAlerts.length) return '';
  let html = `<div class="card mt-12"><div class="card-title"><span class="icon">🌊</span> Storm Surge & Coastal Flooding (${surgeAlerts.length})</div>`;
  surgeAlerts.forEach(a => {
    const p = a.properties || {};
    const ev = p.event || 'Storm Surge Alert';
    const desc = (p.description || '');
    const surgeMatch = desc.match(/(\d+[\.\d]*)\s*(?:to\s*(\d+[\.\d]*))?\s*(?:feet|ft)\s*(?:above|of\s+storm\s+surge)/i);
    const surgeStr = surgeMatch ? (surgeMatch[2] ? surgeMatch[1] + '-' + surgeMatch[2] + ' ft' : surgeMatch[1] + ' ft') : null;
    const inZone = isUserInAlertZone(a);
    const isSurgeWarn = ev.toLowerCase().includes('storm surge warning');
    html += `<div style="padding:8px 10px;border-left:4px solid ${isSurgeWarn ? '#3b82f6' : '#06b6d4'};background:${isSurgeWarn ? 'rgba(59,130,246,0.06)' : 'rgba(6,182,212,0.06)'};border-radius:0 8px 8px 0;margin-bottom:6px">
      <div class="flex-label-row">
        <span style="font-size:1.1em">🌊</span>
        <span style="font-weight:700;font-size:0.85em;color:${isSurgeWarn ? '#3b82f6' : '#06b6d4'}">${ev}</span>
        ${inZone ? '<span style="font-size:0.6em;background:rgba(59,130,246,0.2);color:#60a5fa;padding:1px 6px;border-radius:8px;font-weight:700;animation:tornado-pulse 2s ease-in-out infinite">YOUR AREA</span>' : ''}
      </div>
      ${surgeStr ? `<div style="font-size:0.85em;font-weight:700;color:#3b82f6;margin-bottom:4px">⬆️ Expected surge: ${surgeStr} above normal tide levels</div>` : ''}
      <div style="font-size:0.7em;color:var(--text-secondary);max-height:80px;overflow:hidden;text-overflow:ellipsis">${desc.substring(0, 300)}${desc.length > 300 ? '...' : ''}</div>
      ${p.expires ? `<div style="font-size:0.65em;color:var(--text-muted);margin-top:4px">⏱️ Expires: ${new Date(p.expires).toLocaleString()}</div>` : ''}
    </div>`;
  });
  html += `<div class="text-hint-right">Data: National Weather Service</div></div>`;
  return html;
}
function _nhcProximityCheck() {
  const filtSystems = _getFilteredSystems();
  if (!filtSystems || !filtSystems.length || !S.lat) { _renderNHCBanner(null); return; }
  let bannerStorm = null;
  for (const s of filtSystems) {
    const cat = s.category || _saffirSimpson(s.maxWind);
    const inCone = s._inCone;
    const inRadius = s.dist != null && s.dist <= S._nhcProxRadius;
    if (!inCone && !inRadius) continue;
    // Feature the MOST relevant system: in-cone outranks merely-in-radius, and
    // within the same tier the CLOSEST wins — so a nearby storm you're actually
    // in the cone of is never overshadowed by a far-off system (the old rule kept
    // whichever in-cone storm came LAST in the list, which could be a distant one).
    if (!bannerStorm) {
      bannerStorm = { storm: s, inCone, cat };
    } else {
      const cur = bannerStorm;
      const better = (inCone && !cur.inCone) ||
        (inCone === cur.inCone && s.dist != null && cur.storm.dist != null && s.dist < cur.storm.dist);
      if (better) bannerStorm = { storm: s, inCone, cat };
    }
    const key = 'nhc_alert_' + s.name + '_' + Math.floor(Date.now() / 3600000);
    if (sessionStorage.getItem(key)) continue;
    sessionStorage.setItem(key, '1');
    const dir = (s.lat != null && s.lon != null && S.lat != null && S.lon != null) ? degToDir(bearingDeg(S.lat, S.lon, s.lat, s.lon)) : '';
    const reason = inCone ? 'You are inside the forecast cone!' : `${Math.round(s.dist)} mi${dir ? ' to the ' + dir : ''} from your location`;
    // v5.97: short push text + full detail for the 📢 log; no auto-popping toast.
    const shortMsg = `🌀 ${s.name} (${cat.label}) — ${inCone ? 'in the forecast cone' : Math.round(s.dist) + ' mi ' + dir}`;
    const fullMsg = `🌀 ${s.type} ${s.name} (${cat.label}) — ${reason}.`;
    _sendBrowserNotification('Tropical Cyclone Alert', shortMsg, fullMsg);
  }
  _renderNHCBanner(bannerStorm);
}
function _renderNHCBanner(data) {
  let el = document.getElementById('nhc-prox-banner');
  if (!data) { if (el) el.remove(); return; }
  const { storm, inCone, cat } = data;
  const status = _tropicalStatusLabel(storm);
  const bgColor = inCone ? 'rgba(255,152,0,0.15)' : 'rgba(79,195,247,0.1)';
  const borderColor = status ? status.color : cat.color;
  const dir = (storm.lat != null && storm.lon != null && S.lat != null && S.lon != null) ? degToDir(bearingDeg(S.lat, S.lon, storm.lat, storm.lon)) : '';
  const reason = inCone ? 'You are inside the forecast cone' : `${Math.round(storm.dist)} mi${dir ? ' to the ' + dir : ''} away — Tracking`;
  const html = `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:${bgColor};border:1px solid ${borderColor}44;border-radius:8px;margin:8px 12px 0;cursor:pointer" onclick="_selectNHCStorm('${_escStormName(storm.id||storm.name)}')">
    <span style="font-size:1.4em">🌀</span>
    <div class="flex-1">
      <div style="font-weight:700;font-size:0.85em;color:${borderColor}">${storm.type} ${storm.name} — ${cat.label}</div>
      <div class="text-secondary-sm">${reason}${status ? ' · ' + status.text : ''}${_futureStormName(storm) ? ' · Future: ' + _futureStormName(storm) : ''}</div>
    </div>
    <span style="font-size:0.65em;color:var(--accent-cyan)">View →</span>
  </div>`;
  if (!el) {
    el = document.createElement('div');
    el.id = 'nhc-prox-banner';
    const header = document.querySelector('.header');
    if (header && header.nextSibling) header.parentNode.insertBefore(el, header.nextSibling);
    else document.body.prepend(el);
  }
  el.innerHTML = html;
}
// ==========================================
// STORMS DISPLAY
// ==========================================
function _loadStormFilter(){
  try{const f=JSON.parse(localStorage.getItem('st_stormFilter'));if(f){if(f.threatsOnly==null)f.threatsOnly=false;return f}}catch(e){}
  return{minDbz:0,maxDist:0,approachOnly:false,threatsOnly:false,sort1:'threat',sort2:'eta'};
}
function _saveStormFilter(f){localStorage.setItem('st_stormFilter',JSON.stringify(f));S._stormFilter=f}
function _stormFilterActive(f){return!!(f&&((f.minDbz|0)>0||(f.maxDist|0)>0||f.approachOnly||f.threatsOnly))}
function clearStormFilters(){
  const cur=S._stormFilter||_loadStormFilter();
  const cleared={...cur,minDbz:0,maxDist:0,approachOnly:false,threatsOnly:false};
  _saveStormFilter(cleared);
  if(typeof updateThreatTicker==='function')updateThreatTicker();
  renderStorms();
}
// v5.68: tap the "🎯 In N storm tracks" header line to FOCUS the list on just
// the cells whose forecast cone actually covers you (Direct + Nearby + Passing),
// bypassing "Approaching only" so the wider ones you're inside are visible too.
// Tap again to reset. Session-only (not persisted).
function toggleConeFocus(){
  S._coneFocus=!S._coneFocus;
  if(S._coneFocus&&typeof toast==='function')toast('🎯 Showing the storm cells whose cone covers you — tap again to reset');
  renderStorms();
}
if(typeof window!=='undefined')window.toggleConeFocus=toggleConeFocus;
// v5.71: Storm Points accordion — tapping a tier header opens that one and
// closes the other two. Remembered in S._stormGroupOpen across re-renders.
function _toggleStormGroup(ev,key){
  if(ev&&ev.preventDefault)ev.preventDefault();
  // v6.29: an empty tier (0 items) can't open — keep it collapsed on tap.
  const _el=document.querySelector('details.storm-tier-group[data-grp="'+key+'"]');
  if(_el&&_el.classList.contains('is-empty'))return false;
  // Accordion toggle: tapping the open group closes it (all collapse); tapping a
  // closed group opens it and closes the other two.
  const wasOpen=S._stormGroupOpen===key;
  S._stormGroupOpen=wasOpen?null:key;
  document.querySelectorAll('details.storm-tier-group[data-grp]').forEach(d=>{
    d.open=(!wasOpen&&d.getAttribute('data-grp')===key);
  });
  return false;
}
if(typeof window!=='undefined')window._toggleStormGroup=_toggleStormGroup;
function stormThreatScore10(s){
  // v5.64: threat is purely how DIRECTLY the cell's track crosses you — the
  // cross-track (X-TRK) distance, −4 points per mile: 10 at a bullseye, 9.2 at
  // 0.2 mi, 6 at 1.0 mi, 4 at 1.5 mi, 0 by 2.5 mi. Intensity is conveyed
  // separately (the rain word, Peak dBZ, and the SEVERE/EXTREME cell name).
  let b=s._brief;
  if(!b){try{b=calcStormETAForBriefing(s);s._brief=b}catch(e){}}
  const closing=!!(b&&b.closingMph>0&&b.classification!=='moving_away');
  const pm=(b&&b.perpMissMi!=null)?b.perpMissMi:null;
  let score;
  if(closing&&pm!=null)score=10-4*pm;
  else if(pm==null)score=Math.max(0,Math.min(8,(s.dbz-20)/5)); // track unknown → intensity proxy
  else score=0; // computed, but moving away / not closing on you
  if(s._rotation)score=Math.max(score,8); // rotation (hook echo) is always a flag
  return Math.max(0,Math.min(10,Math.round(score*10)/10));
}
function _stormSortFn(a,b,key){
  if(key==='dbz'){
    // v5.64: "Strongest" ranks by the ESTIMATED dBZ at you (track-aware),
    // falling back to peak when there's no closing track — so a strong cell
    // passing wide no longer outranks a moderate one heading over you.
    const estOf=x=>{const bx=x._brief;const e=(bx&&bx.estDbzAtUser!=null)?bx.estDbzAtUser:null;return e!=null?e:(x.dbz||0)};
    return estOf(b)-estOf(a);
  }
  if(key==='dist')return a.distance-b.distance;
  if(key==='eta'){
    const ea=a._eta&&a._eta.approaching&&a._eta.eta!=null?a._eta.eta:99999;
    const eb=b._eta&&b._eta.approaching&&b._eta.eta!=null?b._eta.eta:99999;
    return ea-eb;
  }
  if(key==='threat'){
    const sa=stormThreatScore10(a),sb=stormThreatScore10(b);
    if(Math.abs(sa-sb)<0.15)return 0;
    return sb-sa;
  }
  if(key==='impact'){
    try{if(!a._brief)a._brief=calcStormETAForBriefing(a)}catch(e){}
    try{if(!b._brief)b._brief=calcStormETAForBriefing(b)}catch(e){}
    const ia=(a._brief&&a._brief.impactScore!=null)?a._brief.impactScore:0;
    const ib=(b._brief&&b._brief.impactScore!=null)?b._brief.impactScore:0;
    return ib-ia;
  }
  return 0;
}
function _applyStormFilter(storms,f){
  let out=storms;
  // v4.65: storm-card filtering reverted to its original, working behavior —
  // a cell is only dropped if its estimated intensity at the user would
  // arrive as essentially nothing (<15 dBZ). The Storms tab is the source of
  // truth for "what counts as a cell"; the Rain Clock is made to MATCH this
  // (see STORM_MIN_DBZ in core.js, consumed by the radar scan floor and the
  // Rain Clock) rather than the cards being forced up to the Rain Clock's
  // old threshold.
  out=out.filter(s=>{
    try{if(!s._brief)s._brief=calcStormETAForBriefing(s);}catch(e){}
    // v5.63: keep/drop on the cell's PEAK dBZ (is it a real cell), NOT its
    // closeness-weighted est-at-you. The steeper v5.63 closeness curve makes a
    // cell that merely passes to your side estimate near-0 dBZ at you; gating on
    // est would then make those nearby cells vanish instead of showing as low.
    // All scanned cells are already ≥ the radar floor, so this stays the light
    // safety net it always was.
    return!(s.dbz!=null&&s.dbz<15);
  });
  if(f.minDbz>0)out=out.filter(s=>{
    // v5.64: "Min dBZ" is the floor on ESTIMATED dBZ at you (what actually
    // reaches you), not the cell's peak — so it hides cells whose track passes
    // too wide to matter. Falls back to peak for cells with no closing track.
    try{if(!s._brief)s._brief=calcStormETAForBriefing(s);}catch(e){}
    const est=(s._brief&&s._brief.estDbzAtUser!=null)?s._brief.estDbzAtUser:s.dbz;
    return est>=f.minDbz;
  });
  if(f.maxDist>0)out=out.filter(s=>s.distance<=f.maxDist);
  const _fHasMv=S.stormMovement&&S.stormMovement.speed&&S.stormMovement.speed>=2;
  const _fHasAl=S._upperWindDir!=null;
  const noMv=!_fHasMv&&!_fHasAl;
  if(S._coneFocus&&S.lat!=null&&S.lon!=null){
    // v5.70: cone-focus (tap the 🎯 header line) shows the EXACT cells the header
    // counted — via the shared S._coneStats.keys computed just before this filter
    // runs — so the focused list, the count, and the tier split always agree.
    const _ck=(S._coneStats&&Array.isArray(S._coneStats.keys)&&S._coneStats.keys.length)?new Set(S._coneStats.keys):null;
    if(_ck){
      out=out.filter(s=>_ck.has(stormKey(s)));
    }else{
      const _cFloor=(typeof getConeMinDbz==='function')?getConeMinDbz():30;
      out=out.filter(s=>{
        if((s.dbz||0)<_cFloor)return false;
        const _smv=(typeof getHybridMovement==='function'?getHybridMovement(s):null)||S.stormMovement;
        if(!_smv||!(_smv.speed>=2))return false;
        try{return isUserInStormCone(s,_smv,S.lat,S.lon)}catch(e){return false}
      });
    }
  }else if(f.approachOnly&&!noMv){
    // v5.77: "Approaching only" = storms whose forecast cone covers you. Reuse the
    // in-cone keys the cone loop already computed THIS render (O(1) per cell)
    // instead of rebuilding a cone polygon for all ~1500 cells every render —
    // that per-cell cone test made filter changes feel like they didn't refresh.
    // v5.84: gate on whether cone stats were COMPUTED for this scan (scanId match),
    // NOT on keys.length. An empty key set for the CURRENT scan means "genuinely 0
    // storms approaching," so filter to empty. Only when the stats predate this scan
    // (scanId mismatch, e.g. mid-scan) do we leave the list unfiltered rather than
    // run the expensive per-cell cone test. Previously an empty-but-current cone
    // left the list UNFILTERED, so "Approaching only" showed EVERY storm (including
    // receding ones) while the header correctly read "In 0 storm tracks".
    if(S._coneStats&&Array.isArray(S._coneStats.keys)&&S._coneStats.scanId===S._stormScanId){
      const _ck=new Set(S._coneStats.keys);
      out=out.filter(s=>_ck.has(stormKey(s)));
    }
  }
  S._filterApproachBypassed=!S._coneFocus&&f.approachOnly&&noMv;
  if(f.threatsOnly){
    out=out.filter(s=>{
      try{
        if(!s._brief)s._brief=calcStormETAForBriefing(s);
        const c=s._brief&&s._brief.classification;
        return c==='direct'||c==='near_direct'||c==='near_miss';
      }catch(e){return false}
    });
  }
  S._filterThreatsBypassed=false;
  out.sort((a,b)=>{const r=_stormSortFn(a,b,f.sort1);return r!==0?r:_stormSortFn(a,b,f.sort2)});
  return out;
}
// Shared post-filter snapshot consumed by briefingEngine + ai.js so all three
// surfaces (Storms tab, System Briefing, AI Briefing) render the SAME cell set.
function getFilteredStorms(){
  const f=S._stormFilter||_loadStormFilter();
  if(!S.storms||!S.storms.length)return{filter:f,storms:[],totalCount:0,hiddenCount:0};
  const out=_applyStormFilter(S.storms,f);
  return{filter:f,storms:out,totalCount:S.storms.length,hiddenCount:S.storms.length-out.length};
}
if(typeof window!=='undefined')window.getFilteredStorms=getFilteredStorms;
// Build the tier-labeled forecast bullets shown at the top of the Storms tab.
// Returns plain-text lines when plain=true (for the AI prompt), or HTML lines
// (matching the prior renderStorms output) when plain=false. The empty-state
// "no storms approaching" message is also returned as a one-element array so
// callers can decide how to render it. Returns [] when there is no usable
// storm-movement vector or no storms at all.
function buildStormForecastLines(plain){
  const storms=(S.storms||[]);
  const mv=(typeof getSteeringMv==='function')?getSteeringMv():(S.stormMovement&&S.stormMovement.speed>=2?S.stormMovement:null);
  if(!storms.length||!mv||mv.speed<2)return{lines:[],empty:false};
  // v4.67: when the Storms tab has rendered, build the "inbound — N cells"
  // banner from the exact same filtered inbound set that produces the cards
  // (S._inboundShown), so the banner count agrees with the cards and the header
  // pill. Fall back to the raw approaching scan only before the tab first renders.
  const _shown=Array.isArray(S._inboundShown)?S._inboundShown:null;
  const approaching=(_shown?_shown.slice():storms.filter(s=>{const e=s._eta;return e&&e.approaching&&e.eta!=null})).filter(s=>s&&s._eta&&s._eta.eta!=null);
  if(!approaching.length)return{lines:[],empty:true};
  approaching.sort((a,b)=>a._eta.eta-b._eta.eta);
  const light=approaching.filter(s=>s.dbz<40);
  const moderate=approaching.filter(s=>s.dbz>=41&&s.dbz<52);
  const modSevere=approaching.filter(s=>s.dbz>=52&&s.dbz<60);
  const severe=approaching.filter(s=>s.dbz>=60&&s.dbz<65);
  const extreme=approaching.filter(s=>s.dbz>=65);
  const now=Date.now();
  const fmtEtaShort=(min)=>{const s=Math.round(min*60);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return(h>0?String(h).padStart(2,'0')+'h:':'')+String(m).padStart(2,'0')+'m:'+String(sec).padStart(2,'0')+'s';};
  const fmtTime=(min)=>fmtClockShort(new Date(now+min*60000));
  const tierSpan=(min)=>{
    // v4.72: subtract the canonical radar age so these header ETAs match the
    // storm cards / Rain Clock (radar data is a few minutes old at scan time).
    const _m=Math.max(0,min-radarAgeMin());
    if(plain)return`${fmtEtaShort(_m)} (${fmtTime(_m)})`;
    const tgt=now+_m*60000;
    return`<span class="tier-eta-cd" data-tier-target="${tgt}"><b>${fmtEtaShort(_m)}</b> (${fmtTime(_m)})</span>`;
  };
  const maxTag=(arr)=>{
    const m=Math.max(...arr.map(s=>s.dbz));
    return plain?` (Max: ${m} dBZ)`:` <span class="c-muted-85">(Max: ${m} dBZ)</span>`;
  };
  const lbl=(emoji,plainTxt,htmlColor,htmlTxt)=>plain?`${emoji} ${plainTxt}`:`<span style="color:${htmlColor}">${emoji} ${htmlTxt}</span>`;
  // Keep a STABLE two-line layout: the description (with cell count + max dBZ)
  // on top, then the ETA always on its own line below. Because the live 1s
  // countdown changes the digit width of the time, an inline ETA used to reflow
  // and bounce between layouts; pinning it to its own line stops that. The
  // "ETA:" label sits OUTSIDE the .tier-eta-cd span (which the updater rewrites
  // every tick), so the label survives each update.
  const countTag=(arr)=>arr.length>1?` — ${arr.length} cells`:'';
  const etaLine=(min)=>plain?`\n   ETA: ${tierSpan(min)}`:`<br><span style="display:inline-block;padding-left:1.5em">ETA: ${tierSpan(min)}</span>`;
  const lines=[];
  if(light.length){
    const first=light[0];
    lines.push(`${lbl('🔵','Light rain','#00F8FF','Light rain')} inbound${countTag(light)}${maxTag(light)}${etaLine(first._eta.eta)}`);
  }
  if(moderate.length){
    const first=moderate[0];
    lines.push(`${lbl('🟡','Moderate to heavy','#F5FF00','Moderate to heavy')} cells inbound${countTag(moderate)}${maxTag(moderate)}${etaLine(first._eta.eta)}`);
  }
  if(modSevere.length){
    const first=modSevere[0];
    lines.push(`${lbl('🟠','Moderate to severe','#E63A2C','Moderate to severe')} cells inbound${countTag(modSevere)}${maxTag(modSevere)}${etaLine(first._eta.eta)}`);
  }
  if(severe.length){
    const first=severe[0];
    lines.push(`${lbl('🔴','Severe','#FF0200','Severe')} cells inbound (hail possible)${countTag(severe)}${maxTag(severe)}${etaLine(first._eta.eta)}`);
  }
  if(extreme.length){
    const first=extreme[0];
    lines.push(`${lbl('🟣','Extreme','#FF00F5','Extreme')} cells inbound (hail likely)${countTag(extreme)}${maxTag(extreme)}${etaLine(first._eta.eta)}`);
  }
  return{lines,empty:false};
}
if(typeof window!=='undefined')window.buildStormForecastLines=buildStormForecastLines;
function _smartStormSummary(storms){
  const r=buildStormForecastLines(false);
  if(r.empty){
    // v5.44: if the user is inside storm track cones, a flat green "nothing
    // approaching" reads like a bug (header says "you are in 30 cones").
    // Explain the distinction instead: tracks pass NEAR you, none projected
    // to pass within the strict "approaching" bar (~6 mi closest pass).
    const cs=S._coneStats;
    if(cs&&cs.count>0&&cs.scanId===S._stormScanId){
      const missTxt=(cs.minMiss!=null&&isFinite(cs.minMiss))?(S.radarMetric?(cs.minMiss*1.609).toFixed(0)+' km':Math.round(cs.minMiss)+' mi'):null;
      return`<div style="padding:8px 12px;background:rgba(250,204,21,0.08);border:1px solid rgba(250,204,21,0.25);border-radius:8px;font-size:0.78em;line-height:1.5;color:#facc15;margin-bottom:8px">🎯 ${cs.count} storm track${cs.count!==1?'s':''} pass${cs.count!==1?'':'es'} near your location, but none are currently projected to hit you directly${missTxt?' — closest projected pass ≈ <strong>'+missTxt+'</strong> away':''}. Storm paths can shift — keep an eye on the radar.</div>`;
    }
    return'<div style="padding:8px 12px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:8px;font-size:0.8em;color:#4ade80;margin-bottom:8px">No storms currently approaching your location.</div>';
  }
  if(!r.lines.length)return'';
  return`<div style="padding:8px 12px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:8px;font-size:0.78em;line-height:1.6;margin-bottom:8px">${r.lines.join('<br>')}</div>`;
}
function _renderFilterBar(f){
  const sortOpts=[['threat','Threat Score'],['impact','Highest Impact'],['dbz','Strongest'],['eta','Soonest ETA'],['dist','Closest']];
  const mkOpts=(sel)=>sortOpts.map(([v,l])=>`<option value="${v}"${sel===v?' selected':''}>${l}</option>`).join('');
  return`<div class="card" style="padding:8px 10px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:0.72em">
      <span style="font-weight:700;color:var(--text-secondary)">Sort:</span>
      <select id="sf-sort1" onchange="updateStormFilter()" oninput="updateStormFilter()" style="background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 4px;font-size:1em">${mkOpts(f.sort1)}</select>
      <span class="c-muted">then</span>
      <select id="sf-sort2" onchange="updateStormFilter()" oninput="updateStormFilter()" style="background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 4px;font-size:1em">${mkOpts(f.sort2)}</select>
      <button type="button" onclick="cycleStormView()" title="Card view: Hybrid (text + boxes) · Text only · Boxes only" style="margin-left:auto;background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border-subtle);border-radius:999px;padding:2px 10px;font-size:1em;font-weight:700;cursor:pointer;white-space:nowrap">${_stormView()==='hybrid'?'▤ Hybrid':_stormView()==='text'?'☰ Text':'▦ Cards'}</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:0.72em;margin-top:6px">
      <span style="font-weight:700;color:var(--text-secondary)">Filter:</span>
      <label style="display:flex;align-items:center;gap:3px;color:var(--text-secondary)">Min dBZ
        <input id="sf-mindbz" type="number" inputmode="numeric" min="0" max="75" step="5" value="${f.minDbz||0}" oninput="updateStormFilter()" onchange="updateStormFilter()" onblur="updateStormFilter()" style="width:42px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 4px;font-size:1em;text-align:center">
      </label>
      <label style="display:flex;align-items:center;gap:3px;color:var(--text-secondary)">Max dist
        <input id="sf-maxdist" type="number" inputmode="numeric" min="0" max="200" step="5" value="${f.maxDist||0}" oninput="updateStormFilter()" onchange="updateStormFilter()" onblur="updateStormFilter()" style="width:42px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 4px;font-size:1em;text-align:center">
        <span class="c-muted">${S.radarMetric?'km':'mi'}</span>
      </label>
      <label style="display:flex;align-items:center;gap:3px;cursor:pointer;color:var(--text-secondary)">
        <input id="sf-approach" type="checkbox" ${f.approachOnly?'checked':''} onchange="updateStormFilter()"> Approaching only
      </label>
      <button type="button" id="sf-threats" onclick="updateStormFilter('threats')" title="Show only direct-hit or near-miss storms" style="display:inline-flex;align-items:center;gap:4px;background:${f.threatsOnly?'rgba(239,68,68,0.18)':'var(--bg-card)'};color:${f.threatsOnly?'#ef4444':'var(--text-secondary)'};border:1px solid ${f.threatsOnly?'rgba(239,68,68,0.55)':'var(--border-subtle)'};border-radius:999px;padding:2px 8px;font-size:1em;font-weight:700;cursor:pointer;letter-spacing:0.02em">🎯 Threats only${f.threatsOnly?' ✓':''}</button>
    </div>
  </div>`;
}
let _sfDebounce=null;
function updateStormFilter(action){
  const cur=S._stormFilter||_loadStormFilter();
  const f={
    sort1:document.getElementById('sf-sort1')?.value||'threat',
    sort2:document.getElementById('sf-sort2')?.value||'eta',
    minDbz:parseInt(document.getElementById('sf-mindbz')?.value)||0,
    maxDist:parseInt(document.getElementById('sf-maxdist')?.value)||0,
    approachOnly:document.getElementById('sf-approach')?.checked||false,
    threatsOnly:action==='threats'?!cur.threatsOnly:!!cur.threatsOnly
  };
  _saveStormFilter(f);
  if(typeof updateThreatTicker==='function')updateThreatTicker();
  if(_sfDebounce)clearTimeout(_sfDebounce);
  _sfDebounce=setTimeout(()=>{
    _sfDebounce=null;
    renderStorms();
  },150);
}
S._stormFilter=_loadStormFilter();
function _renderStormsCore(){
  const el=document.getElementById('page-storms');
  S._inboundShown=null;
  if(!S.lat){el.innerHTML=`<div class="empty-state"><div class="empty-icon">📍</div><p>Set your location to scan for storms.</p></div>`;return}
  const storms=S.storms;
  const userZones=checkUserInZone();
  const zoneAlert=userZones?`<div class="alert-banner danger" style="border-left:4px solid ${userZones[0].color}"><span class="alert-icon"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="${userZones[0].color}" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/></svg></span><div class="alert-text"><span class="alert-title">You are inside ${userZones.map(z=>z.label).join(' + ')}</span><br>Your location is within an active precipitation zone.</div></div>`:'';
  if(!storms.length){
    el.innerHTML=`${zoneAlert}
      <div class="alert-banner safe"><span class="alert-icon">✅</span><div class="alert-text"><span class="alert-title">All Clear</span><br>No storm cells detected within ${S.radarMetric?(S.scanRadius*1.60934).toFixed(0)+' km':S.scanRadius+' mi'}.</div></div>
      <div class="card"><div class="card-title"><span class="icon">🛰️</span> Radar Storm Scanner</div>
        <div class="empty-state"><div class="empty-icon">${neonWx(1,isCurrentlyDay(),48)}</div>
          <p>Scans ${S.radarSource==='nexrad'?'NEXRAD':'RainViewer'} radar tiles for precipitation.<br>
          Tap 📍 on the radar map to scan around your location.<br><br>
          <strong>Scan radius: ${S.scanRadius} mi</strong></p></div></div>`;
    return;
  }
  const _approachingSet=S._topStormAnalysis?S._topStormAnalysis.inbound.concat(S._topStormAnalysis.overhead):[];
  const _maxApproachingDbz=_approachingSet.length?Math.max(..._approachingSet.map(s=>s.dbz)):0;
  const _hasOverhead=!!(S._topStormAnalysis&&S._topStormAnalysis.overhead.length);
  const sev=(_hasOverhead||_maxApproachingDbz>=55)?'danger':(_maxApproachingDbz>=40?'warning':'info');
  const severe=sev==='danger';
  const mv=(typeof getSteeringMv==='function')?getSteeringMv():(S.stormMovement&&S.stormMovement.speed>=2?S.stormMovement:null);
  if(mv&&mv.speed>=2){storms.forEach(s=>{s._eta=calcStormETA(s)})}else{storms.forEach(s=>{if(!s._eta)s._eta=calcStormETA(s)})}
  let inConeCount=0;
  let inConeMinMiss=null;
  const _coneTally={}; for(const _ct of XTRK_TIERS)_coneTally[_ct.key]=0; // v6.30: X-TRK tier split of the cones you're inside (all 5 tiers, one table)
  let _coneKeys=[]; // v5.70: distinct storm keys whose cone covers you (drives the tap-focus)
  if(mv&&mv.speed>=2&&S._tracksMode!=='off'&&S.lat!=null&&S.lon!=null){
    const uLat=S.lat,uLng=S.lon;
    const _coneFloor=(typeof getConeMinDbz==='function')?getConeMinDbz():30;
    // v5.70: count DISTINCT storms (by key) from the real storm set S.storms —
    // NOT getVisibleStormList, which produced "In 12 tracks" next to "10 Storms"
    // (population mismatch). The collected keys ARE the tap-focus target, so the
    // header count, the Direct/Nearby/Passing split and the focused list always
    // describe the exact same cells.
    const _seen=new Set();
    for(const s of (S.storms||[])){
      if((s.dbz||0)<_coneFloor)continue;
      const _k=stormKey(s); if(_seen.has(_k))continue; _seen.add(_k);
      const _smv=(typeof getHybridMovement==='function'?getHybridMovement(s):null)||mv;
      let _in=false; try{_in=isUserInStormCone(s,_smv,uLat,uLng)}catch(e){}
      if(!_in)continue;
      inConeCount++; _coneKeys.push(_k);
      try{
        const b=calcStormETAForBriefing(s);
        const pm=(b&&b.perpMissMi!=null&&isFinite(b.perpMissMi))?b.perpMissMi:null;
        if(pm!=null&&(inConeMinMiss==null||pm<inConeMinMiss))inConeMinMiss=pm;
        // v6.30: bucket by the SAME X-TRK tiers as the card badges and the
        // Storm Points tabs (one XTRK_TIERS table) — direct/nearby/near-miss/
        // tracking/distant. No XTK → distant.
        const _t=pm!=null?_xtrkTier(pm):null;
        _coneTally[_t?_t.key:'distant']++;
      }catch(e){_coneTally.distant++;}
    }
  }
  // v5.44: publish cone stats so the "no storms approaching" banner and the
  // hidden-by-filters note can EXPLAIN "in N cones but 0 approaching" instead
  // of contradicting the header. In-cone = inside a storm's broad 15° track
  // envelope (widens with distance — ~13 mi half-width at 50 mi out), while
  // "approaching" = projected closest pass under ~6 mi. Very different bars.
  S._coneStats={count:inConeCount,minMiss:inConeMinMiss,tally:Object.assign({},_coneTally),keys:_coneKeys,scanId:S._stormScanId};
  // Colour + breakdown follow the XTRK_TIERS order so the highest-priority
  // non-empty tier drives the accent and the pills read in tier order.
  let inConeColor='#6b7280';
  const _coneBreak=[];
  for(const _ct of XTRK_TIERS){
    const _n=_coneTally[_ct.key];
    if(_n>0){if(inConeColor==='#6b7280')inConeColor=_ct.color;_coneBreak.push(`${_ct.plain}: ${_n}`);}
  }
  // v5.68: the cone line is tappable when you're inside ≥1 cone — it focuses the
  // list on just those cells (see toggleConeFocus). Cyan "reset" state while active.
  const _coneTappable=(inConeCount>0)||S._coneFocus;
  const _coneInner=S._coneFocus
    ? `🎯 Showing the cells whose cone covers you — tap to reset ✕`
    : `🎯 In ${inConeCount} storm track${inConeCount!==1?'s':''}${_coneBreak.length?' · '+_coneBreak.join(', '):''}${_coneTappable?' ›':''}`;
  const _coneSpanAttrs=_coneTappable
    ? `onclick="event.stopPropagation();toggleConeFocus()" style="cursor:pointer;color:${S._coneFocus?'#22d3ee':inConeColor};text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px"`
    : `style="color:${inConeColor}"`;
  const _coneLineHtml=(mv&&mv.speed>=2)?`<br><span ${_coneSpanAttrs}>${_coneInner}</span>`:'';
  const sf=S._stormFilter||_loadStormFilter();
  const filtered=_applyStormFilter(storms,sf);
  const prevOpen={};
  el.querySelectorAll('.storm-group').forEach(d=>{const k=d.getAttribute('data-grp');if(k)prevOpen[k]=d.open});
  function isApproaching(s){const e=s._eta;return e&&e.approaching&&e.impact>0&&e.eta!=null}
  function isOverhead(s){const e=s._eta;return e&&e.proximity}
  function isNearby(s){return!isApproaching(s)&&!isOverhead(s)}
  function buildCard(s){
      const cat=stormCat(s.dbz);
      const eta=s._eta;
      // v5.99: read the briefing off the single master record (same cached object)
      // so the cards and the alerts can never diverge; fall back to a direct call.
      let _b=null;try{const _mm=(typeof stormMaster==='function')?stormMaster(s):null;_b=_mm?_mm.brief:calcStormETAForBriefing(s);s._brief=_b}catch(e){}
      const isInboundClass=!!(_b&&(typeof isInboundTier==='function'?isInboundTier(_b.classification):(_b.classification==='direct'||_b.classification==='near_direct'||_b.classification==='near_miss'||_b.classification==='miss'||_b.classification==='distant'||_b.classification==='far'||_b.classification==='nearby')));
      const hasValidClosing=!!(_b&&_b.closingMph>0);
      const bImpPct=(_b&&_b.impactScore!=null)?Math.round(_b.impactScore*100):0;
      const imp=impactLabel(bImpPct);
      // v5.62: the "Strength at you" tile was removed — it duplicated the plain
      // "Est. at you: NN dBZ (rain word)" line below and carried a confusing
      // "% of peak". The X-TRK (cross-track miss) tile stays as the key number.
      const missMiVal=(_b&&hasValidClosing)?_b.perpMissMi:null;
      const missStr=(missMiVal!=null)?(S.radarMetric?(missMiVal*1.60934).toFixed(1)+' km':missMiVal.toFixed(1)+' mi'):null;
      const _xtrkBearing=(_b&&_b.sideBearing!=null)?degToDir(_b.sideBearing):'';
      const projMissDisp=(hasValidClosing&&missStr!=null)?`${missStr}${_xtrkBearing?' '+_xtrkBearing:''}`.trim():'—';
      const missTile=`<div class="storm-detail"><div class="storm-detail-label">${tStr('Storm X-TRK')}</div><div class="storm-detail-val" style="font-size:0.85em">${projMissDisp}</div></div>`;
      let mvLine='';
      const _hybS=typeof getHybridMovement==='function'?getHybridMovement(s):null;
      const _sMv=(_hybS&&_hybS.speed>=2)?_hybS:mv;
      if(_sMv&&_sMv.speed>=2){
        const spdStr=S.radarMetric?Math.round(_sMv.speed*1.60934)+' km/h':_sMv.speed+' mph';
        const _srcBadge=_hybS?_movSourceBadge(_hybS):'';
        mvLine=`<div class="storm-detail tappable-unit" onclick="toggleStormUnits()"><div class="storm-detail-label">${tStr('Moving')}</div><div class="storm-detail-val">${degToDir(_sMv.direction)} (${Math.round(_sMv.direction)}°) ${spdStr}${_srcBadge}</div><div class="tile-tap">tap</div></div>`;
        if(isOverhead(s)){
          mvLine+=`<div class="storm-detail" style="grid-column:span 2"><div class="storm-detail-label">${tStr('Status')}</div><div class="storm-detail-val" style="color:#f97316;font-size:0.85em">⚠️ ${tStr('Overhead · Moving away')}</div></div>`;
        }else if(isApproaching(s)){
          const sk=stormKey(s);
          let targetMs;
          if(S._stormETAs[sk]&&S._stormETAs[sk]>Date.now()){
            targetMs=S._stormETAs[sk];
          }else{
            const elapsedMin=S.scanTime?(Date.now()-S.scanTime)/60000:0;
            const remainMin=Math.max(0,eta.eta-elapsedMin-radarAgeMin());
            targetMs=Date.now()+remainMin*60000;
            S._stormETAs[sk]=targetMs;
          }
          eta._targetMs=targetMs;
          const remainMin=(targetMs-Date.now())/60000;
          const arrivalTime=fmtArrivalTime(remainMin);
          const initCountdown=fmtCountdown(Math.round(remainMin*60));
          // v6.30: ETA tile by the tier's `eta` flag (XTRK_TIERS). 'live'
          // (direct ≤1.5 mi) → live ticking countdown (aimed at you). 'fixed'
          // (nearby 1.5–6 mi) → fixed possible arrival clock time, no countdown.
          // 'none' (>6 mi, or miss unknown) → no ETA tile at all. So a ticking
          // clock alone means "coming at you."
          const _etaT=_xtrkTier(missMiVal);
          if(_etaT&&_etaT.eta==='live'){
            mvLine+=`<div class="storm-detail eta-detail"><div class="storm-detail-label">⏱ ${tStr('ETA')}</div><div class="storm-detail-val" style="color:${imp.color}"><span class="eta-countdown" data-eta-sec="${Math.round(targetMs)}" data-storm-key="${sk}">${initCountdown}</span></div><div style="font-size:0.65em;color:${imp.color};margin-top:1px">${tStr('Arrives')} ~${arrivalTime}</div></div>`;
          }else if(_etaT&&_etaT.eta==='fixed'){
            mvLine+=`<div class="storm-detail eta-detail"><div class="storm-detail-label">⏱ ${tStr('ETA')}</div><div class="storm-detail-val" style="color:var(--text-secondary);font-size:0.9em">~${arrivalTime}</div><div style="font-size:0.6em;color:var(--text-muted);margin-top:1px">${tStr('possible · may shift')}</div></div>`;
          }
          // eta==='none' (>6 mi): no ETA tile
        }
        mvLine+=missTile;
      }
      let estLine='';
      if(_sMv&&_sMv.speed>=2&&_b&&_b.estDbzAtUser!=null&&_b.estDbzAtUser>=18){
        const estCat=stormCat(_b.estDbzAtUser);
        estLine=`<div style="margin-top:4px;font-size:0.7em;color:var(--text-secondary)">${tStr('Est. at you')}: <span style="color:${estCat.color};font-weight:700">${_b.estDbzAtUser} dBZ</span> <span style="color:${estCat.color}">(${tStr(estCat.label)})</span></div>`;
      }
      // v6.1: convective shear / inflow read (Stull §14.5) — organization & longevity
      let shearLine='';
      const _sh=(typeof stormMaster==='function')?(stormMaster(s).shear):null;
      if(_sh){
        const col=_sh.trend==='organized'?'#f97316':_sh.trend==='weakening'?'#4ade80':'#facc15';
        const ic=_sh.trend==='organized'?'🌀':_sh.trend==='weakening'?'🌥️':'⛈️';
        const f=S.radarMetric?3.6:2.237,u=S.radarMetric?'km/h':'mph';
        const inflow=(_sh.srInflowMs!=null)?` · inflow ${Math.round(_sh.srInflowMs*f)} ${u}`:'';
        shearLine=`<div style="margin-top:4px;font-size:0.68em;color:var(--text-secondary);line-height:1.4" title="0–6 km bulk wind shear (Stull, Practical Meteorology §14.5). Weak → short-lived 'pulse' cell that depletes its own fuel; strong → tilted updraft, long-lived / supercell-capable. Storm-relative inflow = whether it's ingesting fresh low-level fuel. Uses winds aloft at your location — a local-environment estimate.">${ic} Shear ${Math.round(_sh.bulkShearMs*f)} ${u} <span style="color:${col};font-weight:700">(${_sh.tier})</span> — ${_sh.note}${inflow}</div>`;
      }
      const hex=dbzHex(s.dbz);
      const isHook=s._rotation;
      const tier=s.dbz>=65?'extreme':s.dbz>=60?'severe':s.dbz>=52?'strong':'';
      const pulse=tier?`storm-card-pulse-${tier}`:'';
      const tierBorder=tier==='extreme'?'#ff00ff':tier==='severe'?'#ff1744':tier==='strong'?'#c2410c':hex;
      const cellIcon=isHook?'🌪️':s.dbz>=65?'‼️':s.dbz>=60?'🚨':s.dbz>=52?'🟧':s.dbz>=46?'⚠️':s.dbz>=41?'🟡':s.dbz>=20?'🟢':'🔵';
      const cellName=isHook?tStr('Rotation'):s.dbz>=65?tStr('Extreme Cell'):s.dbz>=60?tStr('Severe Cell'):s.dbz>=52?tStr('Strong Cell'):s.dbz>=41?tStr('Storm Cell'):tStr('Rain Cell');
      const hookBadge=isHook?`<span class="hook-echo-badge">🌪️ Tornado Warning</span>`:'';
      const ts10=stormThreatScore10(s);
      const tsColor=s.dbz>=65?'#ff00ff':s.dbz>=60?'#ef4444':s.dbz>=52?'#f97316':ts10>=4?'#facc15':'#4ade80';
      const tsLabel=s.dbz>=65?'EXTREME':s.dbz>=60?'SEVERE':s.dbz>=52?'STRONG':ts10>=4?'MODERATE':'LOW';
      const borderColor=isHook?'#ff1744':tierBorder;
      let clsBadge='';
      if(_b&&_b.classification&&_b.classification!=='unknown'){
        const _cls=_b.classification;
        const _missMiTxt=_b.perpMissMi!=null?_b.perpMissMi.toFixed(1):'?';
        // v5.62: one simple cross-track scale on the badge (no closeness %).
        // A closing cell shows how directly its projected path passes over you;
        // a receding cell just says it's moving away.
        if(hasValidClosing&&_cls!=='moving_away'&&_b.perpMissMi!=null){
          const _t=_xtrkTier(_b.perpMissMi);
          const _bTitle=`Projected to pass ~${_missMiTxt} mi from you — ${_t.label} (Direct ≤1.5 mi · Nearby 1.5–6 mi · Passing >6 mi)`;
          clsBadge=`<span class="storm-badge" title="${_bTitle}" style="background:${_t.color}22;color:${_t.color};border:1px solid ${_t.color}66;font-weight:700">${_t.emoji} ${_t.label}</span>`;
        }else if(_cls==='moving_away'){
          const _sc=stormClass('moving_away');
          clsBadge=`<span class="storm-badge" title="Moving away from you" style="background:${_sc.color}22;color:${_sc.color};border:1px solid ${_sc.color}66;font-weight:700">${_sc.badge}</span>`;
        }
      }
      const _cr=getStormConeRain(s);
      const _coneRainLine=(_cr&&_cr.count>0)?`<div title="${tStr('Rain returns inside the projected track path — min · avg · max dBZ')}" style="margin-top:5px;font-size:0.68em;color:#5bc0ff;display:flex;align-items:center;gap:5px"><span>💧</span><span style="font-weight:600;color:var(--text-secondary)">${tStr('In path')}:</span><span style="font-weight:700">${_cr.count}</span><span style="color:var(--text-secondary)">${tStr('returns')}</span>${_cr.maxDbz?`<span style="color:var(--text-secondary)">·</span><span style="font-weight:700">${_cr.minDbz} / ${_cr.avgDbz} / ${_cr.maxDbz}</span><span style="color:var(--text-secondary)">dBZ</span><span style="color:var(--text-secondary);opacity:0.7;font-size:0.9em">${tStr('min·avg·max')}</span>`:''}</div>`:'';
      // v5.64: hybrid view — plain-English readout above, boxes below. The view
      // toggle (filter bar) flips between hybrid / text-only / boxes-only.
      const _viewMode=_stormView();
      const _summary=_stormTextSummary(s,_b,_sMv,eta);
      const _textBlock=_viewMode!=='cards'
        ?`<div class="storm-summary" style="font-size:0.8em;line-height:1.5;color:var(--text-primary);margin:6px 0${_viewMode==='hybrid'?';padding-bottom:6px;border-bottom:1px solid var(--border-subtle)':''}">${_summary}</div>`
        :'';
      const _threatLine=`<div style="display:flex;align-items:center;gap:6px;margin:4px 0 2px;font-size:0.7em" title="Threat = how directly the track crosses you (X-TRK): 10 at a bullseye, −4 per mile"><span style="font-weight:700;color:var(--text-secondary)">Threat:</span><span style="color:${tsColor};font-weight:700;font-size:1.1em">${ts10.toFixed(1)}</span><span style="color:${tsColor};font-size:0.85em;font-weight:600">/ 10 · ${tsLabel}</span></div>`;
      const _gridBlock=`<div class="storm-detail-grid">
          <div class="storm-detail"><div class="storm-detail-label">${tStr('Peak dBZ')}</div><div class="storm-detail-val" style="color:${cat.color}">${s.dbz}</div></div>
          <div class="storm-detail tappable-unit" onclick="toggleStormUnits()"><div class="storm-detail-label">${tStr('Rain Rate')}</div><div class="storm-detail-val">${cat.rain}</div><div class="tile-tap">tap</div></div>
          <div class="storm-detail tappable-unit" onclick="toggleStormUnits()"><div class="storm-detail-label">${tStr('Distance')}</div><div class="storm-detail-val"><span data-dist-mi="${s.distance}" data-closing-mph="${eta&&eta.closingSpeed?eta.closingSpeed:0}" data-target-ms="${eta&&eta._targetMs?eta._targetMs:0}">${(()=>{const cs=eta&&eta.closingSpeed?eta.closingSpeed:0;const tgt=eta&&eta._targetMs?eta._targetMs:0;if(cs>0&&tgt>Date.now()){const rh=Math.max(0,(tgt-Date.now())/3600000);return fmtStormDist(rh*cs)}return fmtStormDist(s.distance)})()}</span> · ${degToDir(s.bearing)} (${String(Math.round(s.bearing)).padStart(3,'0')}°)</div><div class="tile-tap">tap</div></div>
          ${mvLine}
        </div>`;
      const _detailBlock=_viewMode!=='text'?`${_threatLine}${_gridBlock}${_viewMode==='cards'?estLine:''}${_coneRainLine}`:'';
      return`<div class="storm-cell-card ${pulse}" style="border-color:${borderColor};--pulse-color:${borderColor}${isHook?';animation:tornado-pulse 1.8s ease-in-out infinite,storm-pulse-severe 2s ease-in-out infinite':''}">
        <div class="storm-header"><span style="font-weight:700">${cellIcon} ${cellName}</span>${hookBadge}${clsBadge}<span class="storm-badge" style="background:${hex}22;color:${hex};border:1px solid ${hex}44">${tStr(cat.label)}</span></div>
        ${_textBlock}
        ${shearLine}
        ${_detailBlock}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
          <span class="text-hint">
            ${s.lat.toFixed(3)}°N, ${Math.abs(s.lng).toFixed(3)}°${s.lng<0?'W':'E'} &middot; ${s.pixels} returns
          </span>
          <button onclick="flyToStorm(${s.lat},${s.lng})" style="font-size:0.55em;padding:2px 8px;background:rgba(0,229,255,0.08);color:var(--accent-cyan);border:1px solid rgba(0,229,255,0.25);border-radius:5px;cursor:pointer;font-weight:600;white-space:nowrap">📍 Map</button>
        </div>
      </div>`;
  }
  computeTopStorms();
  const fKeys=new Set(filtered.map(stormKey));
  const a=S._topStormAnalysis;
  const inKeySet=new Set(a.inbound.map(stormKey));
  const ohKeySet=new Set(a.overhead.map(stormKey));
  let inboundCapped=filtered.filter(s=>inKeySet.has(stormKey(s)));
  const _missMi=s=>{try{if(!s._brief)s._brief=calcStormETAForBriefing(s);return s._brief&&s._brief.perpMissMi}catch(e){return null}};
  const _missBand=s=>{const m=_missMi(s);return(m==null||!isFinite(m))?99:Math.min(12,Math.floor(m))};
  inboundCapped.sort((x,y)=>{
    const bx=_missBand(x),by=_missBand(y);
    if(bx!==by)return bx-by;
    const mx=_missMi(x)??99,my=_missMi(y)??99;
    if(mx!==my)return mx-my;
    return x.distance-y.distance;
  });
  inboundCapped=inboundCapped.slice(0,12);
  // v4.67: single source of truth for the "inbound" count the user sees. The
  // top header pill (core.js) and the "Light rain inbound — N cells" forecast
  // banner both read this so all three surfaces agree and honor the user's
  // active storm filter, instead of the pill showing the unfiltered top-storms
  // count while the cards showed the filtered count.
  S._inboundShown=inboundCapped;
  let groupHtml='';
  // v6.30: group Storm Points by the SAME 5 X-TRK tiers the ticker uses — direct
  // ≤1.5 · nearby ≤6 · near-miss 6–12 · tracking 12–48 · distant >48 — all read
  // from the ONE global XTRK_TIERS table so the tabs and the ticker breakdown can
  // never disagree. "Approaching only" now means "storms whose cone covers you"
  // (see _applyStormFilter), so with it on the filtered set already IS the in-cone
  // storms and all tabs appear.
  const _tierOf=s=>{const t=_xtrkTier(_missMi(s));return t?t.key:'distant';};
  const _byXtk=(x,y)=>{const mx=_missMi(x),my=_missMi(y);const ax=(mx==null||!isFinite(mx))?999:mx,ay=(my==null||!isFinite(my))?999:my;if(ax!==ay)return ax-ay;return (x.distance||0)-(y.distance||0);};
  const _seenG=new Set();
  // v5.84: a storm MOVING AWAY isn't "arriving" — exclude it from the Direct/Nearby/
  // Passing tiers (and therefore from the inbound badge = gDirect below, and the sat
  // header's "N inbound"). Its track's perpendicular miss can be <1.5 mi because the
  // path line threads near you BEHIND its direction of travel, which used to file a
  // receding cell under "Direct" and inflate "N inbound" even though the card itself
  // said "moving away · not a threat". These tiers describe storms on a track
  // TOWARD/PAST you only; receding cells stay visible on the radar + sonar.
  const _isReceding=s=>{try{if(!s._brief)s._brief=calcStormETAForBriefing(s);return!!(s._brief&&s._brief.classification==='moving_away');}catch(e){return false}};
  const _fUniq=filtered.filter(s=>{const k=stormKey(s);if(_seenG.has(k))return false;_seenG.add(k);return true;}).filter(s=>!_isReceding(s));
  // v6.30: build the tier sections straight from the global XTRK_TIERS table so
  // the group set, order, emoji, colour and names all come from one place. Each
  // section = the cells whose X-TRK miss falls in that tier's band.
  const _grouped={};
  for(const _t of XTRK_TIERS)_grouped[_t.key]=[];
  for(const s of _fUniq){const k=_tierOf(s);(_grouped[k]||_grouped.distant).push(s);}
  const tierSecs=XTRK_TIERS.map(_t=>({key:_t.key,items:_grouped[_t.key].sort(_byXtk),label:`${_t.emoji} ${_t.plain}`,color:_t.color}));
  const gDirect=_grouped.direct;
  // v5.76: header pill / Rain Clock "inbound" set = the Direct tier (cells whose
  // track threads within 1.5 mi of you), so the badge matches the Direct tab
  // instead of showing 0 (the old inbound set used a different approach calc).
  inboundCapped=gDirect.slice(0,12);
  S._inboundShown=inboundCapped;
  const _GRP_CAP=25;
  // Accordion open-state: undefined (first render) → open highest-priority
  // non-empty tier; null (user collapsed all) → stay collapsed; a chosen tab that
  // emptied → first non-empty.
  const _firstNonEmpty=(tierSecs.find(t=>t.items.length)||{}).key||'direct';
  let _openKey=S._stormGroupOpen;
  if(_openKey===undefined)_openKey=_firstNonEmpty;
  else if(_openKey!==null&&!tierSecs.find(t=>t.key===_openKey&&t.items.length))_openKey=_firstNonEmpty;
  S._stormGroupOpen=_openKey;
  // v6.29: ALWAYS render all tiers, even at 0 — an empty tier (e.g. Direct)
  // shows as a dimmed, collapsed header instead of vanishing, so the tab layout is
  // stable and the highest-priority NON-empty tier is the one auto-expanded.
  for(const sec of tierSecs){
    const has=sec.items.length>0;
    const cards=has?sec.items.slice(0,_GRP_CAP).map(buildCard).join(''):'';
    const more=sec.items.length>_GRP_CAP?`<div class="text-hint" style="text-align:center;padding:6px 0">+${sec.items.length-_GRP_CAP} more — narrow with filters</div>`:'';
    const body=has?`${cards}${more}`:`<div class="text-hint" style="text-align:center;padding:8px 0;opacity:0.55">None right now</div>`;
    const openAttr=(has&&sec.key===_openKey)?'open':'';
    groupHtml+=`<details class="storm-group storm-tier-group${has?'':' is-empty'}" data-grp="${sec.key}" ${openAttr}>
      <summary class="storm-group-header" style="border-left:3px solid ${sec.color}${has?'':';opacity:0.5'}" onclick="return _toggleStormGroup(event,'${sec.key}')">
        ${sec.label} <span class="storm-group-count">${sec.items.length}</span>
      </summary>
      <div class="storm-group-body">${body}</div>
    </details>`;
  }
  let gridHtml='';
  if(S._rawScanPts&&S._rawScanPts.length){
    const gridCells=hexGridBin(S._rawScanPts,S.lat,S.lon,S.scanRadius||80);
    const zones=[];
    for(const[k,c]of gridCells){
      const midBear=c.bearing;
      const midDist=c.dist;
      const cat=stormCat(c.maxDbz);
      const hex=dbzHex(c.maxDbz);
      let etaInfo=null;
      if(mv&&mv.speed>=2){
        // v6.2 FIX: a zone approaches only if the storm moves FROM the zone TOWARD
        // the user — i.e. travel direction ≈ (bearing + 180), the zone→user
        // heading. The old code compared travel to the raw user→zone bearing
        // (no +180 flip), so a zone SSW of you with storms moving SSW read as
        // "inbound, ETA 2h" when it was actually receding. Closing speed is now
        // signed: positive = closing on you (show ETA), negative = moving away
        // (no time). Matches the storm-cell convention.
        const bearToUser=(midBear+180)%360;                               // zone → user
        const diff=Math.abs(((mv.direction-bearToUser+180)%360)-180);     // 0° = straight at you
        const closingSpd=mv.speed*Math.cos(diff*Math.PI/180);             // + toward, − away
        if(closingSpd>0.5&&diff<=45){
          etaInfo={approaching:true,eta:midDist/closingSpd*60,color:'#ef4444'};
        }else if(closingSpd<-0.5){
          etaInfo={approaching:false,receding:true};                      // moving away — no ETA
        }
      }
      zones.push({q:c.q,r:c.r,maxDbz:c.maxDbz,count:c.count,midBear,midDist,cat,hex,etaInfo});
    }
    zones.sort((a,b)=>{
      const ae=a.etaInfo&&a.etaInfo.approaching?a.etaInfo.eta:99999;
      const be=b.etaInfo&&b.etaInfo.approaching?b.etaInfo.eta:99999;
      if(ae!==be)return ae-be;
      return a.midDist-b.midDist;
    });
    if(zones.length){
      const zoneCards=zones.map(z=>{
        const dir=degToDir(z.midBear);
        const distVal=S.radarMetric?(z.midDist*1.60934).toFixed(1)+' km':z.midDist.toFixed(1)+' mi';
        const bearStr=Math.round(z.midBear)+'°';
        let etaStr='';
        if(z.etaInfo&&z.etaInfo.approaching){
          const sec=Math.round(z.etaInfo.eta*60);
          const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
          etaStr=`<span style="color:#ef4444;font-weight:600;font-family:var(--font-mono);font-size:0.85em">⏱ ${h>0?h+'h:'+String(m).padStart(2,'0')+'m':m+'m:'+String(s).padStart(2,'0')+'s'}</span>`;
        }else if(z.etaInfo&&z.etaInfo.receding){
          etaStr=`<span style="color:var(--text-muted);font-weight:600;font-size:0.68em">↘ moving away</span>`;
        }
        return`<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-left:3px solid ${z.hex};background:${z.hex}08;border-radius:4px;margin-bottom:4px">
          <div class="flex-1" style="min-width:0">
            <div style="font-weight:600;font-size:0.8em">${dir} <span style="color:var(--text-muted);font-weight:400">${bearStr}</span></div>
            <div class="text-muted-sm">${distVal} · ${z.count} return${z.count>1?'s':''}</div>
          </div>
          <div style="text-align:right">
            <span style="font-size:0.75em;font-weight:600;color:${z.hex}">${z.maxDbz} dBZ</span>
            <div style="font-size:0.6em;color:${z.cat.color}">${z.cat.label}</div>
            ${etaStr}
          </div>
        </div>`;
      }).join('');
      const gridOpen=prevOpen['gridzones']!==undefined?prevOpen['gridzones']:false;
      gridHtml=`<div class="card" style="margin-top:8px"><div class="card-title"><span class="icon">⬡</span> Hex Grid Zones</div>
        <details class="storm-group" data-grp="gridzones" ${gridOpen?'open':''}>
          <summary class="storm-group-header" style="border-left:3px solid var(--accent-cyan)">
            ⬡ Hex Grid Zones <span class="storm-group-count">${zones.length}</span>
          </summary>
          <div class="storm-group-body" style="padding:4px">${zoneCards}</div>
        </details>
      </div>`;
    }
  }
  const stormCount=tierSecs.reduce((n,sec)=>n+sec.items.length,0); // v6.30: = distinct cells across all 5 tiers
  const filteredCount=stormCount; // v5.76: "showing N" = the distinct storms in the tier tabs
  const totalCount=storms.length;
  const filterNote=filteredCount<totalCount?` <span class="c-muted-85">(showing ${filteredCount}/${totalCount})</span>`:'';
  const smartSummary=_smartStormSummary(storms);
  const noWindBanner=(!mv||mv.speed<2)?`<div style="padding:8px 12px;background:rgba(255,204,0,0.08);border:1px solid rgba(255,204,0,0.2);border-radius:8px;font-size:0.78em;line-height:1.5;margin-bottom:8px;color:#facc15">💨 Wind data unavailable or calm — ETA and approach calculations are limited.${S._filterApproachBypassed?' <strong>"Approaching only" filter bypassed</strong> — showing all storms.':''}</div>`:'';
  el.innerHTML=`${zoneAlert}
    <div class="alert-banner ${sev}">
      <span class="alert-icon">${sev==='danger'?'🚨':sev==='warning'?'⚠️':'📡'}</span>
      <div class="alert-text"><span class="alert-title">${storms.length} Cell${storms.length>1?'s':''} Detected${storms.length?' <span class="c-muted-85">(Min: '+Math.min(...storms.map(s=>s.dbz))+' dBZ | Max: '+Math.max(...storms.map(s=>s.dbz))+' dBZ)</span>':''}${stormCount?' · '+stormCount+' Storm'+(stormCount>1?'s':''):''}</span>${filterNote}${inboundCapped.length?' · <span style="color:#ef4444">'+inboundCapped.length+' inbound</span>':''}${_coneLineHtml}<br>Within ${S.radarMetric?(S.scanRadius*1.60934).toFixed(0)+' km':S.scanRadius+' mi'}${mv&&mv.speed>=2?' · Moving '+degToDir(mv.direction)+' ('+Math.round(mv.direction)+'°) at '+(S.radarMetric?Math.round(mv.speed*1.60934)+' km/h':mv.speed+' mph'):''}<br><span id="auto-scan-status" class="c-muted-sm"></span></div>
    </div>
    ${noWindBanner}${smartSummary}
    ${_renderFilterBar(sf)}
    ${(()=>{const hidden=totalCount-filteredCount;if(S._coneFocus){return`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;margin-bottom:6px;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.3);border-radius:6px;font-size:0.75em;color:#22d3ee"><span>🎯 Focused on the ${filteredCount} cell${filteredCount!==1?'s':''} whose cone covers you</span><a href="#" onclick="event.preventDefault();toggleConeFocus()" style="color:var(--accent-cyan);font-weight:600;text-decoration:none">Reset ✕</a></div>`}if(hidden>0&&_stormFilterActive(sf)){return`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;margin-bottom:6px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.22);border-radius:6px;font-size:0.75em;color:var(--text-secondary)"><span>🙈 ${hidden} cell${hidden>1?'s':''} hidden by filters${sf.approachOnly?' — not on a path toward you; uncheck "Approaching only" to see every cell on radar':''}</span><a href="#" onclick="event.preventDefault();clearStormFilters()" style="color:var(--accent-cyan);font-weight:600;text-decoration:none">Clear filters</a></div>`}return''})()}
    <div class="card"><div class="card-title"><span class="icon">🌪️</span> Storm Points</div>
      ${groupHtml}
    </div>
    ${gridHtml}
    <div style="font-size:0.65em;color:var(--text-muted);text-align:center;padding:4px">
      ${(typeof ltgLive==='function'&&ltgLive())?`⚡ ${S._ltgStrikes.flashes.length} live strike${S._ltgStrikes.flashes.length!==1?'s':''} (last 15 min) &middot; Observed via WarPulse<br>`:`⚡ Lightning on storms ≥40 dBZ &middot; Radar-derived, not observed<br>`}
      Impact % based on direction, distance, speed &amp; intensity via winds aloft
    </div>`;
  startEtaCountdowns();
  updateAutoScanUI();
}
// v4.67: renderStorms is a thin wrapper that ALWAYS refreshes the header/nav
// storm badges after rendering, so the inbound pill can never drift out of sync
// with the Storms-tab inbound cards regardless of which code path triggered the
// render (page switch, scan, filter change, desktop re-render, etc.).
function renderStorms(){
  try{_renderStormsCore();}
  finally{
    if(typeof updateStormBadges==='function')updateStormBadges();
    // v4.68: the Storms render is the single source of truth for the inbound set
    // (S._inboundShown). The Rain Clock dial mirrors that exact set, so force it
    // to recompute here — otherwise a filter change or storm re-render would
    // update the cards/pill while the dial kept showing stale windows/counts.
    if(typeof refreshRainClock==='function')refreshRainClock(true);
  }
}

