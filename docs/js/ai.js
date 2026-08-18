// ==========================================
// AI WEATHER ASSISTANT
// ==========================================
const _aiChatHistory=[];
let _aiChatOpen=false;

function saveAIKey(v){
  const t=(v||'').trim();
  // v6.35: a Claude key (sk-ant-…) pasted into the OpenAI field is the #1 setup
  // mistake — OpenAI is the default provider, so on a fresh device its field is
  // the only one shown, and the key then fails against OpenAI's API as "invalid".
  // Auto-route it to the Claude slot and switch the provider instead.
  if(/^sk-ant-/i.test(t)){
    localStorage.setItem('st_aiKeyAnthropic',t);
    const ael=document.getElementById('settings-ai-key-anthropic');if(ael)ael.value=t;
    const oel=document.getElementById('settings-ai-key');if(oel)oel.value='';
    const sel=document.getElementById('settings-ai-provider');if(sel)sel.value='anthropic';
    if(typeof saveAIProvider==='function')saveAIProvider('anthropic'); // applies provider UI + syncs key state
    else{localStorage.setItem('st_aiProvider','anthropic');_syncAiKeyState();}
    return;
  }
  localStorage.setItem('st_aiKey',t);_syncAiKeyState();if(typeof syncPushAlerts==='function')syncPushAlerts();
}
function saveAITone(v){localStorage.setItem('st_aiTone',v);}
function saveAIDetail(v){localStorage.setItem('st_aiDetail',v);}
function saveAIModel(v){localStorage.setItem('st_aiModel',v);}
function getAIKey(){return localStorage.getItem('st_aiKey')||'';}
function getAITone(){return localStorage.getItem('st_aiTone')||'professional';}
function getAIDetail(){return localStorage.getItem('st_aiDetail')||'standard';}
const _AI_MODELS=['gpt-4o-mini','gpt-4o','gpt-4.1-mini','gpt-4.1'];
function getAIModel(){const m=localStorage.getItem('st_aiModel');return _AI_MODELS.includes(m)?m:'gpt-4o-mini';}
// ----- Provider selection (OpenAI default, Claude/Anthropic secondary) -----
function getAIProvider(){return localStorage.getItem('st_aiProvider')==='anthropic'?'anthropic':'openai';}
function getAIProviderLabel(){return getAIProvider()==='anthropic'?'Claude':'OpenAI';}
function saveAIProvider(v){const next=v==='anthropic'?'anthropic':'openai';const changed=next!==getAIProvider();localStorage.setItem('st_aiProvider',next);
  // A push-specific key override (st_pushAiKey) is provider-agnostic; on a real
  // provider switch it is now the wrong provider's key, so clear it and let
  // background alerts fall back to the new provider's in-app key.
  if(changed){try{localStorage.removeItem('st_pushAiKey');}catch(e){}}
  _applyAIProviderUI();_syncAiKeyState();if(typeof _applyAIPanelMode==='function')_applyAIPanelMode();if(typeof renderPushAlertSettings==='function'){try{renderPushAlertSettings();}catch(e){}}if(typeof syncPushAlerts==='function')syncPushAlerts();}
function saveAnthropicKey(v){const t=(v||'').trim();localStorage.setItem('st_aiKeyAnthropic',t);_syncAiKeyState();if(typeof syncPushAlerts==='function')syncPushAlerts();}
function getAnthropicKey(){return localStorage.getItem('st_aiKeyAnthropic')||'';}
// v6.35: valid Anthropic model IDs only. Haiku uses its canonical DATED id
// (the undated 'claude-haiku-4-5' alias 404s), and 'claude-sonnet-4-6' was
// removed — it's not a real model, so selecting it errored. A stale persisted
// value now falls back to the Haiku default via the includes() check below.
const _AI_MODELS_ANTHROPIC=['claude-haiku-4-5-20251001','claude-sonnet-5','claude-opus-4-8'];
function saveAnthropicModel(v){localStorage.setItem('st_aiModelAnthropic',v);}
function getAnthropicModel(){const m=localStorage.getItem('st_aiModelAnthropic');return _AI_MODELS_ANTHROPIC.includes(m)?m:'claude-haiku-4-5-20251001';}
// Active (provider-aware) key/model — the single source every AI call site reads.
function getActiveAIKey(){return getAIProvider()==='anthropic'?getAnthropicKey():getAIKey();}
function getActiveAIModel(){return getAIProvider()==='anthropic'?getAnthropicModel():getAIModel();}
// Shared post-key-change sync: force the on-device briefing when the ACTIVE
// provider has no key, refresh the FAB, and re-render the briefing-mode UI.
function _syncAiKeyState(){if(!getActiveAIKey())localStorage.setItem('st_briefingMode','system');updateAIFab();if(typeof syncBriefingModeUI==='function')syncBriefingModeUI();}
// Show only the selected provider's key + model rows in Settings.
function _applyAIProviderUI(){const p=getAIProvider();const ow=document.getElementById('settings-ai-openai-wrap');const aw=document.getElementById('settings-ai-anthropic-wrap');if(ow)ow.style.display=(p==='anthropic')?'none':'';if(aw)aw.style.display=(p==='anthropic')?'':'none';}
function toggleAIKeyVis(id){
  const inp=document.getElementById(id||'settings-ai-key');
  if(inp)inp.type=inp.type==='password'?'text':'password';
}
function updateAIFab(){
  const fab=document.getElementById('ai-fab');
  if(fab)fab.style.display='block';
}
function syncAISettings(){
  const prov=document.getElementById('settings-ai-provider');
  if(prov)prov.value=getAIProvider();
  const inp=document.getElementById('settings-ai-key');
  if(inp)inp.value=getAIKey();
  const inpA=document.getElementById('settings-ai-key-anthropic');
  if(inpA)inpA.value=getAnthropicKey();
  const tone=document.getElementById('settings-ai-tone');
  if(tone)tone.value=getAITone();
  const detail=document.getElementById('settings-ai-detail');
  if(detail)detail.value=getAIDetail();
  const model=document.getElementById('settings-ai-model');
  if(model)model.value=getAIModel();
  const modelA=document.getElementById('settings-ai-model-anthropic');
  if(modelA)modelA.value=getAnthropicModel();
  _applyAIProviderUI();
  const sk=document.getElementById('settings-skylink-key');
  if(sk&&typeof getSkylinkKey==='function')sk.value=getSkylinkKey();
  const lk=document.getElementById('settings-lightning-key');
  if(lk&&typeof getLightningKey==='function')lk.value=getLightningKey();
  const ls=document.getElementById('settings-lightning-source');
  if(ls&&typeof getLightningSource==='function')ls.value=getLightningSource();
  if(typeof _ltgSetStatus==='function')_ltgSetStatus();   // v6.63: last lightning-source outcome (live / quota / rejected)
  if(typeof _ltgZoneSyncUI==='function')_ltgZoneSyncUI(); // v6.68: real-time zone mode + status
  if(typeof syncBriefingModeUI==='function')syncBriefingModeUI();
  _refreshLiveUsers();   // v6.67: community counts at the bottom of Settings
}
// v6.67: live-user line at the bottom of Settings — anonymous counts from the
// worker's GET /stats (salted daily IP hashes server-side; no accounts, no
// cookies, no raw IPs — see worker/index.js). Hidden entirely when the worker
// doesn't answer (old deploy / offline), throttled to one fetch per minute to
// match the endpoint's own 60 s edge cache.
let _liveUsersAt=0;
async function _refreshLiveUsers(){
  const el=document.getElementById('live-users-line');
  if(!el)return;
  const now=Date.now();
  if(now-_liveUsersAt<60000)return;
  _liveUsersAt=now;
  try{
    const base=(typeof _pushApiUrl==='function')?_pushApiUrl():'https://stormtracker-proxy.joshua-622.workers.dev';
    const opts={};
    if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)opts.signal=AbortSignal.timeout(6000);
    const r=await fetch(base+'/stats',opts);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const j=await r.json();
    if(!j||!j.today)throw new Error('bad shape');
    el.textContent=`🟢 ${j.activeNow} active now · ${j.today.users} device${j.today.users!==1?'s':''} today`;
    el.title='Anonymous counts — distinct devices via a daily-rotating hash, no IPs or accounts stored.';
    el.style.display='block';
  }catch(e){el.style.display='none';_liveUsersAt=0}
}
function clearAIChat(){
  _aiChatHistory.length=0;
  const msgs=document.getElementById('ai-chat-messages');
  if(msgs)msgs.innerHTML='';
  addAIMsg('system','🤖 AI Weather Assistant ready. Ask me anything about the current weather, storms, or conditions at your location.');
}
function toggleAIChat(){
  const o=document.getElementById('ai-chat-overlay');
  if(!o)return;
  _aiChatOpen=!_aiChatOpen;
  o.style.display=_aiChatOpen?'block':'none';
  if(_aiChatOpen){
    _applyAIPanelMode();
  }
}
// v4.60: panel has two distinct modes driven entirely by the presence
// (or absence) of an OpenAI API key. When there's no key the chat input,
// quick-questions, and Send button are all dead weight — every button
// except "Full briefing" just produces the "No API key configured" error.
// So we collapse the panel down to a single auto-rendered Built-in
// Summary, retitle the header, hide the dead controls, and expose a
// ♻️ refresh button in their place. When a key IS present the original
// full chat UI is restored.
function _applyAIPanelMode(){
  const hasKey=(typeof getActiveAIKey==='function')?!!getActiveAIKey():false;
  const title=document.getElementById('ai-header-title');
  const icon=document.getElementById('ai-header-icon');
  const refreshBtn=document.getElementById('ai-refresh-btn');
  const clearBtn=document.getElementById('ai-clear-btn');
  const qq=document.getElementById('ai-quick-questions');
  const inputRow=document.getElementById('ai-input-row');
  const msgs=document.getElementById('ai-chat-messages');
  if(hasKey){
    if(title)title.textContent='AI Weather Assistant';
    if(icon)icon.textContent='🤖';
    if(refreshBtn)refreshBtn.style.display='none';
    if(clearBtn)clearBtn.style.display='';
    if(qq)qq.style.display='';
    if(inputRow)inputRow.style.display='';
    if(msgs&&!msgs.children.length){
      addAIMsg('system','🤖 AI Weather Assistant ready. Ask me anything about the current weather, storms, or conditions at your location.');
    }
    setTimeout(()=>{const inp=document.getElementById('ai-chat-input');if(inp)inp.focus()},200);
  }else{
    if(title)title.textContent='Built-in Summary Assistant (NO AI)';
    if(icon)icon.textContent='📋';
    if(refreshBtn)refreshBtn.style.display='';
    if(clearBtn)clearBtn.style.display='none';
    if(qq)qq.style.display='none';
    if(inputRow)inputRow.style.display='none';
    // Auto-run the deterministic briefing on every open so the user
    // always sees a fresh snapshot without clicking anything.
    refreshSummaryBriefing();
  }
}
// Re-render the built-in summary in place. Clears prior content first
// so each refresh is a clean snapshot (no scroll-back through stale
// briefings) and the ♻️ press feels instant.
function refreshSummaryBriefing(){
  const msgs=document.getElementById('ai-chat-messages');
  if(msgs)msgs.innerHTML='';
  if(typeof buildBriefing==='function'){
    const reply='[!cyan]Built-in Summary (deterministic, on-device · no AI).[/!]\n\n'+buildBriefing();
    addAIMsg('assistant',reply);
  }else{
    addAIMsg('error','Briefing engine not loaded yet — try again in a moment.');
  }
}
if(typeof window!=='undefined'){
  window.refreshSummaryBriefing=refreshSummaryBriefing;
}
function fmtAIText(raw){
  let s=raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  s=s.replace(/__(.+?)__/g,'<u>$1</u>');
  const _aiColors={red:'#ff3355',orange:'#f97316',yellow:'#eab308',green:'#22c55e',cyan:'#00e5ff'};
  s=s.replace(/\[!\s*(red|orange|yellow|green|cyan)\s*\]([\s\S]+?)\[\/!\]/gi,(m,c,t)=>`<span style="color:${_aiColors[c.toLowerCase()]};font-weight:600">${t}</span>`);
  // v4.62: dbz regex widened to accept ranges (`[!dbz:45-55]`), decimals,
  // whitespace, and case variants the model sometimes emits. Anything that
  // still slips past the structured passes is stripped by the final
  // defensive sweep at the end of this function so raw markup like
  // "[!dbz:55]" or "[/!]" can never leak into the rendered briefing.
  // v4.89: when the tag carries a RANGE (e.g. [!dbz:35-55]), color the phrase
  // by the MAX (high end) so "35–55 dBZ" renders red (55), not green (35).
  s=s.replace(/\[!\s*dbz\s*:\s*(-?\d+(?:\.\d+)?)(?:\s*[-–]\s*(-?\d+(?:\.\d+)?))?\s*\]([\s\S]+?)\[\/!\]/gi,(m,lo,hi,t)=>{const v=(hi!=null&&hi!=='')?Math.max(parseFloat(lo),parseFloat(hi)):parseFloat(lo);const c=(typeof dbzHex==='function')?dbzHex(v):'#888';return `<span style="color:${c};font-weight:600">${t}</span>`;});
  s=s.replace(/\*\*\*(.+?)\*\*\*/g,'<b><i>$1</i></b>');
  s=s.replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  s=s.replace(/\*(.+?)\*/g,'<i>$1</i>');
  s=s.replace(/^### (.+)$/gm,'<span style="display:block;font-weight:700;font-size:0.95em;color:var(--accent-cyan);margin-top:8px">$1</span>');
  s=s.replace(/^## (.+)$/gm,'<span style="display:block;font-weight:700;font-size:1em;color:var(--accent-cyan);margin-top:8px">$1</span>');
  s=s.replace(/^# (.+)$/gm,'<span style="display:block;font-weight:800;font-size:1.05em;color:var(--accent-cyan);margin-top:8px">$1</span>');
  s=s.replace(/^[-•] (.+)$/gm,'<span style="display:block;padding-left:12px;text-indent:-10px">• $1</span>');
  s=s.replace(/^\d+\.\s+(.+)$/gm,function(m,p1,offset,str){return '<span style="display:block;padding-left:12px">'+m+'</span>'});
  // v6.11: render markdown tables (| a | b |) as a compact mobile card grid — the
  // model uses one for the Risk Assessment summary and raw "| pipes |" look bad.
  s=s.replace(/(?:^[ \t]*\|.*\|[ \t]*(?:\n|$))+/gm, block=>{
    const rows=block.trim().split('\n').map(r=>r.trim()).filter(Boolean);
    const cells=rows.map(r=>r.replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim()));
    const isSep=r=>r.length&&r.every(c=>/^:?-{2,}:?$/.test(c));
    const data=cells.filter(r=>!isSep(r));
    if(data.length<2)return block; // need a header + at least one data row
    const header=data[0], body=data.slice(1);
    const _sevColor=v=>{const t=(v||'').toLowerCase();if(/sever|extreme|critical|\bhigh\b/.test(t))return '#ff3355';if(/moderate|elevated/.test(t))return '#eab308';if(/margin|\blow\b|minimal/.test(t))return '#22c55e';return 'var(--text-secondary,#9fb0c3)';};
    let html='<div style="display:flex;flex-direction:column;gap:6px;margin:8px 0">';
    for(const r of body){
      if(!r[0])continue;
      html+='<div style="border:1px solid var(--border-subtle,#243040);border-radius:8px;padding:7px 10px;background:rgba(255,255,255,0.02)">';
      html+=`<div style="font-weight:700;margin-bottom:2px">${r[0]}</div>`;
      const bits=[];
      for(let i=1;i<header.length;i++){
        if(r[i]==null||r[i]==='')continue;
        const isSev=/sever/i.test(header[i]||'');
        const val=isSev?`<span style="color:${_sevColor(r[i])};font-weight:600">${r[i]}</span>`:r[i];
        bits.push(`<span><span style="color:var(--text-muted,#7a8699)">${header[i]}:</span> ${val}</span>`);
      }
      html+=`<div style="font-size:0.9em;line-height:1.45;display:flex;flex-direction:column;gap:1px">${bits.join('')}</div></div>`;
    }
    return html+'</div>';
  });
  // horizontal rule (the model sometimes emits a bare "---" divider line)
  s=s.replace(/^\s*---+\s*$/gm,'<hr style="border:none;border-top:1px solid var(--border-subtle,#243040);margin:8px 0">');
  // v6.09: make the "N/10 thunderstorm potential" index tappable — opens a clean
  // explainer of how StormTracker scores it (keeps the math out of the prose).
  s=s.replace(/(\d{1,2}\s*\/\s*10\s+thunderstorm potential|thunderstorm potential[:\s]*\(?\s*\d{1,2}\s*\/\s*10\)?)/gi, m=>`<span onclick="if(typeof showTstormIndexInfo==='function')showTstormIndexInfo()" style="cursor:pointer;border-bottom:1px dotted currentColor" title="How is this scored?">${m} ⓘ</span>`);
  // v4.62: defensive sweep — strip any orphan [!...]/[/!] tokens that
  // survived the structured replacements above (e.g. mismatched pairs,
  // unknown tag names, or markup the model invented). Without this the
  // raw markup leaks into the user's briefing as "[!dbz:..." gibberish.
  s=s.replace(/\[!\s*[^\]]*\]/g,'').replace(/\[\/!\]/g,'');
  return s;
}
function stripAIMarkup(raw){
  // v4.62: tolerant of the same range/whitespace variants fmtAIText
  // handles, plus a final defensive sweep that nukes any remaining
  // [!...]/[/!] tokens so the copied-to-clipboard text is always clean.
  return String(raw||'')
    .replace(/\[!\s*dbz\s*:[^\]]+\]([\s\S]+?)\[\/!\]/gi,'$1')
    .replace(/\[!\s*(red|orange|yellow|green|cyan)\s*\]([\s\S]+?)\[\/!\]/gi,'$2')
    .replace(/\[!\s*[^\]]*\]/g,'')
    .replace(/\[\/!\]/g,'')
    .replace(/__(.+?)__/g,'$1')
    .replace(/\*\*\*(.+?)\*\*\*/g,'$1')
    .replace(/\*\*(.+?)\*\*/g,'$1')
    .replace(/\*(.+?)\*/g,'$1');
}
function addAIMsg(role,text){
  const c=document.getElementById('ai-chat-messages');if(!c)return;
  const d=document.createElement('div');
  d.className='ai-msg '+role;
  if(role==='assistant'){
    d.dataset.rawText=text;
    d.innerHTML=`<div class="ai-msg-actions"><button class="ai-copy-btn" onclick="copyAIMsg(this)" title="Copy to clipboard">📋</button></div>`+fmtAIText(text);
  }else{
    d.textContent=text;
  }
  c.appendChild(d);
  c.scrollTop=c.scrollHeight;
}
function copyAIMsg(btn){
  const msg=btn.closest('.ai-msg');if(!msg)return;
  const raw=msg.dataset.rawText||msg.textContent;
  const header=`StormTracker Weather Briefing\n${S.locName||'Unknown Location'} — ${new Date().toLocaleString()}\n${'─'.repeat(40)}\n\n`;
  const fullText=header+stripAIMarkup(raw);
  navigator.clipboard.writeText(fullText).then(()=>{
    btn.textContent='✅';setTimeout(()=>{btn.textContent='📋'},1500);
  }).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=fullText;ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta);ta.select();document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent='✅';setTimeout(()=>{btn.textContent='📋'},1500);
  });
}
function showAITyping(){
  const c=document.getElementById('ai-chat-messages');if(!c)return;
  const d=document.createElement('div');d.className='ai-typing';d.id='ai-typing-ind';
  d.innerHTML='<span></span><span></span><span></span>';
  c.appendChild(d);c.scrollTop=c.scrollHeight;
}
function hideAITyping(){const e=document.getElementById('ai-typing-ind');if(e)e.remove();_stopAICountdown();}
// v4.59: visible status/countdown shown alongside the typing dots so the user
// knows the request is still in flight, how long until it times out, and
// which retry attempt is running. Replaces the silent "no response" wait the
// user hit on spotty data.
function _showAIStatus(text){
  const c=document.getElementById('ai-chat-messages');if(!c)return;
  let el=document.getElementById('ai-status-ind');
  if(!el){
    el=document.createElement('div');
    el.id='ai-status-ind';
    el.style.cssText='font-size:0.72em;color:var(--text-muted);font-style:italic;padding:4px 12px;margin-top:-4px';
    c.appendChild(el);
  }
  el.textContent=text;
  c.scrollTop=c.scrollHeight;
}
function _hideAIStatus(){const e=document.getElementById('ai-status-ind');if(e)e.remove();}
let _aiCountdownTimer=null;
function _startAICountdown(seconds,attempt,maxAttempts){
  _stopAICountdown();
  let s=seconds;
  const update=()=>_showAIStatus(`Attempt ${attempt}/${maxAttempts} · ${s}s remaining…`);
  update();
  _aiCountdownTimer=setInterval(()=>{s--;if(s<=0){_stopAICountdown();return}update()},1000);
}
function _stopAICountdown(){if(_aiCountdownTimer){clearInterval(_aiCountdownTimer);_aiCountdownTimer=null}_hideAIStatus()}
function aiQuickQ(q){
  const inp=document.getElementById('ai-chat-input');
  if(inp)inp.value=q;
  sendAIChat();
}

