// ── Device Link (v6.38) ────────────────────────────────────────────────────
// Move your StormTracker prefs (and, opt-in, your API keys) from one device to
// another WITHOUT any account or server. Everything is packed in-browser,
// encrypted with a PIN you choose (WebCrypto PBKDF2 + AES-GCM), and carried
// either as a scannable QR / link or a copy-paste code. The plaintext — and
// especially your API keys — never leave your devices unencrypted; a relay,
// screenshot, or shoulder-surfer only ever sees ciphertext, useless without the
// PIN. Import decrypts locally and merges into this browser's settings.
//
// Runs in the browser (window.crypto.subtle) and is also unit-testable in Node
// (globalThis.crypto.subtle), so the crypto is verified by a round-trip test.

(function(){
  const _crypto=(typeof globalThis!=='undefined'&&globalThis.crypto&&globalThis.crypto.subtle)?globalThis.crypto:(typeof window!=='undefined'?window.crypto:null);
  const MAGIC='STL1';           // format tag + version — bump if the wire format changes
  const PBKDF2_ITERS=210000;    // OWASP-ish 2024 floor for PBKDF2-SHA256
  const SALT_LEN=16, IV_LEN=12;

  // Secrets — only travel when the user opts in (checkbox). Still PIN-encrypted.
  const DL_SECRET_KEYS=['st_aiKey','st_aiKeyAnthropic','st_pushAiKey','st_lightningKey','st_skylinkKey','st_syncToken','st_pushCode','st_pushFeedToken'];
  // Device-specific / transient — never sync (push subscription is bound to THIS
  // browser; caches, histories, cooldowns and one-time dismissals are noise).
  const DL_SKIP_KEYS=['st_pushSub','st_pushEndpoint','st_installDismissed','st_locAsked','st_notifLog','st_notifSeen','st_notifPromptSeen','st_stRuns','st_tcache','st_spc_reports','st_stormAlertHistory','st_rainAlertHistory','st_wxAlertHistory','st_stormAlertCooldown','st_wxAlertCooldown','st_drizCooldown','st_rovCooldown','st_overheadPoll','st_syncLastTime','st_minDbzMerged_v533'];
  const DL_SKIP_PREFIXES=['st_grid_'];
  function _isSecret(k){return DL_SECRET_KEYS.indexOf(k)>=0;}
  function _isSkipped(k){return DL_SKIP_KEYS.indexOf(k)>=0||DL_SKIP_PREFIXES.some(p=>k.indexOf(p)===0);}

  // ---- base64url (no padding) — safe in a URL fragment and a copy-paste code ----
  function _b64urlEncode(bytes){
    let bin='';for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
    const b64=(typeof btoa!=='undefined')?btoa(bin):Buffer.from(bytes).toString('base64');
    return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function _b64urlDecode(str){
    const b64=str.replace(/-/g,'+').replace(/_/g,'/');
    const bin=(typeof atob!=='undefined')?atob(b64):Buffer.from(b64,'base64').toString('binary');
    const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
    return out;
  }
  const _enc=(typeof TextEncoder!=='undefined')?new TextEncoder():{encode:s=>new Uint8Array(Buffer.from(s,'utf8'))};
  const _dec=(typeof TextDecoder!=='undefined')?new TextDecoder():{decode:b=>Buffer.from(b).toString('utf8')};

  async function _deriveKey(pin,salt){
    const base=await _crypto.subtle.importKey('raw',_enc.encode(String(pin)),{name:'PBKDF2'},false,['deriveKey']);
    return _crypto.subtle.deriveKey(
      {name:'PBKDF2',salt,iterations:PBKDF2_ITERS,hash:'SHA-256'},
      base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }

  // Collect the syncable localStorage snapshot. includeKeys → also pull secrets.
  function DL_collect(includeKeys){
    const store=(typeof localStorage!=='undefined')?localStorage:null;
    const data={};
    if(!store)return data;
    for(let i=0;i<store.length;i++){
      const k=store.key(i);
      if(!k||k.indexOf('st_')!==0)continue;
      if(_isSkipped(k))continue;
      if(_isSecret(k)&&!includeKeys)continue;
      data[k]=store.getItem(k);
    }
    return data;
  }

  // Encrypt a data object → base64url payload string (the "code").
  async function DL_encrypt(dataObj,pin,meta){
    if(!_crypto||!_crypto.subtle)throw new Error('WebCrypto unavailable');
    const salt=_crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv=_crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key=await _deriveKey(pin,salt);
    const plain=_enc.encode(JSON.stringify({v:1,t:(meta&&meta.t)||null,data:dataObj}));
    const ct=new Uint8Array(await _crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain));
    const magic=_enc.encode(MAGIC);
    const blob=new Uint8Array(magic.length+SALT_LEN+IV_LEN+ct.length);
    blob.set(magic,0);blob.set(salt,magic.length);blob.set(iv,magic.length+SALT_LEN);blob.set(ct,magic.length+SALT_LEN+IV_LEN);
    return _b64urlEncode(blob);
  }

  // Decrypt a payload string with the PIN → data object. Throws on wrong PIN /
  // corrupt payload (AES-GCM auth tag fails), which callers surface as a clear
  // "wrong PIN or damaged code" message.
  async function DL_decrypt(payload,pin){
    if(!_crypto||!_crypto.subtle)throw new Error('WebCrypto unavailable');
    const blob=_b64urlDecode(String(payload).trim());
    const magic=_dec.decode(blob.slice(0,MAGIC.length));
    if(magic!==MAGIC)throw new Error('Not a StormTracker link code');
    const salt=blob.slice(MAGIC.length,MAGIC.length+SALT_LEN);
    const iv=blob.slice(MAGIC.length+SALT_LEN,MAGIC.length+SALT_LEN+IV_LEN);
    const ct=blob.slice(MAGIC.length+SALT_LEN+IV_LEN);
    const key=await _deriveKey(pin,salt);
    let plain;
    try{plain=await _crypto.subtle.decrypt({name:'AES-GCM',iv},key,ct);}
    catch(e){throw new Error('Wrong PIN or damaged code');}
    const obj=JSON.parse(_dec.decode(new Uint8Array(plain)));
    return obj;
  }

  // Merge a decrypted snapshot into THIS browser's localStorage. Returns count.
  function DL_apply(obj){
    const store=(typeof localStorage!=='undefined')?localStorage:null;
    if(!store||!obj||!obj.data||typeof obj.data!=='object')return 0;
    let n=0;
    for(const k in obj.data){
      if(!Object.prototype.hasOwnProperty.call(obj.data,k))continue;
      if(k.indexOf('st_')!==0||_isSkipped(k))continue; // defence-in-depth: never write skip keys
      try{store.setItem(k,obj.data[k]);n++;}catch(e){}
    }
    return n;
  }

  const api={DL_collect,DL_encrypt,DL_decrypt,DL_apply,DL_SECRET_KEYS,DL_SKIP_KEYS,_meta:{MAGIC,PBKDF2_ITERS}};
  if(typeof window!=='undefined')Object.assign(window,api);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();

// ── Device-Link UI (browser only) ───────────────────────────────────────────
// PRIMARY: a short "quick code" via the app's own relay (your Cloudflare worker).
// Type a 6-char code on the other device — done. The code is generated AND HASHED
// on this device, so the relay only stores hash(code) + ciphertext and can't read
// your data; the payload decrypts only with the code (+ optional password). Codes
// expire in minutes and are one-time read. FALLBACK: an offline QR / paste code
// that needs no server. All crypto goes through the DL_* API above.
(function(){
  if(typeof document==='undefined')return;
  function _el(id){return document.getElementById(id);}
  function _appBase(){return location.origin+location.pathname;}
  function _relayBase(){try{return (typeof _pushApiUrl==='function')?_pushApiUrl():'https://stormtracker-proxy.joshua-622.workers.dev';}catch(e){return 'https://stormtracker-proxy.joshua-622.workers.dev';}}
  function _genCode(){const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',r=crypto.getRandomValues(new Uint8Array(6));let s='';for(let i=0;i<6;i++)s+=a[r[i]%a.length];return s;}
  function _normCode(x){return String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);}
  async function _addr(code){
    const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('stlink:'+code));
    const b=new Uint8Array(h);let bin='';for(let i=0;i<b.length;i++)bin+=String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'').slice(0,24);
  }
  const _IN='width:100%;box-sizing:border-box;padding:8px;background:var(--bg-base,#0a0f16);border:1px solid var(--border-subtle,#243040);border-radius:8px;color:var(--text-primary,#e6edf5)';
  const _BTN='width:100%;padding:10px;background:var(--accent-cyan,#00e5ff);color:#00202a;border:none;border-radius:8px;font-weight:700;cursor:pointer';

  function _ensureModal(){
    if(_el('devlink-modal'))return;
    const wrap=document.createElement('div');
    wrap.id='devlink-modal';
    wrap.style.cssText='position:fixed;inset:0;z-index:12000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);padding:16px';
    wrap.innerHTML=`
      <div style="background:var(--bg-elevated,#0e141c);border:1px solid var(--border-subtle,#243040);border-radius:14px;max-width:420px;width:100%;max-height:92vh;overflow:auto;padding:18px 16px;box-shadow:0 12px 40px rgba(0,0,0,0.5)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-weight:700;font-size:1.05em;color:var(--text-primary,#e6edf5)">🔗 Link a Device</div>
          <button onclick="dlClose()" style="background:none;border:none;color:var(--text-muted,#8aa);font-size:1.4em;cursor:pointer;line-height:1">×</button>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button id="devlink-tab-send" onclick="dlTab('send')" class="devlink-tab">Send</button>
          <button id="devlink-tab-recv" onclick="dlTab('recv')" class="devlink-tab">Receive</button>
        </div>

        <div id="devlink-send">
          <div style="font-size:0.78em;color:var(--text-secondary,#9fb0c0);line-height:1.5;margin-bottom:10px">Create a short code, then type it into <b>Receive</b> on your other device. The code opens once and expires soon.</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:0.8em;color:var(--text-secondary,#9fb0c0);margin-bottom:10px;cursor:pointer">
            <input type="checkbox" id="devlink-send-keys" style="width:16px;height:16px"> Include my API keys <span style="opacity:0.7">(OpenAI / Claude)</span>
          </label>
          <label style="font-size:0.8em;color:var(--text-secondary,#9fb0c0);display:block;margin-bottom:4px">Password <span style="opacity:0.7">(optional — extra security)</span></label>
          <input id="devlink-send-pw" type="password" placeholder="leave blank for code-only" style="${_IN};font-size:0.9em;margin-bottom:10px">
          <label style="font-size:0.8em;color:var(--text-secondary,#9fb0c0);display:block;margin-bottom:4px">Code expires in</label>
          <select id="devlink-send-ttl" class="small-btn" style="width:100%;margin-bottom:12px">
            <option value="120">2 minutes</option>
            <option value="300">5 minutes</option>
            <option value="600">10 minutes</option>
          </select>
          <button onclick="dlCreateCode()" style="${_BTN}">Create share code</button>
          <div id="devlink-code-out" style="display:none;margin-top:14px;text-align:center">
            <div id="devlink-code-big" style="font-family:var(--font-mono,monospace);font-size:2.1em;font-weight:800;letter-spacing:6px;color:var(--accent-cyan,#00e5ff)"></div>
            <div id="devlink-code-timer" style="font-size:0.75em;color:var(--text-muted,#8aa);margin-top:4px"></div>
            <div id="devlink-code-note" style="font-size:0.7em;color:var(--text-secondary,#9fb0c0);margin-top:8px;line-height:1.4"></div>
          </div>
          <div id="devlink-code-msg" style="font-size:0.8em;margin-top:10px;text-align:center;min-height:1em"></div>
          <details style="margin-top:14px">
            <summary style="font-size:0.78em;color:var(--text-muted,#8aa);cursor:pointer">Send a link — AirDrop, QR, or copy (works offline)</summary>
            <div style="margin-top:10px">
              <label style="font-size:0.8em;color:var(--text-secondary,#9fb0c0);display:block;margin-bottom:4px">PIN (4–8 digits) — needed on the other device to open</label>
              <input id="devlink-send-pin" inputmode="numeric" maxlength="8" placeholder="e.g. 4821" style="${_IN};font-family:var(--font-mono,monospace);font-size:1.1em;letter-spacing:3px;margin-bottom:10px">
              <div style="display:flex;gap:6px;margin-bottom:2px">
                <button onclick="dlShare()" style="${_BTN};flex:1">📤 Share (AirDrop…)</button>
                <button onclick="dlGenerate()" style="flex:1;padding:10px;background:rgba(255,255,255,0.06);border:1px solid var(--border-subtle,#243040);border-radius:8px;color:var(--text-primary,#e6edf5);cursor:pointer;font-weight:600">Show QR</button>
              </div>
              <div id="devlink-send-out" style="display:none;margin-top:12px;text-align:center">
                <canvas id="devlink-qr" width="288" height="288" style="width:min(288px,72vw);height:auto;background:#fff;border-radius:10px;padding:8px;box-sizing:border-box"></canvas>
                <div id="devlink-qr-note" style="font-size:0.72em;color:var(--text-muted,#8aa);margin:8px 0"></div>
                <div style="display:flex;gap:6px">
                  <button onclick="dlCopy('link')" style="flex:1;padding:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border-subtle,#243040);border-radius:8px;color:var(--text-primary,#e6edf5);cursor:pointer;font-size:0.82em">Copy link</button>
                  <button onclick="dlCopy('code')" style="flex:1;padding:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border-subtle,#243040);border-radius:8px;color:var(--text-primary,#e6edf5);cursor:pointer;font-size:0.82em">Copy code</button>
                </div>
              </div>
            </div>
          </details>
        </div>

        <div id="devlink-recv" style="display:none">
          <div style="font-size:0.78em;color:var(--text-secondary,#9fb0c0);line-height:1.5;margin-bottom:10px">Enter the 6-character code shown on your other device (and the password, if one was set).</div>
          <label style="font-size:0.8em;color:var(--text-secondary,#9fb0c0);display:block;margin-bottom:4px">Share code</label>
          <input id="devlink-recv-code2" maxlength="8" placeholder="ABC-DEF" style="${_IN};font-family:var(--font-mono,monospace);font-size:1.4em;letter-spacing:5px;text-align:center;text-transform:uppercase;margin-bottom:10px">
          <label style="font-size:0.8em;color:var(--text-secondary,#9fb0c0);display:block;margin-bottom:4px">Password <span style="opacity:0.7">(if one was set)</span></label>
          <input id="devlink-recv-pw" type="password" placeholder="leave blank if none" style="${_IN};font-size:0.9em;margin-bottom:12px">
          <button onclick="dlFetchCode()" style="${_BTN}">Get settings</button>
          <div id="devlink-recv-msg" style="font-size:0.8em;margin-top:10px;text-align:center;min-height:1em"></div>
          <details style="margin-top:14px">
            <summary style="font-size:0.78em;color:var(--text-muted,#8aa);cursor:pointer">Have a QR link or long code instead?</summary>
            <div style="margin-top:10px">
              <textarea id="devlink-recv-code" rows="3" placeholder="Paste the link or long code here" style="${_IN};font-family:var(--font-mono,monospace);font-size:0.78em;resize:vertical;margin-bottom:10px"></textarea>
              <label style="font-size:0.8em;color:var(--text-secondary,#9fb0c0);display:block;margin-bottom:4px">PIN</label>
              <input id="devlink-recv-pin" inputmode="numeric" maxlength="8" placeholder="PIN" style="${_IN};font-family:var(--font-mono,monospace);font-size:1.1em;letter-spacing:3px;margin-bottom:12px">
              <button onclick="dlImport()" style="${_BTN}">Import from link/code</button>
              <div id="devlink-recv-msg2" style="font-size:0.8em;margin-top:10px;text-align:center;min-height:1em"></div>
            </div>
          </details>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const st=document.createElement('style');
    st.textContent='.devlink-tab{flex:1;padding:7px;background:rgba(255,255,255,0.05);border:1px solid var(--border-subtle,#243040);border-radius:8px;color:var(--text-muted,#8aa);cursor:pointer;font-size:0.85em;font-weight:600}.devlink-tab.active{background:var(--accent-cyan,#00e5ff);color:#00202a;border-color:transparent}';
    document.head.appendChild(st);
  }

  let _lastCode='',_lastLink='',_cdTimer=null;

  window.dlOpen=function(tab){_ensureModal();_el('devlink-modal').style.display='flex';window.dlTab(tab||'send');};
  window.dlClose=function(){const m=_el('devlink-modal');if(m)m.style.display='none';if(_cdTimer){clearInterval(_cdTimer);_cdTimer=null;}};
  window.dlTab=function(t){
    _ensureModal();
    const send=t!=='recv';
    _el('devlink-send').style.display=send?'':'none';
    _el('devlink-recv').style.display=send?'none':'';
    _el('devlink-tab-send').classList.toggle('active',send);
    _el('devlink-tab-recv').classList.toggle('active',!send);
  };

  function _startCountdown(sec){
    if(_cdTimer)clearInterval(_cdTimer);
    let s=sec;const el=_el('devlink-code-timer');
    const tick=()=>{if(!el)return;if(s<=0){el.textContent='⏳ expired — create a new code';el.style.color='#f87171';clearInterval(_cdTimer);_cdTimer=null;return;}el.style.color='';const m=Math.floor(s/60),ss=String(s%60).padStart(2,'0');el.textContent='expires in '+m+':'+ss;s--;};
    tick();_cdTimer=setInterval(tick,1000);
  }

  // ---- Quick code (relay) ----
  window.dlCreateCode=async function(){
    _ensureModal();
    const msg=_el('devlink-code-msg');
    const includeKeys=_el('devlink-send-keys').checked;
    const pw=(_el('devlink-send-pw').value||'').trim();
    const ttl=parseInt(_el('devlink-send-ttl').value,10)||120;
    msg.style.color='var(--text-muted,#8aa)';msg.textContent='Creating code…';
    try{
      const data=window.DL_collect(includeKeys);
      const code=_genCode();
      const blob=await window.DL_encrypt(data,code+'|'+pw,{t:1});
      const id=await _addr(code);
      const res=await fetch(_relayBase()+'/link-put',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,blob,ttl})});
      const j=await res.json().catch(()=>({}));
      if(!res.ok||!j.ok)throw new Error(j.error||('server '+res.status));
      msg.textContent='';
      _el('devlink-code-out').style.display='';
      _el('devlink-code-big').textContent=code.slice(0,3)+'-'+code.slice(3);
      _el('devlink-code-note').textContent=(includeKeys?'Includes your API keys. ':'')+(pw?'Password required on the other device.':'Code-only — anyone with this code can open it until it expires.');
      _startCountdown(j.ttl||ttl);
    }catch(e){msg.style.color='#f87171';msg.textContent='Could not create code: '+e.message;}
  };

  window.dlFetchCode=async function(){
    _ensureModal();
    const msg=_el('devlink-recv-msg');
    const code=_normCode(_el('devlink-recv-code2').value);
    const pw=(_el('devlink-recv-pw').value||'').trim();
    if(code.length<6){msg.style.color='#f87171';msg.textContent='Enter the 6-character code.';return;}
    msg.style.color='var(--text-muted,#8aa)';msg.textContent='Fetching…';
    try{
      const id=await _addr(code);
      const res=await fetch(_relayBase()+'/link-get',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
      if(res.status===404){msg.style.color='#f87171';msg.textContent='Code not found or expired — codes open once and last a few minutes.';return;}
      const j=await res.json().catch(()=>({}));
      if(!res.ok||!j.ok||!j.blob)throw new Error(j.error||('server '+res.status));
      const obj=await window.DL_decrypt(j.blob,code+'|'+pw);
      const n=window.DL_apply(obj);
      msg.style.color='#4ade80';msg.textContent=`Imported ${n} settings ✓ Reloading…`;
      setTimeout(()=>location.reload(),900);
    }catch(e){
      msg.style.color='#f87171';
      msg.textContent=(e.message==='Wrong PIN or damaged code')?'Wrong password for this code.':('Import failed: '+e.message);
    }
  };

  // ---- Offline QR / paste ----
  function _drawQR(canvas,text){
    if(typeof qrcode==='undefined')return false;
    try{
      const qr=qrcode(0,'M');qr.addData(text);qr.make();
      const n=qr.getModuleCount(),quiet=4,total=n+quiet*2;
      const px=Math.max(2,Math.floor(288/total)),size=total*px;
      canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#000';
      for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))ctx.fillRect((c+quiet)*px,(r+quiet)*px,px,px);
      return true;
    }catch(e){return false;}
  }
  window.dlGenerate=async function(){
    _ensureModal();
    const pin=(_el('devlink-send-pin').value||'').trim();
    if(pin.length<4){alert('Choose a PIN of at least 4 digits.');return;}
    const includeKeys=_el('devlink-send-keys').checked;
    try{
      const data=window.DL_collect(includeKeys);
      _lastCode=await window.DL_encrypt(data,pin,{t:1});
      _lastLink=_appBase()+'#link='+_lastCode;
      _el('devlink-send-out').style.display='';
      const ok=_drawQR(_el('devlink-qr'),_lastLink);
      _el('devlink-qr').style.display=ok?'':'none';
      const nKeys=Object.keys(data).length;
      _el('devlink-qr-note').textContent=ok?`Scan with your other device's camera · ${nKeys} settings${includeKeys?' (incl. keys)':''}`:`Too much data for a QR — use Copy link · ${nKeys} settings`;
    }catch(e){alert('Could not generate: '+e.message);}
  };
  // AirDrop-style: hand the encrypted link to the native share sheet. On iPhone/
  // Mac that sheet includes AirDrop; tapping the received link reopens the app on
  // the #link= handler, which auto-fills Import. Encrypted with the PIN, so the
  // shared link is ciphertext. Falls back to copy where navigator.share is absent.
  window.dlShare=async function(){
    _ensureModal();
    const pin=(_el('devlink-send-pin').value||'').trim();
    if(pin.length<4){alert('Choose a PIN of at least 4 digits first.');return;}
    const includeKeys=_el('devlink-send-keys').checked;
    try{
      const data=window.DL_collect(includeKeys);
      _lastCode=await window.DL_encrypt(data,pin,{t:1});
      _lastLink=_appBase()+'#link='+_lastCode;
      if(navigator.share){
        try{ await navigator.share({title:'StormTracker settings',text:'Open on your other device to import these StormTracker settings (PIN required).',url:_lastLink}); }
        catch(e){ /* user cancelled the share sheet — no-op */ }
      }else{
        try{ await navigator.clipboard.writeText(_lastLink); alert('Direct share isn’t available in this browser — the link was copied instead. Paste it into Receive on your other device.'); }
        catch(e){ alert('Direct share isn’t available here. Use “Show QR” or Copy link instead.'); }
      }
    }catch(e){alert('Could not prepare share: '+e.message);}
  };
  window.dlCopy=async function(which){
    const txt=which==='link'?_lastLink:_lastCode;if(!txt)return;
    try{await navigator.clipboard.writeText(txt);}catch(e){const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(_){}ta.remove();}
    const note=_el('devlink-qr-note');if(note){const p=note.textContent;note.textContent='Copied ✓';setTimeout(()=>{note.textContent=p;},1200);}
  };
  window.dlImport=async function(){
    _ensureModal();
    const msg=_el('devlink-recv-msg2');
    let code=(_el('devlink-recv-code').value||'').trim();
    const pin=(_el('devlink-recv-pin').value||'').trim();
    const h=code.indexOf('#link=');if(h>=0)code=code.slice(h+6);
    if(!code){msg.style.color='#f87171';msg.textContent='Paste a link or code first.';return;}
    if(pin.length<4){msg.style.color='#f87171';msg.textContent='Enter the PIN.';return;}
    msg.style.color='var(--text-muted,#8aa)';msg.textContent='Decrypting…';
    try{
      const obj=await window.DL_decrypt(code,pin);
      const n=window.DL_apply(obj);
      msg.style.color='#4ade80';msg.textContent=`Imported ${n} settings ✓ Reloading…`;
      try{location.hash='';}catch(e){}
      setTimeout(()=>location.reload(),900);
    }catch(e){
      msg.style.color='#f87171';msg.textContent=(e.message==='Wrong PIN or damaged code')?'Wrong PIN, or the code was damaged.':('Import failed: '+e.message);
    }
  };

  // Incoming #link= (scanned QR) → open Receive, expand the paste section prefilled.
  function _checkIncoming(){
    try{
      const h=location.hash||'';
      if(h.indexOf('#link=')!==0)return;
      const code=h.slice(6);if(!code)return;
      _ensureModal();
      _el('devlink-recv-code').value=code;
      const det=_el('devlink-recv-code').closest('details');if(det)det.open=true;
      window.dlOpen('recv');
      const msg=_el('devlink-recv-msg2');msg.style.color='var(--text-secondary,#9fb0c0)';msg.textContent='Enter the PIN set on your other device to import.';
    }catch(e){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',_checkIncoming);
  else _checkIncoming();
})();
