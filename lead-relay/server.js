// KC Watch Trading — lead relay v2
// - Validates contact server-side (email OR phone) — garbage like "milroy" is rejected with 400
// - Stores EVERY lead to disk FIRST (volume-backed) — source of truth
// - Telegram alert always shows every field (blanks as —)
// - MailerLite written SERVER-SIDE (token no longer in the browser)
// - /admin?key=... lead browser, searchable by name
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, MAILERLITE_TOKEN, ADMIN_KEY
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const ML_TOKEN = process.env.MAILERLITE_TOKEN || '';
const ML_GROUP = '183905202219255711';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const ALLOWED = ['https://kcwatchtrading.com', 'https://www.kcwatchtrading.com'];
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/tmp';
const PERSISTENT = !!process.env.RAILWAY_VOLUME_MOUNT_PATH;
const LEADS_FILE = path.join(DATA_DIR, 'leads.jsonl');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

let windowStart = Date.now(), count = 0;
function limited() {
  if (Date.now() - windowStart > 600000) { windowStart = Date.now(); count = 0; }
  return ++count > 30;
}
const esc = s => String(s || '').slice(0, 300);
const dash = s => (s && String(s).trim()) ? esc(s) : '\u2014';

/* ---- contact validation (mirrors client) ---- */
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s).trim()); }
function validPhone(s) {
  const d = String(s).replace(/[^\d]/g, '');
  return d.length >= 10 && d.length <= 15 && /^[\d\s()+.\-]+$/.test(String(s).trim());
}
function validContact(s) { return validEmail(s) || validPhone(s); }

/* ---- storage ---- */
function storeLead(lead) { fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n'); }
function readLeads() {
  try {
    const rows = fs.readFileSync(LEADS_FILE, 'utf8').trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    // corrections (flag updates) replace their originals
    const byId = {};
    for (const r of rows) byId[r.correction || r.id] = { ...(byId[r.correction || r.id] || {}), ...r };
    return Object.values(byId).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  } catch (e) { return []; }
}

/* ---- outbound ---- */
async function telegram(d, mlOk) {
  const text = [
    '\u{1F310} WEBSITE LEAD', '',
    'Name: ' + dash(d.name),
    'Contact: ' + dash(d.contact),
    'Watch: ' + dash(d.watch),
    'Intent: ' + dash(d.intent),
    'Details: ' + dash(d.message),
    '',
    'Page: ' + dash(d.page),
    mlOk === false ? '\u26A0\uFE0F MailerLite save FAILED \u2014 lead is stored on the relay (/admin)' : null
  ].filter(Boolean).join('\n');
  const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text })
  });
  return r.ok;
}
async function mailerlite(d) {
  if (!ML_TOKEN) return false;
  const isEmail = validEmail(d.contact);
  const email = isEmail ? d.contact.trim()
    : (d.name || 'lead').toLowerCase().replace(/[^a-z]+/g, '.') + '.' + Date.now() + '@inquiry.kcwatchtrading.com';
  const r = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ML_TOKEN },
    body: JSON.stringify({
      email,
      fields: { name: esc(d.name), last_name: '', phone: isEmail ? '' : esc(d.contact),
        company: esc(d.watch), city: esc(d.intent), country: esc(d.message) },
      groups: [ML_GROUP], status: 'active', resubscribe: true
    })
  });
  return r.status === 200 || r.status === 201;
}

