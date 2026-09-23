// KC Watch Trading — website live chat
// Replaces the OpenClaw Sam tunnel for kcwatchtrading.com.
// Widget contract (kcwt-chat-widget.js):
//   POST /chat   { sessionId, message, visitor? } -> { reply, handledBy, ts, sessionId }
//   GET  /chat?sessionId=&since=                 -> { messages: [{ text, from, ts }] }
//   POST /upload { sessionId, photoType, imageData }
// Gary replies from Telegram into the active website session, or /t <sessionId> text.
// Env: PORT, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY (optional),
//      RAILWAY_VOLUME_MOUNT_PATH (optional), TELEGRAM_WEBHOOK_SECRET (optional),
//      ANTHROPIC_MODEL (optional), RAILWAY_PUBLIC_DOMAIN (optional)
const http = require('http');
const fs = require('fs');
const path = require('path');

const BOT = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT = process.env.TELEGRAM_CHAT_ID || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const ALLOWED = ['https://kcwatchtrading.com', 'https://www.kcwatchtrading.com'];
const PORT = process.env.PORT || 3000;
const TTL_MS = 24 * 60 * 60 * 1000;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';
const PERSISTENT = !!DATA_DIR;
const SESSIONS_FILE = PERSISTENT ? path.join(DATA_DIR, 'sessions.json') : '';

if (PERSISTENT) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.error('volume:', e.message); }
}

const GREETING = 'Welcome to KC Watch Trading. Are you looking to sell a watch, or buy one? I can help with either.';
const PHOTO_LABELS = {
  face: 'Watch face',
  bracelet: 'Bracelet (both sides)',
  clasp: 'Buckle / clasp',
  case: 'Case (both sides)',
  papers: 'Box, papers & accessories',
};
const SYSTEM = [
  'You are the KC Watch Trading website concierge.',
  'Warm, concise, and specific. Visitors are here to sell a watch or buy one.',
  'Write 1 to 3 short sentences. No bullet lists and no sign-off.',
  'Never invent inventory, availability, or prices. If they ask what is in stock or what something costs, say Gary will follow up with real options and pricing.',
  'Never ask for a serial number.',
  'For a sale, collect brand and model, box and papers, condition, and the best phone number or email.',
  'For a purchase, collect brand and model and the best phone number or email. Do not promise that a specific watch is available.',
  'When you have those details, tell them Gary will follow up shortly.',
  'Do not mention OpenClaw, other assistants, or that you are a language model.',
  'You already greeted them with: "' + GREETING + '"',
].join(' ');

const sessions = new Map();
let activeSessionId = null;
let clock = 0;

function now() {
  const t = Date.now();
  clock = t > clock ? t : clock + 1;
  return clock;
}

function validSessionId(id) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

/* ---- persistence (volume) or memory ---- */
function persist() {
  if (!PERSISTENT) return;
  try {
    const data = {
      activeSessionId,
      sessions: [...sessions.values()].map(s => ({
        id: s.id,
        created: s.created,
        updated: s.updated,
        greeted: s.greeted,
        greetingTs: s.greetingTs,
        cursorTs: s.cursorTs,
        takeover: s.takeover,
        step: s.step,
        messages: s.messages,
        photos: (s.photos || []).map(p => ({
          photoType: p.photoType, label: p.label, mime: p.mime, bytes: p.bytes, ts: p.ts, file: p.file || null,
        })),
      })),
    };
    const tmp = SESSIONS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, SESSIONS_FILE);
  } catch (e) { console.error('persist:', e.message); }
}

function load() {
  if (!PERSISTENT) return;
  try {
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    activeSessionId = data.activeSessionId || null;
    for (const s of data.sessions || []) {
      if (!s || !s.id) continue;
      s.messages = Array.isArray(s.messages) ? s.messages : [];
      s.photos = Array.isArray(s.photos) ? s.photos : [];
      sessions.set(s.id, s);
    }
  } catch (e) { /* first boot, or unreadable file */ }
}

function prune() {
  const cutoff = Date.now() - TTL_MS;
  let changed = false;
  for (const [id, s] of sessions) {
    if ((s.updated || 0) < cutoff) {
      sessions.delete(id);
      changed = true;
    }
  }
  if (activeSessionId && !sessions.has(activeSessionId)) {
    activeSessionId = null;
    changed = true;
  }
  return changed;
}

