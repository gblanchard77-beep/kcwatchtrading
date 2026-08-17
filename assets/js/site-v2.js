/* KC WATCH TRADING — site-v2.js (unified inventory.json) */

/* nav */
(function(){
  var burger=document.getElementById('hamburger'),m=document.getElementById('mobileNav'),s=document.getElementById('navScrim'),x=document.getElementById('mobileNavClose');
  function close(){if(m)m.classList.remove('open');if(s)s.classList.remove('open')}
  if(burger&&m){burger.addEventListener('click',function(){m.classList.toggle('open');if(s)s.classList.toggle('open',m.classList.contains('open'))});}
  if(s)s.addEventListener('click',close);
  if(x)x.addEventListener('click',close);
  if(m)m.querySelectorAll('a').forEach(function(a){a.addEventListener('click',close)});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
})();
/* reveals */
(function(){
  var els=document.querySelectorAll('.reveal');
  if(!els.length)return;
  if(!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('in')});return}
  var io=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},{threshold:.1});
  els.forEach(function(e){io.observe(e)});
})();

/* data */
var KCWT = { data: null };
function loadInventory(){
  if(KCWT._p) return KCWT._p;
  KCWT._p = fetch('assets/data/inventory.json').then(function(r){return r.json()}).then(function(d){KCWT.data=d;return d});
  return KCWT._p;
}
function fmtPrice(p){ if(p===undefined||p===null||p==='')return 'Inquire'; return typeof p==='number' ? '$'+p.toLocaleString('en-US') : p; }
function cardHTML(w, showSold){
  var st=w.status, cls=st==='Sold'?' sold':(st==='Incoming'?' incoming':'');
  var meta=[w.reference,w.year,w.condition,w.set].filter(Boolean).join(' · ');
  return '<a class="a-card'+(st==='Sold'?' sold-fade':'')+'" href="watch.html?w='+encodeURIComponent(w.slug)+'">'+
    '<span class="a-status'+cls+'">'+st+'</span>'+
    '<img loading="lazy" src="'+(w.cardImage||w.image)+'" alt="'+w.brand+' '+w.model+' '+(w.reference||'')+'">'+
    '<div class="a-info"><span class="a-brand">'+w.brand+'</span>'+
    '<span class="a-model">'+w.model+(w.nickname?' \u201C'+w.nickname+'\u201D':'')+'</span>'+
    (meta?'<span class="a-meta">'+meta+'</span>':'')+
    '<span class="a-price">'+(st==='Sold'?'Sold':fmtPrice(w.price))+'</span></div></a>';
}
function sortInv(ws){ return ws.slice().sort(function(a,b){return (a.order||99)-(b.order||99)}); }