// v6.36: the per-cell marker the AI sees (and echoes) is now keyed to rain
// INTENSITY, not track proximity. The old proximity emoji painted a 25 dBZ
// drizzle cell 🔴 red just because its track pointed at you, which reads as
// "severe" to anyone scanning. Proximity is carried in words (ETA + miss)
// instead. 🔵 light · 🟢 moderate · 🟡 heavy · 🟠 very intense · 🔴 extreme.
function _dbzEmoji(dbz){
  if(dbz==null||isNaN(dbz))return'⚪';
  if(dbz>=65)return'🔴';
  if(dbz>=55)return'🟠';
  if(dbz>=45)return'🟡';
  if(dbz>=31)return'🟢';
  return'🔵';
}

// v6.37: compute the user's quadrant relative to a tropical system's MOTION,
// in code, so the AI never has to infer right-front/left-front geometry from
// prose (it got it wrong before — calling a NNW-of-center user "right-front, NE
// of center"). Tornado risk in tropical systems peaks in the RIGHT-FRONT
// quadrant. Returns {quadrant, confidence, userDir, note} or null.
const _QUAD_COMPASS={N:0,NNE:22.5,NE:45,ENE:67.5,E:90,ESE:112.5,SE:135,SSE:157.5,S:180,SSW:202.5,SW:225,WSW:247.5,W:270,WNW:292.5,NW:315,NNW:337.5};
function _tropicalQuadrant(sys){
  if(!sys||sys.lat==null||sys.lon==null||S.lat==null||S.lon==null||typeof bearingDeg!=='function')return null;
  const compass=(typeof _COMPASS!=='undefined')?_COMPASS:_QUAD_COMPASS;
  const motion=compass[String(sys.moveDir||'').toUpperCase().trim()];
  const spd=parseFloat(sys.moveSpeed);
  const brgToUser=bearingDeg(sys.lat,sys.lon,S.lat,S.lon); // storm center → user
  const userDir=(typeof degToDir==='function')?degToDir(brgToUser):null;
  // Motion unknown or quasi-stationary → the quadrant is undefined (no reliable
  // "front"). Say so rather than guessing.
  if(motion==null||!isFinite(spd)||spd<3){
    return {quadrant:'uncertain',confidence:'low',userDir,
      note:(motion==null?'storm motion not published':'storm nearly stationary ('+(isFinite(spd)?spd:'?')+' mph), so front/rear is undefined')};
  }
  const rel=((brgToUser-motion)%360+540)%360-180; // [-180,180]; + = right of motion, 0 = dead ahead
  let quadrant;
  if(rel>=0&&rel<90)quadrant='right-front';
  else if(rel>=90)quadrant='right-rear';
  else if(rel<=-90)quadrant='left-rear';
  else quadrant='left-front';
  // Near an axis (front/rear/left/right boundary) → lower confidence + a note.
  const nearAxis=Math.min(Math.abs(rel),Math.abs(Math.abs(rel)-90),Math.abs(Math.abs(rel)-180));
  const confidence=nearAxis<15?'moderate':'high';
  let note=null;
  if(Math.abs(rel)<15)note='nearly dead ahead of the storm (on the front axis)';
  else if(Math.abs(Math.abs(rel)-180)<15)note='nearly directly behind the storm (rear axis)';
  else if(Math.abs(Math.abs(rel)-90)<15)note='nearly abeam the storm (side)';
  return {quadrant,confidence,userDir,rel:Math.round(rel),note};
}

