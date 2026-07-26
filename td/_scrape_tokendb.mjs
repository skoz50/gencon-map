#!/usr/bin/env node
/**
 * _scrape_tokendb.mjs — build a local catalog of tokendb.com token pages.
 *
 * Read-only research spike. tokendb.com/robots.txt (checked 2026-07-25) allows
 * everything except /wp-admin/, and publishes a sitemap index we enumerate from.
 * There is no REST route for the `tokens` post type (wp/v2/tokens -> 404), so
 * detail pages are fetched as HTML, one at a time, ~1 req/sec.
 *
 * Every fetched page is cached under td/_tokendb_cache/<slug>.html, so re-runs
 * parse from disk and never re-hit their server. Delete a cache file to refetch it.
 *
 *   node td/_scrape_tokendb.mjs            # full run (resumes from cache)
 *   node td/_scrape_tokendb.mjs --limit 25 # smoke test
 *   node td/_scrape_tokendb.mjs --parse-only
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, '_tokendb_cache');
const OUT_FILE = path.join(HERE, 'tokendb-catalog.json');

const ORIGIN = 'https://tokendb.com';
const SITEMAP_INDEX = `${ORIGIN}/wp-sitemap.xml`;
const UA = 'gencon-map-token-catalog/0.1 (personal, non-commercial research script; +https://github.com/skoz50/gencon-map; contact skoz@skoz.org)';
const DELAY_MS = 1000;          // ~1 req/sec, single-threaded
const MAX_RETRIES = 3;

const args = process.argv.slice(2);
const LIMIT = numFlag('--limit', Infinity);
const PARSE_ONLY = args.includes('--parse-only');

function numFlag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1 || !args[i + 1]) return fallback;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- fetching ---------------------------------------------------------------

/** A 404 body is only worth keeping if it actually carries the content we came for. */
function looksLikeContent(text) {
  return /<loc>/.test(text) || /class="[^"]*dir-title/.test(text);
}

/** Fetch with retry + backoff. Returns text, or null after MAX_RETRIES. */
async function fetchText(url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xml' } });
      // tokendb serves wp-sitemap-posts-tokens-2.xml with a 404 status but a
      // complete, valid body (1807 URLs). Don't throw away a good payload over
      // the status line — but don't cache a genuine error page either.
      if (res.status === 404) {
        const text = await res.text();
        return looksLikeContent(text) ? text : null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`  ! give up on ${url}: ${err.message}`);
        return null;
      }
      const backoff = DELAY_MS * 2 ** attempt;
      console.error(`  ~ retry ${attempt}/${MAX_RETRIES - 1} for ${url} (${err.message}), waiting ${backoff}ms`);
      await sleep(backoff);
    }
  }
  return null;
}

/** Cached fetch. Only sleeps when it actually hit the network. */
async function cachedFetch(url, cacheFile) {
  if (existsSync(cacheFile)) return { html: await readFile(cacheFile, 'utf8'), hitNetwork: false };
  const html = await fetchText(url);
  await sleep(DELAY_MS);
  if (html === null) return { html: null, hitNetwork: true };
  await writeFile(cacheFile, html, 'utf8');
  return { html, hitNetwork: true };
}

// ---- sitemap enumeration ----------------------------------------------------

async function collectTokenUrls() {
  const indexXml = (await cachedFetch(SITEMAP_INDEX, path.join(CACHE_DIR, '_sitemap-index.xml'))).html;
  if (!indexXml) throw new Error('could not read sitemap index');

  const sitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(m => m[1])
    .filter(u => /wp-sitemap-posts-tokens-\d+\.xml$/.test(u));
  console.log(`sitemap index: ${sitemaps.length} token sitemap(s)`);

  const urls = [];
  for (const sm of sitemaps) {
    const file = path.join(CACHE_DIR, '_' + path.basename(sm));
    const xml = (await cachedFetch(sm, file)).html;
    if (!xml) continue;
    const found = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map(m => m[1])
      .filter(u => u.includes('/token/'));
    console.log(`  ${path.basename(sm)}: ${found.length} token URLs`);
    urls.push(...found);
  }
  return [...new Set(urls)];
}

// ---- parsing ----------------------------------------------------------------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  '#039': "'", '#8217': '’', '#8216': '‘', '#8220': '“',
  '#8221': '”', '#8211': '–', '#8212': '—', '#215': '×',
  '#8230': '…', hellip: '…', middot: '·', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent in ENTITIES) return ENTITIES[ent];
    if (ent.startsWith('#x') || ent.startsWith('#X')) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith('#')) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return m;
  });
}

