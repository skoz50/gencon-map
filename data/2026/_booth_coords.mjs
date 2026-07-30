/**
 * Find normalized pin coordinates for an exhibit-hall booth — SVG backend.
 *
 * Build-time tooling (see CLAUDE.md) — never loaded by the site.
 *
 * WHY THIS EXISTS ALONGSIDE _booth_coords.py
 * ------------------------------------------
 * The Python tool reads `data/2026/source/2026.exhibithallmap.pdf`, which is
 * gitignored — so it only runs on a box that still has the source PDF, and it
 * also needs PyMuPDF. On a fresh clone neither holds, and adding one vendor pin
 * stalls on restoring a 30 MB PDF.
 *
 * `data/2026/floor-plans/icc-exhibit-hall.svg` is committed, was exported from
 * that same PDF, and carries the same `0 0 1170 801` viewBox — so it is the same
 * coordinate space the pins are normalized against. Booth cells survive the
 * export as vector paths, so the geometry the Python tool relies on is all here.
 *
 * The commands, arguments and output format mirror `_booth_coords.py` exactly,
 * so either tool can be used interchangeably. Calibrated against the committed
 * pins: the three the Python tool produced (643, 701, 2401) come back from
 * `snap` here bit-identical, and the hand-picked ones land the same small
 * distance off centre that the Python docstring already records for them
 * (2411 by 0.0036, 2641 by ~0.008). Same cells, same convention.
 *
 * Same dead ends as the Python tool — do not retry them. Booth numbers are
 * vector outlines, not text: the SVG's `data-text` covers only the alphabetical
 * listing, and the digit paths cannot be decoded by shape reliably. The human
 * identifies the booth ("CC does not guess coords"); this automates locating the
 * cell, taking its centre, and rendering the proof.
 *
 * WORKFLOW
 * --------
 *     # 1. Render a region with a normalized-coordinate grid, to find the booth
 *     #    by eye. Args are SVG user units; the whole page is 0 0 1170 801.
 *     node data/2026/_booth_coords.mjs grid 195 140 340 480
 *
 *     # 2. Read the booth's approximate normalized x/y off that grid, then snap
 *     #    to the exact centre of the cell containing it.
 *     node data/2026/_booth_coords.mjs snap 0.2067 0.2890
 *
 *     # 3. Paste into vendor-favorites.json, then prove every pin sits on the
 *     #    booth it claims. This step is not optional — it is the whole check.
 *     node data/2026/_booth_coords.mjs verify
 *
 * Renders land in `test/screenshots/booth-coords/` (gitignored).
 */
import { mkdir, readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

const SVG_PATH = 'data/2026/floor-plans/icc-exhibit-hall.svg';
const FAVORITES = 'data/2026/vendor-favorites.json';
const OUT_DIR = 'test/screenshots/booth-coords';
const PAGE_W = 1170;
const PAGE_H = 801;

// A booth cell is roughly 24pt on its short side; the bounds below keep aisle
// rules and hall-sized outlines from being mistaken for one. Same as the Python.
const MIN_SIDE = 5;
const MAX_SIDE = 200;

const die = (msg) => { console.error(msg); process.exit(1); };

/**
 * Open the SVG at 1:1, so CSS px === SVG user units === PDF points.
 *
 * The SVG is inlined into an HTML shell rather than navigated to directly:
 * Chrome renders a standalone .svg as its own document with no <body>, and
 * inlining is also how `/vendors/` itself consumes this file.
 */
async function openPage() {
  const svg = await readFile(SVG_PATH, 'utf8').catch(() => die(`${SVG_PATH} not found`));
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: PAGE_W, height: PAGE_H });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">` +
    `<style>html,body{margin:0;background:#fff}` +
    `svg{position:absolute;left:0;top:0}</style>` +
    svg.replace(/<svg([^>]*)>/, `<svg$1 width="${PAGE_W}" height="${PAGE_H}">`),
    { waitUntil: 'load' },
  );
  if (!(await page.evaluate(() => !!document.querySelector('svg')))) die('no <svg> root');
  return { browser, page };
}

