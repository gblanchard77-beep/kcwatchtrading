// KC Watch Trading — website lead -> Telegram relay
// Deployed on Railway as its own service. Only SENDS via the bot (no polling),
// so it cannot conflict with the chat-widget bot usage.
const http = require('http');

const BOT = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID; // Gary: 5480394847
const ALLOWED = ['https://kcwatchtrading.com', 'https://www.kcwatchtrading.com'];
const PORT = process.env.PORT || 3000;

// simple rate limit: 20 sends per 10 min window
let windowStart = Date.now(), count = 0;
function limited() {
  if (Date.now() - windowStart > 600000) { windowStart = Date.now(); count = 0; }
  return ++count > 20;
}
function esc(s) { return String(s || '').slice(0, 300); }

http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const cors = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  res.setHeader('Access-Control-Allow-Origin', cors);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method !== 'POST' || req.url !== '/lead') { res.writeHead(404); return res.end('not found'); }
  if (!ALLOWED.includes(origin)) { res.writeHead(403); return res.end('forbidden'); }
  if (limited()) { res.writeHead(429); return res.end('slow down'); }

  let body = '';
  req.on('data', c => { body += c; if (body.length > 5000) req.destroy(); });
  req.on('end', async () => {
    try {
      const d = JSON.parse(body || '{}');
      const lines = [
        '\u{1F310} WEBSITE LEAD',
        '',
        'Name: ' + esc(d.name),
        'Contact: ' + esc(d.contact),
        d.watch ? 'Watch: ' + esc(d.watch) : null,
        'Intent: ' + esc(d.intent || 'General inquiry'),
        d.message ? 'Details: ' + esc(d.message) : null,
        '',
        'Page: ' + esc(d.page),
        d.mailerlite === false ? '\u26A0\uFE0F MailerLite save FAILED — this alert is the only record' : null
      ].filter(Boolean);
      const tg = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT, text: lines.join('\n') })
      });
      if (!tg.ok) throw new Error('telegram ' + tg.status);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } catch (e) {
      console.error('relay error:', e.message);
      res.writeHead(500); res.end('{"ok":false}');
    }
  });
}).listen(PORT, () => console.log('kcwt lead relay on :' + PORT));