function ensure(id) {
  prune();
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      created: Date.now(),
      updated: Date.now(),
      greeted: false,
      greetingTs: 0,
      cursorTs: 0,
      takeover: false,
      step: 0,
      messages: [],
      photos: [],
    };
    sessions.set(id, s);
  }
  return s;
}

function noteCursor(session, ts) {
  if (ts > (session.cursorTs || 0)) session.cursorTs = ts;
}

function pushMessage(session, text, from, delivered) {
  const ts = now();
  session.messages.push({
    text: String(text).slice(0, 2000),
    from,
    ts,
    delivered: !!delivered,
  });
  if (session.messages.length > 200) session.messages.splice(0, session.messages.length - 200);
  session.updated = ts;
  if (delivered) noteCursor(session, ts);
  persist();
  return ts;
}

function touchActive(session) {
  session.updated = Date.now();
  activeSessionId = session.id;
}

function activeSession() {
  prune();
  if (activeSessionId && sessions.has(activeSessionId)) return sessions.get(activeSessionId);
  let best = null;
  for (const s of sessions.values()) {
    if (!best || (s.updated || 0) > (best.updated || 0)) best = s;
  }
  if (best) activeSessionId = best.id;
  return best;
}

/* ---- concierge ---- */
function machineReply(session, text) {
  const t = String(text || '').toLowerCase();
  let step = session.step || 0;
  let reply;
  // Same buy/sell split as the widget demo, except an explicit sell wins
  // ("interested in selling" should not take the buy path).
  if (step === 0 && !/\b(sell|selling)\b/.test(t) && /(buy|purchas|looking for|interested in)/.test(t)) {
    reply = "Great — what are you hoping to add to the collection? Brand and model if you have one in mind, and I'll check what we have access to.";
    step = 9;
  } else if (step === 0) {
    reply = "Perfect — let's get you a fast offer. What brand and model are we talking about?";
    step = 1;
  } else if (step === 1) {
    reply = 'Beautiful piece. Do you have the reference number, and is it a full set — box and papers?';
    step = 2;
  } else if (step === 2) {
    reply = 'Got it. How would you describe the condition, and roughly what year? A few photos help too — face, caseback, and the box/papers if you have them.';
    step = 3;
  } else if (step === 3) {
    reply = "Thank you. What's the best phone or email for Gary? To finalize numbers we verify in person — when could you bring it by, or should we arrange a time this week?";
    step = 4;
  } else if (step === 9) {
    reply = "Noted — I'll pass your interest to Gary with the details and he'll follow up with options and pricing. What's the best way to reach you?";
    step = 10;
  } else {
    reply = "Perfect — I've logged everything and Gary will follow up shortly to confirm. Anything else I can help with in the meantime?";
  }
  session.step = step;
  return reply;
}

function modelMessages(session) {
  const turns = [];
  for (const m of session.messages) {
    if (m.from === 'visitor') turns.push({ role: 'user', content: m.text });
    else if (m.from === 'sam') turns.push({ role: 'assistant', content: m.text });
  }
  while (turns.length && turns[0].role === 'assistant') turns.shift();
  const merged = [];
  for (const t of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === t.role) prev.content += '\n' + t.content;
    else merged.push({ role: t.role, content: t.content });
  }
  if (!merged.length || merged[merged.length - 1].role !== 'user') return null;
  return merged.slice(-16);
}

function guardReply(reply) {
  let s = String(reply || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/[^.?!]*\bserial numbers?\b[^.?!]*[.?!]?/gi, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/openclaw/ig, '').trim();
  if (!s) return null;
  return s.slice(0, 800);
}

async function askHaiku(session) {
  const messages = modelMessages(session);
  if (!messages) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system: SYSTEM,
        messages,
      }),
    });
    if (!r.ok) throw new Error('anthropic ' + r.status);
    const data = await r.json();
    const text = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join(' ').trim();
    return guardReply(text);
  } finally {
    clearTimeout(timer);
  }
}

async function composeReply(session, text) {
  if (ANTHROPIC_KEY) {
    try {
      const reply = await askHaiku(session);
      if (reply) return reply;
    } catch (e) {
      console.error('haiku:', e.message);
    }
  }
  return machineReply(session, text);
}

/* ---- telegram ---- */
async function telegram(text) {
  if (!BOT || !CHAT) return false;
  const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: String(text).slice(0, 4000) }),
  });
  return r.ok;
}

