// Offline tests: pg-mem stands in for Postgres, Telegram is a mock. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
process.env.RAILWAY_VOLUME_MOUNT_PATH = DATA; // journal + queue go to a temp dir
const { newDb } = require('pg-mem');
const { buildServer } = require('../server');
const { createStore } = require('../store');

const ORIGIN = 'https://kcwatchtrading.com';
const quiet = { log() {}, error() {} };

function freshPool() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return new Pool();
}

async function withRelay(store, sendTelegram, fn) {
  const server = buildServer({ store, sendTelegram });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try { await fn(server.address().port); }
  finally { await new Promise((r) => server.close(r)); }
}

function post(port, body, origin = ORIGIN) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: '/lead', method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, 'Content-Length': Buffer.byteLength(data) } },
    (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, body: t })); });
    req.on('error', reject); req.end(data);
  });
}

const sample = {
  name: 'Test Lead (review)', contact: 'test.lead@example.com', watch: 'Rolex Submariner 124060',
  intent: 'Buy', message: 'Budget about $11k, can trade a Tudor BB58', page: '/watch.html?id=KC10183',
};

test('lead is written to Postgres BEFORE the Telegram alert, then tg_ok is recorded', async () => {
  const pool = freshPool();
  const pending = path.join(DATA, 'p1.jsonl');
  const store = createStore({ pool, pendingFile: pending, log: quiet });
  await store.init();
  const alerts = [];
  const sendTelegram = async (lead, saved) => {
    const { rows } = await pool.query('SELECT name FROM website_leads WHERE lead_uid = $1', [lead.id]);
    alerts.push({ rowsAtAlertTime: rows.length, saved, lead });
    return true;
  };
  await withRelay(store, sendTelegram, async (port) => {
    const res = await post(port, sample);
    assert.equal(res.status, 200);
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].rowsAtAlertTime, 1, 'row must exist when the alert fires');
  assert.deepEqual(alerts[0].saved, { db: true });
  await new Promise((r) => setTimeout(r, 20)); // markTelegram is fire-and-forget
  const { rows } = await pool.query('SELECT * FROM website_leads');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, sample.name);
  assert.equal(rows[0].contact_email, 'test.lead@example.com');
  assert.equal(rows[0].contact_phone, null);
  assert.equal(rows[0].watch, sample.watch);
  assert.equal(rows[0].message, sample.message);
  assert.equal(rows[0].source, 'site_form');
  assert.equal(rows[0].tg_ok, true);
  assert.equal(fs.existsSync(pending), false, 'nothing queued when the DB works');
  console.log('# stored row:', JSON.stringify({ name: rows[0].name, contact: rows[0].contact, watch: rows[0].watch, tg_ok: rows[0].tg_ok }));
});

test('DB down: alert still goes out, flagged, lead queued on disk, then flushed when the DB is back', async () => {
  const pending = path.join(DATA, 'p2.jsonl');
  const broken = { query: async () => { throw new Error('connect ECONNREFUSED'); } };
  const downStore = createStore({ pool: broken, pendingFile: pending, log: quiet });
  const alerts = [];
  const { savedLine } = require('../server');
  await withRelay(downStore, async (lead, saved) => { alerts.push({ saved, line: savedLine(saved) }); return true; }, async (port) => {
    const res = await post(port, { ...sample, contact: '(816) 555-0147' });
    assert.equal(res.status, 200);
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].saved.db, false);
  assert.match(alerts[0].line, /NOT in database yet/);
  assert.equal(fs.readFileSync(pending, 'utf8').trim().split('\n').length, 1);

  const pool = freshPool();
  const upStore = createStore({ pool, pendingFile: pending, log: quiet });
  assert.equal(await upStore.flushPending(), 1);
  assert.equal(await upStore.flushPending(), 0, 'flush is idempotent');
  const { rows } = await pool.query('SELECT contact_phone FROM website_leads');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contact_phone, '(816) 555-0147');
  assert.equal(upStore.pendingCount(), 0);
});

test('DB hangs: insert times out, alert is not blocked, lead queued', async () => {
  const pending = path.join(DATA, 'p3.jsonl');
  const hung = { query: () => new Promise(() => {}) };
  const store = createStore({ pool: hung, pendingFile: pending, timeoutMs: 100, log: quiet });
  let alerted = 0;
  const t0 = Date.now();
  await withRelay(store, async () => { alerted++; return true; }, async (port) => {
    assert.equal((await post(port, sample)).status, 200);
  });
  assert.equal(alerted, 1);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(store.pendingCount(), 1);
});

test('no DATABASE_URL: behaves like today (alert sent) and queues the lead for later', async () => {
  const pending = path.join(DATA, 'p4.jsonl');
  const store = createStore({ pool: null, pendingFile: pending, log: quiet });
  let saved;
  await withRelay(store, async (l, s) => { saved = s; return true; }, async (port) => {
    assert.equal((await post(port, sample)).status, 200);
  });
  assert.equal(saved.db, false);
  assert.equal(store.pendingCount(), 1);
});

test('Telegram failure: lead stays in Postgres with tg_ok = false', async () => {
  const pool = freshPool();
  const store = createStore({ pool, pendingFile: path.join(DATA, 'p5.jsonl'), log: quiet });
  await withRelay(store, async () => { throw new Error('telegram 502'); }, async (port) => {
    assert.equal((await post(port, sample)).status, 200);
  });
  await new Promise((r) => setTimeout(r, 20));
  const { rows } = await pool.query('SELECT tg_ok FROM website_leads');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tg_ok, false);
});

test('invalid contact and foreign origin are rejected before anything is stored or sent', async () => {
  const pool = freshPool();
  const store = createStore({ pool, pendingFile: path.join(DATA, 'p6.jsonl'), log: quiet });
  await store.init();
  let alerted = 0;
  await withRelay(store, async () => { alerted++; return true; }, async (port) => {
    assert.equal((await post(port, { ...sample, contact: 'milroy' })).status, 400);
    assert.equal((await post(port, sample, 'https://evil.example')).status, 403);
  });
  assert.equal(alerted, 0);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM website_leads');
  assert.equal(rows[0].n, 0);
});
