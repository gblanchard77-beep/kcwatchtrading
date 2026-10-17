#!/usr/bin/env python3
"""KC Watch Trading: sync the site inventory from Sell Your Grail Office (single source of truth).

Reads the Office "Website" channel feed (JSON), maps it into assets/data/inventory.json (the site's existing schema),
keeps existing slugs (matched by stock ID, then by reference), keeps sold watches as an archive, downloads each Office
photo once into assets/images/office/<slug>/, and maps Office "Reserved" (e.g. Pending sale, once ticked in Office) to
status "Reserved". Writes files only when something really changed. With --commit it makes ONE local git commit
(never pushes; the workflow pushes).

Source URL:  env OFFICE_WEBSITE_FEED_URL (GitHub secret; contains the Office feed key, never printed)
             or --source URL (e.g. the keyless https://office.sellyourgrail.com/showroom/kc-watch-trading/data.json).
No third-party dependencies (Python 3.9+ standard library only).

Exit codes: 0 ok (changed or not), 2 feed problem (nothing written), 3 safety stop (nothing written).
"""
import argparse, datetime, json, os, re, subprocess, sys, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
INV = os.path.join(ROOT, 'assets', 'data', 'inventory.json')
IMG_DIR = 'assets/images/office'                 # repo-relative; one folder per slug
UA = 'kcwt-office-sync/1.0 (+https://kcwatchtrading.com)'
MAX_GALLERY = int(os.environ.get('OFFICE_SYNC_MAX_PHOTOS', '12'))
MAX_SOLD_PER_RUN = int(os.environ.get('OFFICE_SYNC_MAX_SOLD_PER_RUN', '3'))   # more disappearing at once = stop and ask
ACRONYMS = {'Gmt': 'GMT', 'Ii': 'II', 'Iii': 'III', 'Op': 'OP', 'Dj': 'DJ', 'Bb': 'BB', 'Ap': 'AP', 'Vc': 'VC'}
BOT_DESC = re.compile(r'Contact us for full details and photos\.\s*$')


def log(*a): print(*a, flush=True)


def redact(url):
    """Never print a feed key or a photo signature: show only scheme, host and the shape of the path."""
    p = urllib.parse.urlparse(url or '')
    path = re.sub(r'/(feeds|pub)/[^/]+', r'/\1/<redacted>', p.path)
    return f'{p.scheme}://{p.netloc}{path}'


def fetch(url, binary=False, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*' if binary else 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if r.status != 200: raise RuntimeError(f'HTTP {r.status}')
        return r.read()


# ------------------------------------------------------------------ normalising
def norm_ref(s):
    s = re.sub(r'[^A-Z0-9]', '', str(s or '').upper())
    return s[1:] if re.match(r'^M\d', s) else s          # Tudor: M79360N == 79360N


def tidy_model(model, nickname=''):
    words = [ACRONYMS.get(w, w) for w in str(model or '').split()]
    m = ' '.join(words).strip()
    if nickname and m.lower().endswith(' ' + nickname.lower()):   # Office "GMT-Master II Batman" + site nickname "Batman"
        m = m[: -len(nickname)].strip()
    return m


def slugify(*parts):
    return re.sub(r'(^-|-$)', '', re.sub(r'[^a-z0-9]+', '-', ' '.join(p for p in parts if p).lower()))


def set_from_included(inc, current):
    t = (inc or '').lower()
    box, papers = 'box' in t, any(k in t for k in ('papers', 'card', 'warranty'))
    if box and papers: return 'Complete Set'
    if box: return 'Box Only'
    if papers: return 'Papers Only'
    if 'watch only' in t or t.strip() == 'watch': return 'Watch Only'
    return current


def auto_description(e):
    nick = f' \u201C{e["nickname"]}\u201D' if e.get('nickname') else ''
    s1 = f'{e["brand"]} {e["model"]}{nick} ref. {e["reference"]}'.strip() + '.'
    bits = []
    if e.get('year'): bits.append(f'Year {e["year"]}')
    if e.get('condition'): bits.append(f'{e["condition"].lower()} condition')
    s2 = (', '.join(bits) + '.') if bits else ''
    spec = []
    if e.get('dial'): spec.append(f'{e["dial"]} dial')
    case = ' '.join(x for x in (e.get('caseSize'), e.get('material')) if x)
    if case: spec.append(f'{case} case')
    if e.get('bracelet'): spec.append(f'{e["bracelet"]} bracelet')
    s3 = (', '.join(spec) + '.') if spec else ''
    s4 = f'Included: {e["included"]}.' if e.get('included') else ''
    return ' '.join(x for x in (s1, s2, s3, s4, 'Contact us for full details.') if x)


def office_status(w):
    if w.get('sold'): return 'Sold'
    if w.get('reserved'): return 'Reserved'                      # Office "Mark these as Reserved" statuses, e.g. Pending sale
    if (w.get('badge') or '') == 'Arriving soon': return 'Incoming'
    return 'Available'


def photo_id(url):
    m = re.search(r'/(\d+)(?:_t)?\.jpg(?:\?.*)?$', url or '')
    return m.group(1) if m else None


def today():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo('America/Chicago')).date().isoformat()
    except Exception:
        return datetime.date.today().isoformat()