async function outdir() {
  await mkdir(OUT_DIR, { recursive: true });
  return OUT_DIR;
}

/**
 * Booth-sized outlines as [x0, y0, x1, y1] in user units.
 *
 * Runs in the page because the export nests groups under a y-flip matrix, so a
 * path's own bbox is not in root coordinates. getBoundingClientRect resolves
 * every transform for us, and at 1:1 its numbers are already user units.
 */
const cellsInPage = (minSide, maxSide) => {
  const svg = document.querySelector('svg');
  const root = svg.getBoundingClientRect();
  const out = [];
  for (const p of svg.querySelectorAll('path')) {
    const r = p.getBoundingClientRect();
    if (r.width > minSide && r.width < maxSide &&
        r.height > minSide && r.height < maxSide) {
      out.push([r.left - root.left, r.top - root.top,
                r.right - root.left, r.bottom - root.top]);
    }
  }
  return out;
};

async function cmdGrid(x0, y0, x1, y1, dpi = 300) {
  [x0, y0, x1, y1, dpi] = [x0, y0, x1, y1, dpi].map(Number);
  if ([x0, y0, x1, y1, dpi].some(Number.isNaN)) die('grid needs numeric x0 y0 x1 y1 [dpi]');
  if (x1 <= x0 || y1 <= y0) die('grid region must have x1 > x0 and y1 > y0');

  const { browser, page } = await openPage();
  // Match the Python's 300dpi-of-72pt default so crops are equally legible.
  const scale = Math.min(8, Math.max(1, dpi / 72));
  await page.setViewport({ width: PAGE_W, height: PAGE_H, deviceScaleFactor: scale });

  await page.evaluate((r, w, h) => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.querySelector('svg');
    const g = document.createElementNS(NS, 'g');
    const stepX = w * 0.01;
    const stepY = h * 0.01;
    const line = (x1, y1, x2, y2, major) => {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', x1); l.setAttribute('y1', y1);
      l.setAttribute('x2', x2); l.setAttribute('y2', y2);
      l.setAttribute('stroke', major ? '#f00' : '#0099ff');
      l.setAttribute('stroke-width', major ? 0.7 : 0.25);
      g.appendChild(l);
    };
    const label = (x, y, text) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y);
      t.setAttribute('font-size', 5);
      t.setAttribute('font-family', 'monospace');
      t.setAttribute('fill', '#f00');
      t.textContent = text;
      g.appendChild(t);
    };
    for (let i = Math.floor(r.x0 / stepX); i <= Math.ceil(r.x1 / stepX); i++) {
      line(i * stepX, r.y0, i * stepX, r.y1, i % 5 === 0);
      if (i % 5 === 0) label(i * stepX + 1, r.y0 + 7, (i / 100).toFixed(2));
    }
    for (let j = Math.floor(r.y0 / stepY); j <= Math.ceil(r.y1 / stepY); j++) {
      line(r.x0, j * stepY, r.x1, j * stepY, j % 5 === 0);
      if (j % 5 === 0) label(r.x0 + 1, j * stepY - 1, (j / 100).toFixed(2));
    }
    svg.appendChild(g);
  }, { x0, y0, x1, y1 }, PAGE_W, PAGE_H);

  const path = `${await outdir()}/grid.png`;
  await page.screenshot({
    path,
    clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
  });
  await browser.close();

  console.log(`wrote ${path}`);
  console.log(`  region: svg (${x0},${y0})-(${x1},${y1})`);
  console.log(`  normalized: x ${(x0 / PAGE_W).toFixed(4)}-${(x1 / PAGE_W).toFixed(4)}  ` +
              `y ${(y0 / PAGE_H).toFixed(4)}-${(y1 / PAGE_H).toFixed(4)}`);
  console.log("  read the booth's approximate x/y off the red 0.05 gridlines, " +
              'then run: snap <x> <y>');
}

