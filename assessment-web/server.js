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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  const isAssetRequest = /\.(js|css|json|ico)$/.test(urlPath);

  let filePath;
  if (isAssetRequest) {
    filePath = path.join(__dirname, urlPath);
  } else {
    // Anything else (/, /assess/abc123, /assess/abc123/) serves the SPA shell.
    filePath = path.join(__dirname, 'index.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`[assessment-web] listening on http://localhost:${PORT}`);
});
