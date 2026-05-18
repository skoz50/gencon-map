#!/usr/bin/env node
// test/serve.mjs — minimal static file server for local GenCon Map testing.
//
// Serves the repo root so index.html, data/ and js/ all resolve naturally
// (the JSON fetches and the ES-module import need a real http origin —
// file:// will not do). No dependencies — Node's built-in http + fs only.
//
//   node test/serve.mjs            # serve repo root on :8080
//   node test/serve.mjs 9090       # serve repo root on :9090
//
// Also exports startServer({ port, root, logPath }) so test/viewport.mjs
// can spin the server up itself with --serve.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// `.js` / `.mjs` MUST be a JavaScript MIME or the browser refuses to load
// js/time.js as an ES module.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

export async function startServer({ port = 8080, root = REPO_ROOT, logPath = null } = {}) {
  const logStream = logPath ? fs.createWriteStream(logPath, { flags: 'a' }) : null;
  const log = line => {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    console.error(stamped);
    if (logStream) logStream.write(stamped + '\n');
  };

  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = path.normalize(path.join(root, rel));
      // Path-traversal guard: the resolved file must stay inside root.
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        res.writeHead(403); res.end('Forbidden'); log(`403 ${urlPath}`); return;
      }
      let stat;
      try { stat = await fsp.stat(filePath); }
      catch { res.writeHead(404); res.end('Not found'); log(`404 ${urlPath}`); return; }
      const target = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
      const body = await fsp.readFile(target);
      const mime = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': body.length });
      res.end(body);
      log(`200 ${urlPath} (${body.length}b)`);
    } catch (err) {
      res.writeHead(500); res.end('Server error');
      log(`500 ${req.url} ${err.message}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  log(`serving ${root} on http://localhost:${port}`);

  return {
    server,
    close: () => new Promise(resolve => {
      server.close(() => { if (logStream) logStream.end(); resolve(); });
    })
  };
}

// Run directly: `node test/serve.mjs [port]` — graceful SIGINT shutdown.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]) || 8080;
  const handle = await startServer({ port });
  const shutdown = () => {
    console.error('\n[serve] shutting down');
    handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
