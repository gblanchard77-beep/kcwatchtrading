// KC Watch Trading — lead relay durable storage
// Postgres first (website_leads table, same database kcwt-lead-alert uses).
// If the DB is missing, slow, or down, the lead goes to a pending queue file and
// is retried later. The Telegram alert is never blocked by storage.
const fs = require('fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS website_leads (
  id             SERIAL PRIMARY KEY,
  lead_uid       TEXT UNIQUE NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source         TEXT NOT NULL DEFAULT 'site_form',
  name           TEXT NOT NULL,
  contact        TEXT NOT NULL,
  contact_email  TEXT,
  contact_phone  TEXT,
  watch          TEXT,
  intent         TEXT,
  message        TEXT,
  page           TEXT,
  tg_ok          BOOLEAN,
  status         TEXT NOT NULL DEFAULT 'new',
  notes          TEXT
);
CREATE INDEX IF NOT EXISTS website_leads_received_at_idx ON website_leads (received_at DESC);
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN;
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS sms_consent_text TEXT;
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS sms_consent_at TIMESTAMPTZ;
`;

const INSERT_SQL = `
INSERT INTO website_leads
  (lead_uid, received_at, source, name, contact, contact_email, contact_phone,
   watch, intent, message, page, sms_consent, sms_consent_text, sms_consent_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
ON CONFLICT (lead_uid) DO NOTHING`;

const TG_SQL = `UPDATE website_leads SET tg_ok = $2 WHERE lead_uid = $1`;

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ' timed out after ' + ms + 'ms')), ms); }),
  ]).finally(() => clearTimeout(t));
}

function insertParams(lead) {
  return [
    lead.id, lead.ts, lead.source || 'site_form', lead.name, lead.contact,
    lead.contact_email || null, lead.contact_phone || null,
    lead.watch || null, lead.intent || null, lead.message || null, lead.page || null,
    typeof lead.sms_consent === 'boolean' ? lead.sms_consent : null,
    lead.sms_consent_text || null,
    lead.sms_consent_at || null,
  ];
}

// pool: a pg Pool (or anything with query(sql, params)), or null when DATABASE_URL is unset.
function createStore({ pool, pendingFile, timeoutMs = 4000, log = console }) {
  let ready = false;

  async function init() {
    if (!pool) return false;
    try {
      await withTimeout(pool.query(SCHEMA), timeoutMs, 'db init');
      ready = true;
    } catch (e) {
      log.error('db init failed:', e.message);
    }
    return ready;
  }

  // Never throws: a full/unwritable disk must not stop the Telegram alert.
  function queue(lead) {
    try { fs.appendFileSync(pendingFile, JSON.stringify(lead) + '\n'); return true; }
    catch (e) { log.error('queue write failed:', e.message); return false; }
  }

  async function insert(lead) {
    // One bounded attempt: if the table can't be ensured, fail fast so the alert isn't delayed twice.
    if (!ready && !(await init())) throw new Error('db not ready');
    await withTimeout(pool.query(INSERT_SQL, insertParams(lead)), timeoutMs, 'db insert');
  }

  // Returns { db: true } when the row is in Postgres, else { db: false, queued: true }.
  async function save(lead) {
    if (!pool) return { db: false, queued: queue(lead), reason: 'no_database_url' };
    try {
      await insert(lead);
      return { db: true };
    } catch (e) {
      log.error('db insert failed, lead queued on disk:', e.message);
      return { db: false, queued: queue(lead), reason: 'db_error' };
    }
  }

  async function markTelegram(leadId, ok) {
    if (!pool) return;
    try { await withTimeout(pool.query(TG_SQL, [leadId, ok]), timeoutMs, 'db tg update'); }
    catch (e) { log.error('db tg update failed:', e.message); }
  }

  // Move queued leads into Postgres. Safe to run repeatedly (ON CONFLICT DO NOTHING).
  let flushing = false;
  async function flushPending() {
    if (!pool || flushing) return 0;
    flushing = true;
    const work = pendingFile + '.flushing';
    try {
      if (!fs.existsSync(work)) {
        if (!fs.existsSync(pendingFile)) return 0;
        fs.renameSync(pendingFile, work); // new leads keep appending to a fresh pendingFile
      }
      const lines = fs.readFileSync(work, 'utf8').split('\n').filter(Boolean);
      const left = [];
      let moved = 0;
      for (const line of lines) {
        let lead;
        try { lead = JSON.parse(line); } catch (e) { continue; }
        try { await insert(lead); moved++; } catch (e) { left.push(line); }
      }
      if (left.length) fs.appendFileSync(pendingFile, left.join('\n') + '\n');
      fs.unlinkSync(work);
      if (moved) log.log('flushed ' + moved + ' queued lead(s) to Postgres');
      return moved;
    } catch (e) {
      log.error('flush failed:', e.message);
      return 0;
    } finally {
      flushing = false;
    }
  }

  function pendingCount() {
    let n = 0;
    for (const f of [pendingFile, pendingFile + '.flushing']) {
      try { n += fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length; } catch (e) {}
    }
    return n;
  }

  return { init, save, markTelegram, flushPending, pendingCount };
}

module.exports = { createStore, SCHEMA, INSERT_SQL, TG_SQL };
