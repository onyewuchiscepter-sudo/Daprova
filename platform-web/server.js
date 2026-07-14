// Zero-dependency static file server, matching assessment-web's pattern —
// this internal tool has no build step and no framework, deliberately kept
// as a separate small surface from the customer-facing admin-web bundle
// (docs/org-onboarding-spec.md §7.5), so the platform secret/role gate
// never ships inside code a customer's browser ever loads.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 5175;
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4001';
const ADMIN_WEB_ORIGIN = process.env.ADMIN_WEB_ORIGIN ?? 'http://localhost:5173';
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY ?? '';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'daprova-dev';
const FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(
      `window.DAPROVA_API_BASE = ${JSON.stringify(API_BASE_URL)};` +
        `window.DAPROVA_ADMIN_WEB_ORIGIN = ${JSON.stringify(ADMIN_WEB_ORIGIN)};` +
        `window.DAPROVA_FIREBASE_API_KEY = ${JSON.stringify(FIREBASE_API_KEY)};` +
        `window.DAPROVA_FIREBASE_PROJECT_ID = ${JSON.stringify(FIREBASE_PROJECT_ID)};` +
        `window.DAPROVA_FIREBASE_AUTH_EMULATOR_HOST = ${JSON.stringify(FIREBASE_AUTH_EMULATOR_HOST)};`,
    );
    return;
  }

  const directPath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  fs.readFile(directPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(directPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[platform-web] listening on http://localhost:${PORT}`);
});
