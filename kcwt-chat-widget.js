/* KC Watch Trading — embeddable chat widget.
   Include once:  <script src="kcwt-chat-widget.js" defer></script>
   Open from any button:  onclick="openKCWTChat();return false;"            */
(function(){
  if (window.__kcwtChatLoaded) return; window.__kcwtChatLoaded = true;

  function boot(){
    // styles
    var style = document.createElement('style');
    style.textContent = `
  :root{
    --bg:#070707; --panel:#141414; --panel2:#1c1c1c;
    --gold:#C5B38C; --gold-dim:#8f815f; --green:#02321C;
    --text:#ececec; --muted:#8a8a8a; --line:#242424;
    --serif:'Cormorant Garamond',Georgia,serif; --sans:'Montserrat',system-ui,sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}

  .launch{position:fixed;bottom:24px;right:24px;z-index:99998;background:var(--panel);
    border:1px solid var(--gold);color:var(--gold);font-family:var(--sans);font-size:13px;font-weight:500;
    letter-spacing:1.2px;text-transform:uppercase;padding:14px 22px;border-radius:40px;cursor:pointer;
    display:flex;align-items:center;gap:10px;transition:all .25s}
  .launch:hover{background:var(--gold);color:#070707}
  .launch .dot{width:7px;height:7px;border-radius:50%;background:#5fd07a;box-shadow:0 0 0 0 rgba(95,208,122,.5);
    animation:pulse 2s infinite}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(95,208,122,.5)}70%{box-shadow:0 0 0 7px rgba(95,208,122,0)}100%{box-shadow:0 0 0 0 rgba(95,208,122,0)}}

  .overlay{position:fixed;inset:0;z-index:99999;display:none;align-items:flex-end;justify-content:flex-end;padding:24px}
  .overlay.open{display:flex}
  .chat{width:100%;max-width:400px;height:540px;max-height:88%;background:var(--panel);
    border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;
    box-shadow:0 30px 80px rgba(0,0,0,.65)}

  .chead{padding:16px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;
    background:linear-gradient(180deg,#0f0f0f,#0a0a0a)}
  .avatar{width:38px;height:38px;border-radius:50%;background:var(--green);border:1px solid var(--gold-dim);
    display:flex;align-items:center;justify-content:center;font-family:var(--serif);font-weight:600;color:var(--gold);font-size:18px}
  .chead .who{flex:1}
  .chead .who b{font-family:var(--serif);font-size:18px;font-weight:600;color:var(--text);letter-spacing:.3px}
  .chead .who span{display:block;font-size:11px;color:#5fd07a;letter-spacing:.5px;margin-top:1px}
  .cclose{background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1;padding:2px 6px}
  .cclose:hover{color:var(--gold)}

  .thread{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px;background:#111}
  .thread::-webkit-scrollbar{width:5px}.thread::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:3px}
  .msg{max-width:80%;padding:11px 14px;font-size:14px;line-height:1.5;border-radius:14px;white-space:pre-wrap;color:var(--text)}
  .msg.sam{align-self:flex-start;background:var(--panel2);border:1px solid var(--line);border-bottom-left-radius:4px;color:var(--text)}
  .msg.me{align-self:flex-end;background:var(--gold);color:#070707;border-bottom-right-radius:4px;font-weight:500}
  .msg.human{align-self:flex-start;background:#13261c;border:1px solid var(--gold-dim);border-bottom-left-radius:4px}
  .msg.human .tag{display:block;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--gold);margin-bottom:3px}
  .typing{align-self:flex-start;display:flex;gap:4px;padding:13px 15px;background:var(--panel2);
    border:1px solid var(--line);border-radius:14px;border-bottom-left-radius:4px}
  .typing i{width:6px;height:6px;border-radius:50%;background:var(--gold-dim);animation:bob 1.2s infinite}
  .typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
  @keyframes bob{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}

  .cfoot{padding:12px 14px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center}
  .cfoot input{flex:1;background:var(--panel2);border:1px solid var(--line);color:var(--text);
    font-family:var(--sans);font-size:14px;padding:11px 14px;border-radius:24px;outline:none}
  .cfoot input:focus{border-color:var(--gold)}
  .cfoot input::placeholder{color:#888}
  .send{background:var(--gold);border:none;width:40px;height:40px;border-radius:50%;cursor:pointer;
    flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:opacity .2s}
  .send:hover{opacity:.85}
  .send svg{width:18px;height:18px;fill:#070707}

  .attach{background:none;border:none;cursor:pointer;flex-shrink:0;width:34px;height:34px;
    display:flex;align-items:center;justify-content:center;padding:0}
  .attach svg{width:20px;height:20px;stroke:var(--muted);fill:none;stroke-width:1.8}
  .attach:hover svg{stroke:var(--gold)}
  .photopick{display:flex;flex-wrap:wrap;gap:7px;padding:0 18px 10px}
  .photopick .lbl{width:100%;font-size:12px;color:var(--muted);margin-bottom:2px}
  .pchip{background:var(--panel2);border:1px solid var(--line);color:var(--text);font-family:var(--sans);
    font-size:12px;padding:8px 13px;border-radius:20px;cursor:pointer;transition:all .18s}
  .pchip:hover{border-color:var(--gold);color:var(--gold)}
  .pchip.cancel{color:var(--muted)}
  .msg.photo{padding:6px;background:var(--panel2);border:1px solid var(--line)}
  .msg.photo img{display:block;width:150px;max-width:100%;border-radius:9px}
  .msg.photo .cap{font-size:11px;letter-spacing:.5px;color:var(--gold);text-transform:uppercase;
    margin:6px 2px 2px;text-align:center}
`;
    document.head.appendChild(style);
    // markup
    var root = document.createElement('div');
    root.id = 'kcwt-chat-root';
    root.innerHTML = `  <button class="launch" id="launch"><span class="dot"></span>Sell or Buy a Watch</button>
<div class="overlay" id="overlay">
    <div class="chat">
      <div class="chead">
        <div class="avatar">KC</div>
        <div class="who"><b>KC Watch Trading</b><span>● Concierge — online</span></div>
        <button class="cclose" id="cclose">&times;</button>
      </div>
      <div class="thread" id="thread"></div>
      <div class="photopick" id="photopick" style="display:none">
        <span class="lbl">What's this a photo of?</span>
        <button class="pchip" data-t="face">Watch face</button>
        <button class="pchip" data-t="bracelet">Bracelet (both sides)</button>
        <button class="pchip" data-t="clasp">Buckle / clasp</button>
        <button class="pchip" data-t="case">Case (both sides)</button>
        <button class="pchip" data-t="papers">Box, papers &amp; accessories</button>
        <button class="pchip cancel" data-t="cancel">Cancel</button>
      </div>
      <div class="cfoot">
        <button class="attach" id="attach" aria-label="Add photo">
          <svg viewBox="0 0 24 24"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10 18.2a1.6 1.6 0 0 1-2.3-2.3l7.8-7.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <input type="file" id="photofile" accept="image/*" style="display:none">
        <input id="field" placeholder="Type a message…" autocomplete="off">
        <button class="send" id="send" aria-label="Send">
          <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
        </button>
      </div>
    </div>`;
    document.body.appendChild(root);
    // behavior

  // ===== CONFIG =====
  // The widget reads the LIVE tunnel URL from a pointer file published on the site,
  // so it auto-follows the tunnel even when that URL changes (e.g. after a reboot).
  const POINTER  = "/chat-endpoint.txt";   // same-origin once deployed on kcwatchtrading.com
  const FALLBACK = "https://constitutes-electronics-likes-gaps.trycloudflare.com/chat";  // used if the pointer can't be read (e.g. opening the file locally)
  // ==================
  let activeEndpoint = FALLBACK;
  const DEMO = FALLBACK.includes("YOUR-TUNNEL");
  const uploadUrl = () => activeEndpoint.replace(/\/chat$/, "/upload");
  const sessionId = "web_" + Math.random().toString(36).slice(2,10);
  let lastTs = 0, pollTimer = null;

  // Read the current tunnel URL from the pointer file (cache-busted). Falls back silently.
  async function resolveEndpoint(){
    try{
      const r = await fetch(POINTER + "?t=" + Date.now(), { cache: "no-store" });
      if(r.ok){
        const txt = (await r.text()).trim();
        if(/^https:\/\/\S+\/chat$/.test(txt)) activeEndpoint = txt;
      }
    }catch(e){ /* keep fallback — e.g. local file testing */ }
  }

  const $=id=>document.getElementById(id);
  const overlay=$("overlay"), thread=$("thread"), field=$("field");

  async function openChat(){
    overlay.classList.add("open"); field.focus();
    if(!thread.children.length){
      if(DEMO){ greet(); }
      else { await resolveEndpoint(); openSession(); }
    }
    if(!DEMO&&!pollTimer)pollTimer=setInterval(poll,4000);
  }
  if($("launch")) $("launch").onclick=openChat;
  window.openKCWTChat=openChat;   // CTAs call this to open the widget

  // Ask the server (Sam) for the opening greeting so there's only ONE welcome
  function openSession(){
    typing(true);
    fetch(activeEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sessionId,message:"__open__",visitor:{ts:Date.now()}})})
      .then(r=>r.json()).then(d=>{typing(false);
        if(d&&d.reply)bubble(d.reply,"sam");
        if(d&&d.ts)lastTs=d.ts;
      }).catch(()=>{typing(false);bubble("Welcome to KC Watch Trading — one moment.","sam");});
  }
  $("cclose").onclick=()=>overlay.classList.remove("open");

  function bubble(text,cls,tag){
    const d=document.createElement("div"); d.className="msg "+cls;
    if(tag) d.innerHTML='<span class="tag">'+tag+'</span>'+escapeHtml(text); else d.textContent=text;
    thread.appendChild(d); thread.scrollTop=thread.scrollHeight; return d;
  }
  function escapeHtml(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
  function typing(on){
    let t=$("typingDots");
    if(on&&!t){t=document.createElement("div");t.className="typing";t.id="typingDots";
      t.innerHTML="<i></i><i></i><i></i>";thread.appendChild(t);thread.scrollTop=thread.scrollHeight;}
    if(!on&&t)t.remove();
  }

  function greet(){
    bubble("Welcome to KC Watch Trading. Are you looking to sell a watch, or buy one? I can help with either.","sam");
  }

  $("send").onclick=sendMsg;
  field.addEventListener("keydown",e=>{if(e.key==="Enter")sendMsg();});

  function sendMsg(){
    const text=field.value.trim(); if(!text)return;
    bubble(text,"me"); field.value="";
    if(DEMO){ demoReply(text); return; }
    typing(true);
    postChat(text, true);
  }

  function postChat(text, allowRetry){
    fetch(activeEndpoint,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sessionId,message:text,visitor:{ts:Date.now()}})})
      .then(r=>{ if(!r.ok) throw new Error("bad status"); return r.json(); })
      .then(d=>{typing(false);
        if(d&&d.reply)bubble(d.reply, d.handledBy==="human"?"human":"sam", d.handledBy==="human"?"Gary":null);
        if(d&&d.ts)lastTs=d.ts;
      }).catch(async ()=>{
        if(allowRetry){ await resolveEndpoint(); postChat(text, false); }  // self-heal: tunnel URL may have changed
        else { typing(false); bubble("Connection hiccup — give that one more try.","sam"); }
      });
  }

  // Async messages (e.g. Gary takes over from Telegram) arrive via polling
  function poll(){
    fetch(activeEndpoint+"?sessionId="+sessionId+"&since="+lastTs)
      .then(r=>r.json()).then(d=>{
        if(d&&d.messages)d.messages.forEach(m=>{
          bubble(m.text, m.from==="gary"?"human":"sam", m.from==="gary"?"Gary":null); lastTs=m.ts||lastTs;
        });
      }).catch(()=>{});
  }

  // ---- photo upload (matches Sam's /upload contract: sessionId, photoType, imageData) ----
  const photopick=$("photopick"), photofile=$("photofile");
  let pendingType=null;

  $("attach").onclick=()=>{ photopick.style.display = photopick.style.display==="none" ? "flex" : "none"; };
  photopick.querySelectorAll(".pchip").forEach(c=>c.onclick=()=>{
    photopick.style.display="none";
    if(c.dataset.t==="cancel"){pendingType=null;return;}
    pendingType=c.dataset.t; photofile.click();
  });
  photofile.onchange=e=>{
    const f=e.target.files[0]; photofile.value=""; if(!f||!pendingType)return;
    const type=pendingType; pendingType=null;
    const r=new FileReader();
    r.onload=ev=>{
      const dataUri=ev.target.result;
      const label={face:"Watch face",bracelet:"Bracelet (both sides)",clasp:"Buckle / clasp",case:"Case (both sides)",papers:"Box, papers & accessories"}[type]||type;
      // show it in the thread immediately
      const d=document.createElement("div"); d.className="msg me photo";
      d.innerHTML='<img src="'+dataUri+'"><div class="cap">'+label+'</div>';
      thread.appendChild(d); thread.scrollTop=thread.scrollHeight;
      if(DEMO){ setTimeout(()=>bubble("Got the "+label.toLowerCase()+" shot — thanks.","sam"),500); return; }
      fetch(uploadUrl(),{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({sessionId,photoType:type,imageData:dataUri})})
        .then(r=>r.json()).then(res=>{ if(res&&res.error)bubble("That photo didn't go through — mind trying again?","sam"); })
        .catch(()=>bubble("That photo didn't upload — try once more?","sam"));
    };
    r.readAsDataURL(f);
  };

  // ---- demo brain (front-end only; the real brain is Sam on the Surface) ----
  let demoStep=0;
  function demoReply(text){
    typing(true);
    const t=text.toLowerCase();
    let r;
    if(demoStep===0 && /(buy|purchas|looking for|interested in)/.test(t)){
      r="Great — what are you hoping to add to the collection? Brand and model if you have one in mind, and I'll check what we have access to."; demoStep=9;
    } else if(demoStep===0){
      r="Perfect — let's get you a fast offer. What brand and model are we talking about?"; demoStep=1;
    } else if(demoStep===1){
      r="Beautiful piece. Do you have the reference number, and is it a full set — box and papers?"; demoStep=2;
    } else if(demoStep===2){
      r="Got it. How would you describe the condition, and roughly what year? A few photos help too — face, caseback, and the box/papers if you have them."; demoStep=3;
    } else if(demoStep===3){
      r="Thank you. To finalize numbers we verify in person. When could you bring it by, or would you prefer we arrange a time this week?"; demoStep=4;
    } else if(demoStep===9){
      r="Noted — I'll pass your interest to Gary with the details and he'll follow up with options and pricing. What's the best way to reach you?"; demoStep=10;
    } else {
      r="Perfect — I've logged everything and Gary will follow up shortly to confirm. Anything else I can help with in the meantime?";
    }
    setTimeout(()=>{typing(false);bubble(r,"sam");}, 700+Math.random()*500);
  }

  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
