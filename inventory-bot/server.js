// KC Watch Trading — Lead Alert + Triage
// Meta instant-form lead -> Graph API fetch -> Postgres -> Claude triage ->
// tiered Telegram alert. Send-only to Telegram: never polls getUpdates, so it
// cannot conflict with the website-chat services on the same bot token.

const express = require("express");
const crypto = require("crypto");
const { initDb, insertLead, saveClassification, recentLeads } = require("./db");
const { classifyLead } = require("./classify");

const app = express();

const {
  PAGE_ACCESS_TOKEN,      // Page token with leads_retrieval + pages_manage_ads
  APP_SECRET,
  VERIFY_TOKEN,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,       // 5480394847
  ANTHROPIC_API_KEY,
  DATABASE_URL,
  ADMIN_KEY,
  PORT = 3000,
} = process.env;

const REQUIRED = [
  "PAGE_ACCESS_TOKEN", "APP_SECRET", "VERIFY_TOKEN",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
  "ANTHROPIC_API_KEY", "DATABASE_URL",
];
for (const v of REQUIRED) {
  if (!process.env[v]) { console.error(`FATAL: missing env var ${v}`); process.exit(1); }
}

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get("/", (_req, res) => res.status(200).send("kcwt-lead-alert OK"));

// Meta webhook verification handshake
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    console.log("Webhook verified by Meta");
    return res.status(200).send(req.query["hub.challenge"]);
  }
  return res.sendStatus(403);
});

function validSignature(req) {
  const sig = req.headers["x-hub-signature-256"];
  if (!sig || !req.rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}

async function sendTelegram(text) {
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!r.ok) console.error("Telegram send failed:", r.status, await r.text());
}

const FIELD_LABELS = { full_name: "Name", phone_number: "Phone", email: "Email" };
function label(name) {
  if (FIELD_LABELS[name]) return FIELD_LABELS[name];
  return name.replace(/_/g, " ").replace(/\?+$/, "").replace(/^\w/, (c) => c.toUpperCase());
}

function fieldValue(fields, name) {
  const f = (fields || []).find((x) => x.name === name);
  return f ? (f.values || []).join(", ") : null;
}

async function fetchLead(leadgenId) {
  const r = await fetch(
    `https://graph.facebook.com/v21.0/${leadgenId}?fields=created_time,field_data,form_id,ad_name,campaign_name&access_token=${PAGE_ACCESS_TOKEN}`
  );
  if (!r.ok) throw new Error(`Graph ${r.status}: ${await r.text()}`);
  return r.json();
}

const TIER_HEADER = {
  HOT:  "🔥 HOT LEAD — CALL NOW",
  WARM: "🟡 WARM LEAD — call today",
  COLD: "⚪ COLD LEAD — low priority",
};

async function handleLead(value) {
  const id = value.leadgen_id;
  if (!id) return;

  let lead = null;
  let fields = [];

  try {
    lead = await fetchLead(id);
    fields = lead.field_data || [];
  } catch (e) {
    console.error("Lead fetch failed:", e.message);
  }

  // Store first. Dedupe is now the DB's UNIQUE constraint, which survives
  // restarts — the old in-memory Set did not.
  let isNew = true;
  try {
    isNew = await insertLead({
      leadgen_id: id,
      created_time: lead && lead.created_time ? lead.created_time : null,
      campaign_name: lead ? lead.campaign_name : null,
      ad_name: lead ? lead.ad_name : null,
      form_id: lead ? lead.form_id : null,
      full_name: fieldValue(fields, "full_name"),
      phone: fieldValue(fields, "phone_number"),
      email: fieldValue(fields, "email"),
      raw_fields: fields,
    });
  } catch (e) {
    console.error("DB insert failed (continuing to alert):", e.message);
  }
  if (!isNew) { console.log(`Duplicate delivery for ${id}, skipping`); return; }

  // Classify. Never let this block the alert.
  let c = null;
  try {
    if (fields.length) {
      c = await classifyLead(fields, lead ? lead.campaign_name : null);
      await saveClassification(id, c).catch((e) =>
        console.error("Save classification failed:", e.message));
    }
  } catch (e) {
    console.error("Classification failed:", e.message);
  }

  const lines = [];
  lines.push(c ? TIER_HEADER[c.tier] : "🔔 NEW LEAD — KC Watch Trading");

  if (c) {
    const bits = [];
    if (c.brand || c.model) bits.push([c.brand, c.model].filter(Boolean).join(" "));
    if (c.condition) bits.push(c.condition);
    if (c.multi_piece) bits.push("MULTI-PIECE");
    if (bits.length) lines.push(bits.join(" · "));
    if (c.asking_price) {
      const flag = c.ask_realistic === "unrealistic" ? " ⚠️"
                 : c.ask_realistic === "high" ? " (high)" : "";
      lines.push(`Ask: ${c.asking_price}${flag}`);
    }
    if (c.note) lines.push(`→ ${c.note}`);
  }

  if (lead && lead.campaign_name) lines.push(`Campaign: ${lead.campaign_name}`);

  if (fields.length) {
    const priority = ["full_name", "phone_number", "email"];
    const sorted = [
      ...priority.map((p) => fields.find((f) => f.name === p)).filter(Boolean),
      ...fields.filter((f) => !priority.includes(f.name)),
    ];
    lines.push("");
    for (const f of sorted) lines.push(`${label(f.name)}: ${(f.values || []).join(", ")}`);
  } else {
    lines.push("", `Lead ID: ${id}`, "(couldn't fetch details — check Leads Center)");
  }

  lines.push("", "Leads Center → https://business.facebook.com/latest/leads_center");
  await sendTelegram(lines.join("\n"));
}

app.post("/webhook", (req, res) => {
  if (!validSignature(req)) { console.warn("Rejected: bad signature"); return res.sendStatus(403); }
  res.sendStatus(200); // ack fast; Meta requires quick 200

  const body = req.body;
  if (body.object !== "page") return;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === "leadgen") {
        handleLead(change.value || {}).catch((e) => console.error("handleLead error:", e));
      }
    }
  }
});

// Simple lead browser: /admin?key=YOUR_ADMIN_KEY
app.get("/admin", async (req, res) => {
  if (!ADMIN_KEY || req.query.key !== ADMIN_KEY) return res.sendStatus(403);
  try {
    const rows = await recentLeads(100);
    res.json({ count: rows.length, leads: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`kcwt-lead-alert listening on ${PORT}`)))
  .catch((e) => { console.error("FATAL: DB init failed:", e.message); process.exit(1); });
