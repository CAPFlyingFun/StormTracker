// ==========================================
// DETERMINISTIC HTML WEATHER BRIEFING ENGINE
// On-device, no AI. Mirrors the AI section ordering and rich-text markup.
//
// Public API:
//   gatherBriefingData()             -> snapshot object pulled from global S
//   buildSystemBriefing(data)        -> string of rich-text markup
//   buildBriefing()                  -> convenience wrapper (gather + build)
//
// Output uses [!dbz:NN]NN dBZ[/!], [!red|orange|yellow|green|cyan]...[/!],
// **bold**, *italic*, __underline__ — all rendered by ai.js fmtAIText().
// ==========================================
(function(){
  function _fmtDist(mi,metric){if(mi==null||isNaN(mi))return '?';const r=Math.round(mi*10)/10;return metric?(r*1.60934).toFixed(1)+' km':r.toFixed(1)+' mi'}
  function _emojiTier(k){return ({direct:'🔴',near_direct:'🟠',near_miss:'🟡',miss:'🔵',distant:'⚪',far:'⚫',passing:'🟡',moving_away:'🟢'})[k]||'⚫'}
  function _labelTier(k){return ({direct:'DIRECT',near_direct:'NEAR DIRECT',near_miss:'NEAR MISS',miss:'MISS',distant:'DISTANT',far:'FAR',passing:'PASSING',moving_away:'MOVING AWAY'})[k]||(k||'UNKNOWN').toUpperCase()}
  function _dbzTag(n){return `[!dbz:${n}]${n} dBZ[/!]`}
  function _safeDeg(b){try{return (typeof degToDir==='function')?degToDir(b):''}catch(e){return ''}}
  function _safeTemp(c){try{return (typeof fmtTemp==='function')?fmtTemp(c):(c+'°C')}catch(e){return c+'°'}}
  function _safeWind(k){try{return (typeof fmtWind==='function')?fmtWind(k):k+' km/h'}catch(e){return k+''}}
  function _safePres(m){try{return (typeof fmtPres==='function')?fmtPres(m):m+' mb'}catch(e){return m+''}}

  function gatherBriefingData(){
    const classified={inbound:[],background:[],passing:[],away:[],hiddenCount:0,totalCount:0};
    // Consume the post-filter snapshot so the System Briefing sees the SAME cells
    // the Storms tab cards render. Falls back to raw S.storms if the helper is
    // not loaded yet (e.g. very early boot).
    const fs=(typeof S!=='undefined'&&typeof getFilteredStorms==='function')
      ?getFilteredStorms()
      :{storms:(typeof S!=='undefined'&&S.storms)?S.storms:[],filter:null,totalCount:(typeof S!=='undefined'&&S.storms?S.storms.length:0),hiddenCount:0};
    classified.totalCells=fs.totalCount;
    classified.hiddenByFilter=fs.hiddenCount;
    classified.filterState=fs.filter;
    // v4.51: Inbound bucket mirrors the user's filtered Storms tab (so the
    // briefing's "Inbound" subsection matches the cards the user is looking at).
    // Non-inbound buckets (background / passing / away) bypass the user filter
    // and walk the FULL scan radius, so a heavy cell hidden by a "Threats only"
    // or min-dBZ filter still gets narrated in the "Elsewhere on Radar"
    // situational-awareness subsection. The user explicitly requested this:
    // "talk about the filtered ones first, then everything in the 80 mi radius."
    const inboundSeen=new Set();
    if(fs.storms&&fs.storms.length){
      for(const s of fs.storms){
        if(!s||s.distance==null||s.bearing==null||s.dbz==null)continue;
        classified.totalCount++;
        let b=s._brief;
        try{if(!b&&typeof calcStormETAForBriefing==='function')b=calcStormETAForBriefing(s);}catch(e){}
        if(b&&b.estDbzAtUser!=null&&b.estDbzAtUser<15){classified.hiddenCount++;continue}
        const c=b?b.classification:'unknown';
        const entry={s,b,tier:c||'unknown'};
        if(b&&(c==='direct'||c==='near_direct'||c==='near_miss')&&b.closingMph>0){
          classified.inbound.push(entry);inboundSeen.add(s);
        }
      }
    }
    // Walk the entire unfiltered scan for non-inbound buckets. Skip cells already
    // surfaced as inbound above to avoid double-counting.
    const allStorms=(typeof S!=='undefined'&&S.storms)?S.storms:[];
    classified.unfilteredTotal=allStorms.length;
    for(const s of allStorms){
      if(!s||inboundSeen.has(s)||s.distance==null||s.bearing==null||s.dbz==null)continue;
      let b=s._brief;
      try{if(!b&&typeof calcStormETAForBriefing==='function')b=calcStormETAForBriefing(s);}catch(e){}
      const c=b?b.classification:'unknown';
      const entry={s,b,tier:c||'unknown'};
      if(b&&(c==='direct'||c==='near_direct'||c==='near_miss')&&b.closingMph>0){
        // Inbound cell that was hidden by the user's filter — surface it as
        // background (situational awareness) so the AI knows it exists.
        classified.background.push({...entry,tier:'miss',_hiddenInbound:true});
      }
      else if(c==='miss'||c==='distant'||c==='far'){classified.background.push(entry)}
      else if(c==='passing'){classified.passing.push(entry)}
      else if(c==='moving_away'){classified.away.push(entry)}
      else{classified.background.push(entry)}
    }
    if(classified.inbound.length||classified.background.length||classified.passing.length||classified.away.length){
      const bandOf=mi=>(mi==null||!isFinite(mi))?99:Math.min(12,Math.floor(mi));
      const order={direct:0,near_direct:1,near_miss:2};
      // Display comparator — matches v4.31 and the Storms tab: miss-band -> tier -> distance.
      // No dBZ tiebreaker here; the strongest-cell guarantee below is a membership-only step.
      const missBandSort=(a,b)=>{
        const bA=bandOf(a.b&&a.b.perpMissMi),bB=bandOf(b.b&&b.b.perpMissMi);
        if(bA!==bB)return bA-bB;
        const oA=order[a.tier]??9,oB=order[b.tier]??9;
        if(oA!==oB)return oA-oB;
        return a.s.distance-b.s.distance;
      };
      classified.inbound.sort(missBandSort);
      classified.background.sort((a,b)=>b.s.dbz-a.s.dbz);
      // Significance filter: <25 dBZ beyond 5 mi is drizzle/clutter — collapse those
      // into a single light-cells summary line so they don't crowd out meaningful cells.
      const SIG=it=>(it.s.dbz>=25)||(it.s.distance<=5);
      const inboundSig=classified.inbound.filter(SIG);
      classified.inboundLight=classified.inbound.filter(it=>!SIG(it));
      // Strongest-cell guarantee: always surface the top 4 by raw dBZ so peak cells
      // (e.g. 55 dBZ at 58 mi) don't get starved by hundreds of close light cells
      // sharing miss-band 0. Fill remaining slots with miss-band order.
      const INBOUND_CAP=12,STRONG_GUARANTEE=4;
      const byDbz=[...inboundSig].sort((a,b)=>(b.s.dbz||0)-(a.s.dbz||0)||a.s.distance-b.s.distance);
      const guaranteed=byDbz.slice(0,STRONG_GUARANTEE);
      const guarSet=new Set(guaranteed.map(it=>it.s));
      const restMissBand=inboundSig.filter(it=>!guarSet.has(it.s));
      const chosen=guaranteed.concat(restMissBand).slice(0,INBOUND_CAP);
      // Display order in the bullets still follows miss-band sort (closest pass first);
      // the guarantee only changes membership, not order.
      chosen.sort(missBandSort);
      const chosenSet=new Set(chosen.map(it=>it.s));
      classified.inboundTop=chosen;
      classified.inboundRest=inboundSig.filter(it=>!chosenSet.has(it.s));
    }else{
      classified.inboundLight=[];
      classified.inboundTop=[];
      classified.inboundRest=[];
    }
    let stab=null,shear=null;
    try{if(typeof getStabilityData==='function')stab=getStabilityData()}catch(e){}
    try{if(typeof getWindShearAnalysis==='function')shear=getWindShearAnalysis()}catch(e){}
    let radarMeta=null;
    if(typeof S!=='undefined'&&S.radarFrames&&S.radarFrames.length){
      const last=S.radarFrames[S.radarFrames.length-1];
      const ageMin=last&&last.time?Math.round((Date.now()/1000-last.time)/60):null;
      radarMeta={frames:S.radarFrames.length,ageMin,scanRadius:S.scanRadius||null};
    }
    return{
      now:new Date(),
      locName:(typeof S!=='undefined'&&S.locName)?S.locName:null,
      metric:!!(typeof S!=='undefined'&&S.radarMetric),
      weather:(typeof S!=='undefined'&&S.weather)?S.weather:null,
      station:(typeof S!=='undefined'&&S.station)?S.station:null,
      alerts:(typeof S!=='undefined'&&S.alerts)?S.alerts:[],
      afd:(typeof S!=='undefined'&&S._afd)?S._afd:null,
      aloft:(typeof S!=='undefined'&&S._aloftData)?S._aloftData:null,
      stab,shear,radarMeta,
      classified
    };
  }

  function _stormLine(item,metric){
    const{s,b,tier}=item;
    const e=_emojiTier(tier);
    const dir=_safeDeg(s.bearing);
    const dist=_fmtDist(s.distance,metric);
    const dbz=_dbzTag(s.dbz);
    if(!b||tier==='unknown')return `${e} ${dbz} cell ${dist} ${dir}, motion unknown.`;
    const closing=b.closingMph!=null?((b.closingMph>=0?'+':'')+b.closingMph+' mph'):'?';
    const miss=b.perpMissMi!=null?b.perpMissMi.toFixed(1)+' mi':'?';
    const estDbz=b.estDbzAtUser;
    const movStr=(b.movSpdMph&&b.movDirDeg!=null)?`, motion ${_safeDeg(b.movDirDeg)} @ ${b.movSpdMph} mph`:'';
    if(tier==='direct'){
      const eta=b.etaMin!=null?`, ETA __~${Math.round(Math.max(0,b.etaMin-((typeof radarAgeMin==='function')?radarAgeMin():5)))} min__ (__${(typeof fmtClock==='function')?fmtClock(new Date(Date.now()+Math.max(0,b.etaMin-((typeof radarAgeMin==='function')?radarAgeMin():5))*60000)):''}__)`:'';
      const estStr=estDbz!=null?`, ~${_dbzTag(estDbz)} expected at you`:'';
      return `${e} ${dbz} cell ${dist} ${dir} closing ${closing}${eta}, projected pass within ${miss}${estStr}${movStr}. **Expect overhead impact.**`;
    }
    if(tier==='near_direct'){
      const eta=b.etaMin!=null?`, ETA __~${Math.round(Math.max(0,b.etaMin-((typeof radarAgeMin==='function')?radarAgeMin():5)))} min__ (__${(typeof fmtClock==='function')?fmtClock(new Date(Date.now()+Math.max(0,b.etaMin-((typeof radarAgeMin==='function')?radarAgeMin():5))*60000)):''}__)`:'';
      const estStr=estDbz!=null?`, ~${_dbzTag(estDbz)} at you`:'';
      return `${e} ${dbz} cell ${dist} ${dir} closing ${closing}${eta}, projected miss ${miss}${estStr}${movStr}. Brief heavy downpour likely.`;
    }
    if(tier==='near_miss'){
      const estStr=estDbz!=null?`, ~${_dbzTag(estDbz)} at you`:'';
      return `${e} ${dbz} cell ${dist} ${dir} closing ${closing}, miss ${miss}${estStr}${movStr}.`;
    }
    return `${e} ${dbz} cell ${dist} ${dir}, miss ${miss}${movStr}.`;
  }

  function _sumLine(label,cells,emoji,trailing,metric){
    if(!cells.length)return null;
    const dbzMin=Math.min(...cells.map(x=>x.s.dbz));
    const dbzMax=Math.max(...cells.map(x=>x.s.dbz));
    const dirs=[...new Set(cells.map(x=>_safeDeg(x.s.bearing)))].slice(0,4);
    const range=dbzMin===dbzMax?_dbzTag(dbzMin):`${_dbzTag(dbzMin)}–${_dbzTag(dbzMax)}`;
    return `- ${emoji} ${label}: ${cells.length} cell${cells.length===1?'':'s'} (${range}) ${dirs.join('/')}${trailing}`;
  }

  function buildOverview(d){
    const lines=['🌐 Situation Overview'];
    const loc=d.locName||'your location';
    lines.push(`Briefing for **${loc}** — ${d.now.toLocaleString()}.`);
    if(d.weather){
      const w=d.weather;
      const parts=[];
      if(w.temperature_2m!=null)parts.push(`temp ${_safeTemp(w.temperature_2m)}`);
      if(w.apparent_temperature!=null&&w.temperature_2m!=null&&Math.abs(w.apparent_temperature-w.temperature_2m)>=2)parts.push(`feels ${_safeTemp(w.apparent_temperature)}`);
      if(w.relative_humidity_2m!=null)parts.push(`${w.relative_humidity_2m}% RH`);
      if(w.wind_speed_10m!=null){
        const wd=w.wind_direction_10m!=null?_safeDeg(w.wind_direction_10m):'';
        const gst=(w.wind_gusts_10m!=null&&w.wind_gusts_10m>w.wind_speed_10m+5)?' gusts '+_safeWind(w.wind_gusts_10m):'';
        parts.push(`wind ${wd} ${_safeWind(w.wind_speed_10m)}${gst}`);
      }
      if(w.pressure_msl!=null)parts.push(`pressure ${_safePres(w.pressure_msl)}`);
      if(w.cloud_cover!=null)parts.push(`${w.cloud_cover}% clouds`);
      if(parts.length)lines.push('Current: '+parts.join(', ')+'.');
    }
    const c=d.classified;
    if(c.totalCount===0){
      lines.push('Radar is [!green]clear[/!] across the scan radius — no precipitation detected.');
    }else if(c.inbound.length===0){
      const bits=[];
      if(c.background.length)bits.push(`${c.background.length} background`);
      if(c.passing.length)bits.push(`${c.passing.length} passing`);
      if(c.away.length)bits.push(`${c.away.length} receding`);
      lines.push(`Radar shows ${c.totalCount} return${c.totalCount===1?'':'s'}, [!green]none on track to impact you[/!]${bits.length?' ('+bits.join(', ')+')':''}.`);
    }else{
      const tc={direct:0,near_direct:0,near_miss:0};
      for(const it of c.inbound)tc[it.tier]++;
      const tcStr=Object.entries(tc).filter(([,n])=>n>0).map(([k,n])=>`${n} ${_labelTier(k)}`).join(', ');
      const peak=Math.max(...c.inbound.map(x=>x.s.dbz));
      const sev=peak>=60?'red':peak>=52?'orange':peak>=41?'yellow':'cyan';
      lines.push(`Radar shows [!${sev}]**${c.inbound.length} inbound cell${c.inbound.length===1?'':'s'}**[/!] (${tcStr}) within 12 mi miss-distance, peak ${_dbzTag(peak)}.`);
    }
    if(d.radarMeta){
      const ageStr=d.radarMeta.ageMin!=null?`${d.radarMeta.ageMin} min old`:'fresh';
      lines.push(`*Radar:* ${d.radarMeta.frames} frames (${ageStr})${d.radarMeta.scanRadius?', scan radius '+_fmtDist(d.radarMeta.scanRadius,d.metric):''}.`);
    }
    // Mirror the "🙈 N cells hidden by filters" badge on the Storms tab so the
    // briefing text reflects exactly what the user is looking at.
    if(c.filterState&&c.hiddenByFilter>0){
      const f=c.filterState;
      const bits=[];
      if((f.minDbz|0)>0)bits.push(`min ${f.minDbz} dBZ`);
      if((f.maxDist|0)>0)bits.push(`max ${f.maxDist} ${d.metric?'km':'mi'}`);
      if(f.approachOnly)bits.push('Approaching only ✓');
      if(f.threatsOnly)bits.push('Threats only ✓');
      const filterStr=bits.length?' ('+bits.join(' · ')+')':'';
      lines.push(`*Storm filter active${filterStr}:* showing **${c.totalCount}** of **${c.totalCells}** cells (${c.hiddenByFilter} hidden by your filters).`);
    }
    if(d.stab){
      const s=d.stab;
      const capeStr=s.cape!=null?`*CAPE* ${s.cape} J/kg`:null;
      const liStr=s.li!=null?`*LI* ${s.li.toFixed(1)}°C`:null;
      const cinStr=s.cin!=null?`CIN ${s.cin} J/kg`:null;
      const sevTag=s.overall>=7?'red':s.overall>=5?'orange':s.overall>=3?'yellow':'cyan';
      const parts=[capeStr,liStr,cinStr].filter(Boolean).join(', ');
      lines.push(`Instability: [!${sevTag}]thunderstorm potential ${s.overall}/10 (${s.risk})[/!]${parts?' — '+parts:''}.`);
    }
    if(d.shear){
      const sev=(d.shear.severity||'').toLowerCase();
      const tag=sev.includes('strong')||sev.includes('extreme')?'orange':sev.includes('moderate')?'yellow':'cyan';
      lines.push(`Wind shear: [!${tag}]${d.shear.vectorShear} (${d.shear.severity})[/!], Δdir ${d.shear.dirDiff}°. ${d.shear.impact}`);
    }
    // v4.59: AFD intentionally omitted from the System (non-AI) briefing.
    // The raw NWS Area Forecast Discussion is a long, technical narrative
    // written for meteorologists — dropping it whole into a deterministic
    // briefing produced the "...[Truncated]" wall the user reported. The
    // AI Briefing still consumes the AFD (with summarization) via the
    // separate buildWeatherContext() path in docs/js/ai.js.
    return lines.join('\n');
  }

  function buildThreats(d){
    const c=d.classified;
    const alerts=d.alerts||[];
    const lines=['⛈️ Active Threats & Storm Tracking'];
    if(c.inbound.length===0&&c.background.length===0&&c.passing.length===0&&c.away.length===0&&!alerts.length){
      lines.push('[!green]No active threats at this time[/!] — radar and NWS alert feeds are clear.');
      return lines.join('\n');
    }
    for(const a of alerts.slice(0,6)){
      const p=a.properties||a;
      const sev=(p.severity||'').toLowerCase();
      const color=sev==='extreme'?'red':sev==='severe'?'orange':sev==='moderate'?'yellow':'cyan';
      const ev=p.event||p.headline||'NWS Alert';
      const ends=p.ends||p.expires;
      let endsStr='';
      if(ends){try{endsStr=` (expires __${new Date(ends).toLocaleString()}__)`;}catch(e){}}
      lines.push(`- ⚠️ [!${color}]${ev}[/!]${endsStr}`);
    }
    // Inbound — SUMMARY, not a per-cell list (v4.85). The full per-cell detail
    // (distance, dBZ, ETA, closing speed) lives on the Storms tab, so the
    // briefing frames the overall band and highlights only the SOONEST (nearest
    // ETA) and STRONGEST (highest dBZ-at-user) cells. A high cell count is a
    // broad rain shield resolved into many returns, NOT many separate storms.
    const inboundLight=c.inboundLight||[];
    const allInbound=c.inbound||[];
    if(allInbound.length){
      const _age=(typeof radarAgeMin==='function')?radarAgeMin():5;
      const _etaOf=(it)=>{const e=it.b&&it.b.etaMin;return e!=null?Math.max(0,e-_age):Infinity;};
      const _strOf=(it)=>{const b=it.b||{};return b.estDbzAtUser!=null?b.estDbzAtUser:it.s.dbz;};
      let soonest=null,strongest=null;
      for(const it of allInbound){
        if(soonest===null||_etaOf(it)<_etaOf(soonest))soonest=it;
        if(strongest===null||_strOf(it)>_strOf(strongest))strongest=it;
      }
      const peak=Math.max(...allInbound.map(x=>x.s.dbz));
      const n=allInbound.length;
      if(n>=15){
        lines.push(`- 🌧️ A broad area of rain (${n} radar returns within one shield, peak ${_dbzTag(peak)}) is moving through your impact corridor — repeated rounds of rain over the next hour, not ${n} separate storms. See Storms tab for the full cell list.`);
      }else{
        lines.push(`- 🌧️ ${n} inbound cell${n===1?'':'s'} in your impact corridor (peak ${_dbzTag(peak)}) — see Storms tab for the full list.`);
      }
      lines.push('- ⏱️ Soonest: '+_stormLine(soonest,d.metric));
      if(strongest&&strongest!==soonest){
        lines.push('- 🔺 Strongest at your location: '+_stormLine(strongest,d.metric));
      }
    }
    if(inboundLight.length){
      const peak=Math.max(...inboundLight.map(x=>x.s.dbz));
      const minD=Math.min(...inboundLight.map(x=>x.s.distance));
      const maxD=Math.max(...inboundLight.map(x=>x.s.distance));
      const dStr=_fmtDist(minD,d.metric)+'–'+_fmtDist(maxD,d.metric);
      lines.push(`- 💧 ${inboundLight.length} light cell${inboundLight.length===1?'':'s'} (sprinkles / drizzle, ≤${_dbzTag(peak)}) tracking through ${dStr} — minor radar reflectivity, not actionable.`);
    }
    // MISS / DISTANT / FAR — background context only, one summary line per tier (no per-cell bullets)
    function _bgTier(label,emoji,cells){
      const sum=_sumLine(label,cells,emoji,' — background context, no direct impact.',d.metric);
      if(sum)lines.push(sum);
    }
    _bgTier('MISS','🔵',c.background.filter(x=>x.tier==='miss'));
    _bgTier('DISTANT','⚪',c.background.filter(x=>x.tier==='distant'));
    _bgTier('FAR','⚫',c.background.filter(x=>x.tier==='far'));
    // Unknown bucket (fallback)
    const unk=c.background.filter(x=>x.tier==='unknown');
    if(unk.length){const sum=_sumLine('UNCLASSIFIED',unk,'⚫',' — motion data unavailable.',d.metric);if(sum)lines.push(sum)}
    // PASSING / MOVING AWAY — one summary line each
    if(c.passing.length){
      const dbzMax=Math.max(...c.passing.map(x=>x.s.dbz));
      const dirs=[...new Set(c.passing.map(x=>_safeDeg(x.s.bearing)))].slice(0,3);
      lines.push(`- 🟡 PASSING: ${c.passing.length} cell${c.passing.length===1?'':'s'} (up to ${_dbzTag(dbzMax)}) tracking past to the ${dirs.join('/')} — outflow possible, no direct hit.`);
    }
    if(c.away.length){
      const dbzMax=Math.max(...c.away.map(x=>x.s.dbz));
      const dirs=[...new Set(c.away.map(x=>_safeDeg(x.s.bearing)))].slice(0,3);
      lines.push(`- 🟢 MOVING AWAY: ${c.away.length} cell${c.away.length===1?'':'s'} (up to ${_dbzTag(dbzMax)}) receding to the ${dirs.join('/')} — [!green]no threat[/!].`);
    }
    return lines.join('\n');
  }

  function buildSafety(d){
    const lines=['🚸 Public Safety & Outdoor Guidance'];
    const c=d.classified;
    const alerts=d.alerts||[];
    const hasExtreme=alerts.some(a=>((a.properties||a).severity||'').toLowerCase()==='extreme');
    const hasSevere=alerts.some(a=>((a.properties||a).severity||'').toLowerCase()==='severe');
    const peak=c.inbound.length?Math.max(...c.inbound.map(x=>x.s.dbz)):0;
    if(hasExtreme||peak>=60){
      lines.push('[!red]**Seek shelter now.**[/!] Severe weather is active or imminent. Stay away from windows, avoid travel, and monitor official alerts.');
    }else if(hasSevere||peak>=52){
      lines.push('[!orange]Strong storms are active.[/!] Move indoors, secure outdoor items, avoid open areas, and delay outdoor activity until the cells pass.');
    }else if(c.inbound.length){
      const top=c.inbound[0];
      const eta=top.b&&top.b.etaMin;
      const _adjEta=eta!=null?Math.max(0,eta-((typeof radarAgeMin==='function')?radarAgeMin():5)):null;
      const etaStr=_adjEta!=null?` (~__${Math.round(_adjEta)} min__ away — arrives __${(typeof fmtClock==='function')?fmtClock(new Date(Date.now()+_adjEta*60000)):''}__)`:'';
      lines.push(`[!yellow]Light to moderate rain is approaching${etaStr}.[/!] Plan around the cell — bring an umbrella, expect a brief downpour, then clearing.`);
    }else{
      lines.push('[!green]Conditions are quiet.[/!] Outdoor activity is fine; no storm-related restrictions.');
    }
    if(d.weather){
      const w=d.weather;
      if(w.temperature_2m!=null&&w.temperature_2m>=32)lines.push('Heat caution: hydrate, take shade breaks, and limit strenuous outdoor exertion during the hottest part of the day.');
      else if(w.temperature_2m!=null&&w.temperature_2m<=-5)lines.push('Cold caution: dress in layers, watch for icy surfaces, and limit exposed-skin time outdoors.');
      if(w.wind_gusts_10m!=null&&w.wind_gusts_10m>=50)lines.push(`Wind caution: gusts to ${_safeWind(w.wind_gusts_10m)} — secure loose objects and use care on high-profile vehicles.`);
    }
    return lines.join('\n');
  }

  function buildAviationMarine(d){
    if(!d.station&&!d.aloft&&!d.weather)return null;
    const lines=['✈️ Aviation & Marine Briefing'];
    const c=d.classified;
    const close=c.inbound.filter(x=>x.s.distance<=30);
    if(close.length){
      lines.push('[!orange]Convective hazards active within ~30 mi:[/!] expect turbulence, windshear, possible IFR in TSRA, and lightning. Avoid cell cores; defer departures until clear.');
    }
    if(d.station){
      const st=d.station;
      const visSM=st.visMeter!=null?(st.visMeter/1609.34):null;
      try{
        if(typeof getFltCatDetail==='function'){
          const fc=getFltCatDetail(visSM,st);
          if(fc&&fc.cat)lines.push(`Flight category: **${fc.cat}**${fc.limit?' ('+fc.limit+')':''}.`);
        }
      }catch(e){}
      if(st.windKmh!=null){
        const wd=st.windDir!=null?_safeDeg(st.windDir):'VRB';
        const knots=Math.round(st.windKmh*0.539957);
        const gstStr=st.gustKmh!=null?`, gusts ${_safeWind(st.gustKmh)} (${Math.round(st.gustKmh*0.539957)} kts)`:'';
        lines.push(`Surface wind ${wd} ${_safeWind(st.windKmh)} (${knots} kts)${gstStr}.`);
      }
    }
    if(d.aloft&&d.aloft.length){
      const pToAlt={1013:'SFC',925:'2,500 ft',850:'5,000 ft',700:'10,000 ft',500:'18,000 ft'};
      const parts=d.aloft.map(a=>`${pToAlt[a.p]||a.p+'hPa'}: ${_safeDeg(a.dir)} ${Math.round(a.spd*0.539957)} kts`);
      lines.push(`*Winds aloft:* ${parts.join(' · ')}.`);
    }
    const w=d.weather;
    if(w&&w.wind_speed_10m!=null){
      const ws=w.wind_speed_10m;
      const wsKts=Math.round(ws*0.539957);
      let marine='';
      if(wsKts>=33)marine=' — [!red]Gale conditions[/!], not safe for small craft.';
      else if(wsKts>=22)marine=' — [!orange]Small Craft Advisory[/!] criteria; reef sails, secure gear.';
      else if(wsKts>=15)marine=' — brisk; expect chop.';
      else marine=' — light to moderate, generally favorable.';
      lines.push(`Marine: surface wind ${_safeWind(ws)} (${wsKts} kts)${marine}`);
      if(close.length)lines.push('[!yellow]Outflow winds and a wind shift may arrive before the storm core[/!] — reduce sail and seek shelter ahead of the visible cell.');
    }
    return lines.length>1?lines.join('\n'):null;
  }

  function buildBottomLine(d){
    const c=d.classified;
    const alerts=d.alerts||[];
    const _sev=a=>((a.properties||a).severity||'').toLowerCase();
    const _ev=a=>((a.properties||a).event||'').trim();
    const hasExtreme=alerts.some(a=>_sev(a)==='extreme');
    const hasSevere=alerts.some(a=>_sev(a)==='severe');
    // A Warning (Tropical Storm / Hurricane / Severe Thunderstorm / Tornado /
    // High Surf etc.) is a call to action regardless of how NWS tags severity.
    const hasWarning=alerts.some(a=>/warning/i.test(_ev(a)));
    const peak=c.inbound.length?Math.max(...c.inbound.map(x=>x.s.dbz)):0;
    // v6.36: the Bottom Line used to only look at inbound cell dBZ + "extreme"
    // alerts, so an active Tropical Storm Warning with no cell on a direct track
    // read as "All quiet" — flatly contradicting the alerts listed right above.
    // Name the most significant active alert so the two agree.
    const _order={extreme:4,severe:3,moderate:2,minor:1,unknown:0};
    let _topAlert=null,_bo=-1;
    for(const a of alerts){const o=_order[_sev(a)]!=null?_order[_sev(a)]:0;if(o>_bo){_bo=o;_topAlert=_ev(a)||_topAlert;}}
    let line;
    if(hasExtreme||peak>=60){
      line='[!red]**Active severe threat — take protective action now.**[/!]'+(_topAlert?` (${_topAlert} in effect)`:'');
    }else if(hasSevere||hasWarning||peak>=52){
      line=`[!orange]**${_topAlert||'Warning'} in effect — heed the alert and be ready to act.**[/!]`;
    }else if(alerts.length){
      line=`[!yellow]${_topAlert||'Advisory'} in effect${c.inbound.length?' — rain on the way too':''}. Review the alerts below and stay weather-aware.[/!]`;
    }else if(c.inbound.length){
      line='[!yellow]Rain is on the way — plan for a wet window then clearing.[/!]';
    }else{
      line='[!green]All quiet — no storm impact expected.[/!]';
    }
    return '⏬ Bottom Line Summary\n'+line;
  }

  function buildSystemBriefing(data){
    try{
      const d=data||gatherBriefingData();
      const out=[buildOverview(d),buildThreats(d),buildSafety(d),buildAviationMarine(d),buildBottomLine(d)].filter(Boolean);
      return out.join('\n\n');
    }catch(e){
      console.error('briefingEngine error',e);
      return '⚠️ Briefing engine error: '+e.message;
    }
  }

  function buildBriefing(){return buildSystemBriefing(gatherBriefingData())}

  if(typeof window!=='undefined'){
    window.gatherBriefingData=gatherBriefingData;
    window.buildSystemBriefing=buildSystemBriefing;
    window.buildBriefing=buildBriefing;
    window.buildBriefingOverview=buildOverview;
    window.buildBriefingThreats=buildThreats;
    window.buildBriefingSafety=buildSafety;
    window.buildBriefingAviationMarine=buildAviationMarine;
    window.buildBriefingBottomLine=buildBottomLine;
  }
})();