/* ---- admin page ---- */
const ADMIN_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>KCWT Leads</title><style>
body{font-family:system-ui,sans-serif;background:#0D241E;color:#F6F1E7;margin:0;padding:2rem}
h1{font-size:1.2rem;color:#E8D6A6}input{width:100%;max-width:420px;padding:.7rem;font-size:1rem;border:2px solid #C9A46A;background:#FDFBF7;margin:1rem 0}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{text-align:left;padding:.6rem .5rem;border-bottom:1px solid rgba(201,164,106,.25);vertical-align:top}
th{color:#C9A46A;font-size:.75rem;text-transform:uppercase;letter-spacing:.06em}
.flag{color:#f0b4b4}.count{color:rgba(246,241,231,.6);font-size:.85rem}.warn{background:#5a1414;padding:.7rem 1rem;margin-bottom:1rem;font-size:.85rem}
td a{color:#E8D6A6}</style></head><body>
<h1>KC Watch Trading \u2014 Website Leads</h1><div id="warn"></div>
<input id="q" placeholder="Search by name..." autofocus>
<div class="count" id="count"></div>
<table><thead><tr><th>When (CST)</th><th>Name</th><th>Contact</th><th>Watch</th><th>Intent</th><th>Details</th><th>Page</th><th>Flags</th></tr></thead><tbody id="rows"></tbody></table>
<script>
const key=new URLSearchParams(location.search).get('key');
let all=[];
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function render(){const q=(document.getElementById('q').value||'').toLowerCase();
const f=all.filter(l=>!q||String(l.name||'').toLowerCase().includes(q));
document.getElementById('count').textContent=f.length+' of '+all.length+' leads';
document.getElementById('rows').innerHTML=f.map(l=>{
const c=String(l.contact||'');const link=c.includes('@')?'<a href="mailto:'+esc(c)+'">'+esc(c)+'</a>':'<a href="tel:'+esc(c.replace(/[^\\d+]/g,''))+'">'+esc(c)+'</a>';
const flags=[l.ml===false?'ML failed':null,l.tg===false?'TG failed':null].filter(Boolean).join(', ');
return '<tr><td>'+new Date(l.ts).toLocaleString('en-US',{timeZone:'America/Chicago'})+'</td><td>'+esc(l.name)+'</td><td>'+link+'</td><td>'+(esc(l.watch)||'\\u2014')+'</td><td>'+(esc(l.intent)||'\\u2014')+'</td><td>'+(esc(l.message)||'\\u2014')+'</td><td>'+esc(l.page)+'</td><td class="flag">'+flags+'</td></tr>';}).join('');}
fetch('/admin/leads?key='+encodeURIComponent(key)).then(r=>{if(!r.ok)throw 0;return r.json()}).then(d=>{all=d.leads;
if(!d.persistent)document.getElementById('warn').innerHTML='<div class="warn">\\u26A0 Storage volume not attached \\u2014 leads shown here will NOT survive a redeploy. Attach the Railway volume.</div>';
render();}).catch(()=>{document.body.innerHTML='<h1>Unauthorized</h1><p>Missing or wrong key.</p>'});
document.getElementById('q').addEventListener('input',render);
</script></body></html>`;

/* ---- server ---- */
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const origin = req.headers.origin || '';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  if (req.method === 'GET' && u.pathname === '/admin') {
    if (!ADMIN_KEY || u.searchParams.get('key') !== ADMIN_KEY) { res.writeHead(401); return res.end('unauthorized'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(ADMIN_HTML);
  }
  if (req.method === 'GET' && u.pathname === '/admin/leads') {
    if (!ADMIN_KEY || u.searchParams.get('key') !== ADMIN_KEY) { res.writeHead(401); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ persistent: PERSISTENT, leads: readLeads() }));
  }
  if (req.method === 'POST' && u.pathname === '/lead') {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED.includes(origin) ? origin : ALLOWED[0]);
    if (!ALLOWED.includes(origin)) { res.writeHead(403); return res.end('forbidden'); }
    if (limited()) { res.writeHead(429); return res.end('slow down'); }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 6000) req.destroy(); });
    req.on('end', async () => {
      try {
        const d = JSON.parse(body || '{}');
        if (!esc(d.name).trim() || !validContact(d.contact)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'invalid_contact' }));
        }
        const lead = { id: crypto.randomUUID(), ts: new Date().toISOString(),
          name: esc(d.name), contact: esc(d.contact), watch: esc(d.watch),
          intent: esc(d.intent), message: esc(d.message), page: esc(d.page), ml: null, tg: null };
        storeLead(lead); // source of truth — always first
        let mlOk = null, tgOk = null;
        try { mlOk = await mailerlite(lead); } catch (e) { mlOk = false; console.error('ML:', e.message); }
        try { tgOk = await telegram(lead, mlOk); } catch (e) { tgOk = false; console.error('TG:', e.message); }
        if (mlOk === false || tgOk === false) storeLead({ correction: lead.id, id: lead.id + '-c', ts: lead.ts, ml: mlOk, tg: tgOk });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        console.error('lead error:', e.message);
        res.writeHead(500); res.end('{"ok":false}');
      }
    });
    return;
  }
  res.writeHead(200); res.end('kcwt lead relay v2');
}).listen(PORT, () => console.log(`lead relay v2 on :${PORT} | storage: ${LEADS_FILE} (${PERSISTENT ? 'persistent' : 'NOT PERSISTENT - attach volume'})`));