# ------------------------------------------------------------------ photos (downloaded once, never altered)
def sync_photos(e, w, dry, report):
    """Gallery = the watch's current Office photos, in Office order. New ones are downloaded once; a photo the dealer
    removed or kept off the feeds (e.g. it shows a serial) is dropped from the gallery and its file deleted."""
    slug = e['slug']; folder = f'{IMG_DIR}/{slug}'; want = []
    for full, thumb in list(zip(w.get('photos') or [], (w.get('thumbs') or []) + [None] * 99))[:MAX_GALLERY]:
        pid = photo_id(full)
        if not pid: continue
        rel = f'{folder}/{pid}.jpg'; want.append(rel); path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            report['photos_new'].append(rel)
            if not dry:
                os.makedirs(os.path.dirname(path), exist_ok=True)
                data = fetch(full, binary=True)
                if not data.startswith(b'\xff\xd8'): raise RuntimeError(f'not a JPEG: {rel}')
                open(path, 'wb').write(data)
        if thumb and len(want) == 1:                               # small copy of the main picture, for cards
            trel = f'{folder}/{pid}_card.jpg'; tpath = os.path.join(ROOT, trel)
            if not os.path.exists(tpath):
                report['photos_new'].append(trel)
                if not dry:
                    data = fetch(thumb, binary=True)
                    if not data.startswith(b'\xff\xd8'): raise RuntimeError(f'not a JPEG: {trel}')
                    open(tpath, 'wb').write(data)
    old = e.get('gallery') or []
    for rel in old:
        if rel not in want:
            report['photos_removed'].append(rel)
            if not dry:
                for p in (rel, rel.replace('.jpg', '_card.jpg')):
                    try: os.remove(os.path.join(ROOT, p))
                    except FileNotFoundError: pass
    changed = old != want
    if want:
        e['gallery'] = want
        card = want[0].replace('.jpg', '_card.jpg')
        for k, val in (('image', want[0]), ('cardImage', card)):
            if not e.get(k) or (e[k].startswith(IMG_DIR) and e[k] != val): e[k] = val; changed = True
        if not dry and os.path.isdir(os.path.join(ROOT, folder)):        # drop a stale card copy if the main picture changed
            for f in os.listdir(os.path.join(ROOT, folder)):
                if f.endswith('_card.jpg') and f'{folder}/{f}' != card: os.remove(os.path.join(ROOT, folder, f))
    return changed


# ------------------------------------------------------------------ main merge
OWNED = ['brand', 'model', 'reference', 'stockId', 'year', 'condition', 'caseSize', 'material', 'dial', 'bracelet', 'included', 'set', 'price', 'status']


