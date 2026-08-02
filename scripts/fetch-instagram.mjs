// KC Watch Trading — Instagram feed refresh
// Pulls latest 9 posts from @kcwatchtrading via IG Graph API (system-user token),
// downloads images locally, writes assets/data/instagram.json.
// EXITS NON-ZERO WITHOUT WRITING on any failure -> workflow skips commit -> site keeps last good feed.
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';

const TOKEN = process.env.IG_ACCESS_TOKEN;
const IG_USER = process.env.IG_USER_ID;
if (!TOKEN || !IG_USER) { console.error('Missing IG_ACCESS_TOKEN or IG_USER_ID'); process.exit(1); }

const API = `https://graph.facebook.com/v21.0/${IG_USER}/media?fields=id,media_type,media_url,thumbnail_url,permalink,caption&limit=15&access_token=${TOKEN}`;

const res = await fetch(API);
if (!res.ok) { console.error('Graph API error', res.status, await res.text()); process.exit(1); }
const data = await res.json();
const media = (data.data || [])
  .filter(m => ['IMAGE', 'CAROUSEL_ALBUM'].includes(m.media_type))
  .slice(0, 9);
if (media.length === 0) { console.error('No posts returned'); process.exit(1); }

const dir = 'assets/images/ig';
mkdirSync(dir, { recursive: true });

const posts = [];
for (let i = 0; i < media.length; i++) {
  const m = media[i];
  const url = m.media_url || m.thumbnail_url;
  const imgRes = await fetch(url);
  if (!imgRes.ok) { console.error('Image download failed', m.id); process.exit(1); }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const file = `${dir}/live${i + 1}.jpg`;
  writeFileSync(file, buf);
  posts.push({
    image: file,
    permalink: m.permalink,
    alt: (m.caption || 'KC Watch Trading post').split('\n')[0].slice(0, 110)
  });
}

// remove stale mockup/live files beyond current set
for (const f of readdirSync(dir)) {
  if (/^ig\d+\.jpg$/.test(f)) unlinkSync(`${dir}/${f}`);
  const mLive = f.match(/^live(\d+)\.jpg$/);
  if (mLive && Number(mLive[1]) > posts.length) unlinkSync(`${dir}/${f}`);
}

writeFileSync('assets/data/instagram.json', JSON.stringify({
  updated: new Date().toISOString(),
  posts
}, null, 2));
console.log(`Wrote ${posts.length} posts at ${new Date().toISOString()}`);
