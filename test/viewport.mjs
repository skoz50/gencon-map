#!/usr/bin/env node
// test/viewport.mjs — headless-Chrome viewport harness for GenCon Map.
//
// Drives Puppeteer against a running site at a TRUE device viewport (via
// page.setViewport, which wraps CDP Emulation.setDeviceMetricsOverride — not
// Chrome's --window-size, which silently floors the layout viewport at
// 500px and produces false text-clipping at narrow widths). Optionally
// forces a time zone, captures a screenshot, and/or runs a JS expression in
// page context. Per-run artifacts are keyed by a timestamp runId.
//
//   node test/viewport.mjs --width 375 --url http://localhost:8080 \
//        --check .test-panel --hidden --label baseline
//   node test/viewport.mjs --width 1280 --url http://localhost:8080 \
//        --tz America/Los_Angeles --label tz-drift
//   node test/viewport.mjs --width 1280 --serve --eval "document.title"
//
// Diagnostics go to STDERR; only an --eval result goes to STDOUT, so it can
// be redirected to a file cleanly. Exits non-zero on any assertion failure.
//
// Artifacts:
//   test/.tmp/<runId>/profile/   throwaway Chrome user-data-dir (removed on exit)
//   test/.tmp/<runId>/chrome.log Chrome stdio
//   test/.tmp/<runId>/http.log   bundled server log (only with --serve)
//   test/screenshots/<runId>/<width>-<label>.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    width: 1280, height: 900, dpr: 1, url: null, tz: null,
    check: 'body', hidden: false, label: null, eval: null, serve: false, port: 8080
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--width':  args.width  = Number(argv[++i]); break;
      case '--height': args.height = Number(argv[++i]); break;
      case '--dpr':    args.dpr    = Number(argv[++i]); break;
      case '--url':    args.url    = argv[++i]; break;
      case '--tz':     args.tz     = argv[++i]; break;
      case '--check':  args.check  = argv[++i]; break;
      case '--hidden': args.hidden = true; break;
      case '--label':  args.label  = argv[++i]; break;
      case '--eval':   args.eval   = argv[++i]; break;
      case '--serve':  args.serve  = true; break;
      case '--port':   args.port   = Number(argv[++i]); break;
      default:
        console.error(`viewport.mjs: unknown arg "${a}"`);
        process.exit(2);
    }
  }
  return args;
}

function makeRunId() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
         `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Load Puppeteer lazily so a missing dependency fails with a clear message
// instead of an opaque import error. Deliberately never auto-installs — a
// surprise ~150MB Chromium download is user-hostile (see test/README.md).
async function loadPuppeteer() {
  try {
    return (await import('puppeteer')).default;
  } catch {
    console.error('viewport.mjs needs Puppeteer, which is not installed.');
    console.error('Install it once:  npm install --save-dev puppeteer');
    process.exit(1);
  }
}

const args = parseArgs(process.argv.slice(2));
const puppeteer = await loadPuppeteer();

const runId = makeRunId();
const tmpDir = path.join(REPO_ROOT, 'test', '.tmp', runId);
const profileDir = path.join(tmpDir, 'profile');
const chromeLog = path.join(tmpDir, 'chrome.log');
fs.mkdirSync(profileDir, { recursive: true });

let server = null;
let browser = null;
let failed = false;

try {
  let url = args.url;
  if (args.serve) {
    const { startServer } = await import('./serve.mjs');
    server = await startServer({
      port: args.port, root: REPO_ROOT, logPath: path.join(tmpDir, 'http.log')
    });
    url = url || `http://localhost:${args.port}`;
  }
  if (!url) {
    console.error('viewport.mjs: need --url (or --serve). Nothing to load.');
    process.exit(2);
  }

  browser = await puppeteer.launch({
    headless: true,
    userDataDir: profileDir,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu']
  });
  // Best-effort capture of Chrome's stdio for post-mortem inspection.
  const logStream = fs.createWriteStream(chromeLog);
  logStream.write(`[viewport] runId=${runId}\n`);
  browser.process()?.stderr?.pipe(logStream);
  browser.process()?.stdout?.pipe(logStream);

  const page = await browser.newPage();
  // page.setViewport -> CDP Emulation.setDeviceMetricsOverride: a true
  // device viewport, immune to the Chrome --window-size 500px layout floor.
  await page.setViewport({
    width: args.width, height: args.height, deviceScaleFactor: args.dpr
  });
  // page.emulateTimezone -> CDP Emulation.setTimezoneOverride.
  if (args.tz) await page.emulateTimezone(args.tz);

  console.error(`[viewport] ${args.width}x${args.height} dpr=${args.dpr}` +
    (args.tz ? ` tz=${args.tz}` : '') + ` -> ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector(args.check, { timeout: 10000 });

  // Visibility check — getBoundingClientRect rather than offsetParent, which
  // is null for position:fixed elements (the 🧪 panel) even when visible.
  const visible = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }, args.check);

  if (args.hidden && visible) {
    console.error(`[FAIL] expected '${args.check}' hidden, but it is visible`);
    failed = true;
  } else if (!args.hidden && !visible) {
    console.error(`[FAIL] expected '${args.check}' visible, but it is hidden/absent`);
    failed = true;
  } else {
    console.error(`[ok] '${args.check}' is ${args.hidden ? 'hidden' : 'visible'}`);
  }

  if (args.label) {
    const shotDir = path.join(REPO_ROOT, 'test', 'screenshots', runId);
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = path.join(shotDir, `${args.width}-${args.label}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.error(`[viewport] screenshot -> ${path.relative(REPO_ROOT, shot)}`);
  }

  if (args.eval) {
    const result = await page.evaluate(args.eval);
    // String results print raw (handy for HTML capture); everything else
    // pretty-prints as JSON.
    process.stdout.write(
      typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    );
    process.stdout.write('\n');
  }
} catch (err) {
  console.error('[viewport] ERROR', (err && err.stack) || err);
  failed = true;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await server.close().catch(() => {});
  // Tear down the throwaway profile; keep logs + screenshots for inspection.
  fs.rmSync(profileDir, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