// ----- Briefing Mode (System vs AI) -----
function getBriefingMode(){
  const m=localStorage.getItem('st_briefingMode');
  const hasKey=(typeof getActiveAIKey==='function')?!!getActiveAIKey():false;
  if(m==='ai'&&hasKey)return 'ai';
  return 'system';
}
function getBriefingModePref(){return localStorage.getItem('st_briefingMode')||'system'}
function saveBriefingMode(v){
  const next=(v==='ai')?'ai':'system';
  localStorage.setItem('st_briefingMode',next);
  if(typeof syncBriefingModeUI==='function')syncBriefingModeUI();
}
function syncBriefingModeUI(){
  const wrap=document.getElementById('settings-briefing-mode-wrap');
  if(!wrap)return;
  const hasKey=(typeof getActiveAIKey==='function')?!!getActiveAIKey():false;
  const pref=getBriefingModePref();
  const btns=wrap.querySelectorAll('button[data-mode]');
  btns.forEach(b=>{
    const m=b.getAttribute('data-mode');
    const active=(m===pref);
    const aiDisabled=(m==='ai'&&!hasKey);
    b.disabled=aiDisabled;
    b.style.opacity=aiDisabled?'0.45':'1';
    b.style.cursor=aiDisabled?'not-allowed':'pointer';
    b.style.background=active?(m==='ai'?'rgba(168,85,247,0.18)':'rgba(0,229,255,0.18)'):'rgba(255,255,255,0.04)';
    b.style.borderColor=active?(m==='ai'?'#a855f7':'#00e5ff'):'var(--border-subtle)';
    b.style.color=active?(m==='ai'?'#a855f7':'#00e5ff'):'var(--text-muted)';
    b.title=aiDisabled?'Add an AI API key below to enable AI Briefing':'';
  });
  const hint=document.getElementById('briefing-mode-hint');
  if(hint){
    hint.textContent=hasKey
      ? 'System Briefing is instant and on-device. AI Briefing uses your selected AI provider for natural-language reasoning.'
      : 'System Briefing runs on-device with no API key required. Add an AI key below to unlock AI Briefing.';
  }
}