function textOf(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token pages are consistent WordPress markup:
 *   <h1 class="dir-title ...">Name</h1>
 *   <div class="dir-tax">Label: <a rel="tag">Value</a>, <a rel="tag">Value</a></div>
 *   <div class="token-text"><h4>Text On Token</h4><p>...</p></div>
 * so regex extraction is stable enough for a research spike (no DOM dep).
 */
function parseTokenPage(html, url, slug) {
  const article = (html.match(/<article[^>]*class="[^"]*\btokens\b[^"]*"[\s\S]*?<\/article>/i) || [html])[0];

  const nameM = article.match(/<h1[^>]*class="[^"]*dir-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  const name = nameM ? textOf(nameM[1]) : null;

  const imgM = article.match(/<div[^>]*class="[^"]*dir-logo-single[^"]*"[\s\S]*?<img[^>]*\ssrc="([^"]+)"/i)
            || article.match(/<img[^>]*class="[^"]*wp-post-image[^"]*"[^>]*\ssrc="([^"]+)"/i);
  const image = imgM ? decodeEntities(imgM[1]) : null;

  // Taxonomy rows: keep every label the page carries, surface the ones we asked for.
  const taxonomies = {};
  for (const m of article.matchAll(/<div[^>]*class="[^"]*dir-tax[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const row = m[1];
    const label = textOf(row.replace(/<a[\s\S]*$/i, '')).replace(/[:*\s]+$/, '').trim();
    const values = [...row.matchAll(/<a[^>]*rel="tag"[^>]*>([\s\S]*?)<\/a>/gi)].map(a => textOf(a[1]));
    if (label) taxonomies[label] = values;
  }

  // "Text On Token" — the literal rules text printed on the physical token.
  const ttM = article.match(/<div[^>]*class="[^"]*token-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const textOnToken = ttM ? textOf(ttM[1].replace(/<h4[\s\S]*?<\/h4>/i, '')) : null;

  // Flavor / description: the <p> blocks in the details column before token-text.
  const deetsM = article.match(/<div[^>]*class="[^"]*dir-deets-single[^"]*"[^>]*>([\s\S]*)$/i);
  let flavor = null;
  if (deetsM) {
    const head = deetsM[1].split(/<div[^>]*class="[^"]*(?:token-text|dir-tax)[^"]*"/i)[0];
    const paras = [...head.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(p => textOf(p[1])).filter(Boolean);
    flavor = paras.length ? paras.join('\n\n') : null;
  }

  const years = (taxonomies['Year'] || []).map(y => (/^\d{4}$/.test(y) ? Number(y) : y));

  return {
    slug,
    url,
    name,
    image,
    usableBy: taxonomies['Usable By'] || [],
    slot: (taxonomies['Slot'] || [])[0] ?? null,
    rarity: (taxonomies['Rarity'] || [])[0] ?? null,
    years,
    source: taxonomies['Source'] || [],
    classification: taxonomies['Classification'] || [],
    flavor,
    textOnToken,
    taxonomies,
  };
}

// ---- main -------------------------------------------------------------------

async function cacheBytes() {
  let total = 0, files = 0;
  for (const f of await readdir(CACHE_DIR)) {
    total += (await stat(path.join(CACHE_DIR, f))).size;
    files++;
  }
  return { total, files };
}

const started = Date.now();
await mkdir(CACHE_DIR, { recursive: true });
// Keep the raw HTML cache out of git — it is a scratch artifact, not source.
await writeFile(path.join(CACHE_DIR, '.gitignore'), '*\n', 'utf8');

const allUrls = await collectTokenUrls();
const urls = allUrls.slice(0, LIMIT);
console.log(`${allUrls.length} token URLs total; processing ${urls.length}`);

const tokens = [];
const failures = [];
let fetched = 0, fromCache = 0;

for (let i = 0; i < urls.length; i++) {
  const url = urls[i];
  const slug = url.replace(/\/+$/, '').split('/').pop();
  const cacheFile = path.join(CACHE_DIR, `${slug}.html`);

  let html;
  if (PARSE_ONLY) {
    if (!existsSync(cacheFile)) continue;
    html = await readFile(cacheFile, 'utf8');
    fromCache++;
  } else {
    const r = await cachedFetch(url, cacheFile);
    html = r.html;
    if (r.hitNetwork) fetched++; else fromCache++;
  }

  if (!html) { failures.push(url); continue; }

  const parsed = parseTokenPage(html, url, slug);
  if (!parsed.name) { failures.push(`${url} (no name parsed)`); continue; }
  tokens.push(parsed);

  if ((i + 1) % 100 === 0 || i + 1 === urls.length) {
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`  [${i + 1}/${urls.length}] parsed=${tokens.length} fetched=${fetched} cached=${fromCache} failed=${failures.length} ${mins}m`);
  }
}

const { total, files } = await cacheBytes();
const elapsedSec = Math.round((Date.now() - started) / 1000);

await writeFile(OUT_FILE, JSON.stringify({
  source: 'https://tokendb.com (scraped from wp-sitemap token post type)',
  scrapedAt: new Date().toISOString(),
  urlsInSitemap: allUrls.length,
  tokenCount: tokens.length,
  failures,
  elapsedSeconds: elapsedSec,
  cacheFiles: files,
  cacheBytes: total,
  tokens,
}, null, 2) + '\n', 'utf8');

console.log(`\nwrote ${path.relative(process.cwd(), OUT_FILE)} — ${tokens.length} tokens, ${failures.length} failures`);
console.log(`cache: ${files} files, ${(total / 1024 / 1024).toFixed(1)} MiB`);
console.log(`network fetches: ${fetched}, cache hits: ${fromCache}, elapsed: ${Math.floor(elapsedSec / 60)}m${elapsedSec % 60}s`);
