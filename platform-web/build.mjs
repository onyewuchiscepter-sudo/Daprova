// Static build for Cloudflare Pages (or any static host) — see
// assessment-web/build.mjs. Bakes server.js's per-request /config.js into
// dist/ from the build environment. The emulator host is deliberately left
// out: a hosted build always talks to real Firebase.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, 'dist');

if (process.env.CF_PAGES) {
  for (const name of ['API_BASE_URL', 'ADMIN_WEB_ORIGIN', 'FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID']) {
    if (!process.env[name]) throw new Error(`${name} must be set in the Cloudflare Pages build environment.`);
  }
}

const config = {
  DAPROVA_API_BASE: process.env.API_BASE_URL ?? 'http://localhost:4001',
  DAPROVA_ADMIN_WEB_ORIGIN: process.env.ADMIN_WEB_ORIGIN ?? 'http://localhost:5173',
  DAPROVA_FIREBASE_API_KEY: process.env.FIREBASE_API_KEY ?? '',
  DAPROVA_FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? 'daprova-dev',
  DAPROVA_FIREBASE_AUTH_EMULATOR_HOST: '',
};

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const file of ['index.html', 'app.js', 'style.css', '_headers']) {
  fs.copyFileSync(path.join(__dirname, file), path.join(out, file));
}
fs.writeFileSync(
  path.join(out, 'config.js'),
  Object.entries(config).map(([k, v]) => `window.${k} = ${JSON.stringify(v)};`).join('\n') + '\n',
);
console.log(`[platform-web] built dist/ (API_BASE_URL=${config.DAPROVA_API_BASE})`);