async function cmdSnap(nx, ny) {
  [nx, ny] = [nx, ny].map(Number);
  if ([nx, ny].some(Number.isNaN)) die('snap needs numeric normalized x y');

  const px = nx * PAGE_W;
  const py = ny * PAGE_H;
  const { browser, page } = await openPage();
  const cells = await page.evaluate(cellsInPage, MIN_SIDE, MAX_SIDE);
  await browser.close();

  const hits = cells.filter(([x0, y0, x1, y1]) =>
    x0 - 1 <= px && px <= x1 + 1 && y0 - 1 <= py && py <= y1 + 1);
  if (!hits.length) die(`no booth cell contains (${nx}, ${ny}) — re-read it off \`grid\`.`);

  hits.sort((a, b) => (a[2] - a[0]) * (a[3] - a[1]) - (b[2] - b[0]) * (b[3] - b[1]));
  const [x0, y0, x1, y1] = hits[0];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  console.log(`cell: (${x0.toFixed(1)},${y0.toFixed(1)})-(${x1.toFixed(1)},${y1.toFixed(1)})  ` +
              `${(x1 - x0).toFixed(1)} x ${(y1 - y0).toFixed(1)} pt`);
  if (hits.length > 1) {
    console.log(`      (${hits.length - 1} larger cell(s) also contain this point; smallest used)`);
  }
  console.log(`  "x": ${(cx / PAGE_W).toFixed(4)}, "y": ${(cy / PAGE_H).toFixed(4)}`);
  console.log('  now add to vendor-favorites.json and run: verify');
}

async function cmdVerify() {
  const vendors = JSON.parse(await readFile(FAVORITES, 'utf8')).vendors;
  const pins = vendors.filter((v) => typeof v.x === 'number' && typeof v.y === 'number');

  const { browser, page } = await openPage();
  await page.setViewport({ width: PAGE_W, height: PAGE_H, deviceScaleFactor: 6 });
  await page.evaluate((pts, w, h) => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.querySelector('svg');
    const g = document.createElementNS(NS, 'g');
    for (const p of pts) {
      for (const [r, fill] of [[7, 'none'], [2, '#f00']]) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', p.x * w);
        c.setAttribute('cy', p.y * h);
        c.setAttribute('r', r);
        c.setAttribute('stroke', '#f00');
        c.setAttribute('stroke-width', 1.4);
        c.setAttribute('fill', fill);
        g.appendChild(c);
      }
    }
    svg.appendChild(g);
  }, pins.map(({ x, y }) => ({ x, y })), PAGE_W, PAGE_H);

  const d = await outdir();
  for (const v of pins) {
    const cx = v.x * PAGE_W;
    const cy = v.y * PAGE_H;
    const path = `${d}/pin-${v.booth}-${v.id}.png`;
    await page.screenshot({
      path,
      clip: {
        x: Math.max(0, cx - 55),
        y: Math.max(0, cy - 40),
        width: Math.min(110, PAGE_W - Math.max(0, cx - 55)),
        height: Math.min(80, PAGE_H - Math.max(0, cy - 40)),
      },
    });
    console.log(`  ${String(v.booth).padStart(5)}  ${v.name}  -> ${path}`);
  }
  await browser.close();

  const skipped = vendors.length - pins.length;
  console.log(`\n${pins.length} pin(s) rendered in ${d}` +
              (skipped ? `; ${skipped} skipped (non-numeric x/y)` : ''));
  console.log('LOOK AT EACH ONE: the dot must sit inside the cell printed with that ' +
              'booth number. Counts and JSON validity cannot catch a right-shaped ' +
              'pin on the wrong booth.');
}

const COMMANDS = { grid: cmdGrid, snap: cmdSnap, verify: cmdVerify };

const [cmd, ...rest] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, cmd ?? '')) {
  die(`usage: node data/2026/_booth_coords.mjs <grid|snap|verify> [args]\n` +
      `  grid   x0 y0 x1 y1 [dpi]   render a region with a normalized grid\n` +
      `  snap   x y                 snap a normalized point to its cell centre\n` +
      `  verify                     draw every favorites pin and crop around it`);
}
await COMMANDS[cmd](...rest);
