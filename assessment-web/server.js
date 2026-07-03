// Zero-dependency static file server. Deliberately not using a framework or
// `serve`/`http-server` package here — this app's whole point is minimal
// payload (FR-M2-02), so the dev server that hosts it stays equally minimal.
// Any /assess/:token path (matching the spec's link format, US-06) is
// rewritten to index.html so the client-side router can read the token from
// the URL path instead of a query string.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 5174;
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4001';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // This is static HTML/JS with no build step, so there's no way to bake in
  // the API URL at build time the way Vite does for admin-web. Instead the
  // server generates this tiny config script from an env var at request
  // time — index.html loads it before app.js, which reads
  // window.DAPROVA_API_BASE. In dev, API_BASE_URL is unset and this falls
  // back to localhost:4001.
  if (urlPath === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(`window.DAPROVA_API_BASE = ${JSON.stringify(API_BASE_URL)};`);
    return;
  }

  const directPath = path.join(__dirname, urlPath);

  // Serve a real file if one exists at this exact path (e.g. /teachable-stub.html,
  // /style.css, /app.js). Only fall back to the SPA shell (index.html) for
  // paths that don't correspond to an actual file — that's what makes
  // /assess/:token work (the token isn't a file, so it hits the fallback).
  fs.readFile(directPath, (directErr, directData) => {
    if (!directErr) {
      const ext = path.extname(directPath);
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(directData);
      return;
    }
    fs.readFile(path.join(__dirname, 'index.html'), (fallbackErr, fallbackData) => {
      if (fallbackErr) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fallbackData);
    });
  });
});

server.listen(PORT, () => {
  console.log(`[assessment-web] listening on http://localhost:${PORT}`);
});