function notify(text) {
  telegram(text).catch(e => console.error('TG:', e.message));
}

function alertFooter(session) {
  return [
    'Reply to take over. A plain reply goes to the latest open chat.',
    'Reply with: /t ' + session.id + ' your message',
  ].join('\n');
}

function alertOpen(session) {
  return ['\u{1F4AC} WEB CHAT', '', 'Session: ' + session.id, 'Visitor opened the chat.', '', alertFooter(session)].join('\n');
}

function alertVisitor(session, text) {
  return [
    '\u{1F4AC} WEB CHAT',
    '',
    'Session: ' + session.id,
    session.takeover ? 'Status: you have this chat' : 'Status: concierge is replying',
    'Visitor: ' + String(text).slice(0, 500),
    '',
    alertFooter(session),
  ].join('\n');
}

function alertPhoto(session, label) {
  return ['\u{1F4F7} WEB CHAT PHOTO', '', 'Session: ' + session.id, 'Photo: ' + label, '', alertFooter(session)].join('\n');
}

function isGary(msg) {
  if (!CHAT || !msg || !msg.chat) return false;
  return String(msg.chat.id) === String(CHAT);
}

function parseTakeover(text) {
  const m = String(text || '').match(/^\/(?:t|reply)(?:@[A-Za-z0-9_]+)?\s+(\S+)(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return { sessionId: m[1], text: (m[2] || '').trim() };
}

function sessionFromReply(msg) {
  const quoted = msg.reply_to_message && (msg.reply_to_message.text || msg.reply_to_message.caption || '');
  if (!quoted) return null;
  // Longest id wins so web_demo does not steal a quote that names web_demo123.
  let best = null;
  for (const id of sessions.keys()) {
    if (quoted.includes(id) && (!best || id.length > best.length)) best = id;
  }
  return best;
}

function deliverGary(session, text) {
  session.takeover = true;
  activeSessionId = session.id;
  session.updated = Date.now();
  pushMessage(session, text, 'gary', false);
  notify('Sent to ' + session.id + '. You have this chat — the concierge will stay quiet.');
}

async function handleGary(msg) {
  const text = (msg.text || '').trim();
  if (!text) {
    notify('Send a text reply to reach the website chat.');
    return;
  }
  if (/^\/(start|help)(?:@[A-Za-z0-9_]+)?$/i.test(text)) {
    notify([
      'KC Watch Trading web chat.',
      '',
      'A plain reply goes to the latest website chat.',
      '/t SESSION your message — send to that chat.',
      '/who — show the active session.',
    ].join('\n'));
    return;
  }
  if (/^\/who(?:@[A-Za-z0-9_]+)?$/i.test(text)) {
    const s = activeSession();
    notify(s ? ('Active: ' + s.id + (s.takeover ? ' (you)' : ' (concierge)')) : 'No open website chat.');
    return;
  }
  const cmd = parseTakeover(text);
  if (cmd) {
    const s = sessions.get(cmd.sessionId);
    if (!s) {
      notify('No chat ' + cmd.sessionId + '. Copy the session id from an alert, or send a plain reply for the latest chat.');
      return;
    }
    if (!cmd.text) {
      notify('Add a message: /t ' + cmd.sessionId + ' your message');
      return;
    }
    deliverGary(s, cmd.text);
    return;
  }
  if (text.startsWith('/')) {
    notify('Plain reply = latest chat.\n/t SESSION your message');
    return;
  }
  const quotedId = sessionFromReply(msg);
  const s = (quotedId && sessions.get(quotedId)) || activeSession();
  if (!s) {
    notify('No open website chat right now.');
    return;
  }
  deliverGary(s, text);
}

async function registerWebhook() {
  if (!BOT) {
    console.log('no TELEGRAM_BOT_TOKEN — alerts and handoff disabled');
    return;
  }
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || '';
  if (!domain) {
    console.log('No RAILWAY_PUBLIC_DOMAIN — set the Telegram webhook to https://<service>.up.railway.app/telegram');
    return;
  }
  const base = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = 'https://' + base + '/telegram';
  const body = { url, allowed_updates: ['message'] };
  if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    console.log('webhook set:', data.ok ? url : JSON.stringify(data));
  } catch (e) {
    console.error('webhook:', e.message);
  }
}

/* ---- http ---- */
const buckets = new Map();
function limited(ip) {
  const t = Date.now();
  let b = buckets.get(ip);
  if (!b || t - b.start > 600000) {
    b = { start: t, n: 0 };
    buckets.set(ip, b);
  }
  return ++b.n > 60;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        if (!settled) { settled = true; reject(Object.assign(new Error('too large'), { status: 413 })); }
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); }
    });
    req.on('error', e => { if (!settled) { settled = true; reject(e); } });
  });
}

