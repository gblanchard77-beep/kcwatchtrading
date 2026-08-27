// KC WATCH TRADING — Telegram Inventory Bot
// Gary texts a photo + spec line -> preview -> YES -> site updated.
// Commands: SOLD <ref> | PRICE <ref> <amount|inquire> | STATUS <ref> <status> | LIST | HELP
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GITHUB_TOKEN, GITHUB_REPO, (RAILWAY_PUBLIC_DOMAIN auto)
const http = require('http');
const crypto = require('crypto');
const sharp = require('sharp');

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = String(process.env.TELEGRAM_CHAT_ID || '');
const GH_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO || 'gblanchard77-beep/kcwatchtrading';
const DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || '';
const PORT = process.env.PORT || 3000;
const TG = `https://api.telegram.org/bot${BOT}`;
const HOOK_PATH = '/tg/' + crypto.createHash('sha256').update(BOT || 'x').digest('hex').slice(0, 20);

const pending = {}; // chat_id -> {entry, photoFileId}

/* ---------------- Telegram helpers ---------------- */
async function send(chatId, text) {
  await fetch(`${TG}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }) });
}
async function tgFile(fileId) {
  const r = await (await fetch(`${TG}/getFile?file_id=${fileId}`)).json();
  if (!r.ok) throw new Error('getFile failed');
  const buf = await (await fetch(`https://api.telegram.org/file/bot${BOT}/${r.result.file_path}`)).arrayBuffer();
  return Buffer.from(buf);
}

/* ---------------- GitHub helpers ---------------- */
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${GH_TOKEN}`, 'Accept': 'application/vnd.github+json',
      'User-Agent': 'kcwt-inventory-bot', ...(opts.headers || {}) }
  });
  if (!r.ok && r.status !== 404) throw new Error(`GitHub ${r.status}: ${await r.text()}`);
  return r.status === 404 ? null : r.json();
}
async function putFile(path, contentB64, message, sha) {
  return gh(`contents/${path}`, { method: 'PUT',
    body: JSON.stringify({ message, content: contentB64, ...(sha ? { sha } : {}) }) });
}
async function getInventory() {
  const f = await gh('contents/assets/data/inventory.json');
  if (!f) throw new Error('inventory.json not found');
  return { data: JSON.parse(Buffer.from(f.content, 'base64').toString()), sha: f.sha };
}
async function saveInventory(data, sha, msg) {
  return putFile('assets/data/inventory.json',
    Buffer.from(JSON.stringify(data, null, 2)).toString('base64'), msg, sha);
}

/* ---------------- Spec line parser ---------------- */
const BRANDS = { RLX: 'Rolex', ROLEX: 'Rolex', TDR: 'Tudor', TUDOR: 'Tudor', AP: 'Audemars Piguet',
  PATEK: 'Patek Philippe', PP: 'Patek Philippe', VC: 'Vacheron Constantin', VACHERON: 'Vacheron Constantin',
  OMEGA: 'Omega', CARTIER: 'Cartier', BREITLING: 'Breitling', PANERAI: 'Panerai', IWC: 'IWC', GRAND: 'Grand Seiko' };
const MODELS = { 'SUB DATE': 'Submariner Date', 'SUB ND': 'Submariner', 'SUB': 'Submariner',
  'GMT': 'GMT-Master II', 'DAYT': 'Daytona', 'DAYTONA': 'Daytona', 'EXP II': 'Explorer II', 'EXP': 'Explorer',
  'SD': 'Sea-Dweller', 'DSSD': 'Deepsea', 'YM': 'Yacht-Master', 'SKY': 'Sky-Dweller', 'AIR KING': 'Air-King',
  'DJ41': 'Datejust 41', 'DJ36': 'Datejust 36', 'DJ': 'Datejust', 'OP': 'Oyster Perpetual',
  'AIRKING': 'Air-King', 'AIR-KING': 'Air-King', 'GMT MASTER II': 'GMT-Master II', 'GMT-MASTER II': 'GMT-Master II',
  'GMT MASTER': 'GMT-Master II', 'SUBMARINER DATE': 'Submariner Date', 'SUBMARINER': 'Submariner', 'DATEJUST': 'Datejust',
  'BLACK BAY 58': 'Black Bay 58', 'BLACK BAY 54': 'Black Bay 54', 'BLACK BAY CHRONO': 'Black Bay Chrono',
  'BLACK BAY GMT': 'Black Bay GMT', 'BLACK BAY': 'Black Bay', 'OVERSEAS': 'Overseas', 'SPEEDMASTER': 'Speedmaster', 'SEAMASTER': 'Seamaster',
  'BB58': 'Black Bay 58', 'BB54': 'Black Bay 54', 'BB CHRONO': 'Black Bay Chrono', 'BB GMT': 'Black Bay GMT' };
const NICKS = { BATMAN: 'Batman', BATGIRL: 'Batgirl', PEPSI: 'Pepsi', SPRITE: 'Sprite', BLUESY: 'Bluesy',
  'ROOT BEER': 'Root Beer', ROOTBEER: 'Root Beer', KERMIT: 'Kermit', STARBUCKS: 'Starbucks', HULK: 'Hulk',
  SMURF: 'Smurf', COKE: 'Coke', PANDA: 'Panda' };

function parseSpec(text) {
  let s = ' ' + text.toUpperCase().replace(/[,]/g, '').replace(/\s+/g, ' ').trim() + ' ';
  const out = { status: 'Available', condition: '', set: '', price: 'Inquire', year: '', nickname: '', stockId: '' };
  const sid = s.match(/#([A-Z0-9]{3,14})/);
  if (sid) { out.stockId = sid[1]; s = s.replace(sid[0], ' '); }

  const price = s.match(/\$\s?([\d]+)/) || s.match(/ (\d{4,6})(?=\s*$)/);
  if (price) { out.price = parseInt(price[1], 10); s = s.replace(price[0], ' '); }
  const yr = s.match(/ (19[5-9]\d|20[0-4]\d) /);
  if (yr) { out.year = yr[1]; s = s.replace(yr[0], ' '); }

  for (const [k, v] of [[' BNIB ', 'BNIB'], [' BRAND NEW IN BOX ', 'BNIB'], [' BRAND NEW ', 'BNIB'],
    [' PRE-OWNED ', 'Pre-Owned'], [' PREOWNED ', 'Pre-Owned'], [' UNWORN ', 'Unworn'],
    [' EXCELLENT ', 'Excellent'], [' VERY GOOD ', 'Very Good'], [' GOOD ', 'Good']]) {
    if (s.includes(k)) { out.condition = v; s = s.replace(k, ' '); break; }
  }
  for (const [k, v] of [[' COMPLETE SET ', 'Complete Set'], [' FULL SET ', 'Complete Set'],
    [' WATCH ONLY ', 'Watch Only'], [' BOX ONLY ', 'Box Only'], [' PAPERS ONLY ', 'Papers Only']]) {
    if (s.includes(k)) { out.set = v; s = s.replace(k, ' '); break; }
  }
  for (const [k, v] of Object.entries(NICKS)) {
    if (s.includes(' ' + k + ' ')) { out.nickname = v; s = s.replace(' ' + k + ' ', ' '); break; }
  }
  if (s.includes(' SOLD ')) { out.status = 'Sold'; s = s.replace(' SOLD ', ' '); }
  if (s.includes(' INCOMING ')) { out.status = 'Incoming'; s = s.replace(' INCOMING ', ' '); }

  const words = s.trim().split(' ').filter(Boolean);
  if (words.length && BRANDS[words[0]]) { out.brand = BRANDS[words.shift()]; }
  // reference = last token containing a digit
  for (let i = words.length - 1; i >= 0; i--) {
    if (/\d/.test(words[i]) && words[i].length >= 4) { out.reference = words.splice(i, 1)[0]; break; }
  }
  const modelRaw = words.join(' ');
  const ACRO = ['GMT','II','ND','OP','SD','VC','AP','BB'];
  out.model = MODELS[modelRaw] || (modelRaw ? modelRaw.split(' ').map(w => (/^[A-Z]+$/.test(w) && !ACRO.includes(w) && !/\d/.test(w)) ? w[0] + w.slice(1).toLowerCase() : (w.length > 3 && !/\d/.test(w) ? w[0] + w.slice(1).toLowerCase() : w)).join(' ') : '');
  if (!out.brand && out.model) out.brand = 'Rolex'; // Gary's default sourcing brand
  return out;
}

function slugify(e) {
  return `${e.brand} ${e.model} ${e.reference}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function preview(e) {
  return ['PREVIEW — reply YES to publish, NO to cancel', '',
    `Brand: ${e.brand}`, `Model: ${e.model}`, e.nickname ? `Nickname: ${e.nickname}` : null,
    `Reference: ${e.reference}`, e.stockId ? `Stock ID: ${e.stockId}` : 'Stock ID: (none — add #ID to caption to set)', `Year: ${e.year || '(blank)'}`, `Condition: ${e.condition || '(blank)'}`,
    `Set: ${e.set || '(blank)'}`, `Price: ${typeof e.price === 'number' ? '$' + e.price.toLocaleString() : e.price}`,
    `Status: ${e.status}`].filter(Boolean).join('\n');
}

/* ---------------- Actions ---------------- */
async function publishAdd(chatId) {
  const p = pending[chatId]; if (!p) return send(chatId, 'Nothing pending.');
  delete pending[chatId];
  const e = p.entry;
  await send(chatId, 'Publishing... (about 2 minutes to live)');
  const raw = await tgFile(p.photoFileId);
  // 4:5 crop, full + card
  const img = sharp(raw).rotate();
  const meta = await img.metadata();
  const target = 4 / 5;
  let w = meta.width, h = meta.height, cw, ch;
  if (w / h > target) { ch = h; cw = Math.round(h * target); } else { cw = w; ch = Math.round(w / target); }
  const left = Math.round((w - cw) / 2), top = Math.max(0, Math.round((h - ch) * 0.42));
  const base = sharp(raw).rotate().extract({ left, top, width: cw, height: ch });
  const full = await base.clone().resize({ width: Math.min(1400, cw) }).jpeg({ quality: 82, progressive: true }).toBuffer();
  const card = await base.clone().resize({ width: Math.min(720, cw) }).jpeg({ quality: 80, progressive: true }).toBuffer();

  const { data: invCheck } = await getInventory();
  let slug = slugify(e), n = 1;
  while (invCheck.watches.some(w => w.slug === slug)) { n++; slug = slugify(e) + '-' + n; }
  const imgPath = `assets/images/${slug}.jpg`, cardPath = `assets/images/${slug}-card.jpg`;
  await putFile(imgPath, full.toString('base64'), `Add photo: ${e.reference}`);
  await putFile(cardPath, card.toString('base64'), `Add card photo: ${e.reference}`);

  const { data, sha } = await getInventory();
  const maxOrder = Math.max(0, ...data.watches.map(x => x.order || 0));
  while (data.watches.some(w => w.slug === slug)) { n++; slug = slugify(e) + '-' + n; }
  data.watches.push({
    slug, status: e.status, brand: e.brand, model: e.model, nickname: e.nickname || '',
    reference: e.reference, stockId: e.stockId || '', year: e.year || '', cardDate: '', condition: e.condition || '',
    set: e.set || '', price: e.price, caseSize: '', material: '', dial: '', bracelet: '',
    included: e.set === 'Complete Set' ? 'Full set' : 'Inquire for details',
    description: `${e.brand} ${e.model}${e.nickname ? ' \u201C' + e.nickname + '\u201D' : ''} ref. ${e.reference}. Contact us for full details and photos.`,
    image: imgPath, cardImage: cardPath, order: maxOrder + 1
  });
  await saveInventory(data, sha, `Add ${e.reference} via bot`);
  await send(chatId, `\u2705 ${e.brand} ${e.model} ${e.reference} published as ${e.status}. Live in ~2 min.`);
}

async function updateWatch(chatId, ref, fn, label, idx) {
  const { data, sha } = await getInventory();
  let matches;
  if (ref.startsWith('#')) {
    const sid = ref.slice(1).toUpperCase();
    matches = data.watches.filter(x => (x.stockId || '').toUpperCase() === sid);
    if (!matches.length) return send(chatId, `No watch found with stock ID ${ref}. Send LIST to see inventory.`);
  } else {
    matches = data.watches.filter(x => (x.reference || '').toUpperCase() === ref.toUpperCase());
    if (!matches.length) return send(chatId, `No watch found with reference ${ref}. Send LIST to see inventory.`);
  }
  let w;
  if (matches.length === 1) w = matches[0];
  else if (idx && idx >= 1 && idx <= matches.length) w = matches[idx - 1];
  else {
    const lines = matches.map((x, i) => `${i + 1}. ${x.stockId ? '#' + x.stockId + ' \u2014 ' : ''}${x.brand} ${x.model} [${x.status}] ${typeof x.price === 'number' ? '$' + x.price.toLocaleString() : x.price}${x.year ? ' \u00B7 ' + x.year : ''}${x.nickname ? ' \u00B7 ' + x.nickname : ''}`);
    const cmd = label.split(' ')[0].toUpperCase() === 'MARKED' ? 'SOLD' : label.toUpperCase().split(' ')[0];
    const hint = matches.some(x => x.stockId) ? `${cmd} #${(matches.find(x=>x.stockId)||{}).stockId}` : `${cmd} ${ref} 2`;
    return send(chatId, `${matches.length} watches share ref ${ref}:\n\n${lines.join('\n')}\n\nUse the stock ID or the number, e.g.:\n${hint}`);
  }
  fn(w);
  await saveInventory(data, sha, `${label} ${ref} via bot`);
  await send(chatId, `\u2705 ${w.brand} ${w.model} ${ref}${matches.length > 1 ? ' (#' + (matches.indexOf(w) + 1) + ')' : ''}: ${label}. Live in ~2 min.`);
}

/* ---------------- Command router ---------------- */
async function handle(msg) {
  const chatId = String(msg.chat.id);
  if (chatId !== CHAT) return; // Gary only
  const text = (msg.text || msg.caption || '').trim();
  const upper = text.toUpperCase();

  try {
    if (msg.photo && msg.photo.length) {
      if (!text) return send(chatId, 'Photo received but no spec line. Send the photo again WITH a caption like:\n2026 RLX SUB DATE 126613LB COMPLETE SET BNIB $14700');
      const e = parseSpec(text);
      if (!e.reference) return send(chatId, 'Could not find a reference number in that caption. Include the ref (e.g. 126613LB) and resend.');
      if (!e.model) return send(chatId, 'Could not read the model. Try format:\n2026 RLX SUB DATE 126613LB COMPLETE SET BNIB $14700');
      pending[chatId] = { entry: e, photoFileId: msg.photo[msg.photo.length - 1].file_id };
      return send(chatId, preview(e));
    }
    if (upper === 'YES' && pending[chatId]) return publishAdd(chatId);
    if (upper === 'NO' && pending[chatId]) { delete pending[chatId]; return send(chatId, 'Cancelled.'); }

    let m;
    if ((m = upper.match(/^SOLD\s+(\S+?)(?:\s+(\d))?$/)))
      return updateWatch(chatId, m[1], w => { w.status = 'Sold'; }, 'marked SOLD', m[2] ? parseInt(m[2],10) : null);
    if ((m = upper.match(/^PRICE\s+(\S+)\s+(\S+?)(?:\s+(\d))?$/))) {
      const val = m[2] === 'INQUIRE' ? 'Inquire' : parseInt(m[2].replace(/[$,]/g, ''), 10);
      if (val !== 'Inquire' && !(val > 0)) return send(chatId, 'Price not understood. Use: PRICE 126613LB 14700 or PRICE 126613LB INQUIRE');
      return updateWatch(chatId, m[1], w => { w.price = val; }, `price set to ${val === 'Inquire' ? 'Inquire' : '$' + val.toLocaleString()}`, m[3] ? parseInt(m[3],10) : null);
    }
    if ((m = upper.match(/^STATUS\s+(\S+)\s+(AVAILABLE|INCOMING|RESERVED|SOLD)(?:\s+(\d))?$/))) {
      const st = m[2][0] + m[2].slice(1).toLowerCase();
      return updateWatch(chatId, m[1], w => { w.status = st; }, `status set to ${st}`, m[3] ? parseInt(m[3],10) : null);
    }
    if ((m = upper.match(/^SETID\s+(\S+?)(?:\s+(\d))?\s+#?([A-Z0-9]{3,14})$/)))
      return updateWatch(chatId, m[1], w => { w.stockId = m[3]; }, `stock ID set to #${m[3]}`, m[2] ? parseInt(m[2],10) : null);
    if (upper === 'LIST') {
      const { data } = await getInventory();
      const sorted = data.watches.sort((a, b) => (a.order || 0) - (b.order || 0));
      const refCount = {}; sorted.forEach(w => { refCount[w.reference] = (refCount[w.reference] || 0) + 1; });
      const seen = {};
      const lines = sorted.map(w => {
        seen[w.reference] = (seen[w.reference] || 0) + 1;
        const tag = refCount[w.reference] > 1 ? ` #${seen[w.reference]}` : '';
        return `${w.status === 'Available' ? '\u{1F7E2}' : w.status === 'Sold' ? '\u{1F534}' : '\u{1F7E1}'} ${w.reference}${tag}${w.stockId ? ' #' + w.stockId : ''} — ${w.brand} ${w.model} [${w.status}] ${typeof w.price === 'number' ? '$' + w.price.toLocaleString() : w.price}`;
      });
      return send(chatId, 'INVENTORY\n\n' + lines.join('\n'));
    }
    return send(chatId, ['KC WATCH TRADING — Inventory Bot', '',
      '\u{1F4F7} Photo + caption = add a watch:', '   2026 RLX SUB DATE 126613LB COMPLETE SET BNIB $14700', '',
      'SOLD 126613LB — mark sold', 'PRICE 126613LB 14700 — set price', 'PRICE 126613LB INQUIRE',
      'STATUS 126613LB Incoming', 'LIST — show all watches'].join('\n'));
  } catch (err) {
    console.error(err);
    await send(chatId, `\u26A0\uFE0F Error: ${err.message}. Nothing was changed. Try again or tell Claude.`);
  }
}

/* ---------------- Server + webhook ---------------- */
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === HOOK_PATH) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      res.writeHead(200); res.end('ok'); // ack immediately
      try { const u = JSON.parse(body); if (u.message) handle(u.message); } catch (e) { console.error('bad update', e.message); }
    });
    return;
  }
  res.writeHead(200); res.end('kcwt inventory bot');
}).listen(PORT, async () => {
  console.log('inventory bot on :' + PORT);
  if (DOMAIN) {
    const url = `https://${DOMAIN.replace(/^https?:\/\//, '')}${HOOK_PATH}`;
    const r = await (await fetch(`${TG}/setWebhook?url=${encodeURIComponent(url)}&drop_pending_updates=true`)).json();
    console.log('webhook set:', r.ok ? url : JSON.stringify(r));
  } else console.log('No RAILWAY_PUBLIC_DOMAIN yet — generate a domain, service will re-register on restart.');
});