document.addEventListener('DOMContentLoaded', function(){
  var needs = ['shopGrid','soldGrid','watchDetail','reviewsMount','newGrid'].some(function(id){return document.getElementById(id)});
  if(!needs) return;
  loadInventory().then(function(d){
    var inv = sortInv(d.watches||[]);

    /* SHOP */
    var shop=document.getElementById('shopGrid');
    if(shop){
      var list=inv.filter(function(w){return w.status!=='Sold'});
      var q=document.getElementById('shopSearch'), fb=document.getElementById('fBrand'), fs=document.getElementById('fStatus'), srt=document.getElementById('shopSort'), rc=document.getElementById('resultCount');
      if(fb){Array.from(new Set(list.map(function(w){return w.brand}))).sort().forEach(function(b){var o=document.createElement('option');o.value=b;o.textContent=b;fb.appendChild(o)});}
      function np(w){return typeof w.price==='number'?w.price:null}
      function apply(){
        var out=list.slice(), t=(q&&q.value||'').trim().toLowerCase();
        if(t)out=out.filter(function(w){return (w.brand+' '+w.model+' '+(w.nickname||'')+' '+(w.reference||'')).toLowerCase().indexOf(t)!==-1});
        if(fb&&fb.value)out=out.filter(function(w){return w.brand===fb.value});
        if(fs&&fs.value)out=out.filter(function(w){return w.status===fs.value});
        var s=srt?srt.value:'newest';
        if(s==='price-asc'||s==='price-desc')out.sort(function(a,b){var pa=np(a),pb=np(b);if(pa===null&&pb===null)return 0;if(pa===null)return 1;if(pb===null)return -1;return s==='price-asc'?pa-pb:pb-pa});
        if(rc)rc.textContent=out.length+(out.length===1?' watch':' watches');
        shop.innerHTML=out.length?out.map(function(w){return cardHTML(w)}).join(''):
          '<div class="empty-state"><p>Inventory moves quickly. Tell us what you are looking for and we will source it through our private dealer network.</p><a class="btn btn-gold inline" href="source.html">Source a Watch</a></div>';
      }
      [q,fb,fs,srt].forEach(function(el){if(el)el.addEventListener(el.tagName==='INPUT'?'input':'change',apply)});
      apply();
    }

    /* NEW ARRIVALS (latest available by order) */
    var ng=document.getElementById('newGrid');
    if(ng){
      var na=inv.filter(function(w){return w.status!=='Sold'});
      ng.innerHTML=na.length?na.map(function(w){return cardHTML(w)}).join(''):
        '<div class="empty-state"><p>Nothing new listed right now — many watches sell before they hit the site. Ask us what is incoming.</p><a class="btn btn-gold inline" href="contact.html">Get in Touch</a></div>';
    }

    /* RECENTLY SOLD */
    var sg=document.getElementById('soldGrid');
    if(sg){
      var sold=inv.filter(function(w){return w.status==='Sold'});
      var bf=document.getElementById('soldBrandFilter');
      function renderSold(list){
        sg.innerHTML=list.length?list.map(function(w){return cardHTML(w)}).join(''):
          '<div class="empty-state"><p>The sold archive is being added. Recent transactions and references from collectors and dealers are available on request.</p><a class="btn btn-gold inline" href="https://instagram.com/kcwatchtrading" target="_blank" rel="noopener">See Recent Sales on Instagram</a></div>';
      }
      if(bf){
        Array.from(new Set(sold.map(function(w){return w.brand}))).sort().forEach(function(b){var o=document.createElement('option');o.value=b;o.textContent=b;bf.appendChild(o)});
        bf.addEventListener('change',function(){renderSold(bf.value?sold.filter(function(w){return w.brand===bf.value}):sold)});
      }
      renderSold(sold);
    }

    /* WATCH DETAIL */
    if(document.getElementById('watchDetail')){
      var slug=new URLSearchParams(location.search).get('w');
      var w=inv.find(function(x){return x.slug===slug})||inv.filter(function(x){return x.status!=='Sold'})[0];
      if(w){
        document.title=w.brand+' '+w.model+' '+(w.reference||'')+' — KC Watch Trading';
        var di=document.getElementById('dImg'); di.src=w.image; di.alt=w.brand+' '+w.model+' '+(w.reference||'');
        document.getElementById('dBrand').textContent=w.brand;
        document.getElementById('dTitle').textContent=w.model;
        var nk=document.getElementById('dNick'); nk.textContent=w.nickname?'\u201C'+w.nickname+'\u201D':''; nk.style.display=w.nickname?'':'none';
        var stp=document.getElementById('dStatus'); stp.textContent=w.status; stp.className='a-status'+(w.status==='Sold'?' sold':(w.status==='Incoming'?' incoming':'')); stp.style.position='static'; stp.style.display='inline-block';
        document.getElementById('dPrice').textContent=w.status==='Sold'?'Sold':fmtPrice(w.price);
        [['dRef',w.reference],['dStockId',w.stockId],['dYear',w.year],['dCard',w.cardDate],['dCondition',w.condition],['dSet',w.set],['dCase',w.caseSize],['dMaterial',w.material],['dDial',w.dial],['dBracelet',w.bracelet],['dIncluded',w.included]].forEach(function(pair){
          var el=document.getElementById(pair[0]); if(!el)return;
          if(!pair[1]){var tr=el.closest('tr'); if(tr)tr.style.display='none';} else el.textContent=pair[1];
        });
        document.getElementById('dDesc').textContent=w.description||'';
        var wf=document.getElementById('fieldWatch'); if(wf)wf.value=(w.brand+' '+w.model+' '+(w.reference||'')).trim();
        if(window.fbq)fbq('track','ViewContent',{content_type:'product',content_name:(w.brand+' '+w.model+' '+(w.reference||'')).trim(),content_category:w.brand});
        var rel=inv.filter(function(x){return x.slug!==w.slug&&x.status!=='Sold'}).slice(0,3);
        var rg=document.getElementById('relatedGrid'); if(rg)rg.innerHTML=rel.map(function(x){return cardHTML(x)}).join('');
      }
    }

    /* REVIEWS PAGE */
    var rm=document.getElementById('reviewsMount');
    if(rm&&d.reviews){
      var fbIcon='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>';
      rm.innerHTML=d.reviews.map(function(r){
        return '<div class="rev rev-light"><div class="rev-stars">'+'★'.repeat(r.stars)+'</div>'+
        '<p class="rev-text">\u201C'+r.text+'\u201D</p>'+
        '<div class="rev-name">'+r.name+' <span class="rev-src">'+fbIcon+' '+r.platform+(r.type?' · '+r.type:'')+'</span></div></div>';
      }).join('');
    }
  });
});

