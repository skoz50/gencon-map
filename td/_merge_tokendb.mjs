#!/usr/bin/env node
/**
 * _merge_tokendb.mjs — merge tokendb fields + images into data/2026/td-tokens.json.
 *
 * tokendb's field values are canonical: its slot/rarity/classification strings are
 * written through verbatim, with no vocabulary translation. Our own curation fields
 * (keeper, keeperQty, tradeQty, notes, why) are preserved untouched.
 *
 * Images are fetched fresh — session 1 cached HTML only, not image bytes — at
 * ~1 req/sec, and skipped if already on disk, so re-runs are free.
 *
 *   node td/_merge_tokendb.mjs
 *   node td/_merge_tokendb.mjs --no-images   # merge fields only
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OURS_FILE = path.join(HERE, '..', 'data', '2026', 'td-tokens.json');
const CATALOG_FILE = path.join(HERE, 'tokendb-catalog.json');
const REPORT_FILE = path.join(HERE, 'match-report.json');
const IMAGE_DIR = path.join(HERE, 'images');

const UA = 'gencon-map-token-catalog/0.1 (personal, non-commercial research script; +https://github.com/skoz50/gencon-map; contact skoz@skoz.org)';
const DELAY_MS = 1000;
const MAX_RETRIES = 3;
const LARGE_IMAGE_BYTES = 200 * 1024;   // flag, don't block

const NO_IMAGES = process.argv.includes('--no-images');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ours = JSON.parse(await readFile(OURS_FILE, 'utf8'));
const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
const report = JSON.parse(await readFile(REPORT_FILE, 'utf8'));

if (report.counts.unmatched || report.counts.ambiguous) {
  throw new Error(`refusing to merge: report still has ${report.counts.unmatched} unmatched / ${report.counts.ambiguous} ambiguous`);
}

const bySlug = new Map(catalog.tokens.map(t => [t.slug, t]));
const matchByName = new Map(report.matched.map(m => [m.our_name, m]));

// ---- images -----------------------------------------------------------------

async function fetchImage(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'image/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`  ! give up on ${url}: ${err.message}`);
        return null;
      }
      await sleep(DELAY_MS * 2 ** attempt);
    }
  }
  return null;
}

await mkdir(IMAGE_DIR, { recursive: true });

const started = Date.now();
const oversized = [];
const imageFailures = [];
let downloaded = 0, skipped = 0;

// ---- merge ------------------------------------------------------------------

const merged = [];
for (const t of ours.tokens) {
  const m = matchByName.get(t.name);
  if (!m) throw new Error(`no match record for "${t.name}"`);
  const e = bySlug.get(m.tokendb_slug);
  if (!e) throw new Error(`catalog has no entry for slug "${m.tokendb_slug}"`);

  const ext = (e.image?.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || 'png';
  const fileName = `${e.slug}.${ext}`;
  const dest = path.join(IMAGE_DIR, fileName);

  if (!NO_IMAGES && e.image) {
    if (existsSync(dest)) {
      skipped++;
    } else {
      const buf = await fetchImage(e.image);
      await sleep(DELAY_MS);
      if (buf) {
        await writeFile(dest, buf);
        downloaded++;
        if (buf.length > LARGE_IMAGE_BYTES) oversized.push({ file: fileName, bytes: buf.length, url: e.image });
      } else {
        imageFailures.push({ name: t.name, url: e.image });
      }
    }
  }
  if (existsSync(dest) && (await stat(dest)).size > LARGE_IMAGE_BYTES && !oversized.some(o => o.file === fileName)) {
    oversized.push({ file: fileName, bytes: (await stat(dest)).size, url: e.image });
  }

  merged.push({
    // --- ours: curation, preserved verbatim ---
    name: t.name,
    category: t.category,
    keeper: t.keeper,
    keeperQty: t.keeperQty,
    tradeQty: t.tradeQty,
    notes: t.notes,
    why: t.why,
    // --- tokendb: canonical, written through as-is ---
    slot: e.slot,
    rarity: e.rarity,
    usable_by: e.usableBy,
    years: e.years,
    source: e.source,
    classification: e.classification,
    flavor: e.flavor,
    text_on_token: e.textOnToken,
    tokendb_url: e.url,
    tokendb_slug: e.slug,
    tokendb_name: e.name,
    image_path: existsSync(dest) ? `images/${fileName}` : null,
  });

  if (merged.length % 25 === 0) {
    console.log(`  [${merged.length}/${ours.tokens.length}] downloaded=${downloaded} skipped=${skipped} failed=${imageFailures.length}`);
  }
}

await writeFile(OURS_FILE, JSON.stringify({
  source: ours.source,
  enrichedFrom: 'https://tokendb.com — field values are tokendb\'s, used verbatim (no vocabulary translation)',
  enrichedAt: new Date().toISOString(),
  tokens: merged,
}, null, 2) + '\n', 'utf8');

// ---- report -----------------------------------------------------------------

let imageBytes = 0, imageFiles = 0;
for (const f of await readdir(IMAGE_DIR)) {
  if (f.startsWith('.')) continue;
  imageBytes += (await stat(path.join(IMAGE_DIR, f))).size;
  imageFiles++;
}

const slots = [...new Set(merged.map(t => t.slot))].sort();
const elapsed = Math.round((Date.now() - started) / 1000);

console.log(`\nmerged ${merged.length} tokens -> ${path.relative(process.cwd(), OURS_FILE)}`);
console.log(`images: ${imageFiles} files, ${(imageBytes / 1024 / 1024).toFixed(2)} MiB (downloaded ${downloaded}, skipped ${skipped}, failed ${imageFailures.length})`);
console.log(`elapsed: ${Math.floor(elapsed / 60)}m${elapsed % 60}s`);
if (oversized.length) {
  console.log(`\noversized images (>${LARGE_IMAGE_BYTES / 1024} KiB):`);
  oversized.forEach(o => console.log(`  ${o.file}  ${(o.bytes / 1024).toFixed(0)} KiB`));
} else {
  console.log(`\nno image over ${LARGE_IMAGE_BYTES / 1024} KiB`);
}
if (imageFailures.length) {
  console.log('\nIMAGE FAILURES:');
  imageFailures.forEach(f => console.log(`  ${f.name} — ${f.url}`));
}
console.log(`\ndistinct slot values (${slots.length}):`);
slots.forEach(s => console.log(`  ${s}  (${merged.filter(t => t.slot === s).length})`));