def office_values(w, e):
    v = {'brand': w.get('brand') or '', 'model': tidy_model(w.get('model'), (e or {}).get('nickname', '')), 'reference': w.get('reference') or '',
         'stockId': w.get('sku') or '', 'year': str(w.get('year') or ''), 'condition': w.get('condition') or '', 'caseSize': w.get('size') or '',
         'material': w.get('material') or '', 'dial': w.get('dial') or '', 'bracelet': w.get('bracelet') or '', 'included': (w.get('included') or '').strip(),
         'status': office_status(w)}
    v['set'] = set_from_included(v['included'], (e or {}).get('set', ''))
    p = w.get('price')
    v['price'] = int(p) if isinstance(p, (int, float)) else ('Inquire' if not w.get('sold') else (e or {}).get('price', 'Inquire'))
    return v


def match(watches, w, claimed):
    sku = (w.get('sku') or '').upper()
    if sku:
        for i, e in enumerate(watches):
            if i not in claimed and (e.get('stockId') or '').upper() == sku: return i, 'stock ID'
    ref = norm_ref(w.get('reference'))
    if ref:
        hits = [i for i, e in enumerate(watches) if i not in claimed and e.get('status') != 'Sold' and norm_ref(e.get('reference')) == ref]
        if len(hits) == 1: return hits[0], 'reference'
        if len(hits) > 1: return None, f'ambiguous reference ({len(hits)} site watches)'
    return None, 'new'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', help='feed URL (default: env OFFICE_WEBSITE_FEED_URL)')
    ap.add_argument('--dry-run', action='store_true', help='report only, write nothing')
    ap.add_argument('--commit', action='store_true', help='git add + ONE local commit if anything changed (no push)')
    ap.add_argument('--msg-file', help='write the commit message here (for the workflow)')
    ap.add_argument('--allow-mass-sold', action='store_true', help=f'allow more than {MAX_SOLD_PER_RUN} watches to flip to Sold in one run')
    a = ap.parse_args()

    url = a.source or os.environ.get('OFFICE_WEBSITE_FEED_URL', '')
    if not url: log('No feed URL: set the OFFICE_WEBSITE_FEED_URL secret or pass --source.'); return 2
    log('Feed:', redact(url))
    try:
        feed = json.loads(fetch(url).decode('utf-8'))
        office = feed['watches']; assert isinstance(office, list)
    except Exception as ex:
        log('Feed problem, nothing changed:', type(ex).__name__, str(ex)[:200]); return 2

    raw = open(INV, encoding='utf-8').read(); inv = json.loads(raw); watches = inv['watches']
    live_on_site = [e for e in watches if e.get('status') != 'Sold']
    if not office and live_on_site:
        log('Safety stop: Office returned 0 watches while the site shows', len(live_on_site), '- is the Office Website channel switched off? Nothing changed.'); return 3

    report = {'new': [], 'updated': [], 'sold': [], 'photos_new': [], 'photos_removed': [], 'warnings': []}
    claimed = set(); now = today()
    for w in office:
        i, how = match(watches, w, claimed)
        if how.startswith('ambiguous'): report['warnings'].append(f'{w.get("sku")} {w.get("reference")}: {how}; skipped'); continue
        if i is None:
            if w.get('sold'): continue                              # a sold watch the site never had: not added
            v = office_values(w, None)
            e = {'slug': '', 'status': v['status'], 'brand': v['brand'], 'model': v['model'], 'nickname': '', 'reference': v['reference'], 'stockId': v['stockId'],
                 'year': v['year'], 'cardDate': '', 'condition': v['condition'], 'set': v['set'], 'price': v['price'], 'caseSize': v['caseSize'], 'material': v['material'],
                 'dial': v['dial'], 'bracelet': v['bracelet'], 'included': v['included'], 'description': '', 'image': '', 'cardImage': '',
                 'order': min([x.get('order') or 0 for x in watches] + [0]) - 1}
            base = slugify(v['brand'], v['model'], v['stockId'] or v['reference']); slug, n = base, 1
            while any(x.get('slug') == slug for x in watches): n += 1; slug = f'{base}-{n}'
            e['slug'] = slug; e['description'] = auto_description(e); e['descAuto'] = True; e['source'] = 'office'
            sync_photos(e, w, a.dry_run, report); e['updated'] = now
            watches.append(e); claimed.add(len(watches) - 1)
            report['new'].append(f'{v["stockId"]} {v["brand"]} {v["model"]} {v["reference"]} ({v["status"]}, {v["price"]}) -> /watches/{slug}/')
            continue
        claimed.add(i); e = watches[i]; v = office_values(w, e); diffs = []
        for k in OWNED:
            new = v[k]
            if new in ('', None) and k not in ('price', 'status'): continue      # Office blank: keep what the site has
            if e.get(k) != new: diffs.append(f'{k}: {e.get(k)!r} -> {new!r}'); e[k] = new
        if e.get('source') != 'office': e['source'] = 'office'; diffs.append(f'matched by {how}')
        if BOT_DESC.search(e.get('description') or '') or e.get('descAuto'):
            d = auto_description(e)
            if d != e.get('description'): e['description'] = d; e['descAuto'] = True; diffs.append('description regenerated')
        if sync_photos(e, w, a.dry_run, report): diffs.append(f'gallery: {len(e.get("gallery") or [])} photos')
        if diffs:
            e['updated'] = now
            report['updated'].append(f'{e.get("stockId")} /watches/{e["slug"]}/: ' + '; '.join(diffs))

    gone = [i for i, e in enumerate(watches) if i not in claimed and e.get('status') != 'Sold']
    office_gone = [i for i in gone if watches[i].get('source') == 'office']
    for i in gone:
        if i not in office_gone: report['warnings'].append(f'{watches[i].get("stockId") or watches[i]["slug"]}: on the site but not in Office and never synced; left unchanged')
    if len(office_gone) > MAX_SOLD_PER_RUN and not a.allow_mass_sold:
        log(f'Safety stop: {len(office_gone)} watches would flip to Sold at once (limit {MAX_SOLD_PER_RUN}). Nothing changed.')
        for i in office_gone: log('  would mark Sold:', watches[i].get('stockId'), watches[i]['slug'])
        return 3
    for i in office_gone:
        e = watches[i]; e['status'] = 'Sold'; e['updated'] = now
        report['sold'].append(f'{e.get("stockId")} {e["brand"]} {e["model"]} {e["reference"]} -> Sold (left Office feed; photos kept)')

    out = json.dumps(inv, indent=2, ensure_ascii=False)
    changed = out != raw
    for k in ('new', 'updated', 'sold', 'photos_new', 'photos_removed', 'warnings'):
        for line in report[k]: log(f'[{k}]', line)
    if not changed:
        log('No change.'); return 0
    if a.dry_run:
        log('Dry run: inventory.json would change; nothing written.'); return 0
    open(INV, 'w', encoding='utf-8').write(out)

    parts = []
    if report['new']: parts.append(f'{len(report["new"])} new')
    if report['sold']: parts.append(f'{len(report["sold"])} sold')
    if report['updated']: parts.append(f'{len(report["updated"])} updated')
    msg = 'Office sync: ' + (', '.join(parts) or 'inventory updated') + '\n\n' + '\n'.join(report['new'] + report['sold'] + report['updated'])
    if a.msg_file: open(a.msg_file, 'w', encoding='utf-8').write(msg + '\n')
    if a.commit:
        subprocess.run(['git', '-C', ROOT, 'add', 'assets/data/inventory.json', IMG_DIR], check=True)
        subprocess.run(['git', '-C', ROOT, 'add', '-A', IMG_DIR], check=True)
        subprocess.run(['git', '-C', ROOT, 'commit', '-q', '-m', msg], check=True)
        log('Committed locally (not pushed).')
    log('Changed.'); return 0


if __name__ == '__main__':
    sys.exit(main())