// Single entrypoint for the full briefing panel.
// Honors the briefing mode toggle. If user prefers AI but key is missing,
// silently falls back to System and prepends a visible notice.
async function runFullBriefing(){
  const pref=getBriefingModePref();
  const hasKey=(typeof getActiveAIKey==='function')?!!getActiveAIKey():false;
  const effective=(pref==='ai'&&hasKey)?'ai':'system';
  const fellBack=(pref==='ai'&&!hasKey);
  if(effective==='system'){
    if(typeof addAIMsg==='function')addAIMsg('user','Full weather briefing');
    let reply=(typeof buildBriefing==='function')?buildBriefing():'Briefing engine not loaded.';
    if(fellBack){
      reply='[!yellow]Using System Briefing — no AI API key is configured.[/!] Add a key in Settings to enable AI Briefing.\n\n'+reply;
    }else{
      reply='[!cyan]System Briefing (deterministic, on-device).[/!]\n\n'+reply;
    }
    if(typeof addAIMsg==='function')addAIMsg('assistant',reply);
    return;
  }
  // AI mode — defer to the AI chat path, but as a DEDICATED briefing request:
  // no prior chat history (so the briefing can't be tugged by earlier
  // conversation) and a low temperature (so it sticks to the supplied data
  // instead of wandering into extra certainty). See sendAIChat({briefing:true}).
  const inp=document.getElementById('ai-chat-input');
  if(inp)inp.value='Give me a full weather analysis with risk assessment';
  if(typeof sendAIChat==='function')await sendAIChat({briefing:true});
}

if(typeof window!=='undefined'){
  window.getBriefingMode=getBriefingMode;
  window.getBriefingModePref=getBriefingModePref;
  window.saveBriefingMode=saveBriefingMode;
  window.syncBriefingModeUI=syncBriefingModeUI;
  window.runFullBriefing=runFullBriefing;
}
