// Static build for Cloudflare Pages (or any static host). server.js generates
// /config.js per request from env vars; a static host can't, so this bakes the
// same file at build time into dist/ alongside the unchanged app files. Set
// API_BASE_URL in the Pages project's build environment — changing it later
// needs a redeploy, not just a restart.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, 'dist');
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4001';

if (process.env.CF_PAGES && !process.env.API_BASE_URL) {
  throw new Error('API_BASE_URL must be set in the Cloudflare Pages build environment.');
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const file of ['index.html', 'app.js', 'style.css', 'teachable-stub.html', 'daprova-mark.svg', '_redirects', '_headers']) {
  fs.copyFileSync(path.join(__dirname, file), path.join(out, file));
}
fs.writeFileSync(path.join(out, 'config.js'), `window.DAPROVA_API_BASE = ${JSON.stringify(API_BASE_URL)};\n`);
console.log(`[assessment-web] built dist/ (API_BASE_URL=${API_BASE_URL})`);
