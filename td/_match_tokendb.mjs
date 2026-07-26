#!/usr/bin/env node
/**
 * _match_tokendb.mjs — match data/2026/td-tokens.json against td/tokendb-catalog.json.
 *
 * Deliberately conservative: this script never picks a winner among plausible
 * candidates. Anything short of a confident single hit lands in `ambiguous`
 * (2+ candidates) or `unmatched` (with nearest misses attached) for human review.
 *
 *   node td/_match_tokendb.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OURS_FILE = path.join(HERE, '..', 'data', '2026', 'td-tokens.json');
const CATALOG_FILE = path.join(HERE, 'tokendb-catalog.json');
const OVERRIDES_FILE = path.join(HERE, 'match-overrides.json');
const OUT_FILE = path.join(HERE, 'match-report.json');

// Fuzzy thresholds. Tuned to prefer "flag it" over "guess it".
const FUZZY_CONFIDENT = 0.90;   // lone candidate at/above this -> medium-confidence match
const FUZZY_PLAUSIBLE = 0.75;   // at/above this -> worth showing a human
const FUZZY_NEAR_MISS = 0.55;   // shown as context on unmatched entries

/** Category prefixes our Obsidian note uses that tokendb may not carry in the name. */
const PREFIX_RE = /^(scroll|potion|ioun stone|figurine of power|wand|oil|dust|rune|charm)\s*[:–—-]\s*/i;
const PLUS_RE = /^\+\d+\s+/;

function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[–—−]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Name with the "+N " enhancement prefix and any category prefix removed. */
function baseName(s) {
  let out = String(s).replace(PLUS_RE, '');
  out = out.replace(PREFIX_RE, '');
  return out;
}

function kebab(s) {
  return norm(s).replace(/\s+/g, '-');
}

