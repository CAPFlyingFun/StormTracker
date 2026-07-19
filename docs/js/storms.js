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
  if(typeof toast==='function')toast(t?'✓ Lightning key saved':'Lightning key cleared');
}
function toggleLightningKeyVis(){
  const inp=document.getElementById('settings-lightning-key');
  if(!inp)return;
  inp.type=inp.type==='password'?'text':'password';
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

function getWindShearAnalysis(){
  if(!S._windShear||!S._aloftData||S._aloftData.length<2)return null;
  const sfc=S._aloftData.find(a=>a.isSfc)||S._aloftData[0];
  const upper=S._aloftData[S._aloftData.length-1];
  const vecShearKmh=S._windShear.speedDiff;
  const vecShearMph=vecShearKmh*0.621371;
  let severity='Light';
  if(vecShearMph>=25)severity='Strong';else if(vecShearMph>=15)severity='Moderate';
  let impact='Minimal turbulence expected';
  if(vecShearMph>=25)impact='Significant turbulence likely — hazardous for light aircraft';
  else if(vecShearMph>=15)impact='Moderate turbulence possible — use caution';
  else if(vecShearMph>=8)impact='Light chop possible';
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
  const _eta={eta:_etaOut,impact:pct,approaching:_isApproaching,perpTier:_tierKey,closingSpeed:_closingOut,angleDiff:Math.round(diff),cellTrack:!!cellTrack,trackDir:cellTrack?cellTrack.dir:null,trackSpd:cellTrack?cellTrack.speed:null,movDir,movSpd,source:_hyb.source,confidence:_hyb.confidence,obsBased:_obsBased,nwsWarnings,terrain:terrain.desc};
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
  if(!s)return{count:0,maxDbz:0};
  if(s._coneRainScanId===S._stormScanId&&s._coneRain)return s._coneRain;
  let res={count:0,maxDbz:0};
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
const _nhcData = { systems: null, forecast: null, cones: null, windRadii: null, _lastFetch: 0 };
S._nhcTrackLayers = [];
S._nhcSelectedStorm = null;
S._showNHCTracks = (() => { try { const v = localStorage.getItem('st_nhc_tracks'); return v === null ? true : v === '1'; } catch(e) { return true; } })();
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
    const [gisRes, rssRes, surgeRes, jtwcRes] = await Promise.allSettled([
      _fetchNHCGIS(),
      _fetchNHCActiveStorms(),
      fetch('https://www.nhc.noaa.gov/CurrentSurges.json', { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null).catch(() => null),
      _fetchJTWCStorms()
    ]);
    const gis = gisRes.status === 'fulfilled' ? gisRes.value : null;
    const rssStorms = rssRes.status === 'fulfilled' ? rssRes.value : [];
    const surgeData = surgeRes.status === 'fulfilled' ? surgeRes.value : null;
    const jtwcStorms = jtwcRes.status === 'fulfilled' ? jtwcRes.value : [];
    let storms = [];
    if (gis && gis.positions && gis.positions.length) {
      storms = gis.positions;
      _nhcData.forecast = gis.tracks || [];
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
    _nhcData.systems = storms;
    _nhcData.surgeRaw = surgeData;
    _recomputeNHCUserFields();
    console.log('[NHC+JTWC] Tropical systems:', storms.length, 'NHC tracks:', (_nhcData.forecast||[]).length, 'cones:', (_nhcData.cones||[]).length, 'JTWC:', jtwcStorms.length);
  } catch (e) {
    console.log('[NHC] Fetch error:', e.message);
    if (!_nhcData.systems) _nhcData.systems = [];
  }
}
async function _fetchNHCGIS() {
  const base = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';
  const q = 'where=1%3D1&outFields=*&f=geojson&resultRecordCount=500';
  const result = { positions: [], tracks: [], cones: [], windRadii: [] };
  try {
    const [posRes, trkRes, coneRes, wr34Res, wr50Res, wr64Res] = await Promise.allSettled([
      fetch(`${base}/0/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/2/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/4/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/7/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/8/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null),
      fetch(`${base}/9/query?${q}`, { signal: AbortSignal.timeout(10000) }).then(r => r.ok ? r.json() : null)
    ]);
    const posData = posRes.status === 'fulfilled' ? posRes.value : null;
    const trkData = trkRes.status === 'fulfilled' ? trkRes.value : null;
    const coneData = coneRes.status === 'fulfilled' ? coneRes.value : null;
    const wr34Data = wr34Res.status === 'fulfilled' ? wr34Res.value : null;
    const wr50Data = wr50Res.status === 'fulfilled' ? wr50Res.value : null;
    const wr64Data = wr64Res.status === 'fulfilled' ? wr64Res.value : null;
    if (posData && posData.features) {
      const seen = new Set();
      for (const f of posData.features) {
        const p = f.properties || {};
        const coords = f.geometry?.coordinates;
        if (!coords) continue;
        const name = p.STORMNAME || p.NAME || 'Unknown';
        const stormId = p.STORMID || p.ATCFID || '';
        const tau = p.TAU || p.ADVDATE || 0;
        const key = name + '_' + stormId;
        if (seen.has(key)) continue;
        seen.add(key);
        const windKt = p.MAXWIND || p.INTENSITY || null;
        const maxWind = windKt ? Math.round(windKt * 1.15078) : null;
        const stormType = p.STORMTYPE || (maxWind >= 74 ? 'Hurricane' : maxWind >= 39 ? 'Tropical Storm' : 'Tropical Depression');
        const basin = stormId.startsWith('EP') ? 'ep' : 'at';
        result.positions.push({
          id: stormId, name, type: stormType, basin,
          lat: coords[1], lon: coords[0],
          maxWind, gusts: p.GUST ? Math.round(p.GUST * 1.15078) : null,
          minPressure: p.MSLP || null,
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
function _saffirSimpson(windMph) {
  if (!windMph) return { cat: 'Unknown', label: 'Unknown', color: '#888', num: -1 };
  if (windMph >= 157) return { cat: 'Cat 5', label: 'Category 5', color: '#ff1744', num: 5 };
  if (windMph >= 130) return { cat: 'Cat 4', label: 'Category 4', color: '#ff5722', num: 4 };
  if (windMph >= 111) return { cat: 'Cat 3', label: 'Category 3', color: '#ff9800', num: 3 };
  if (windMph >= 96) return { cat: 'Cat 2', label: 'Category 2', color: '#ffc107', num: 2 };
  if (windMph >= 74) return { cat: 'Cat 1', label: 'Category 1', color: '#ffeb3b', num: 1 };
  if (windMph >= 39) return { cat: 'TS', label: 'Tropical Storm', color: '#4fc3f7', num: 0 };
  return { cat: 'TD', label: 'Tropical Depression', color: '#90caf9', num: -1 };
}
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
// v5.62: the storm-cell card badge's cross-track (X-TRK) proximity scale — how
// far a cell's projected path passes from your exact location. Three plain tiers
// replace the old six (direct/near_direct/near_miss/miss/distant/far) plus the
// confusing closeness-% badge:
//   🎯 Direct  ≤1.5 mi   ·   🟠 Nearby  1.5–6 mi   ·   ⚪ Passing  >6 mi
// (Display only — the internal 6-tier classification still drives sorting,
// grouping, alert thresholds and the background push scanner.)
function _xtrkTier(missMi){
  if(missMi==null||isNaN(missMi))return null;
  if(missMi<=1.5)return{key:'direct', label:'DIRECT', emoji:'🎯', color:'#ef4444'};
  if(missMi<=6)  return{key:'nearby', label:'NEARBY', emoji:'🟠', color:'#f97316'};
  return{key:'passing', label:'PASSING', emoji:'⚪', color:'#94a3b8'};
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
    const word=t.key==='direct'?'Direct impact':t.key==='nearby'?'Nearby pass':'Passing wide';
    const missStr=S.radarMetric?(_b.perpMissMi*1.60934).toFixed(1)+' km':_b.perpMissMi.toFixed(1)+' mi';
    // v5.65: arrival shows a LIVE countdown (ticks via the shared eta-countdown
    // updater) next to the fixed clock time. No data-storm-key here so it never
    // double-triggers the auto-rescan the box's countdown already owns.
    let arr='';
    if(_tgt&&_tgt>Date.now()){
      const _cd=fmtCountdown(Math.max(0,Math.round((_tgt-Date.now())/1000)));
      arr=`, arriving ~${fmtClockShort(new Date(_tgt))} (in <span class="eta-countdown" data-eta-sec="${Math.round(_tgt)}">${_cd}</span>)`;
    }else if(eta&&eta.eta!=null){
      arr=`, arriving ~${fmtArrivalTime(eta.eta)}`;
    }
    const est=_b.estDbzAtUser;
    const rain=(est!=null&&est>=15)?`${stormCat(est).label} (~${est} dBZ) expected`:'little/no rain expected at you';
    impact=`${t.emoji} ${word}, XTK ${missStr}${arr} · ${rain}.`;
  }else{
    impact='Track uncertain — watching.';
  }
  return `${icon} ${strength} — ${distStr} to your ${posDir} (${Math.round(s.bearing)}°), ${moveClause}. ${impact}`;
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
      <div style="font-size:0.6em;color:var(--text-muted);text-align:center;padding:0 8px 8px">Data: NHC + JTWC · ArcGIS + RSS</div></div>`;
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
      ${s.lat != null ? `<div style="font-size:0.65em;color:var(--text-muted);margin-top:4px">📍 ${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}, ${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'} · ${(_STORM_REGIONS.find(r => r.id === s._region) || {}).label || s.basin}${s._source === 'jtwc' ? ' (JTWC)' : ''}${hasForecast ? ' · <span class="c-cyan">Tap for forecast track</span>' : ''}</div>` : ''}
    </div>`;
  });
  html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px 2px">
    <div class="flex-center-gap4"><span class="text-hint">Alert radius:</span>
      <select onchange="setNHCProxRadius(this.value)" style="font-size:0.6em;padding:1px 4px;background:var(--bg-elevated);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:4px">${[100,200,300,500,750,1000].map(r=>`<option value="${r}"${r===S._nhcProxRadius?' selected':''}>${r} mi</option>`).join('')}</select></div>
    <span class="text-hint">NHC + JTWC · 15-min</span></div></div>`;
  return html;
}
function setNHCProxRadius(val) {
  S._nhcProxRadius = parseInt(val) || 200;
  try { localStorage.setItem('st_nhc_prox_radius', String(S._nhcProxRadius)); } catch(e) {}
  if (S.activePage === 'alerts' || S.activePage === 'weather') { if (S.activePage === 'alerts') renderAlerts(); _updateTropicalUI(); }
}
function _selectNHCStorm(idOrName) {
  S._nhcSelectedStorm = idOrName;
  switchPage('radar');
  const findStorm = () => (_nhcData.systems || []).find(s => s.id === idOrName || s.name === idOrName);
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
function toggleNHCTracks(on) {
  S._showNHCTracks = on;
  try { localStorage.setItem('st_nhc_tracks', on ? '1' : '0'); } catch(e) {}
  if (S.map) plotNHCTracks(S.map);
  const btn = document.getElementById('btn-nhc-tracks');
  if (btn) btn.style.opacity = on ? '1' : '0.4';
  toast(on ? 'Hurricane tracks shown on map' : 'Hurricane tracks hidden');
}
function plotNHCTracks(map) {
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
  for (const cone of (_nhcData.cones || [])) {
    if (!_isStormVisible(cone.stormId, cone.stormName)) continue;
    if (!showAll && cone.stormName.toLowerCase() !== selectedName?.toLowerCase() && cone.stormId !== selectedName) continue;
    if (!cone.coords || cone.coords.length < 3) continue;
    const storm = (_nhcData.systems || []).find(s => s.id === cone.stormId || s.name.toLowerCase() === cone.stormName.toLowerCase());
    const cat = storm ? (storm.category || _saffirSimpson(storm.maxWind)) : { color: '#9333EA' };
    const latlngs = cone.coords.map(c => [c[1], c[0]]);
    const poly = L.polygon(latlngs, {
      color: cat.color || '#9333EA', fillColor: cat.color || '#9333EA',
      fillOpacity: 0.08, weight: 1.5, dashArray: '6,4', interactive: false
    });
    poly.addTo(map);
    S._nhcTrackLayers.push(poly);
  }
  for (const track of (_nhcData.forecast || [])) {
    if (!_isStormVisible(track.stormId, track.stormName)) continue;
    if (!showAll && track.stormName.toLowerCase() !== selectedName?.toLowerCase() && track.stormId !== selectedName) continue;
    if (!track.coords || track.coords.length < 2) continue;
    const storm = (_nhcData.systems || []).find(s => s.id === track.stormId || s.name.toLowerCase() === track.stormName.toLowerCase());
    const cat = storm ? (storm.category || _saffirSimpson(storm.maxWind)) : { color: '#9333EA' };
    const latlngs = track.coords.map(c => [c[1], c[0]]);
    const line = L.polyline(latlngs, {
      color: cat.color || '#9333EA', weight: 3, opacity: 0.9,
      dashArray: '8,6', interactive: false
    });
    line.addTo(map);
    S._nhcTrackLayers.push(line);
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
      ${s.dist != null ? `<div style="font-size:0.75em;color:#aaa;margin-top:4px">${Math.round(s.dist)} mi from you</div>` : ''}
      <div style="margin-top:6px"><a href="#" onclick="event.preventDefault();_selectNHCStorm('${_escStormName(s.id||s.name)}')" style="font-size:0.75em;color:var(--accent-cyan)">Show forecast track →</a></div>
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
    if (isSelected) {
      const radiiColors = { 34: '#4fc3f7', 50: '#ffc107', 64: '#ff5722' };
      const radiiLabels = { 34: '34 kt (TS)', 50: '50 kt (Strong TS)', 64: '64 kt (Hurricane)' };
      const stormRadii = (_nhcData.windRadii || []).filter(wr => wr.stormId === s.id || wr.stormName.toLowerCase() === s.name.toLowerCase());
      if (stormRadii.length) {
        for (const wr of stormRadii) {
          if (!wr.coords || wr.coords.length < 3) continue;
          const latlngs = wr.coords.map(c => [c[1], c[0]]);
          const color = radiiColors[wr.ktLevel] || '#4fc3f7';
          const poly = L.polygon(latlngs, {
            color, fillColor: color, fillOpacity: 0.06, weight: 1.5, dashArray: '4,3', interactive: false
          });
          poly.addTo(map);
          S._nhcTrackLayers.push(poly);
          const bounds = poly.getBounds();
          const labelPt = bounds.getNorth ? L.latLng(bounds.getNorth(), bounds.getCenter().lng) : null;
          if (labelPt) {
            const rLabel = L.divIcon({
              className: '',
              html: `<div style="font-size:8px;color:${color};font-weight:600;text-shadow:0 0 3px #000;pointer-events:none">${radiiLabels[wr.ktLevel] || wr.ktLevel + ' kt'}</div>`,
              iconSize: [80, 10], iconAnchor: [40, 12]
            });
            const rm = L.marker(labelPt, { icon: rLabel, interactive: false });
            rm.addTo(map);
            S._nhcTrackLayers.push(rm);
          }
        }
      }
    }
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
    const msg = `🌀 ${s.type} ${s.name} (${cat.label}) — ${reason}`;
    toast(msg, 8000);
    _sendBrowserNotification('Tropical Cyclone Alert', msg);
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
  if(f.approachOnly&&!noMv)out=out.filter(s=>{
    const e=s._eta;if(!(e&&e.approaching&&e.eta!=null))return false;
    // v5.63: "Approaching only" now means heading DIRECTLY at you — cross-track
    // miss ≤ 1.5 mi (the DIRECT tier), matching the card badge. Was the old
    // 6-tier direct/near_direct/near_miss (≤12 mi).
    try{if(!s._brief)s._brief=calcStormETAForBriefing(s);const pm=s._brief&&s._brief.perpMissMi;return pm!=null&&pm<=1.5;}catch(err){return false}
  });
  S._filterApproachBypassed=f.approachOnly&&noMv;
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
  let coneDirect=0,coneNearby=0,conePassing=0; // v5.66: X-TRK tier split of the cones you're inside
  if(mv&&mv.speed>=2&&S._tracksMode!=='off'){
    const uLat=S.lat,uLng=S.lon;
    const _coneFloor=(typeof getConeMinDbz==='function')?getConeMinDbz():30;
    // Base the cone COUNT on the same population the map draws (plotStormTracks
    // also uses getVisibleStormList), so clutter-hiding keeps the count and the
    // drawn cones in agreement.
    let coneStorms=(typeof getVisibleStormList==='function')?getVisibleStormList():storms;
    if(S._tracksMode==='inbound'){
      if(S._topStorms&&S._topStorms.length){
        coneStorms=coneStorms.filter(s=>S._topStorms.includes(s));
      }else{
        coneStorms=coneStorms.filter(s=>{try{if(!s._brief)s._brief=calcStormETAForBriefing(s);return s._brief&&s._brief.impactScore>0}catch(e){return false}}).sort((a,b)=>((b._brief&&b._brief.impactScore)||0)-((a._brief&&a._brief.impactScore)||0)).slice(0,12);
      }
    }
    coneStorms.forEach(s=>{
      if((s.dbz||0)<_coneFloor)return;
      const _smv=(typeof getHybridMovement==='function'?getHybridMovement(s):null)||mv;
      if(isUserInStormCone(s,_smv,uLat,uLng)){
        inConeCount++;
        try{
          const b=calcStormETAForBriefing(s);
          const pm=(b&&b.perpMissMi!=null&&isFinite(b.perpMissMi))?b.perpMissMi:null;
          if(pm!=null&&(inConeMinMiss==null||pm<inConeMinMiss))inConeMinMiss=pm;
          // v5.66: bucket each cone you're inside by the SAME X-TRK tiers as the
          // card badges — Direct ≤1.5 · Nearby 1.5–6 · Passing >6 (or no XTK).
          const _t=pm!=null?_xtrkTier(pm):null;
          if(_t&&_t.key==='direct')coneDirect++;
          else if(_t&&_t.key==='nearby')coneNearby++;
          else conePassing++;
        }catch(e){conePassing++;}
      }
    });
  }
  // v5.44: publish cone stats so the "no storms approaching" banner and the
  // hidden-by-filters note can EXPLAIN "in N cones but 0 approaching" instead
  // of contradicting the header. In-cone = inside a storm's broad 15° track
  // envelope (widens with distance — ~13 mi half-width at 50 mi out), while
  // "approaching" = projected closest pass under ~6 mi. Very different bars.
  S._coneStats={count:inConeCount,minMiss:inConeMinMiss,direct:coneDirect,nearby:coneNearby,passing:conePassing,scanId:S._stormScanId};
  const inConeColor=coneDirect>0?'#ef4444':coneNearby>0?'#f97316':conePassing>0?'#94a3b8':'#6b7280';
  const _coneBreak=[];
  if(coneDirect>0)_coneBreak.push('Direct: '+coneDirect);
  if(coneNearby>0)_coneBreak.push('Nearby: '+coneNearby);
  if(conePassing>0)_coneBreak.push('Passing: '+conePassing);
  const _coneLineHtml=(mv&&mv.speed>=2)?`<br><span style="color:${inConeColor}">🎯 In ${inConeCount} storm track${inConeCount!==1?'s':''}${_coneBreak.length?' · '+_coneBreak.join(', '):''}</span>`:'';
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
      let _b=null;try{_b=calcStormETAForBriefing(s);s._brief=_b}catch(e){}
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
          mvLine+=`<div class="storm-detail eta-detail"><div class="storm-detail-label">⏱ ${tStr('ETA')}</div><div class="storm-detail-val" style="color:${imp.color}"><span class="eta-countdown" data-eta-sec="${Math.round(targetMs)}" data-storm-key="${sk}">${initCountdown}</span></div><div style="font-size:0.65em;color:${imp.color};margin-top:1px">${tStr('Arrives')} ~${arrivalTime}</div></div>`;
        }
        mvLine+=missTile;
      }
      let estLine='';
      if(_sMv&&_sMv.speed>=2&&_b&&_b.estDbzAtUser!=null&&_b.estDbzAtUser>=18){
        const estCat=stormCat(_b.estDbzAtUser);
        estLine=`<div style="margin-top:4px;font-size:0.7em;color:var(--text-secondary)">${tStr('Est. at you')}: <span style="color:${estCat.color};font-weight:700">${_b.estDbzAtUser} dBZ</span> <span style="color:${estCat.color}">(${tStr(estCat.label)})</span></div>`;
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
      const _coneRainLine=(_cr&&_cr.count>0)?`<div title="${tStr('Rain returns inside the projected track path')}" style="margin-top:5px;font-size:0.68em;color:#5bc0ff;display:flex;align-items:center;gap:5px"><span>💧</span><span style="font-weight:600;color:var(--text-secondary)">${tStr('In path')}:</span><span style="font-weight:700">${_cr.count}</span><span style="color:var(--text-secondary)">${tStr('returns')}</span>${_cr.maxDbz?`<span style="color:var(--text-secondary)">·</span><span style="font-weight:700">${_cr.maxDbz} dBZ</span><span style="color:var(--text-secondary)">${tStr('max')}</span>`:''}</div>`:'';
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
  const overhead=filtered.filter(s=>ohKeySet.has(stormKey(s)));
  const nearby=filtered.filter(s=>!inKeySet.has(stormKey(s))&&!ohKeySet.has(stormKey(s)));
  let groupHtml='';
  const _nearbyAutoOpen=inboundCapped.length===0&&overhead.length===0&&nearby.length>0;
  const sections=[
    {key:'approaching',items:inboundCapped,label:'⏱️ Inbound',color:'#ef4444',open:true},
    {key:'overhead',items:overhead,label:'⚠️ Overhead / Arrived',color:'#f97316',open:false},
    {key:'nearby',items:nearby,label:'🟢 Nearby / Outbound',color:'#4ade80',open:_nearbyAutoOpen}
  ];
  for(const sec of sections){
    if(!sec.items.length)continue;
    const cards=sec.items.map(buildCard).join('');
    const isOpen=prevOpen[sec.key]!==undefined?prevOpen[sec.key]:sec.open;
    groupHtml+=`<details class="storm-group" data-grp="${sec.key}" ${isOpen?'open':''}>
      <summary class="storm-group-header" style="border-left:3px solid ${sec.color}">
        ${sec.label} <span class="storm-group-count">${sec.items.length}</span>
      </summary>
      <div class="storm-group-body">${cards}</div>
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
        const travelDir=mv.direction;
        const diff=Math.abs(((travelDir-midBear+180)%360)-180);
        if(diff<=30){
          const closingSpd=mv.speed*Math.cos(diff*Math.PI/180);
          if(closingSpd>0.5){
            const etaMin=midDist/closingSpd*60;
            etaInfo={approaching:true,eta:etaMin,color:'#ef4444'};
          }
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
  const stormCount=inboundCapped.length+overhead.length+nearby.length;
  const filteredCount=filtered.length;
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
    ${(()=>{const hidden=totalCount-filteredCount;if(hidden>0&&_stormFilterActive(sf)){return`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;margin-bottom:6px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.22);border-radius:6px;font-size:0.75em;color:var(--text-secondary)"><span>🙈 ${hidden} cell${hidden>1?'s':''} hidden by filters${(()=>{const _c=S._coneStats;if(!(sf.approachOnly&&_c&&_c.count>0&&_c.scanId===S._stormScanId))return'';return _c.direct>0?` — ${_c.direct} heading directly, ${_c.count-_c.direct} passing wider; uncheck "Approaching only" to see the rest`:' — none heading directly at you; uncheck "Approaching only" to see nearby tracks'})()}</span><a href="#" onclick="event.preventDefault();clearStormFilters()" style="color:var(--accent-cyan);font-weight:600;text-decoration:none">Clear filters</a></div>`}return''})()}
    <div class="card"><div class="card-title"><span class="icon">🌪️</span> Storm Points</div>
      ${groupHtml}
    </div>
    ${gridHtml}
    <div style="font-size:0.65em;color:var(--text-muted);text-align:center;padding:4px">
      ⚡ Lightning on storms ≥40 dBZ &middot; Radar-derived, not observed<br>
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