function buildWeatherContext(){
  const parts=[];
  const now=new Date();
  parts.push(`Current time: ${now.toLocaleString()}`);
  if(S.locName)parts.push(`Location: ${S.locName} (${S.lat?.toFixed(4)}, ${S.lon?.toFixed(4)})`);
  parts.push(`Scan radius: ${S.radarMetric?(S.scanRadius*1.60934).toFixed(0)+' km':S.scanRadius+' miles'}`);
  parts.push(`USER UNITS: temperature=${TEMP_UNITS[S.tempUnit]}, wind=${WIND_UNITS[S.windUnit]}, pressure=${PRES_UNITS[S.presUnit]}, visibility=${VIS_UNITS[S.visUnit]}, precipitation=${PRECIP_UNITS[S.precipUnit]}, distance=${S.radarMetric?'km':'mi'}`);

  try{
  if(S.weather){
    const w=S.weather;
    const tempC=w.temperature_2m;
    const feelsC=w.apparent_temperature;
    const humid=w.relative_humidity_2m;
    const windKmh=w.wind_speed_10m;
    const windDeg=w.wind_direction_10m;
    const windDir=windDeg!=null?degToDir(windDeg)+' ('+Math.round(windDeg)+'°)':null;
    const gustKmh=w.wind_gusts_10m;
    const precip=w.precipitation;
    const cloud=w.cloud_cover;
    const pres=w.pressure_msl||w.surface_pressure;
    const isDay=w.is_day;
    const nwsDesc=w._nwsDesc;
    const src=w._source||'Open-Meteo';
    parts.push(`\nCURRENT CONDITIONS (source: ${src}):`);
    if(tempC!=null)parts.push(`  Temperature: ${fmtTemp(tempC)}`);
    if(feelsC!=null)parts.push(`  Feels like: ${fmtTemp(feelsC)}`);
    if(humid!=null)parts.push(`  Humidity: ${humid}%`);
    if(windKmh!=null)parts.push(`  Wind: ${windDir||'?'} at ${fmtWind(windKmh)}${gustKmh!=null?' gusts '+fmtWind(gustKmh):''}`);
    if(pres!=null)parts.push(`  Pressure: ${fmtPres(pres)}`);
    if(precip!=null)parts.push(`  Precipitation: ${fmtPrecip(precip)}`);
    if(cloud!=null)parts.push(`  Cloud cover: ${cloud}%`);
    if(S._nwsVisM!=null)parts.push(`  Visibility: ${fmtVis(S._nwsVisM/1609.34)}`);
    if(nwsDesc){
      // v5.80: nwsDesc is the nearest METAR station's present-weather (can be ~10 mi
      // away). If it reports precip but radar shows nothing >=25 dBZ over the user,
      // flag it as the station's report, not overhead — the "RAIN OVER YOU RIGHT NOW"
      // line below is authoritative for the user's exact spot.
      const _dP=/rain|snow|drizzle|thunder|storm|shower|sleet|hail|freezing/i.test(nwsDesc);
      const _clear=(typeof rainOverUserNow==='function')&&!rainOverUserNow()&&(precip==null||precip<0.1);
      parts.push(`  Conditions: ${nwsDesc}${(_dP&&_clear)?` (nearest station report — NOT confirmed over the user; radar shows no rain overhead)`:''}`);
    }
    if(isDay!=null)parts.push(`  Day/Night: ${isDay?'Daytime':'Nighttime'}`);
  }else{
    parts.push('\nCurrent conditions: Data not yet loaded. Weather may still be fetching.');
  }

  // RAIN OVER YOU RIGHT NOW — the SINGLE authoritative "is it raining at the user's
  // exact spot" fact, from the same oracle the hero card and Rain Clock use
  // (rainOverUserNow -> 25 dBZ overhead floor). Without this the AI was inferring
  // "currently experiencing heavy thunderstorms/heavy rain" from inbound cells +
  // humidity even when nothing >=25 dBZ was actually overhead. This line is the
  // ground truth: describe CURRENT conditions from it, not from the inbound set.
  try{
    const _now=(typeof rainOverUserNow==='function')?rainOverUserNow():null;
    const _rc=S._rainClockData;
    const _nrst=(_rc&&_rc.nearest&&_rc.nearest.mi!=null)
      ?(()=>{const nm=S.radarMetric?(_rc.nearest.mi*1.60934).toFixed(1)+' km':_rc.nearest.mi.toFixed(1)+' mi';return ` Nearest actual rain (>=25 dBZ) is ${nm} to the ${_rc.nearest.dir}.`;})()
      :'';
    if(_now&&_now.maxDbz!=null){
      parts.push(`\nRAIN OVER YOU RIGHT NOW: YES — ${_now.label} (~${Math.round(_now.maxDbz)} dBZ) is directly overhead (within 1.5 mi).${_nrst}`);
    }else{
      parts.push(`\nRAIN OVER YOU RIGHT NOW: NO — nothing >=25 dBZ is over your exact location; it is NOT currently raining at your spot.${_nrst} Do NOT describe current/overhead rain or "you're experiencing rain now"; any rain is inbound/forecast (see RAIN NOWCAST and STORM CONTEXT). Radar echo can sit nearby without rain reaching you.`);
    }
  }catch(e){}

  if(S.station){
    const st=S.station;
    parts.push(`\nMETAR STATION DATA (${S.stationId||'unknown'}):`);
    if(st.rawMETAR)parts.push(`  Raw METAR: ${st.rawMETAR}`);
    if(st.name)parts.push(`  Station: ${st.name}`);
    if(st.temp!=null)parts.push(`  METAR Temp: ${fmtTemp(st.temp)}`);
    if(st.dewp!=null)parts.push(`  Dew point: ${fmtTemp(st.dewp)}`);
    if(st.windKmh!=null){
      const wDir=st.windDir!=null?degToDir(st.windDir):'VRB';
      parts.push(`  METAR Wind: ${wDir} at ${fmtWind(st.windKmh)}${st.gustKmh!=null?' gusts '+fmtWind(st.gustKmh):''}`);
    }
    if(st.visMeter!=null)parts.push(`  Visibility: ${fmtVis(st.visMeter/1609.34)}`);
    if(st.presPa!=null)parts.push(`  Pressure: ${fmtPres(st.presPa/100)}`);
    const visSM=st.visMeter!=null?(st.visMeter/1609.34):null;
    const fltInfo=getFltCatDetail(visSM,st);
    if(fltInfo)parts.push(`  Flight category: ${fltInfo.cat}`);
    if(st.wxString)parts.push(`  Weather: ${st.wxString}`);
    if(st.clouds&&st.clouds.length){
      const cStr=st.clouds.map(c=>`${c.amount||'?'} at ${c.base?.value!=null?fmtAlt(c.base.value*3.28084):'?'}`).join(', ');
      parts.push(`  Cloud layers: ${cStr}`);
    }
  }

  // LIGHTNING — real observed strikes (WarPulse ground network or GOES GLM
  // satellite, last 15 min). Only present when a source has fresh data;
  // otherwise the AI relies on radar-derived storm intensity for
  // convective/lightning reasoning.
  try{
    if(typeof ltgLive==='function'&&ltgLive()&&S._ltgStrikes&&S._ltgStrikes.flashes.length&&S.lat!=null){
      const fl=S._ltgStrikes.flashes;
      let nearest=Infinity,nBrg=0,w10=0,w25=0;
      for(const f of fl){
        const d=(f.distMi!=null)?f.distMi:haversine(S.lat,S.lon,f.lat,f.lon);
        if(d<nearest){nearest=d;nBrg=(f.bear!=null)?f.bear:(bearingDeg(S.lat,S.lon,f.lat,f.lon));}
        if(d<=10)w10++; if(d<=25)w25++;
      }
      const nd=S.radarMetric?(nearest*1.60934).toFixed(1)+' km':nearest.toFixed(1)+' mi';
      const _lsrc=S._ltgStrikes.src==='glm'?('GOES GLM satellite'+(S._ltgStrikes.sat?' ('+S._ltgStrikes.sat+')':'')+', geolocation ~8-14 km'):'WarPulse ground network';
      parts.push(`\nLIGHTNING (REAL observed strikes via ${_lsrc}, last 15 min — NOT a radar estimate):`);
      parts.push(`  Total: ${fl.length} strike${fl.length!==1?'s':''} · within 10 mi: ${w10} · within 25 mi: ${w25}`);
      if(isFinite(nearest))parts.push(`  Nearest strike: ${nd} to the ${degToDir(nBrg)}`);
      parts.push(`  Treat lightning within ~10 mi as an active outdoor-safety hazard (30/30 rule); prefer this observed data over radar-implied lightning when both are present.`);
    }
  }catch(e){}

  // RAIN NOWCAST — the SAME Rain Clock projection the dial renders (S._rainClockData),
  // so the AI's rain narrative matches what the user sees on the Rain Clock tab
  // (rain-until time, expected amount, upcoming windows, nearest precipitation).
  try{
    const rc=S._rainClockData;
    if(rc&&rc.awaitingMotion){
      // v5.82: dial is holding until the scan resolves storm motion — don't let
      // the AI fill the gap with "no rain expected" or a raining-now claim.
      parts.push(`\nRAIN NOWCAST (Rain Clock): scan is still resolving storm motion, so the dial isn't projecting yet — do NOT state rain timing or claim it's raining/dry right now; say the nowcast is still coming up.`);
    }else if(rc&&rc.ready&&Array.isArray(rc.windows)){
      const now=Date.now();
      const _rcClock=(min)=>fmtClock(new Date(now+min*60000));
      parts.push(`\nRAIN NOWCAST (Rain Clock — the projection shown on the app's Rain Clock dial; radar-derived nowcast blended with the hourly forecast):`);
      if(rc.windows.length){
        const w0=rc.windows[0];
        if(rc.rainingNow||w0.startMin<=0){
          parts.push(`  Status: raining now, easing around ${_rcClock(w0.endMin)}${rc.forecast?' (from the hourly forecast — no cells on radar yet)':''}.`);
        }else{
          parts.push(`  Status: dry now — next rain about ${_rcClock(w0.startMin)}, easing around ${_rcClock(w0.endMin)}.`);
        }
        // Upcoming windows (up to 3), each with its clock span and peak intensity.
        const wl=rc.windows.slice(0,3).map(w=>{
          const span=w.startMin<=0?`now → ${_rcClock(w.endMin)}`:`${_rcClock(w.startMin)} → ${_rcClock(w.endMin)}`;
          return `${span} (peak ${Math.round(w.peakDbz)} dBZ)`;
        });
        if(wl.length)parts.push(`  Windows: ${wl.join('; ')}`);
      }else{
        parts.push(`  Status: no rain expected on the nowcast horizon.`);
      }
      if(rc.totalMm>0.01&&typeof fmtPrecip==='function'){
        const _spanH=rc.span?Math.max(1,Math.round(rc.span/60)):12;
        parts.push(`  Expected total over the dial's SHORT-RANGE nowcast window (next ~${_spanH} h): ${fmtPrecip(rc.totalMm)}. This figure covers only the next ~${_spanH} h — do NOT present it as the storm's total rainfall; heavier rain arriving later is captured by the 48 h forecast total below, not here.`);
      }
      if(rc.nearest&&rc.nearest.mi!=null){
        const nm=S.radarMetric?(rc.nearest.mi*1.60934).toFixed(1)+' km':rc.nearest.mi.toFixed(1)+' mi';
        parts.push(`  Nearest precipitation: ${nm} to the ${rc.nearest.dir} (${Math.round(rc.nearest.brg)}°).`);
      }
      parts.push(`  Use this nowcast for "when will it rain / stop" questions; it reflects the exact dial the user is looking at.`);
    }
  }catch(e){}

  // v6.16: LONGER-RANGE forecast rain (next 48 h) — the same hourly precipitation the
  // app's "Total Precipitation (next 48 hrs)" graph plots. The Rain Clock above is a
  // SHORT-range (≤12 h) nowcast, so on a multi-day system its total can look tiny next
  // to the storm's real rainfall; give the AI the 48 h picture so the two agree and it
  // doesn't say "only 0.05 in" when a wetter day is coming just beyond the dial.
  try{
    const h48=S._hourlyData;
    if(h48&&h48.time){
      const now48=Date.now();
      if(h48.precipitation&&typeof fmtPrecip==='function'){
        let sum48=0,peakHrMm=0,firstWetMin=null;
        for(let i=0;i<h48.time.length;i++){
          const ts=new Date(h48.time[i]).getTime(); if(isNaN(ts))continue;
          const off=(ts-now48)/60000; if(off<-60||off>48*60)continue;
          const mm=h48.precipitation[i]||0;
          if(mm>0){ sum48+=mm; if(mm>peakHrMm)peakHrMm=mm; if(firstWetMin==null&&off>5&&mm>=0.5)firstWetMin=off; }
        }
        if(sum48>0.05){
          const _c=(min)=>fmtClock(new Date(now48+min*60000));
          parts.push(`\nFORECAST RAIN — NEXT 48 h (matches the app's Total Precipitation graph; longer-range than the Rain Clock nowcast):`);
          parts.push(`  Model-estimated total: ${fmtPrecip(sum48)}${peakHrMm>0?`, heaviest hour ~${fmtPrecip(peakHrMm)}/hr`:''}.${firstWetMin!=null?` First meaningful rain around ${_c(firstWetMin)}.`:''}`);
          parts.push(`  These are MODEL GRID estimates, not measured amounts — in scattered convection, actual totals vary sharply over short distances. Present them as potential ("storms could locally drop around ${fmtPrecip(sum48)}"), never as an exact amount that WILL fall at the user's address.`);
          parts.push(`  When the Rain Clock's short-range total is small but this 48 h total is larger, the wetter rain is arriving BEYOND the dial's window — describe the fuller picture from this line, and be explicit about WHEN (today vs tonight vs tomorrow).`);
        }
      }
      // v6.62: hourly rain CHANCES (PoP), independent of modeled amounts. The
      // briefing once said "today stays dry" while the official forecast
      // carried a 30% storm chance the same afternoon — the model's own QPF
      // grid was dry, and the AI had no probability signal to disagree with.
      // Deliberately NOT gated on h48.precipitation: PoP must reach the AI
      // even when a partial/cached payload lacks the QPF array.
      const pop=h48.precipitation_probability;
      if(pop&&pop.length){
        let p12=0,p12At=null,p48=0,p48At=null;
        for(let i=0;i<h48.time.length;i++){
          const ts=new Date(h48.time[i]).getTime(); if(isNaN(ts))continue;
          const off=(ts-now48)/60000; if(off<-60||off>48*60)continue;
          const v=pop[i]; if(v==null)continue;
          // The current hour's value counts toward the 12 h peak, but only
          // FUTURE stamps may be quoted as the peak's clock time — otherwise
          // at :55 the briefing could present an already-elapsed hour as an
          // upcoming peak.
          if(off<=12*60){ if(v>p12){p12=v;p12At=off>=0?ts:null;} }
          else if(v>p48){p48=v;p48At=ts;}
        }
        const _t=(ts)=>(ts&&typeof fmtClock==='function')?`${fmtClock(new Date(ts))} ${new Date(ts).getDate()===new Date(now48).getDate()?'today':'('+new Date(ts).toLocaleDateString('en-US',{weekday:'short'})+')'}`:'';
        parts.push(`\nRAIN CHANCES (hourly probability of precipitation — the same kind of % the official forecast uses):`);
        parts.push(`  Next 12 h: peak ${Math.round(p12)}%${(p12At&&_t(p12At))?` around ${_t(p12At)}`:''}. Hours 12–48: peak ${Math.round(p48)}%${(p48At&&_t(p48At))?` around ${_t(p48At)}`:''}.`);
        parts.push(`  RULE: if a window's peak chance is ≥20%, NEVER describe that window as "dry", "no rain expected", or "rain holds off" — say showers/storms "remain possible" (20–40%) or "are likely" (≥60%). Keep your storm TIMING consistent with when these probabilities peak — don't place the main chance in the evening if the probability peaks in the morning.`);
      }
    }
  }catch(e){}

  // v6.18: TROPICAL SYSTEMS — feed the NHC/JTWC vitals (max sustained wind, PEAK
  // GUSTS, MIN CENTRAL PRESSURE, motion, category) directly, so the briefing reports
  // the storm's real numbers instead of inferring them from alert text (which caused
  // pressure + gusts to go missing). When NHC doesn't publish a field, say so.
  try{
    const _sys=(typeof _nhcData!=='undefined'&&_nhcData&&Array.isArray(_nhcData.systems))?_nhcData.systems:[];
    if(_sys.length&&S.lat!=null){
      const _rows=_sys.map(s=>{
        const d=(s.dist!=null)?s.dist:((s.lat!=null&&s.lon!=null&&typeof haversine==='function')?haversine(S.lat,S.lon,s.lat,s.lon):null);
        const b=(s.lat!=null&&s.lon!=null&&typeof bearingDeg==='function')?bearingDeg(S.lat,S.lon,s.lat,s.lon):null;
        return {s,d,b};
      }).filter(x=>x.d==null||x.d<=1500).sort((a,b)=>(a.d==null?9e9:a.d)-(b.d==null?9e9:b.d)).slice(0,5);
      if(_rows.length){
        parts.push(`\nTROPICAL SYSTEMS (NHC/JTWC live vitals — report these numbers directly; when a field reads "not published", state that rather than guessing or omitting it):`);
        for(const {s,d,b} of _rows){
          const cat=(s.category&&s.category.label)?s.category.label:(s.type||'System');
          const dTxt=(d!=null)?`${S.radarMetric?(d*1.60934).toFixed(0)+' km':d.toFixed(0)+' mi'} to the ${b!=null?degToDir(b):'?'}`:'distance unknown';
          const wind=(s.maxWind!=null)?`max sustained ${fmtWind(s.maxWind*1.60934)}`:'max sustained wind not published';
          const gust=(s.gusts!=null)?`peak gusts ${fmtWind(s.gusts*1.60934)}`:'peak gusts not published';
          const pres=(s.minPressure!=null)?`min central pressure ${fmtPres(s.minPressure)}`:'central pressure not published';
          const mov=(s.moveDir)?`moving ${s.moveDir}${s.moveSpeed!=null?' at '+fmtWind(s.moveSpeed*1.60934):''}`:'motion not published';
          const src=s._source==='jtwc'?'JTWC':s._source==='gdacs'?'GDACS':'NHC';
          // v6.37: precomputed user quadrant relative to storm motion (tornado
          // threat). Only meaningful when the system is close enough to matter.
          let quadTxt='';
          if(d!=null&&d<=300){
            const q=_tropicalQuadrant(s);
            if(q){
              quadTxt=(q.quadrant==='uncertain')
                ?` USER QUADRANT: uncertain — ${q.note}; state the quadrant is uncertain rather than guessing.`
                :` USER QUADRANT (computed): ${q.quadrant} — you are ${q.userDir||'?'} of the center${q.note?', '+q.note:''} (confidence ${q.confidence}).`;
            }
          }
          // v6.47: feed-lagged storms (GDACS freezes after NHC's final advisory)
          // must not be narrated as live — tell the AI how old the numbers are.
          const _ageH=(s._asOf&&(Date.now()-s._asOf)>3*3600000)?Math.round((Date.now()-s._asOf)/3600000):0;
          const _ageTxt=_ageH?` DATA AGE: intensity/motion figures were last updated ~${_ageH} h ago — present them as "as of ${_ageH} h ago", not as current, and note the storm (especially if inland) has likely changed since.`:'';
          parts.push(`  🌀 ${(s.type||'').trim()} ${(s.name||'').trim()} (${cat}) — ${dTxt} from you. ${wind}, ${gust}, ${pres}. ${mov}. [${src}]${quadTxt}${_ageTxt}`);
        }
        parts.push(`  ALWAYS include the nearest/affecting system's max sustained wind, PEAK GUSTS, and MIN CENTRAL PRESSURE in the Bottom Line or Situation Overview. If a value is "not published", say so explicitly (e.g. "central pressure not published by NHC") — do NOT invent one or quietly drop it.`);
        parts.push(`  TORNADO QUADRANT: use the "USER QUADRANT (computed)" value above VERBATIM — do NOT infer right-front/left-front geometry yourself (it is easy to get wrong from prose). Tropical tornado risk is highest in the RIGHT-FRONT quadrant relative to motion; if the computed quadrant is anything else, or reads "uncertain", say so plainly rather than defaulting to "right-front". State the user's direction from the center exactly as given.`);
        parts.push(`  SINGLE SOURCE OF TRUTH: this TROPICAL SYSTEMS block is the ONLY authority for present-tense tropical facts — current position, distance, bearing, motion direction & speed, wind, gust and pressure. State ONE current position and ONE current motion per system, taken from here. The Area Forecast Discussion (further down) may quote the storm's position/motion from its own issuance time — those are HISTORICAL context; never repeat them as the current position/motion, and never let the Bottom Line and the Situation Overview give two different "current" distances, bearings or motions for the same system.`);
      }
    }
  }catch(e){}

  // STORM CONTEXT — consume the SAME post-filter snapshot the Storms tab cards
  // and System Briefing render from, so all three surfaces agree on the cell
  // list. This block replaces the prior raw-storm rebuild.
  if(S.storms&&S.storms.length){
    const fs=(typeof getFilteredStorms==='function')
      ?getFilteredStorms()
      :{storms:S.storms,filter:null,totalCount:S.storms.length,hiddenCount:0};
    const f=fs.filter;
    const filterActive=!!(f&&((f.minDbz|0)>0||(f.maxDist|0)>0||f.approachOnly||f.threatsOnly));
    const distU=S.radarMetric?'km':'mi';
    parts.push(`\nSTORM FILTER (user-controlled Storms-tab filter — these are the ONLY cells the user is looking at; do NOT mention cells outside this filter):`);
    if(filterActive){
      if((f.minDbz|0)>0)parts.push(`  - Min dBZ: ${f.minDbz} (cells below this are hidden by the user)`);
      if((f.maxDist|0)>0)parts.push(`  - Max distance: ${f.maxDist} ${distU} (cells beyond are hidden)`);
      if(f.approachOnly)parts.push(`  - Approaching only: ON (passing / moving-away cells are hidden)`);
      if(f.threatsOnly)parts.push(`  - Threats only: ON (only direct / near_direct / near_miss cells are shown)`);
      parts.push(`  - Sort: ${f.sort1||'threat'} then ${f.sort2||'eta'}`);
      parts.push(`  - Showing ${fs.totalCount-fs.hiddenCount} of ${fs.totalCount} cells (${fs.hiddenCount} hidden by your filters)`);
    }else{
      parts.push(`  - No filter active — all ${fs.totalCount} scanned cells are eligible.`);
    }

    let d=null;
    try{if(typeof gatherBriefingData==='function')d=gatherBriefingData();}catch(e){console.warn('briefing data error',e)}
    const c=d&&d.classified;
    if(c){
      const inboundTop=c.inboundTop||[];
      const inboundRest=c.inboundRest||[];
      const inboundLight=c.inboundLight||[];
      const bg=c.background||[];
      const passing=c.passing||[];
      const away=c.away||[];
      const sigCount=c.inbound.filter(it=>it.s.dbz>=31).length;
      const lowCount=inboundLight.length;
      parts.push(`\nSTORM DATA (inbound = post-filter mirror of Storms tab; non-inbound = FULL unfiltered scan radius for situational awareness):`);
      const modCount=c.inbound.length-sigCount-lowCount;
      const unfilt=c.unfilteredTotal!=null?c.unfilteredTotal:fs.totalCount;
      const hiddenInbound=bg.filter(it=>it._hiddenInbound).length;
      parts.push(`  Total cells: ${fs.totalCount} scanned · ${c.totalCount} after user filter · ${unfilt} total in scan radius (used for non-inbound buckets) · ${c.inbound.length} inbound after filter (${sigCount} significant ≥31 dBZ, ${modCount} moderate 25-30 dBZ, ${lowCount} light/drizzle <25 dBZ at >5 mi) · ${bg.length} background · ${passing.length} passing · ${away.length} moving away${hiddenInbound>0?` · NOTE: ${hiddenInbound} inbound cell(s) hidden by your filter are listed in background for awareness`:''}`);
      // v6.34: pin the inbound tally so the AI can't invent a second, different
      // total. The per-cell list below is only the TOP few — never re-count the
      // visible cells and report that as the inbound total.
      parts.push(`  AUTHORITATIVE COUNT: the inbound total is exactly ${c.inbound.length} (${sigCount} significant + ${modCount} moderate + ${lowCount} light = ${sigCount+modCount+lowCount}). Use these numbers verbatim and state EVERY category with its number — e.g. "${c.inbound.length} inbound cells (${sigCount+modCount} moderate-to-heavy, ${lowCount} light)"; never leave a category without its count or trail off. The per-cell lines that follow are only the top ${Math.min(inboundTop.length,c.inbound.length)} for detail — do NOT tally the listed cells and present that as the inbound count, and do NOT state any other inbound total anywhere in the briefing.`);
      if(sigCount===0&&lowCount===0&&c.inbound.length===0&&c.totalCount>0){
        parts.push(`  NOTE: No inbound cells in the filtered view. Background / passing / moving-away cells are off the impact corridor, but they are still REAL ECHOES the user can see on radar — summarize them in the mandatory "Elsewhere on Radar:" subsection using the SCENE HINTS lines below. Do NOT dismiss them as "clutter" or skip it.`);
      }else if(sigCount===0&&lowCount>0){
        parts.push(`  Inbound is ALL light rain (15-30 dBZ) — LEAD with these inbound cells; do NOT call this severe weather.`);
      }
      if(c.inbound.length){
        const peakDbz=Math.max(...c.inbound.map(it=>it.s.dbz));
        const peakCat=peakDbz>=65?'EXTREME (significant-hail signature)':peakDbz>=60?'SEVERE reflectivity (hail possible — reflectivity alone is NOT an NWS "severe" designation)':peakDbz>=55?'VERY INTENSE CORE (strong, NOT automatically severe)':peakDbz>=45?'HEAVY':peakDbz>=31?'MODERATE':'LIGHT';
        parts.push(`  Peak inbound intensity: ${peakDbz} dBZ [${peakCat}].`);
      }
      parts.push(`  PROJECTION CONFIDENCE — cell ETAs have an expiration date. Report each cell only as precisely as its line below is written: cells given an exact ETA + "projected miss X mi" are near-term and reliable; cells given "approx arrival ~TIME (±, moderate confidence)" get a WINDOW, not a to-the-minute time; cells flagged "part of a broader rain band — no fixed ETA" are far out (tropical bands merge/collapse/regenerate on the way) — describe them as a moving rain corridor arriving over a rough multi-hour window, and do NOT assign them a clock time or a sub-mile miss. Never state a to-the-minute arrival or a <1 mi projected miss for a far cell just because an internal number exists.`);
      const fmtD=(mi)=>{const r=Math.round(mi*10)/10;return S.radarMetric?(r*1.60934).toFixed(1)+' km':r.toFixed(1)+' mi';};
      const tierLbl={direct:'DIRECT',near_direct:'NEAR DIRECT',near_miss:'NEAR MISS',miss:'MISS',distant:'DISTANT',far:'FAR',passing:'PASSING',moving_away:'MOVING AWAY'};
      const tierEmo={direct:'🔴',near_direct:'🟠',near_miss:'🟡',miss:'🔵',distant:'⚪',far:'⚫',passing:'🟡',moving_away:'🟢'};
      // v6.34: CONFIDENCE HORIZON — a projected ETA / sub-mile miss is only
      // trustworthy for cells that are close AND arriving soon. Beyond that, the
      // "same" cell rarely survives the trip (tropical bands merge, collapse,
      // regenerate), so emitting "arrives 4:24 PM, miss 0.1 mi" for a 117-mi cell
      // is false precision. Tier each cell by distance + effective ETA and format
      // accordingly: NEAR → exact ETA+miss · MID → rough window, ± miss · FAR →
      // no clock, no sub-mile miss, flagged as an evolving band.
      const _age=(typeof radarAgeMin==='function')?radarAgeMin():5;
      const _projTier=(distMi,etaEffMin)=>{
        const et=(etaEffMin==null)?9999:etaEffMin;
        if(distMi<=45&&et<=75)return'near';
        if(distMi<=90&&et<=150)return'mid';
        return'far';
      };
      for(const it of inboundTop){
        const s=it.s,b=it.b||{};
        const e=_dbzEmoji(s.dbz),lbl=tierLbl[it.tier]||(it.tier||'').toUpperCase(); // v6.36: emoji=intensity, lbl=proximity (words)
        const close=b.closingMph!=null?((b.closingMph>=0?'+':'')+b.closingMph+' mph'):'?';
        const etaEff=b.etaMin!=null?Math.max(0,b.etaMin-_age):null;
        const _pt=_projTier(s.distance,etaEff);
        let eta='',miss='';
        if(_pt==='near'){
          eta=etaEff!=null?`, ETA ~${Math.round(etaEff)} min (${(typeof fmtClock==='function')?fmtClock(new Date(Date.now()+etaEff*60000)):''})`:'';
          miss=b.perpMissMi!=null?`, projected miss ${b.perpMissMi.toFixed(1)} mi`:'';
        }else if(_pt==='mid'){
          // Round ETA to a 15-min window; keep miss but coarse (~mi) + moderate-confidence flag.
          const w=etaEff!=null?Math.round(etaEff/15)*15:null;
          eta=w!=null?`, approx arrival ~${(typeof fmtClock==='function')?fmtClock(new Date(Date.now()+w*60000)):''} (±, moderate confidence)`:'';
          miss=b.perpMissMi!=null?`, projected miss ~${Math.round(b.perpMissMi)} mi`:'';
        }else{
          // FAR: no clock, no sub-mile miss — describe as an evolving band, not a durable cell.
          eta=`, part of a broader rain band — no fixed ETA (cores may merge/weaken/regenerate before reaching you)`;
          miss='';
        }
        const pct=b.closenessPct!=null?` (${b.closenessPct}% max intensity at user)`:'';
        const estDbz=b.estDbzAtUser!=null?`, ~${b.estDbzAtUser} dBZ expected at user`:'';
        const mov=(b.movSpdMph&&b.movDirDeg!=null)?` (motion ${degToDir(b.movDirDeg)} @ ${b.movSpdMph} mph)`:'';
        const _shm=(typeof stormMaster==='function')?(stormMaster(s).shear):null; // v6.1: convective shear/inflow read
        const shear=_shm?` [0–6km shear ${Math.round(_shm.bulkShearMs*2.237)} mph, ${_shm.tier} — ${_shm.trend}: ${_shm.note}]`:'';
        parts.push(`  ${e} ${lbl}${pct}: ${s.dbz} dBZ cell at ${fmtD(s.distance)} ${degToDir(s.bearing)} closing ${close}${eta}${miss}${estDbz}${mov}${shear}.`);
      }
      if(inboundRest.length){
        const peak=Math.max(...inboundRest.map(it=>it.s.dbz));
        parts.push(`  ➕ +${inboundRest.length} more inbound cell(s), peak ${peak} dBZ — see Storms tab for full list.`);
      }
      if(inboundLight.length){
        const peak=Math.max(...inboundLight.map(it=>it.s.dbz));
        const dMin=Math.min(...inboundLight.map(it=>it.s.distance));
        const dMax=Math.max(...inboundLight.map(it=>it.s.distance));
        parts.push(`  💧 ${inboundLight.length} light cell(s) (sprinkles/drizzle, ≤${peak} dBZ) through ${fmtD(dMin)}–${fmtD(dMax)} — minor reflectivity, not actionable.`);
      }
      // v4.85: Soonest + strongest hints so the AI can write a SUMMARY of the
      // inbound rain (highlight these two) instead of re-listing every cell —
      // the full per-cell list lives on the Storms tab.
      if(c.inbound.length){
        const _age=(typeof radarAgeMin==='function')?radarAgeMin():5;
        const _etaOf=(it)=>{const e=it.b&&it.b.etaMin;return e!=null?Math.max(0,e-_age):Infinity;};
        const _strOf=(it)=>{const b=it.b||{};return b.estDbzAtUser!=null?b.estDbzAtUser:it.s.dbz;};
        let soonest=null,strongest=null;
        for(const it of c.inbound){
          if(soonest===null||_etaOf(it)<_etaOf(soonest))soonest=it;
          if(strongest===null||_strOf(it)>_strOf(strongest))strongest=it;
        }
        const _hint=(it)=>{
          const s=it.s,b=it.b||{};
          const e=tierEmo[it.tier]||'⚫',lbl=tierLbl[it.tier]||(it.tier||'').toUpperCase();
          const sd=b.estDbzAtUser!=null?b.estDbzAtUser:s.dbz;
          const eta=b.etaMin!=null?`ETA ~${Math.round(_etaOf(it))} min (${(typeof fmtClock==='function')?fmtClock(new Date(Date.now()+_etaOf(it)*60000)):''})`:'ETA n/a';
          return `${e} ${lbl}: ${s.dbz} dBZ cell ${fmtD(s.distance)} ${degToDir(s.bearing)}, ~${sd} dBZ at user, ${eta}`;
        };
        parts.push(`\nINBOUND SUMMARY HINTS (write the inbound subsection as a SUMMARY — frame the band, then highlight ONLY these two; do NOT list every inbound cell):`);
        parts.push(`  • Soonest (nearest ETA): ${_hint(soonest)}.`);
        parts.push(`  • Strongest (at user): ${_hint(strongest)}.`);
        if(soonest===strongest)parts.push(`  • NOTE: the soonest cell IS the strongest — mention it once, don't repeat.`);
      }
      const _ts=S._topStormAnalysis;
      if(_ts&&_ts.overhead&&_ts.overhead.length){
        parts.push(`  ⚠️ OVERHEAD / ARRIVED: ${_ts.overhead.length} cell(s) currently inside the user's storm cone.`);
        for(const s of _ts.overhead.slice(0,3)){
          parts.push(`    - ${s.dbz} dBZ at ${fmtD(s.distance)} ${degToDir(s.bearing)} (in cone).`);
        }
      }
      const _bgGroup=(tier,label,emoji)=>{
        const cells=bg.filter(it=>it.tier===tier);
        if(!cells.length)return;
        const dbzMin=Math.min(...cells.map(it=>it.s.dbz));
        const dbzMax=Math.max(...cells.map(it=>it.s.dbz));
        const dMin=Math.min(...cells.map(it=>it.s.distance)),dMax=Math.max(...cells.map(it=>it.s.distance));
        const dRange=cells.length===1?fmtD(cells[0].s.distance):`${fmtD(dMin)}–${fmtD(dMax)}`;
        const dirs=[...new Set(cells.map(it=>degToDir(it.s.bearing)))].slice(0,4);
        parts.push(`  ${emoji} ${label}: ${cells.length} cell(s) (${dbzMin===dbzMax?dbzMin+' dBZ':dbzMin+'-'+dbzMax+' dBZ'}) ${dirs.join('/')} at ${dRange}.`);
      };
      _bgGroup('miss','MISS','🔵');
      _bgGroup('distant','DISTANT','⚪');
      _bgGroup('far','FAR','⚫');
      if(passing.length){
        const dbzMax=Math.max(...passing.map(it=>it.s.dbz));
        const dirs=[...new Set(passing.map(it=>degToDir(it.s.bearing)))].slice(0,3);
        parts.push(`  🟡 PASSING: ${passing.length} cell(s) (up to ${dbzMax} dBZ) tracking past to the ${dirs.join('/')}.`);
      }
      if(away.length){
        const dbzMax=Math.max(...away.map(it=>it.s.dbz));
        const dirs=[...new Set(away.map(it=>degToDir(it.s.bearing)))].slice(0,3);
        parts.push(`  🟢 MOVING AWAY: ${away.length} cell(s) (up to ${dbzMax} dBZ) receding to the ${dirs.join('/')}.`);
      }
      // v4.52: Explicit per-cell list of every non-inbound cell ≥45 dBZ so the
      // AI can name them individually (distance, bearing, dBZ, motion, threat
      // verdict) instead of collapsing them into a vague "20-55 dBZ ring".
      // Per user request: "anything over 45 dBZ should mention the distance,
      // direction, and movement, e.g. 'the strongest storm on radar is 25 mi
      // NE of you with a strength of 55 dBZ moving N at 12 mph, poses no risk'."
      const _strongNonInbound=[...bg,...passing,...away]
        .filter(it=>it.s.dbz>=45)
        .sort((a,b)=>b.s.dbz-a.s.dbz)
        .slice(0,12);
      if(_strongNonInbound.length){
        parts.push(`\nSTRONG NON-INBOUND CELLS (≥45 dBZ, outside the impact corridor — for situational awareness only. SUMMARIZE these by direction in the "Elsewhere on Radar" subsection; you may name ONLY the single strongest one individually (first in this list) if it is louder than anything inbound. Do NOT list them all):`);
        const tierEmo2={miss:'🔵',distant:'⚪',far:'⚫',passing:'🟡',moving_away:'🟢',unknown:'⚫'};
        const tierLbl2={miss:'MISS',distant:'DISTANT',far:'FAR',passing:'PASSING',moving_away:'MOVING AWAY',unknown:'UNKNOWN'};
        for(const it of _strongNonInbound){
          const s=it.s,b=it.b||{};
          const e=tierEmo2[it.tier]||'⚫';
          const lbl=tierLbl2[it.tier]||(it.tier||'').toUpperCase();
          const mov=(b.movSpdMph&&b.movDirDeg!=null)?`moving ${degToDir(b.movDirDeg)} at ${b.movSpdMph} mph`:'motion unknown';
          const miss=b.perpMissMi!=null?`, projected miss ${b.perpMissMi.toFixed(1)} mi`:'';
          const close=b.closingMph!=null?`, closing ${(b.closingMph>=0?'+':'')+b.closingMph} mph`:'';
          const verdict=it.tier==='moving_away'?'receding — not projected to affect your location'
            :it.tier==='passing'?'tangent track — not projected to affect your location'
            :it._hiddenInbound?'inbound but hidden by your filter — review filter'
            :(b.perpMissMi!=null&&b.perpMissMi>24)?'well clear of your location'
            :'background context only';
          parts.push(`  ${e} ${lbl}: ${s.dbz} dBZ cell at ${fmtD(s.distance)} ${degToDir(s.bearing)} of user, ${mov}${miss}${close} — ${verdict}.`);
        }
      }
      // v4.36: Precomputed scene-hint phrasings so the model has ready-made
      // narrative phrasings to anchor the mandatory "Surrounding Picture"
      // wrap-up sentence on (see DETAIL vs MENTAL PICTURE rule in the prompt).
      const _scenify=(cells,verb)=>{
        if(!cells.length)return null;
        const dbzMin=Math.min(...cells.map(it=>it.s.dbz));
        const dbzMax=Math.max(...cells.map(it=>it.s.dbz));
        const dMin=Math.min(...cells.map(it=>it.s.distance));
        const dMax=Math.max(...cells.map(it=>it.s.distance));
        const dirs=[...new Set(cells.map(it=>degToDir(it.s.bearing)))];
        const dirStr=dirs.length===1?dirs[0]:dirs.length===2?dirs.join(' and '):dirs.slice(0,3).join('/');
        const dbzStr=dbzMin===dbzMax?`${dbzMin} dBZ`:`${dbzMin}-${dbzMax} dBZ`;
        const dStr=Math.abs(dMax-dMin)<2?fmtD(dMin):`${fmtD(dMin)}-${fmtD(dMax)}`;
        const geom=cells.length===1?'a lone cell':cells.length<=3?'a small cluster':cells.length<=8?'a band':'a ring of returns';
        return `${geom} (${dbzStr}) ${dStr} to the ${dirStr}, ${verb}`;
      };
      const _allBg=[...bg];
      const _hBg=_scenify(_allBg,'sitting in the background');
      const _hPass=_scenify(passing,'tracking past, outside the impact corridor');
      const _hAway=_scenify(away,'drifting away from you');
      if(_hBg||_hPass||_hAway){
        parts.push(`\nSCENE HINTS (ready-made phrasings — quote, rephrase, or combine into the mandatory "Elsewhere on Radar:" subsection):`);
        if(_hBg)parts.push(`  • Background: ${_hBg}`);
        if(_hPass)parts.push(`  • Passing: ${_hPass}`);
        if(_hAway)parts.push(`  • Moving away: ${_hAway}`);
      }else{
        // Always emit a deterministic SCENE HINTS line so the mandatory wrap-up
        // never has to be invented from scratch — works for both "inbound but
        // nothing else" and "all clear" cases.
        parts.push(`\nSCENE HINTS: nothing else of note on radar — write the subsection as "Elsewhere on Radar: nothing else of note on radar — the inbound rain above is the whole story." (verbatim if there are inbound cells; lightly rephrased to "the rest of the scan is quiet" if not).`);
      }
    }else{
      parts.push(`\nSTORM DATA: briefing engine unavailable, ${fs.storms.length} cells after filter.`);
    }
    const _aiMv=(typeof getSteeringMv==='function')?getSteeringMv():(S.stormMovement&&S.stormMovement.speed>=2?S.stormMovement:null);
    if(_aiMv&&_aiMv.speed>=2){
      let _src='';
      if(_aiMv.source==='observed')_src=` (radar-observed cell motion, ${Math.round((_aiMv.confidence||0)*100)}% confidence)`;
      else if(_aiMv.source==='hybrid')_src=` (blend of winds-aloft + observed motion, ${Math.round((_aiMv.confidence||0)*100)}% confidence)`;
      else if(_aiMv.source==='aloft')_src=` (estimated from winds-aloft steering)`;
      parts.push(`  General storm movement: ${degToDir(_aiMv.direction)} at ${fmtWind(_aiMv.speed*1.60934)}${_src}`);
    }
    // STORMS TAB FORECAST — the exact tier-labeled bullets shown at the top of
    // the Storms tab ("🔵 Light rain inbound starting in 25m:28s — 102 cells", etc).
    try{
      if(typeof buildStormForecastLines==='function'){
        const fl=buildStormForecastLines(true);
        if(fl.empty){
          parts.push(`\nSTORMS TAB FORECAST: No storms currently approaching your location.`);
        }else if(fl.lines&&fl.lines.length){
          parts.push(`\nSTORMS TAB FORECAST (verbatim from the Storms tab header):`);
          for(const ln of fl.lines)parts.push(`  ${ln}`);
        }
      }
    }catch(e){console.warn('forecast lines error',e)}
  }else{
    parts.push('\nSTORM DATA: No storm cells currently detected in scan radius.');
  }

  if(S.alerts&&S.alerts.length){
    parts.push(`\nACTIVE NWS ALERTS (${S.alerts.length}) — same wording shown on the Alerts tab:`);
    for(const a of S.alerts.slice(0,8)){
      const p=a.properties||a;
      let line=`  ⚠ ${p.event||p.headline||'Alert'}`;
      if(p.severity)line+=` [Severity: ${p.severity}]`;
      if(p.urgency)line+=` [Urgency: ${p.urgency}]`;
      if(p.onset)line+=` [Onset: ${p.onset}]`;
      else if(p.effective)line+=` [Effective: ${p.effective}]`;
      if(p.ends)line+=` [Ends: ${p.ends}]`;
      else if(p.expires)line+=` [Expires: ${p.expires}]`;
      if(p.areaDesc)line+=`\n    Area: ${String(p.areaDesc).substring(0,200)}`;
      if(p.description){
        const desc=p.description.replace(/\n/g,' ').substring(0,1200);
        line+=`\n    ${desc}`;
      }
      if(p.instruction){
        const ins=p.instruction.replace(/\n/g,' ').substring(0,500);
        line+=`\n    Instruction: ${ins}`;
      }
      parts.push(line);
    }
  }

  if(S.forecast&&S.forecast.hourly){
    const h=S.forecast.hourly;
    const nowIdx=h.time?h.time.findIndex(t=>new Date(t)>=now):0;
    const startIdx=Math.max(0,nowIdx);
    parts.push('\nHOURLY FORECAST (next 8 hours):');
    for(let i=startIdx;i<Math.min(startIdx+8,h.time?.length||0);i++){
      const t=h.time[i];
      const tC=h.temperature_2m?h.temperature_2m[i]:null;
      const pop=h.precipitation_probability?h.precipitation_probability[i]:'?';
      const prec=h.precipitation?h.precipitation[i]:0;
      const wKmh=h.wind_speed_10m?h.wind_speed_10m[i]:null;
      const gKmh=h.wind_gusts_10m?h.wind_gusts_10m[i]:null;
      const hr=fmtClockShort(new Date(t));
      let line=`  ${hr}: ${tC!=null?fmtTemp(tC):'?'}, ${pop}% precip chance`;
      if(prec>0)line+=` (${fmtPrecip(prec)})`;
      line+=`, wind ${wKmh!=null?fmtWind(wKmh):'?'}`;
      if(gKmh!=null&&wKmh!=null&&gKmh>wKmh+8)line+=` gusts ${fmtWind(gKmh)}`;
      parts.push(line);
    }
  }

  if(S.forecast&&S.forecast.daily){
    const d=S.forecast.daily;
    parts.push('\n7-DAY FORECAST:');
    for(let i=0;i<Math.min(7,d.time?.length||0);i++){
      const day=new Date(d.time[i]+'T12:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
      const hiC=d.temperature_2m_max?d.temperature_2m_max[i]:null;
      const loC=d.temperature_2m_min?d.temperature_2m_min[i]:null;
      const pop=d.precipitation_probability_max?d.precipitation_probability_max[i]:'?';
      const precSum=d.precipitation_sum?d.precipitation_sum[i]:0;
      const wMaxKmh=d.wind_speed_10m_max?d.wind_speed_10m_max[i]:null;
      let line=`  ${day}: Hi ${hiC!=null?fmtTemp(hiC):'?'} / Lo ${loC!=null?fmtTemp(loC):'?'}, ${pop}% precip`;
      if(precSum>0)line+=` (${fmtPrecip(precSum)})`;
      line+=`, max wind ${wMaxKmh!=null?fmtWind(wMaxKmh):'?'}`;
      parts.push(line);
    }
  }

  if(S.forecast&&S.forecast._nwsForecast&&S.forecast._nwsForecast.length){
    parts.push('\nNWS FORECAST PERIODS:');
    for(const p of S.forecast._nwsForecast.slice(0,6)){
      parts.push(`  ${p.name}: ${p.detailedForecast||p.shortForecast||''}`);
    }
  }

  if(S._afd&&S._afd.discussion){
    parts.push(`\n=== AREA FORECAST DISCUSSION ===`);
    parts.push(`NWS Office: ${S._afd.office}`);
    if(S._afd.issuedAt)parts.push(`Issued: ${S._afd.issuedAt}`);
    parts.push(`Use this for forecast REASONING — synoptic setup, uncertainty, moisture, track trends. If it quotes a tropical system's position, intensity, pressure or motion, treat those as HISTORICAL (from its issuance time): the TROPICAL SYSTEMS live vitals above override them for every present-tense fact. Do NOT restate an AFD storm position/motion as the current one.`);
    parts.push(`Forecaster Discussion:\n${S._afd.discussion}`);
  }

  if(S._aloftData&&S._aloftData.length){
    const pToAlt={1013:'Surface (10m)',925:'~2,500 ft (925 hPa)',850:'~5,000 ft (850 hPa)',700:'~10,000 ft (700 hPa)',500:'~18,000 ft (500 hPa)'};
    parts.push(`\n=== WINDS ALOFT (STORM STEERING) ===`);
    for(const a of S._aloftData){
      const alt=pToAlt[a.p]||a.p+'hPa';
      parts.push(`  ${alt}: ${degToDir(a.dir)} (${Math.round(a.dir)}°) at ${fmtWind(a.spd)}`);
    }
  }

  const shearInfo=getWindShearAnalysis();
  if(shearInfo){
    parts.push(`\nWIND SHEAR ANALYSIS (NWS/Aviation Standard):`);
    parts.push(`  Vector shear magnitude: ${shearInfo.vectorShear} (${shearInfo.severity})`);
    parts.push(`  Directional change: ${shearInfo.dirDiff}°`);
    parts.push(`  Surface (model 10 m analysis — used ONLY for the shear vector; this is NOT the reported current surface wind, use CURRENT CONDITIONS / METAR for that): ${shearInfo.surfaceWind}`);
    parts.push(`  Upper level: ${shearInfo.upperWind}`);
    parts.push(`  Aviation impact: ${shearInfo.impact}`);
  }

  const stab=getStabilityData();
  if(stab){
    parts.push(`\n=== THUNDERSTORM FORMATION ANALYSIS ===`);
    parts.push(`The Three Essential Conditions for Thunderstorm Development:`);
    parts.push(`\n1. MOISTURE (${stab.moistRat}/10):`);
    if(stab.humid!=null)parts.push(`  Relative Humidity: ${stab.humid}%`);
    if(stab.dewp!=null)parts.push(`  Dew Point: ${fmtTemp(stab.dewp)}`);
    if(stab.temp!=null&&stab.dewp!=null)parts.push(`  Temp-Dewpoint Spread: ${fmtTempDiff(stab.temp-stab.dewp)}`);
    parts.push(`\n2. ATMOSPHERIC STABILITY (${stab.stabRat}/10):`);
    parts.push(`  CAPE: ${stab.cape||0} J/kg`);
    parts.push(`  Lifted Index: ${stab.li!=null?stab.li.toFixed(1)+'°C ('+cToF(stab.li)+'°F)':'?'} (negative = unstable)`);
    if(stab.cin!=null)parts.push(`  Convective Inhibition (CIN): ${stab.cin} J/kg`);
    parts.push(`  Assessment: ${stab.stabDesc}`);
    parts.push(`\n3. LIFTING MECHANISMS (${stab.liftRat}/10):`);
    if(S._windShear){
      const _shMs=(S._windShear.speedDiff!=null)?(S._windShear.speedDiff/3.6):null; // km/h → m/s
      const _shBand=_shMs==null?'':(_shMs<10?'weak (single-pulse cells)':_shMs<18?'moderate (organized multicell)':'strong (supercell-capable)');
      const _dirDiff=S._windShear.dirDiff||0;
      const _mostly=_dirDiff<30?' — almost pure SPEED shear (winds nearly aligned; limited storm rotation)':_dirDiff<60?' — mixed speed + directional shear':' — strong DIRECTIONAL shear (favors rotating storms)';
      parts.push(`  0–6 km bulk wind shear (vector): ${fmtWind(S._windShear.speedDiff)}${_shMs!=null?` (${_shMs.toFixed(1)} m/s / ${Math.round(_shMs*1.94384)} kt)`:''}, ${_dirDiff}° directional change`);
      if(_shBand)parts.push(`  Convective classification: ${_shBand}${_mostly}. Bands: <10 m/s weak · 10–18 moderate · ≥18 strong.`);
    }
    parts.push(`\nOVERALL THUNDERSTORM POTENTIAL: ${stab.overall}/10 (${stab.risk})`);
  }

  // v6.10: today's forecast PEAK temp + heat index, so heat-index language is tied
  // to the daytime high (and its hour) rather than the current/overnight reading.
  try{
    const fh=S.forecast&&S.forecast.hourly;
    if(fh&&fh.time&&fh.apparent_temperature&&fh.temperature_2m){
      const now=new Date();
      let peakT=-999,peakHI=-999,peakHrT=null,peakHrHI=null;
      for(let i=0;i<fh.time.length;i++){
        const d=new Date(fh.time[i]);
        if(d.getDate()!==now.getDate()||d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear())continue; // today only
        if(d.getTime()<now.getTime()-3600000)continue; // remaining hours today
        const t=fh.temperature_2m[i], hi=fh.apparent_temperature[i];
        if(t!=null&&t>peakT){peakT=t;peakHrT=d;}
        if(hi!=null&&hi>peakHI){peakHI=hi;peakHrHI=d;}
      }
      if(peakHI>-900){
        parts.push(`\nTODAY'S PEAK HEAT (forecast):`);
        if(peakT>-900)parts.push(`  Afternoon high temp: ${fmtTemp(peakT)}${peakHrT&&typeof fmtClockShort==='function'?' (~'+fmtClockShort(peakHrT)+')':''}`);
        parts.push(`  Peak heat index / feels-like: ${fmtTemp(peakHI)}${peakHrHI&&typeof fmtClockShort==='function'?' (~'+fmtClockShort(peakHrHI)+')':''}`);
        parts.push(`  NOTE: heat-index / "feels-like" values describe the AFTERNOON PEAK above — tie any heat language to this daytime high and its time, NOT to the current or overnight temperature.`);
      }
    }
  }catch(e){}

  if(S._terrainData){
    const td=S._terrainData;
    parts.push(`\nTERRAIN ANALYSIS:`);
    parts.push(`  User elevation: ${fmtAlt(td.userElev*3.281)}`);
    parts.push(`  Local relief: ${fmtAlt(td.relief*3.281)}`);
    if(td.valleys.length)parts.push(`  Valley channels: ${td.valleys.map(v=>`${v.dir}° (${Math.abs(v.diff).toFixed(0)}m deep)`).join(', ')}`);
    if(td.ridges.length)parts.push(`  Ridge barriers: ${td.ridges.map(r=>`${r.dir}° (${r.diff.toFixed(0)}m high)`).join(', ')}`);
    if(td.valleys.length||td.ridges.length)parts.push(`  Note: Valleys can channel storms, ridges can block/deflect weaker cells`);
  }
  if(S._cellTracks&&Object.keys(S._cellTracks).length){
    parts.push(`\nCELL TRACKING: ${Object.keys(S._cellTracks).length} individually tracked cells`);
    const tracks=Object.values(S._cellTracks).sort((a,b)=>b.dbz-a.dbz).slice(0,5);
    for(const t of tracks){
      parts.push(`  Cell at ${t.toLat.toFixed(2)},${t.toLng.toFixed(2)}: ${t.dbz}dBZ, moving ${t.dir}° at ${fmtWind(t.speed*1.60934)}`);
    }
  }

  }catch(e){
    parts.push('\n[Error building weather context: '+e.message+']');
  }

  return parts.join('\n');
}

function getAISystemPrompt(){
  const tone=getAITone();
  const detail=getAIDetail();
  const ctx=buildWeatherContext();

  let toneInstr='';
  if(tone==='professional')toneInstr='Use a professional, clear meteorological briefing style. Be precise and factual.';
  else if(tone==='friendly')toneInstr='Be warm, conversational, and approachable. Use everyday language while keeping accuracy.';
  else if(tone==='humorous')toneInstr='Be witty and entertaining while keeping safety info serious. Light humor about non-dangerous conditions.';

  let detailInstr='';
  if(detail==='minimal')detailInstr='Keep responses brief — 2-3 sentences max focusing on essentials.';
  else if(detail==='standard')detailInstr='Provide balanced detail with key data points and practical guidance.';
  else if(detail==='technical')detailInstr='Include detailed meteorological analysis with specific measurements, dBZ values, wind shear analysis, and professional terminology.';

  // v6.17: urgency must reflect the user's DIRECT risk — not the loudest pixel
  // anywhere in the scan radius. A 65 dBZ cell 50 mi away and receding is NOT an
  // emergency for this user. Gate on: relevant official warnings, radar-confirmed
  // OVERHEAD intensity, INBOUND (direct/near-direct/near-miss) storms, and observed
  // lightning within the safety radius. Distant/passing/moving-away cells are
  // situational awareness only (they still appear under "Elsewhere on Radar").
  const _inbound=Array.isArray(S._inboundShown)?S._inboundShown
    :((S._topStormAnalysis&&Array.isArray(S._topStormAnalysis.inbound))?S._topStormAnalysis.inbound:[]);
  const _inbMax=_inbound.reduce((m,st)=>(st&&st.dbz>m?st.dbz:m),0);
  let _overheadDbz=0;
  try{const _n=(typeof rainOverUserNow==='function')?rainOverUserNow():null;if(_n&&_n.maxDbz)_overheadDbz=_n.maxDbz;}catch(e){}
  let _ltgClose=false;
  try{if(typeof ltgLive==='function'&&ltgLive()&&S._ltgStrikes&&S._ltgStrikes.flashes&&S.lat!=null){_ltgClose=S._ltgStrikes.flashes.some(f=>{const d=(f.distMi!=null)?f.distMi:haversine(S.lat,S.lon,f.lat,f.lon);return d<=10;});}}catch(e){}
  const hasAlerts=S.alerts&&S.alerts.length>0;
  const hasExtremeAlert=S.alerts&&S.alerts.some(a=>(a.properties||a).severity==='Extreme');
  const hasSevereAlert=S.alerts&&S.alerts.some(a=>(a.properties||a).severity==='Severe');
  const _peakRelevant=Math.max(_inbMax,_overheadDbz); // strongest dBZ that actually threatens the user
  const hasExtreme=hasExtremeAlert||_peakRelevant>=65;
  const hasSevere=hasSevereAlert||_peakRelevant>=60;
  const hasHigh=hasAlerts||_peakRelevant>=45||_ltgClose;
  let urgencyPrefix='Weather looks good:';
  let urgencyStyle='Use relaxed, conversational tone.';
  if(hasExtreme||hasExtremeAlert){
    urgencyPrefix='URGENT WEATHER ALERT:';
    urgencyStyle='Use direct, urgent, life-safety focused language. Be concise and clear about immediate threats. No humor. Start with active warnings and any inbound/overhead extreme storm. (A strong cell that is distant, passing, or moving away is NOT the reason for urgency — do not lead with it.)';
  }else if(hasSevere||hasSevereAlert){
    urgencyPrefix='Weather Advisory:';
    urgencyStyle='Use professional, clear language with focus on safety guidance. Be direct but not alarming. Prioritize discussing active alerts.';
  }else if(hasHigh||hasAlerts){
    urgencyPrefix='Weather Update:';
    urgencyStyle='Use balanced professional tone with clear explanations. Maintain awareness without alarm. Discuss active weather alerts before other conditions.';
  }

  return `You are StormTracker's AI weather assistant, helping people anywhere in the world understand the weather around them. Explain conditions in plain language anyone can follow, with the thoroughness of an NWS Area Forecast Discussion — but in everyday words, not jargon. You are NOT a certified meteorologist: never claim facts you don't have, and never present an estimate as a certainty. You may offer grounded opinions from your knowledge and the data provided, but keep them tied to the evidence. You do not replace official warnings, an FAA pilot briefing, or emergency instructions. Your audience ranges from everyday citizens checking if they need an umbrella, to GA pilots planning a flight, to boaters heading offshore. Adapt your language to serve all three — lead with what matters most to safety, then layer in detail.

How you communicate:
- Calibrated confidence: be direct when the evidence is strong, and say so plainly when sources disagree or data is missing. Distinguish an observation from a forecast from a radar estimate from your own inference. Never manufacture precision you don't have.
- You reference actual data points (dBZ, CAPE, wind speeds, distances, ETAs) — never speak in vague generalities when you have numbers
- You distinguish between radar clutter and real precipitation (sub-22 dBZ with <12 returns = almost certainly clutter; say so clearly rather than warning about nonexistent rain). Cells in the 22-30 dBZ range ARE real light rain — when classified inbound (direct/near_direct/near_miss only, i.e. ≤12 mi projected miss with positive closing), acknowledge them as "light rain inbound" rather than calling them clutter or omitting them entirely. Cells beyond 12 mi miss (MISS/DISTANT/FAR) are NOT inbound — treat them as background context only.
- dBZ intensity calibration: 30-44 dBZ = moderate rain; 45-54 dBZ = heavy rain; 55-59 dBZ = very intense core (hail possible); 60-64 dBZ = extreme reflectivity (elevated hail concern); 65+ dBZ = exceptional reflectivity (significant hail concern). Reflectivity ALONE never confirms "severe" — reserve the word "severe" for a cell with an active NWS Severe/Tornado warning, an observed report, or a velocity signature. Do NOT call a 55 dBZ core "severe" on reflectivity alone.
- Storm motion is computed for you using vector projection (dot product of motion onto the storm-to-user vector). Each storm line tells you the classification:
    * Storms are classified by **perpendicular miss distance** from the user using a 6-tier ladder. Only DIRECT / NEAR DIRECT / NEAR MISS (≤12 mi miss with positive closing) count as INBOUND. Anything past 12 mi miss is NOT inbound — it is background context (MISS / DISTANT / FAR). Anything past 6 mi miss is NOT "approaching" / "direct" / "imminent".
      - DIRECT (0-3 mi miss): the cells most likely to be your soonest/strongest — quote ETA, "expect overhead". Lead the inbound summary with these.
      - NEAR DIRECT (3-6 mi miss): quote ETA + brief downpour likely when highlighted. Mention after DIRECT.
      - NEAR MISS (6-12 mi miss): part of the inbound summary; do NOT call this "approaching" or "direct".
      - MISS (12-24 mi miss): one-line summary unless dBZ ≥ 55. Not actionable for the user's location.
      - DISTANT (24-48 mi miss): one-line summary only. Background context.
      - FAR (48-60 mi miss): mention only if dBZ ≥ 55, otherwise omit.
      (These tier names describe PROXIMITY — state them in words where useful; they are NOT the leading emoji, which is intensity-based per the Emoji coding rule below.)
    * "PASSING TO YOUR <DIR>" — the storm's projected track does not bring it toward the user at all. Summarize ALL passing-but-not-inbound cells in ONE sentence (e.g. "A few 45-55 dBZ cells are passing well SE/NE, outside the impact corridor"). Do NOT enumerate them individually unless one is 60+ dBZ within 20 mi. Do NOT manufacture an ETA.
    * "MOVING AWAY" — closing speed is zero or negative; the storm is receding. Summarize ALL moving-away cells in ONE sentence (count + dBZ range + general direction). Do NOT enumerate them individually. They are not actionable.
  ORDERING: The "Active Threats & Storm Tracking" section MUST lead with the inbound summary (DIRECT / NEAR DIRECT / NEAR MISS cells, ≤12 mi miss), highlighting the soonest and strongest cells rather than listing each one. Then MISS / DISTANT / FAR / PASSING / MOVING AWAY summarized together as the "Elsewhere on Radar" scene (these are NOT inbound — do not count them in any "N inbound cells" claim). Do NOT spend more lines on the non-inbound scene than on the inbound summary. Cards with projected dBZ-at-user below 15 are hidden from the user — do not mention them.
- Impact score interpretation: every storm line gives you a percentage labelled "max intensity at user" plus an estimated dBZ ("~NN dBZ expected at user"). This is closeness-to-track × intensity. Use the estimated dBZ when describing what the user will actually experience at their location — do NOT quote the storm's peak dBZ as if that's what will hit the user when the projected miss is more than ~1 mi. Example: a 55 dBZ cell with projected miss 1.8 mi has ~52 dBZ expected at user (60% max-intensity) — describe the user experience as "heavy rain / 52 dBZ at your location" not "55 dBZ severe core overhead".
- Never invent ETAs, closing speeds, or miss distances. If the storm line does not give you an ETA, you must not state one.
- Risk Assessment intensity wording: when stating that storms do not exceed a given dBZ threshold (e.g. "no storms exceed 55 dBZ"), you MUST qualify whether the statement applies to inbound storms only or to all storms on radar. If stronger cells exist on radar but are classified PASSING or MOVING AWAY, explicitly call that out. Preferred phrasing: "No inbound storms exceed 55 dBZ. The only stronger cells are NE of your position and are moving away — not projected to affect you." Never make a bare intensity claim that could be read as contradicting the Active Threats section.
- CERTAINTY CALIBRATION — radar is now, not a promise: radar shows what EXISTS at this moment; it cannot rule out the next few hours. When nothing is inbound but RAIN CHANCES carry ≥20% for the period, or the air is clearly unstable, the correct claim is "no storm is currently affecting or approaching your location, though new isolated development remains possible" — never a flat "no rain is coming" / "today stays dry". Motion verdicts ("passing", "receding") describe each cell's CURRENT projected track — in weak-flow environments cells can pop up, collapse, or shift on an outflow boundary, so state them as projections, not guarantees. Avoid categorical negatives about flooding: when heavy downpours are possible, prefer "widespread flooding is not indicated, though brief street ponding is possible where a slow-moving storm sits over the same spot" over "this is not a flash-flood scenario".
- Emoji coding for storms — INTENSITY, not proximity: prefix every individual cell you mention with the emoji for its RAIN INTENSITY (dBZ), matching the emoji already on each cell's data line — 🔵 light (<31), 🟢 moderate (31–44), 🟡 heavy (45–54), 🟠 very intense (55–64: strong core, NOT automatically severe), 🔴 extreme (65+). NEVER use the emoji to signal how close a cell's track comes — a light-rain cell aimed straight at you is 🔵, and a heavy cell passing wide is still 🟡. Proximity is conveyed in WORDS: its ETA and projected miss (and for non-inbound cells, the motion word "passing"/"moving away"). So the red circle means HEAVY, never "on-target". Example inbound: "🟡 [!dbz:48]48 dBZ[/!] heavy cell 14 mi NW closing at +25 mph, ETA ~34 min". Example elsewhere: "🟠 [!dbz:55]55 dBZ[/!] very intense cell NE, passing wide (miss ~12 mi), receding at -18 mph — not headed your way". Always include the signed closing speed (+ for inbound, − for receding).
- Rich text formatting: the briefing pane renders a limited markdown-style syntax. Use it sparingly and only where it adds clarity:
    * **bold** for safety-critical phrases ("seek shelter now", "tornado warning in effect", "do not drive through flooded roadways"). Never bold an entire paragraph.
    * *italic* for the first mention of a technical term (CAPE, lifted index, PWAT, etc.) so readers can spot it.
    * __underline__ for specific times and ETAs ("storm overhead __~34 min__", "expires __11:45 PM CDT__").
    * Semantic color tags for tier callouts — wrap the short status phrase only, never a whole sentence: [!red]severe / imminent threat[/!], [!orange]near miss / cone alert[/!], [!yellow]advisory / watch[/!], [!green]all-clear / receding[/!], [!cyan]atmospheric data[/!]. Example: "Conditions are [!red]critical[/!] — a confirmed tornado is **on the ground 6 mi SW** and tracking NE."
    * EVERY specific dBZ value you mention MUST be wrapped as [!dbz:NN]NN dBZ[/!] so the number renders in the master radar palette color for that intensity. Example: "A [!dbz:55]55 dBZ[/!] cell 14 mi NW closing at +25 mph." Use this everywhere — Situation Overview, Active Threats, Aviation, Marine — never write a bare "55 dBZ" without the tag. Decimals are allowed ([!dbz:47.5]47.5 dBZ[/!]).
    * For a dBZ RANGE, tag it as [!dbz:LO-HI]LO–HI dBZ[/!] (e.g. [!dbz:35-55]35–55 dBZ[/!]). The phrase renders in the color of the STRONGEST (high) end, so a range topping out at 55 dBZ shows red — never imply the whole range is light just because it starts low.
    * INTENSITY WORDS: whenever you state a dBZ value or range, pair it with the plain-language intensity term from the radar palette so non-technical readers grasp it — 31-40 = moderate rain, 41-45 = heavy rain, 46-51 = very heavy rain, 52-59 = heavy core (strong, not auto-severe), 60-64 = severe (hail possible), 65+ = extreme (hail likely). Write it naturally, e.g. "heavy rain ([!dbz:41]41 dBZ[/!])" or "a heavy-to-very-heavy core ([!dbz:46-52]46–52 dBZ[/!])". A range spans terms — say so (e.g. "moderate-to-heavy"). Keep the existing calibration guardrail: do NOT label 55 dBZ "severe" — that is a heavy core, not automatically severe.
  Do NOT use ###/##/# headers — section headers are already provided. Do NOT use raw HTML. Do NOT invent new color tags or hex codes. Do NOT wrap section headers in any formatting.
- Section headers: prefix each section header line with its topical emoji — 🌐 Situation Overview, ⛈️ Active Threats & Storm Tracking, 🚸 Public Safety & Outdoor Guidance, ✈️ Aviation & Marine Briefing. Headers stay on their own line, no markdown characters.
- Projected-miss phrasing: use natural language — "projected miss around NN mi". Only append "to your <direction>" if the direction has NOT already been stated earlier in the same bullet/sentence (e.g. the storm position "14 mi NW" or the classification label "PASSING TO YOUR NW" both count as already-stated). Never restate direction twice in the same sentence.
- Distances: round to 1 decimal place (e.g. "14.3 mi"). Don't repeat the same distance for multiple cells unless they are genuinely at the same range.
- Never invent PWAT (precipitable water) values. Only mention PWAT if it appears explicitly in the data above (it usually won't). If PWAT isn't given, talk about moisture using dewpoint / humidity / CAPE instead.
- GEOGRAPHIC GROUNDING (works anywhere on Earth — never assume a specific city, region, or country; derive everything from the LOCATION coordinates above): keep the FOCUS on the user's DIRECT impact — what actually happens AT their location — rather than cataloguing weather across the wider region. Two cases: (a) when YOU pick a reference for the user's own local guidance, use the nearest genuinely-relevant real feature and never invent a landmark that isn't actually near their coordinates; (b) when RELAYING a reference an official product already used (see next bullet), keep it and add where the user sits relative to it. Always verify direction/distance against the user's coordinates.
  * KEEP the official products' real place references — BUT ANCHOR EACH TO THE USER. Area Forecast Discussions, alerts, and local statements cite real landmarks and reference lines (highways, cities, counties, regions). These are factual and worth relaying — do NOT delete or reword them away. Whenever you cite one the user can't instantly place themselves against, add a short "relative to you" note using ONLY the general direction you can reasonably support ("to your west, inland", "along the coast south of you"), then tie it back to what it means for THEM — e.g. "[region/landmark the alert names] — that's to your west, so the strongest effects there stay away from you". Do NOT state a specific mileage or precise bearing to that landmark unless the data explicitly gives you its location (you only have the USER's coordinates, not the landmark's — see the GEOGRAPHY YOU CAN'T VERIFY rule). The goal is to KEEP the official wording, ADD the user's rough position relative to it, and always land on the user's own impact. Never substitute a made-up local landmark for the official one.
- SURFACE WIND — ONE CONSISTENT NUMBER: report a single current surface wind throughout, taken from CURRENT CONDITIONS (or METAR when present). The "Surface" value inside WIND SHEAR ANALYSIS is a gridded 10 m model wind used only to compute the shear vector and will often differ — never quote it as the current/observed wind. If they differ, the observed CURRENT CONDITIONS / METAR wind is what the user feels and what you report.
- TROPICAL-CORE WIND vs LOCAL WIND — KEEP THEM SEPARATE: a tropical system's max sustained wind and peak gust (from TROPICAL SYSTEMS) describe conditions AT ITS CENTER, offshore — they are NOT the forecast for the user's location. Report the user's local wind (current + forecast) as its own number, and only cite the storm-center figures as "near Bertha's center, X mi offshore". Never imply the user will feel the center's winds. When the local forecast reaches a threshold only in GUSTS or only in a warning's upper uncertainty range, say the stronger winds "could" / "may" occur — do NOT say the user "will" experience them.
- CONVECTIVE SHEAR BANDS: when judging shear for THUNDERSTORM organization (not aviation turbulence), use the 0–6 km bulk-shear bands provided in the data: <10 m/s = weak (single-pulse cells), 10–18 m/s = moderate (organized multicell), ≥18 m/s = strong (supercell-capable). Do not call ~10–13 m/s "strong". Also separate SPEED shear from DIRECTIONAL shear — if the surface and upper winds point nearly the same way it is mostly speed shear (limited rotation potential) even when the magnitude looks sizable; say so rather than implying supercell risk.
- HEAT INDEX TIMING: heat-index / "feels-like" values apply to the AFTERNOON PEAK (see TODAY'S PEAK HEAT). Never derive a 100°+ heat index from the current or overnight temperature — state the peak value with its approximate time of day (e.g. "heat index near 103°F this afternoon, around 3 PM"), and keep the current/overnight temperature separate.
- Rip Current Statements: if an alert with event "Rip Current Statement" appears in ACTIVE NWS ALERTS, include the exact expiration time from the alert's Ends/Expires field. Do not paraphrase to "later today".
- Aviation section: when storms within ~30 mi are APPROACHING DIRECTLY or NEAR MISS, lead with convective hazards (turbulence, lightning, IFR in TSRA, possible convective downdrafts) rather than the VFR/MVFR ceiling-visibility category. It is misleading to call conditions VFR while thunderstorms are expected — if you mention the flight category, immediately qualify it with the convective threat.
- AVIATION — CEILING & ICING DISCIPLINE: a "ceiling" is the lowest BROKEN or OVERCAST layer in the METAR. If the observation shows only FEW/SCT, there is NO ceiling — do not report one, and never present model cloud cover as an observed ceiling (if you use it, label it "model estimate"). Do NOT mention icing unless the data actually supports it (a freezing level low enough to matter for the altitudes being discussed, or an icing AIRMET) — warm-season low-level flight around convection is a turbulence/downdraft story, not an icing story. Don't assert "no turbulence expected outside convection" as a fact; attribute it ("no turbulence indicators in this data — check PIREPs/AIRMETs").
- AVIATION — EVIDENCE-GATE THE STRONG CLAIMS: do NOT assert "severe turbulence", "microbursts", or a categorical no-go ("do not attempt VFR", "remain grounded until 6 PM") unless the data supports it (a SIGMET/AIRMET, PIREP, TAF, active NWS warning, or a strong shear/DCAPE signal). With weak shear and reflectivity alone, say "possible convective downdrafts and turbulence near the cells" and recommend the pilot obtain an official FAA/1800wxbrief briefing, current TAFs and SIGMETs before flight — frame it as "VFR flight through the rainband window would carry substantial risk", not a personal dispatch order. Do NOT promise conditions improve after a specific clock hour unless a TAF or forecast explicitly says so.
- Marine section: when storms are approaching or grazing, explicitly note that gusty outflow winds (and a possible wind shift) may arrive before the storm core itself reaches the coast/water. Boaters should reduce sail and seek shelter ahead of the visible cell.
- When the Area Forecast Discussion is available, you synthesize it — explain what synoptic features are driving the weather, what the forecasters are confident about vs uncertain about, and what that means for the next 6-12 hours in plain language
- For calm weather, keep it brief and conversational — don't manufacture drama when conditions are benign
- RADAR LIMITATION CAVEAT: radar under-samples very light stratiform rain, drizzle and mist near the ground (the beam overshoots low precip, especially far from the radar site). When you report that there's no rain / radar is clear AND the moisture picture makes light rain plausible (high humidity, small temp–dewpoint spread, or a wet forecast), add ONE brief line that radar can miss light drizzle/mist right at the user's location, so "clear on radar" isn't a guarantee it's dry outside. Keep it to a single caveat, match the chosen tone (a light, humorous touch is fine when the tone is friendly/humorous), and skip it on a clearly dry, low-humidity day — don't over-hedge.
- For dangerous weather, drop all humor and be direct about life safety
- SINGLE SOURCE OF TRUTH (INBOUND): The STORM FILTER, STORM DATA, STORMS TAB FORECAST, and ACTIVE NWS ALERTS sections below are the EXACT cells and wording the user is looking at on the Storms and Alerts tabs after their filter is applied. For the INBOUND summary (Subsection 1), do not contradict, re-rank, or invent additional cells, and do not promote filtered-out cells into the inbound set. Mirror those numbers so the user sees consistent counts, distances, ETAs, and dBZ values across the Storms tab, System Briefing, and AI Briefing. If the user's filter has hidden the strongest cells, acknowledge that explicitly ("with your Threats-only filter on, the 55 dBZ cell to the NE is hidden") rather than reaching for the raw scan. NON-INBOUND EXCEPTION: the "Elsewhere on Radar" subsection is *deliberately* drawn from the FULL unfiltered scan (background MISS/DISTANT/FAR, passing, moving-away, overhead) for situational awareness — summarizing those buckets there is required, NOT a violation of this rule. The filter governs the inbound set only.
- SUMMARIZE, DO NOT LIST: The user can already see every inbound cell — exact distance, dBZ, ETA, closing speed — on their Storms tab. Your job in the briefing is to SUMMARIZE, not to re-list. Do NOT write one bullet per cell. Describe the inbound threat as a short narrative that highlights the two things that actually matter: the SOONEST cell (when rain first arrives and what it will feel like) and the STRONGEST cell (the peak intensity expected at the user's location and roughly when it hits). If one cell is both the soonest and the strongest, say so once. Everything else is context — point the user to the Storms tab rather than enumerating it.
    * **Inbound** = a short summary highlighting the soonest + strongest cells. NOT a per-cell bullet list.
    * **Non-inbound** (background MISS / DISTANT / FAR, passing, moving-away) = a quick visual scene, also a summary. Paint a picture the user can grasp without reading a list: "a ring of light returns sits 25-35 mi to the NE, drifting away", "a band of moderate cells is sliding past well to your south". Use geometry/motion words (ring, band, line, cluster, arc, scattered, parked, drifting, sliding, receding). Do NOT enumerate non-inbound cells one by one — not even the strong (≥45 dBZ) ones. If the single strongest cell on the whole screen is non-inbound and louder than anything inbound, you may name THAT ONE cell in a sentence (dBZ + direction + motion + "not headed your way") for awareness; do not call out the others.
- HIGH CELL COUNT = BROAD RAIN, NOT MANY STORMS: When the inbound cell count is high (roughly 15+), the radar is resolving a single continuous line or broad area of rain into many individual returns — it is NOT that many discrete thunderstorms. Lead with the overall band as one feature (its motion, dBZ range, and how long rain will persist at the user's location — e.g. "A broad area of rain is moving in from the WSW and will bring repeated rounds of moderate-to-heavy rain over the next hour"). Never imply the raw cell count equals a number of separate storms (do NOT write "142 storms are approaching"); if you reference the count at all, frame it as returns within one rain shield and send the user to the Storms tab for the full list rather than enumerating them.
- MANDATORY TWO-SUBSECTION STRUCTURE for **Active Threats & Storm Tracking** (inbound first, then everything else for situational awareness). Never collapse the two halves into one paragraph and never skip the second half.
    * **Subsection 1 — Inbound (in your impact corridor):** a short summary (1-3 sentences, NOT a per-cell bullet list) of the DIRECT / NEAR DIRECT / NEAR MISS cells the user's filter shows. Frame the overall band, then highlight the SOONEST cell (nearest ETA — when rain arrives, what to expect) and the STRONGEST cell (highest dBZ-at-user — peak intensity and roughly when). Quote each highlighted cell's tier emoji, dBZ (with the [!dbz:NN] tag), direction, and ETA. Do NOT list the remaining cells individually — refer the user to the Storms tab for the full set.
    * **Subsection 2 — Elsewhere on Radar (situational awareness):** a short prose block (1-3 sentences, NOT a bullet list) summarizing the NON-inbound buckets (background MISS / DISTANT / FAR, PASSING, MOVING AWAY, OVERHEAD / ARRIVED) by direction. Group cells with geometry/motion words — do NOT enumerate them one by one. If the single strongest cell on radar is non-inbound and stronger than anything inbound, you may name THAT ONE cell (dBZ + direction + motion + threat verdict) so the user knows the loudest part of the screen is being tracked; do not call out the rest. Use the SCENE HINTS lines below STORM DATA as ready-made phrasings to quote, rephrase, or combine.
    * **Header label:** prefix Subsection 2 with the literal label "**Elsewhere on Radar:**". If the user later asks "what about the stuff to the north?" they should be able to find it under that label.
    * If ALL non-inbound buckets are empty (background, passing, moving away, AND overhead/arrived all zero), Subsection 2 reads exactly: "**Elsewhere on Radar:** nothing else of note on radar — the inbound rain above is the whole story."
    * Subsection 2 is **additive** to Subsection 1, not a replacement. Do not skip Subsection 2 just because Subsection 1 already summarized the threat.
    * NEVER write "no other notable storms" or "nothing else on radar" as a contradiction of the STORM DATA block. If STORM DATA shows non-zero counts in any non-inbound bucket, summarize them in Subsection 2.

${urgencyPrefix} ${urgencyStyle}
${toneInstr}
${detailInstr}

=== LIVE WEATHER DATA ===
${ctx}

RESPONSE FORMAT:
Write in flowing paragraphs under these section headers. Skip any section that has no relevant data — do NOT write a section just to say "no data available."

🎯 Bottom Line
Start here — this is what the reader needs before anything else. In 2-4 tight sentences, answer the who/what/when/where/how/why for THIS user: WHAT is happening at their exact location right now, WHEN the next meaningful change arrives (and roughly how long it lasts), WHERE the main feature is relative to them, HOW significant the main hazard is, and briefly WHY (the driver) — then end with your confidence (high / moderate / low) in plain words. Lead with the user's own impact, not the regional synoptic picture. If conditions are calm, say so plainly and keep it to a sentence or two.

🌐 Situation Overview
The deeper "why" behind the Bottom Line. Synoptic setup, frontal positions, pressure patterns, and the AFD synthesis if available — what's driving today's weather and what changes are expected in the next 6-12 hours. This frames the detail that follows; don't just repeat the Bottom Line.

⛈️ Active Threats & Storm Tracking
Only include if storms >= 31 dBZ exist OR active NWS alerts are present. Lead with alerts. The section is split into TWO mandatory subsections: first an **inbound summary** (DIRECT / NEAR DIRECT / NEAR MISS — the filtered cells the user sees on their Storms tab) that frames the overall band and highlights the SOONEST and STRONGEST cells WITHOUT listing each one, then a **"Elsewhere on Radar:"** subsection (1-3 narrative sentences) summarizing the non-inbound buckets (background MISS/DISTANT/FAR, PASSING, MOVING AWAY, OVERHEAD/ARRIVED) by direction. Do NOT enumerate cells one-by-one in either subsection — the Storms tab is the full per-cell list. If the single strongest cell on radar is non-inbound and stronger than anything inbound, you may name THAT ONE cell for awareness. If ALL non-inbound buckets are empty, the second subsection reads exactly: "Elsewhere on Radar: nothing else of note on radar — the inbound rain above is the whole story." See the MANDATORY TWO-SUBSECTION STRUCTURE rule above for full requirements; the second subsection is NOT optional.

🚸 Public Safety & Outdoor Guidance
Practical advice for the general public. Should you be outside? Driving risks? Heat/cold concerns? What to watch for and when conditions change. Keep this conversational and actionable.

✈️ Aviation & Marine Briefing
Combined section for pilots and mariners. IMPORTANT: Always include knots alongside the user's preferred wind unit if it is not knots (e.g. "SW at 35 km/h (19 kts)"). When any APPROACHING DIRECTLY or NEAR MISS storm exists within ~30 mi, LEAD with convective hazards (turbulence, microburst potential, lightning, IFR in TSRA, hail) — only mention the VFR/MVFR flight category after the convective threat is stated, and qualify it (e.g. "currently VFR but TSRA expected within 40 min"). When no storms threaten, lead with the flight category and limiting factor (ceiling vs visibility) — tied to the actual METAR observation, not framed as TAF facts (no TAF is provided in this data). Report winds aloft with altitudes. Wind shear assessment — note any shear exceeding 25 kts per 2,000 ft. Density altitude if available. METAR highlights. Then transition to marine conditions: surface wind sustained and gusts (say whether observed or model), and small craft advisory or gale RELEVANCE (whether the wind meets the criteria — not a claim that one is in effect unless it appears in ACTIVE NWS ALERTS). SEA STATE & OVER-WATER VISIBILITY: no wave or marine-visibility observation is provided in this data — you may give a qualitative sea-state estimate derived from the wind, but label it as such ("estimated from wind — not an official coastal waters forecast") and never quote precise wave heights or over-water visibility as fact. When storms are direct/near-miss, explicitly note that outflow winds and a possible wind shift may arrive BEFORE the storm core. Thunderstorm avoidance guidance if applicable.

RULES:
- IMPORTANT: Use the units specified in USER UNITS for ALL measurements in your response. If the user has wind set to km/h, report winds in km/h — not mph or knots. If temperature is °C, use °C. If distance is km, use km. Match their preferences exactly.
- Reference specific numbers from the data whenever possible
- TROPICAL SYSTEMS — VITALS + TORNADO THREAT: for any tropical storm/hurricane affecting or approaching the user, (1) report its max sustained wind, PEAK GUSTS, and MIN CENTRAL PRESSURE from the TROPICAL SYSTEMS data — and if a value is "not published", say so rather than omitting it or guessing; and (2) ALWAYS address the tornado threat — tropical systems commonly spawn brief tornadoes in their outer rain bands, with the risk highest in the RIGHT-FRONT quadrant relative to motion. Use the precomputed "USER QUADRANT" from the TROPICAL SYSTEMS data to say which quadrant the user is in — do NOT infer the quadrant yourself, and do NOT assume "right-front" by default; if the computed quadrant is left-front/rear or "uncertain", say that plainly (the tornado risk is correspondingly lower or indeterminate). If a Tornado Watch/Warning is in the alerts, lead with it; otherwise state the potential in plain terms (usually low but non-zero in the outer bands, and lower still outside the right-front quadrant) and what to do if a warning is issued. If the risk is genuinely negligible, say "tornadoes are not expected" — never leave tornadoes out of a tropical briefing entirely, and include a tornado line in any Risk Assessment summary.
- Work with the data you have; briefly disclose a missing, stale, or unavailable source ONLY when it materially changes your confidence or the conclusion (e.g. "the nearest weather station is 60 mi away, so overhead conditions are estimated"). Don't clutter a calm briefing with caveats that don't matter.
- GEOGRAPHY YOU CAN'T VERIFY: you are given the USER's coordinates, but NOT coordinates for the cities/highways/counties named inside alerts or the AFD. So you may state a distance/direction to such a landmark ONLY when the data explicitly provides that relationship. Otherwise, relay the official place name as written and describe its position in general terms you can support (e.g. "to your west, inland") — never fabricate a specific mileage or precise bearing to a landmark you haven't been given coordinates for.
- LENGTH & NO REPETITION: aim for 700–1000 words for standard detail (hard cap ~1000), under 400 for minimal, under 2000 for technical. State each safety action and each fact ONCE — do not repeat "secure loose items", "stay indoors", "avoid the water", or the rain timing across multiple sections. The Risk Assessment table SUMMARIZES the briefing in one row per hazard; it must NOT restate the full paragraphs above it.
- For safety-critical situations, err on the side of caution
- If all conditions are calm and clear, a 3-4 sentence summary is perfectly fine — don't pad`;
}

// Provider-agnostic single completion. Returns {ok,status,text,errMsg}; throws
// only on network error / abort so the caller's retry loop can handle it. The
// system prompt is passed separately because OpenAI takes it as the first
// message while Anthropic takes it as a top-level `system` param.
async function _aiComplete(history,sysPrompt,opts){
  const o=opts||{};
  const maxTokens=o.maxTokens||2500;
  const temperature=(typeof o.temperature==='number')?o.temperature:0.4;
  const signal=o.signal;
  const provider=getAIProvider();
  const key=getActiveAIKey();
  const model=getActiveAIModel();
  const turns=(history||[]).filter(m=>m&&(m.role==='user'||m.role==='assistant'));
  if(provider==='anthropic'){
    // Anthropic requires the messages array to START with a user turn; after
    // trimming to the last N, drop any leading assistant turns.
    let msgs=turns;
    while(msgs.length&&msgs[0].role!=='user')msgs=msgs.slice(1);
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model,max_tokens:maxTokens,temperature,system:sysPrompt,messages:msgs}),
      signal
    });
    if(!res.ok){const err=await res.json().catch(()=>({}));return{ok:false,status:res.status,text:null,errMsg:(err&&err.error&&err.error.message)||('API error '+res.status)};}
    const data=await res.json();
    const block=Array.isArray(data.content)?data.content.find(b=>b&&b.type==='text'):null;
    return{ok:true,status:res.status,text:(block&&block.text)||'',errMsg:''};
  }
  // OpenAI (default): system is the first message.
  const msgs=[{role:'system',content:sysPrompt},...turns];
  const res=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body:JSON.stringify({model,messages:msgs,max_tokens:maxTokens,temperature}),
    signal
  });
  if(!res.ok){const err=await res.json().catch(()=>({}));return{ok:false,status:res.status,text:null,errMsg:(err&&err.error&&err.error.message)||('API error '+res.status)};}
  const data=await res.json();
  return{ok:true,status:res.status,text:(data.choices&&data.choices[0]&&data.choices[0].message&&data.choices[0].message.content)||'',errMsg:''};
}
async function sendAIChat(_opts){
  const o=_opts||{};
  // v6.34: a Full Briefing runs as a DEDICATED call — no prior chat history in
  // the request (all weather data lives in the freshly-built system prompt, so
  // the briefing needs no conversation carry-over) and a low temperature, so it
  // reports the supplied numbers instead of drifting into extra confidence.
  const isBriefing=!!o.briefing;
  const inp=document.getElementById('ai-chat-input');if(!inp)return;
  const msg=inp.value.trim();if(!msg)return;
  inp.value='';

  const key=getActiveAIKey();
  if(!key){
    addAIMsg('user',msg);
    addAIMsg('error','No API key configured. Add your '+getAIProviderLabel()+' API key in Settings (gear icon) under AI Weather Assistant, or tap "Full briefing" to get a deterministic on-device briefing instead.');
    return;
  }

  addAIMsg('user',msg);
  _aiChatHistory.push({role:'user',content:msg});
  showAITyping();

  // v4.59 / v4.61: retry chain. Up to 3 attempts, each with a 60s timeout
  // (AbortController). v4.61 bumped from 30s -> 60s because the model is
  // processing a lot of context (storms, METAR, AFD, alerts, shear, etc.)
  // and on slower connections legitimate responses were sometimes pushing
  // close to a minute; 30s was cutting off real responses, not just dead
  // sockets. A visible countdown tells the user which attempt is running
  // and how many seconds remain. Non-network failures (401 bad key, 429
  // rate limit, 402 quota) skip the retry — those won't fix themselves
  // by trying again. Network errors / timeouts / 5xx server errors retry.
  const MAX_ATTEMPTS=3;
  const PER_ATTEMPT_MS=120000; // v6.14: 5000-token briefings take longer to generate — give each attempt 2 min so a long full briefing isn't aborted mid-stream
  const sysPrompt=getAISystemPrompt();
  // Briefing: send ONLY the trigger turn (no prior chat). Chat: last 10 turns.
  const history=isBriefing?_aiChatHistory.slice(-1):_aiChatHistory.slice(-10);
  const _reqTemp=isBriefing?0.15:0.4;
  let attempt=0;
  let lastErrMsg='';
  while(attempt<MAX_ATTEMPTS){
    attempt++;
    _startAICountdown(PER_ATTEMPT_MS/1000,attempt,MAX_ATTEMPTS);
    const ctrl=new AbortController();
    const to=setTimeout(()=>ctrl.abort(),PER_ATTEMPT_MS);
    try{
      const result=await _aiComplete(history,sysPrompt,{maxTokens:5000,temperature:_reqTemp,signal:ctrl.signal});
      clearTimeout(to);
      _stopAICountdown();

      if(!result.ok){
        const errMsg=result.errMsg;
        lastErrMsg=errMsg;
        const provLabel=getAIProviderLabel();
        const billUrl=getAIProvider()==='anthropic'?'console.anthropic.com':'platform.openai.com';
        // Non-retryable: don't burn attempts on errors that won't fix themselves.
        if(result.status===401){hideAITyping();addAIMsg('error','Invalid API key. Please check your '+provLabel+' API key in Settings.');return}
        if(result.status===429){hideAITyping();addAIMsg('error','Rate limit exceeded. Please wait a moment and try again.');return}
        if(result.status===402||(result.status===400&&errMsg.includes('quota'))){hideAITyping();addAIMsg('error','API quota exceeded. Check your '+provLabel+' billing at '+billUrl+'.');return}
        // 5xx server errors AND Anthropic 529 (overloaded, ≥500) — retry if attempts remain.
        if(result.status>=500&&attempt<MAX_ATTEMPTS){console.log(`AI retry: HTTP ${result.status} on attempt ${attempt}`);continue}
        hideAITyping();
        addAIMsg('error','API error: '+errMsg);
        return;
      }

      const reply=result.text||'No response received.';
      _aiChatHistory.push({role:'assistant',content:reply});
      hideAITyping();
      addAIMsg('assistant',reply);
      if(_aiChatHistory.length>20)_aiChatHistory.splice(0,_aiChatHistory.length-14);
      return;
    }catch(e){
      clearTimeout(to);
      _stopAICountdown();
      const wasAbort=e.name==='AbortError';
      lastErrMsg=wasAbort?('timed out after '+Math.round(PER_ATTEMPT_MS/1000)+'s'):e.message;
      console.log(`AI attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastErrMsg}`);
      if(attempt<MAX_ATTEMPTS){
        _showAIStatus(`Attempt ${attempt} ${wasAbort?'timed out':'failed'} — retrying…`);
        await new Promise(r=>setTimeout(r,800));
        continue;
      }
      hideAITyping();
      addAIMsg('error','Three failed attempts. Internet connection is weak — try moving to a different location or connecting to Wi-Fi, then ask again. (Last error: '+lastErrMsg+')');
      return;
    }
  }
}