/** Sørensen–Dice over character bigrams — good at catching typos and word swaps. */
function bigrams(s) {
  const t = s.replace(/\s+/g, ' ');
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

function dice(a, b) {
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, sizeA = 0, sizeB = 0;
  for (const n of A.values()) sizeA += n;
  for (const [g, n] of B) {
    sizeB += n;
    if (A.has(g)) inter += Math.min(n, A.get(g));
  }
  return sizeA + sizeB === 0 ? 0 : (2 * inter) / (sizeA + sizeB);
}

const brief = c => ({
  tokendb_slug: c.slug,
  tokendb_name: c.name,
  url: c.url,
  slot: c.slot,
  rarity: c.rarity,
  years: c.years,
});

// ---- load -------------------------------------------------------------------

const ours = JSON.parse(await readFile(OURS_FILE, 'utf8')).tokens;
const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
const entries = catalog.tokens;

// Index the catalog by both its full normalized name and its prefix/plus-stripped form.
const byExact = new Map();
const byBase = new Map();
for (const e of entries) {
  const ex = norm(e.name);
  const ba = norm(baseName(e.name));
  if (!byExact.has(ex)) byExact.set(ex, []);
  byExact.get(ex).push(e);
  if (ba !== ex) {
    if (!byBase.has(ba)) byBase.set(ba, []);
    byBase.get(ba).push(e);
  }
}

const bySlugIndex = new Map(entries.map(e => [e.slug, e]));

// Human-confirmed decisions win over anything the matcher would infer.
let overrides = new Map();
try {
  const raw = JSON.parse(await readFile(OVERRIDES_FILE, 'utf8'));
  overrides = new Map((raw.overrides || []).map(o => [o.our_name, o]));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

// Precompute normalized catalog names once — the fuzzy pass is 142 x ~3800.
const normedCatalog = entries.map(e => ({ e, n: norm(e.name), b: norm(baseName(e.name)) }));

// ---- match ------------------------------------------------------------------

const matched = [], unmatched = [], ambiguous = [];
const usedIds = new Set();

for (const t of ours) {
  let ourId = kebab(t.name);
  if (usedIds.has(ourId)) {
    let i = 2;
    while (usedIds.has(`${ourId}-${i}`)) i++;
    ourId = `${ourId}-${i}`;
  }
  usedIds.add(ourId);

  const ourExact = norm(t.name);
  const ourBase = norm(baseName(t.name));
  const stripsPlus = PLUS_RE.test(t.name);

  const record = { our_id: ourId, our_name: t.name, our_category: t.category };

  // Tier 0 — a reviewed override. Fail loudly on a bad slug rather than
  // silently falling through to a guess.
  if (overrides.has(t.name)) {
    const o = overrides.get(t.name);
    const e = bySlugIndex.get(o.tokendb_slug);
    if (!e) throw new Error(`override for "${t.name}" points at unknown slug "${o.tokendb_slug}"`);
    matched.push({ ...record, tokendb_slug: e.slug, tokendb_name: e.name, url: e.url, confidence: 'confirmed', rule: `human-confirmed override: ${o.note}` });
    continue;
  }

  // Tier A — normalized names are identical.
  const tierA = byExact.get(ourExact) || [];
  if (tierA.length === 1) {
    matched.push({ ...record, tokendb_slug: tierA[0].slug, tokendb_name: tierA[0].name, url: tierA[0].url, confidence: 'exact', rule: 'normalized name identical' });
    continue;
  }
  if (tierA.length > 1) {
    ambiguous.push({ ...record, reason: `${tierA.length} catalog entries share this exact normalized name`, candidates: tierA.map(brief) });
    continue;
  }

  // Tier B — identical once the "+N" / category prefix is stripped on either side.
  const tierB = new Map();
  for (const e of [...(byExact.get(ourBase) || []), ...(byBase.get(ourExact) || []), ...(byBase.get(ourBase) || [])]) {
    tierB.set(e.slug, e);
  }
  const tierBList = [...tierB.values()];
  if (tierBList.length === 1) {
    const e = tierBList[0];
    // "+1 Large Throwing Axe" vs "Large Throwing Axe" are genuinely different
    // tokens, so a plus-stripped hit is only trustworthy when the enhancement
    // level actually agrees on both sides.
    const plusAgrees = stripsPlus === PLUS_RE.test(e.name);
    if (plusAgrees) {
      matched.push({ ...record, tokendb_slug: e.slug, tokendb_name: e.name, url: e.url, confidence: 'high', rule: 'match after category-prefix normalization' });
    } else {
      ambiguous.push({ ...record, reason: 'only candidate differs in "+N" enhancement level — could be the base or the upgraded token', candidates: [brief(e)] });
    }
    continue;
  }
  if (tierBList.length > 1) {
    ambiguous.push({ ...record, reason: `${tierBList.length} candidates after prefix normalization`, candidates: tierBList.map(brief) });
    continue;
  }

  // Tier C — fuzzy.
  const scored = normedCatalog
    .map(({ e, n, b }) => ({ e, score: Math.max(dice(ourExact, n), dice(ourBase, b)) }))
    .filter(s => s.score >= FUZZY_NEAR_MISS)
    .sort((a, b) => b.score - a.score);

  const plausible = scored.filter(s => s.score >= FUZZY_PLAUSIBLE);

  if (plausible.length === 1 && plausible[0].score >= FUZZY_CONFIDENT) {
    const e = plausible[0].e;
    matched.push({ ...record, tokendb_slug: e.slug, tokendb_name: e.name, url: e.url, confidence: 'medium', rule: `sole fuzzy candidate, dice ${plausible[0].score.toFixed(3)}` });
    continue;
  }
  if (plausible.length >= 2) {
    ambiguous.push({
      ...record,
      reason: `${plausible.length} fuzzy candidates above ${FUZZY_PLAUSIBLE}`,
      candidates: plausible.slice(0, 8).map(s => ({ ...brief(s.e), score: Number(s.score.toFixed(3)) })),
    });
    continue;
  }
  if (plausible.length === 1) {
    ambiguous.push({
      ...record,
      reason: `single fuzzy candidate below the ${FUZZY_CONFIDENT} confidence bar — needs a human call`,
      candidates: plausible.map(s => ({ ...brief(s.e), score: Number(s.score.toFixed(3)) })),
    });
    continue;
  }

  unmatched.push({
    ...record,
    reason: 'no candidate above the plausibility bar',
    nearest: scored.slice(0, 5).map(s => ({ ...brief(s.e), score: Number(s.score.toFixed(3)) })),
  });
}

await writeFile(OUT_FILE, JSON.stringify({
  generatedAt: new Date().toISOString(),
  ourTokenCount: ours.length,
  catalogTokenCount: entries.length,
  catalogScrapedAt: catalog.scrapedAt,
  thresholds: { FUZZY_CONFIDENT, FUZZY_PLAUSIBLE, FUZZY_NEAR_MISS },
  counts: { matched: matched.length, unmatched: unmatched.length, ambiguous: ambiguous.length },
  matched, unmatched, ambiguous,
}, null, 2) + '\n', 'utf8');

const byConf = matched.reduce((acc, m) => (acc[m.confidence] = (acc[m.confidence] || 0) + 1, acc), {});
console.log(`${matched.length} matched / ${unmatched.length} unmatched / ${ambiguous.length} ambiguous  (of ${ours.length} ours vs ${entries.length} catalog)`);
console.log(`  matched by confidence: ${Object.entries(byConf).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
