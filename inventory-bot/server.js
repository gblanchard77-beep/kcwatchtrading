// KC WATCH TRADING — Telegram Inventory Bot (read-only since 2026-10-17)
// Inventory now lives in Sell Your Grail Office; the website syncs from Office every ~20 min
// (GitHub Action office-sync.yml). This bot no longer writes to the site or the repo.
// Commands: LIST (read-only, from the public inventory.json) | HELP
// Old write commands (photo + caption, YES/NO, SOLD, PRICE, STATUS, SETID) reply with the Office message.
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, (RAILWAY_PUBLIC_DOMAIN auto). No GitHub token needed.
const http = require('http');
const crypto = require('crypto');

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = String(process.env.TELEGRAM_CHAT_ID || '');
const INVENTORY_URL = process.env.INVENTORY_URL || 'https://kcwatchtrading.com/assets/data/inventory.json';
const DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || '';
const PORT = process.env.PORT || 3000;
const TG = `https://api.telegram.org/bot${BOT}`;
const HOOK_PATH = '/tg/' + crypto.createHash('sha256').update(BOT || 'x').digest('hex').slice(0, 20);
const OFFICE_MSG = 'Inventory now lives in Sell Your Grail Office. Add, price or mark watches sold there; the website updates within about 20 minutes.';

/* ---------------- Telegram helpers ---------------- */
async function send(chatId, text) {
  await fetch(`${TG}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }) });
}

/* ---------------- Inventory (read-only, public site) ---------------- */
async function getInventory() {
  const r = await fetch(`${INVENTORY_URL}?cb=${Date.now()}`, { headers: { 'User-Agent': 'kcwt-inventory-bot', 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`inventory.json HTTP ${r.status}`);
  return { data: await r.json() };
}

function listText(data) {
  const sorted = data.watches.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const refCount = {}; sorted.forEach(w => { refCount[w.reference] = (refCount[w.reference] || 0) + 1; });
  const seen = {};
  const lines = sorted.map(w => {
    seen[w.reference] = (seen[w.reference] || 0) + 1;
    const tag = refCount[w.reference] > 1 ? ` #${seen[w.reference]}` : '';
    return `${w.status === 'Available' ? '\u{1F7E2}' : w.status === 'Sold' ? '\u{1F534}' : '\u{1F7E1}'} ${w.reference}${tag}${w.stockId ? ' #' + w.stockId : ''} — ${w.brand} ${w.model} [${w.status}] ${typeof w.price === 'number' ? '$' + w.price.toLocaleString() : w.price}`;
  });
  return 'INVENTORY\n\n' + lines.join('\n');
}

const HELP = ['KC WATCH TRADING — Inventory Bot (read-only)', '',
  'LIST — show all watches on the website', '',
  'To add a watch, change a price or mark one sold, use Sell Your Grail Office.',
  'The website updates from Office within about 20 minutes.'].join('\n');

/* ---------------- Command router ---------------- */
async function handle(msg) {
  const chatId = String(msg.chat.id);
  if (chatId !== CHAT) return; // Gary only
  const text = (msg.text || msg.caption || '').trim();
  const upper = text.toUpperCase();

  try {
    if (msg.photo && msg.photo.length) return send(chatId, OFFICE_MSG);
    if (/^(YES|NO|SOLD|PRICE|STATUS|SETID)\b/.test(upper)) return send(chatId, OFFICE_MSG);
    if (upper === 'LIST') { const { data } = await getInventory(); return send(chatId, listText(data)); }
    return send(chatId, HELP);
  } catch (err) {
    console.error('handle error:', err.message);
    await send(chatId, `\u26A0\uFE0F Error: ${err.message}. Nothing was changed. Try again in a minute.`);
  }
}

/* ---------------- Server + webhook ---------------- */
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === HOOK_PATH) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      res.writeHead(200); res.end('ok'); // ack immediately
      try { const u = JSON.parse(body); if (u.message) handle(u.message).catch(e => console.error('handle failed', e.message)); } catch (e) { console.error('bad update', e.message); }
    });
    return;
  }
  res.writeHead(200); res.end('kcwt inventory bot');
});
if (require.main === module) {
  server.listen(PORT, async () => {
    console.log('inventory bot (read-only) on :' + PORT);
    if (!BOT) return console.log('TELEGRAM_BOT_TOKEN missing; webhook not registered.');
    if (DOMAIN) {
      try {
        const url = `https://${DOMAIN.replace(/^https?:\/\//, '')}${HOOK_PATH}`;
        const r = await (await fetch(`${TG}/setWebhook?url=${encodeURIComponent(url)}&drop_pending_updates=true`)).json();
        console.log('webhook set:', r.ok ? url : JSON.stringify(r));
      } catch (e) { console.error('setWebhook failed:', e.message); }
    } else console.log('No RAILWAY_PUBLIC_DOMAIN yet — generate a domain, service will re-register on restart.');
  });
}
module.exports = { handle, listText, getInventory, OFFICE_MSG, HELP, server };