function sendJson(res, status, obj, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (origin && ALLOWED.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

function preflight(res, origin) {
  const allow = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  res.writeHead(204, {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  res.end();
}

function originOk(origin) {
  return !origin || ALLOWED.includes(origin);
}

function parseDataUri(uri) {
  const m = String(uri || '').match(/^data:(image\/[a-zA-Z0-9.+-]+)(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  let buf;
  try { buf = Buffer.from(m[2].replace(/\s/g, ''), 'base64'); } catch (e) { return null; }
  if (!buf.length || buf.length > 12_000_000) return null;
  return { mime: m[1].toLowerCase(), buf };
}

async function handleChat(req, res, origin) {
  const raw = await readBody(req, 32 * 1024);
  let d;
  try { d = JSON.parse(raw || '{}'); } catch (e) {
    return sendJson(res, 400, { error: 'bad json' }, origin);
  }
  const sessionId = String(d.sessionId || '');
  const message = typeof d.message === 'string' ? d.message.trim() : '';
  if (!validSessionId(sessionId) || !message) {
    return sendJson(res, 400, { error: 'sessionId and message are required' }, origin);
  }
  if (message !== '__open__' && message.length > 2000) {
    return sendJson(res, 400, { error: 'message too long' }, origin);
  }
  const session = ensure(sessionId);
  touchActive(session);

  if (message === '__open__') {
    notify(alertOpen(session));
    if (!session.greeted) {
      const ts = pushMessage(session, GREETING, 'sam', true);
      session.greeted = true;
      session.greetingTs = ts;
      persist();
      return sendJson(res, 200, { reply: GREETING, handledBy: 'ai', ts, sessionId }, origin);
    }
    const ts = session.greetingTs || session.cursorTs || now();
    noteCursor(session, ts);
    return sendJson(res, 200, { reply: GREETING, handledBy: 'ai', ts, sessionId }, origin);
  }

  pushMessage(session, message, 'visitor', false);
  notify(alertVisitor(session, message));

  // Gary already has the chat: do not invent a concierge line.
  // If his text has not been polled yet, hand it back on this response.
  if (session.takeover) return sendJson(res, 200, takeoverBody(session, sessionId), origin);

  const reply = await composeReply(session, message);
  if (session.takeover) return sendJson(res, 200, takeoverBody(session, sessionId), origin);
  const ts = pushMessage(session, reply, 'sam', true);
  sendJson(res, 200, { reply, handledBy: 'ai', ts, sessionId }, origin);
}

// Pending Gary/Sam lines the widget has not been given yet.
// Sam replies are stored already-delivered because POST /chat returns them.
// Claiming here keeps a poll and a takeover POST from both showing the same line.
function claimUnseen(session, since) {
  const out = [];
  let changed = false;
  for (const m of session.messages) {
    if (m.delivered) continue;
    if (m.from !== 'gary' && m.from !== 'sam') continue;
    if (m.ts <= since) {
      m.delivered = true;
      changed = true;
      continue;
    }
    out.push(m);
    m.delivered = true;
    changed = true;
  }
  if (out.length) noteCursor(session, out[out.length - 1].ts);
  else if (since > (session.cursorTs || 0)) noteCursor(session, since);
  if (changed) persist();
  return out;
}

function takeoverBody(session, sessionId) {
  const pending = claimUnseen(session, session.cursorTs || 0);
  const gary = pending.filter(m => m.from === 'gary');
  if (gary.length) {
    const ts = gary[gary.length - 1].ts;
    return { reply: gary.map(m => m.text).join('\n\n'), handledBy: 'human', ts, sessionId };
  }
  const ts = session.cursorTs || session.greetingTs || now();
  return { reply: '', handledBy: 'ai', ts, sessionId };
}

function handlePoll(u, res, origin) {
  const sessionId = u.searchParams.get('sessionId') || '';
  const since = Number(u.searchParams.get('since') || 0) || 0;
  const session = validSessionId(sessionId) ? sessions.get(sessionId) : null;
  if (!session) return sendJson(res, 200, { messages: [] }, origin);
  const pending = claimUnseen(session, since);
  const messages = pending.map(m => ({ text: m.text, from: m.from, ts: m.ts }));
  sendJson(res, 200, { messages }, origin);
}

async function handleUpload(req, res, origin) {
  const raw = await readBody(req, 16 * 1024 * 1024);
  let d;
  try { d = JSON.parse(raw || '{}'); } catch (e) {
    return sendJson(res, 200, { error: 'bad json' }, origin);
  }
  const sessionId = String(d.sessionId || '');
  if (!validSessionId(sessionId)) return sendJson(res, 200, { error: 'missing session' }, origin);
  const photoType = String(d.photoType || '').slice(0, 40);
  const parsed = parseDataUri(d.imageData);
  if (!parsed) return sendJson(res, 200, { error: 'send a photo as a data URI' }, origin);
  const session = ensure(sessionId);
  touchActive(session);
  const label = PHOTO_LABELS[photoType] || (photoType || 'Photo');
  const ts = now();
  let file = null;
  if (PERSISTENT) {
    try {
      const dir = path.join(DATA_DIR, 'photos', sessionId);
      fs.mkdirSync(dir, { recursive: true });
      const ext = parsed.mime.includes('png') ? 'png'
        : parsed.mime.includes('webp') ? 'webp'
          : parsed.mime.includes('gif') ? 'gif' : 'jpg';
      const safeType = (photoType || 'photo').replace(/[^a-z0-9_-]/gi, '') || 'photo';
      file = path.join(dir, ts + '-' + safeType + '.' + ext);
      fs.writeFileSync(file, parsed.buf);
    } catch (e) {
      console.error('photo:', e.message);
      file = null;
    }
  }
  session.photos.push({ photoType, label, mime: parsed.mime, bytes: parsed.buf.length, ts, file });
  if (session.photos.length > 30) session.photos.splice(0, session.photos.length - 30);
  session.updated = ts;
  persist();
  notify(alertPhoto(session, label));
  sendJson(res, 200, { ok: true }, origin);
}

function handleTelegram(req, res) {
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    res.writeHead(401);
    res.end('unauthorized');
    return;
  }
  readBody(req, 1024 * 1024).then(body => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    let update;
    try { update = JSON.parse(body || '{}'); } catch (e) { return; }
    const msg = update.message;
    if (!msg || !isGary(msg)) return;
    if (msg.from && msg.from.is_bot) return;
    handleGary(msg).catch(e => console.error('gary:', e.message));
  }).catch(e => {
    if (!res.headersSent) {
      res.writeHead(e.status || 400);
      res.end('bad');
    }
  });
}

load();
if (prune()) persist();
setInterval(() => { if (prune()) persist(); }, 10 * 60 * 1000).unref();

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const origin = req.headers.origin || '';
  handleRequest(req, res, u, origin).catch(err => {
    console.error(err);
    if (res.headersSent) return;
    const status = err.status || 500;
    sendJson(res, status, { error: status === 413 ? 'too large' : 'error' }, originOk(origin) ? origin : '');
  });
});

async function handleRequest(req, res, u, origin) {
  if (req.method === 'OPTIONS') return preflight(res, origin);
  if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/health')) {
    return sendJson(res, 200, { ok: true }, origin);
  }
  if (req.method === 'POST' && u.pathname === '/telegram') return handleTelegram(req, res);
  if (!originOk(origin)) return sendJson(res, 403, { error: 'forbidden' }, '');
  const write = req.method === 'POST' && (u.pathname === '/chat' || u.pathname === '/upload');
  if (write && limited(clientIp(req))) return sendJson(res, 429, { error: 'slow down' }, origin);
  if (req.method === 'POST' && u.pathname === '/chat') return handleChat(req, res, origin);
  if (req.method === 'GET' && u.pathname === '/chat') return handlePoll(u, res, origin);
  if (req.method === 'POST' && u.pathname === '/upload') return handleUpload(req, res, origin);
  sendJson(res, 404, { error: 'not found' }, origin);
}

server.listen(PORT, () => {
  console.log('kcwt web chat on :' + PORT
    + ' | storage: ' + (PERSISTENT ? DATA_DIR : 'memory (restarts drop sessions)')
    + ' | haiku: ' + (ANTHROPIC_KEY ? ANTHROPIC_MODEL : 'off'));
  registerWebhook();
});