/* ---- forms: deliver via Railway relay -> Telegram ---- */
/* ---- lead endpoint discovery ---- */
var LEAD_EP = null;
var LEAD_EP_P = fetch('lead-endpoint.txt').then(function(r){return r.ok?r.text():''}).then(function(t){
  t=(t||'').trim(); if(t && t.indexOf('http')===0) LEAD_EP=t.replace(/\/$/,''); return LEAD_EP;
}).catch(function(){return null});
function val(id){var el=document.getElementById(id);return el?el.value.trim():''}
function validEmailKCWT(s){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s).trim())}
function validPhoneKCWT(s){var d=String(s).replace(/[^\d]/g,'');return d.length>=10&&d.length<=15&&/^[\d\s()+.\-]+$/.test(String(s).trim())}
async function submitLeadForm(o){
  var btn=document.getElementById(o.btnId||'submitBtn'),msg=document.getElementById(o.msgId||'formMsg'),hp=document.getElementById('hpField');
  if(hp&&hp.value)return;
  var cEl=document.getElementById('fieldContact');
  var name=val('fieldName'),contact=val('fieldContact');
  if(cEl)cEl.style.borderColor='';
  if(!name||!contact){msg.style.display='block';msg.style.color='#8a6d3b';msg.textContent='Please enter your name and contact info.';return}
  if(!validEmailKCWT(contact)&&!validPhoneKCWT(contact)){
    if(cEl){cEl.style.borderColor='#a33';cEl.focus()}
    msg.style.display='block';msg.style.color='#8a3b3b';
    msg.textContent='Please enter a valid phone number or email address so we can reach you.';
    return}
  btn.textContent='Sending...';btn.disabled=true;msg.style.display='none';
  var payload={name:name,contact:contact,watch:o.watchInfo||'',intent:o.intent||'General inquiry',message:o.message||'',page:location.pathname+location.search};
  try{
    await LEAD_EP_P;
    if(!LEAD_EP)throw new Error('no endpoint');
    var r=await fetch(LEAD_EP+'/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(r.status===400){
      if(cEl){cEl.style.borderColor='#a33';cEl.focus()}
      msg.style.display='block';msg.style.color='#8a3b3b';
      msg.textContent='Please enter a valid phone number or email address so we can reach you.';
      btn.textContent=o.btnLabel||'Send Inquiry \u2192';btn.disabled=false;return}
    if(!r.ok)throw new Error('relay '+r.status);
    if(window.fbq)fbq('track','Lead',{content_category:o.intent||'inquiry',content_name:(o.watchInfo||'').substring(0,90)});
    msg.style.display='block';msg.style.color='#7a6434';msg.textContent=o.successMsg||'Inquiry received. We will be in touch within 24 hours.';
    btn.textContent='Sent \u2713';(o.clearIds||[]).forEach(function(id){var el=document.getElementById(id);if(el)el.value=''});
  }catch(e){
    msg.style.display='block';msg.style.color='#8a3b3b';msg.textContent='Something went wrong. Please call or text (816) 535-0210.';
    btn.textContent=o.btnLabel||'Send Inquiry \u2192';btn.disabled=false;
  }
}
function submitInquiry(){
  submitLeadForm({watchInfo:val('fieldWatch'),intent:val('fieldIntent')||'General inquiry',message:val('fieldMessage'),clearIds:['fieldName','fieldContact','fieldWatch','fieldMessage']});
}
function submitSell(){
  var wi=[val('sBrand'),val('sModel'),val('sReference'),val('sYear')].filter(Boolean).join(' ');
  var det=[val('sCondition')&&'Cond: '+val('sCondition'),val('sBox')&&'Box: '+val('sBox'),val('sPapers')&&'Papers: '+val('sPapers'),val('sLinks')&&'Links: '+val('sLinks'),val('sService')&&'Service: '+val('sService'),val('sPrice')&&'Ask: '+val('sPrice'),(val('sCity')||val('sState'))&&'Loc: '+[val('sCity'),val('sState')].filter(Boolean).join(', '),val('sNotes')].filter(Boolean).join(' | ');
  submitLeadForm({watchInfo:'SELL: '+wi,intent:'Sell a watch',message:det,successMsg:'Received. We will come back with a market-based offer. Text photos to (816) 535-0210 to speed things up.',clearIds:['fieldName','fieldContact','sBrand','sModel','sReference','sYear','sCondition','sBox','sPapers','sLinks','sService','sPrice','sCity','sState','sNotes']});
}
function submitSource(){
  var wi=[val('qBrand'),val('qModel'),val('qReference')].filter(Boolean).join(' ');
  var det=[val('qYear')&&'Year: '+val('qYear'),val('qCondition')&&'Cond: '+val('qCondition'),val('qSet')&&'Set: '+val('qSet'),val('qBudget')&&'Budget: '+val('qBudget'),val('qTiming')&&'Timing: '+val('qTiming'),val('qNotes')].filter(Boolean).join(' | ');
  submitLeadForm({watchInfo:'SOURCE: '+wi,intent:'Source a watch for me',message:det,successMsg:'Request received. We will check the network and come back with what we can do.',clearIds:['fieldName','fieldContact','qBrand','qModel','qReference','qYear','qCondition','qSet','qBudget','qTiming','qNotes']});
}

/* Contact-intent tracking: phone/text/email taps */
document.addEventListener('click', function(e){
  var a = e.target.closest && e.target.closest('a[href^="tel:"],a[href^="sms:"],a[href^="mailto:"]');
  if(a && window.fbq) fbq('track','Contact');
}, true);

/* prefill contact intent from query (?intent=...) */
(function(){
  var q=new URLSearchParams(location.search).get('intent');
  if(!q)return;
  var sel=document.getElementById('fieldIntent');
  if(!sel)return;
  var opt=[].find.call(sel.options,function(o){return o.value===q||o.textContent===q});
  if(opt){sel.value=opt.value||opt.textContent;
    var w=document.getElementById('fieldWatch');
    if(w&&q.indexOf('Parfums')!==-1){var lb=document.querySelector('label[for="fieldWatch"]');if(lb)lb.textContent='Fragrance / Interest';w.placeholder='e.g. Nocturne, Zenith, full line';}
  }
})();
