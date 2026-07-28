// Downloads the IBM Plex woff2 files Daprova's landing page uses and emits a
// local @font-face stylesheet, so the page stops depending on Google's CDN.
// Only latin + latin-ext subsets are kept — the cyrillic/greek/vietnamese
// blocks Google serves are dead weight for this audience.
import { writeFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CSS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500&display=swap';

const OUT_DIR = path.join(import.meta.dirname, '..', 'public', 'fonts');
const KEEP = new Set(['latin', 'latin-ext']);

const SLUG = {
  'IBM Plex Mono': 'plex-mono',
  'IBM Plex Sans': 'plex-sans',
  'IBM Plex Sans Condensed': 'plex-sans-cond',
};

const css = await fetch(CSS_URL, { headers: { 'User-Agent': UA } }).then((r) => r.text());

// Google emits `/* subset */` immediately before each @font-face block.
const blocks = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*{([^}]+)}/g)].map((m) => ({
  subset: m[1],
  body: m[2],
}));

await mkdir(OUT_DIR, { recursive: true });

const faces = [];
let totalBytes = 0;

for (const { subset, body } of blocks) {
  if (!KEEP.has(subset)) continue;
  const family = /font-family:\s*'([^']+)'/.exec(body)[1];
  const weight = /font-weight:\s*(\d+)/.exec(body)[1];
  const url = /url\(([^)]+)\)/.exec(body)[1];
  const unicodeRange = /unicode-range:\s*([^;]+);/.exec(body)[1].trim();

  const file = `${SLUG[family]}-${weight}-${subset}.woff2`;
  const buf = Buffer.from(await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => r.arrayBuffer()));
  await writeFile(path.join(OUT_DIR, file), buf);
  totalBytes += buf.length;

  faces.push(
    `@font-face {\n` +
      `  font-family: '${family}';\n` +
      `  font-style: normal;\n` +
      `  font-weight: ${weight};\n` +
      `  font-display: swap;\n` +
      `  src: url('/fonts/${file}') format('woff2');\n` +
      `  unicode-range: ${unicodeRange};\n` +
      `}`,
  );
  console.log(`  ${file}  ${(buf.length / 1024).toFixed(1)} KB`);
}

const header =
  `/* IBM Plex, self-hosted.\n` +
  `   Generated — do not hand-edit; re-run scripts/fetch-fonts.mjs to refresh.\n` +
  `   Served from our own origin rather than Google's CDN: the landing page's\n` +
  `   audience is largely on African mobile networks, where an extra\n` +
  `   cross-origin round trip before text renders is a real cost. Latin and\n` +
  `   latin-ext subsets only. */\n\n`;

await writeFile(path.join(import.meta.dirname, '..', 'src', 'fonts.css'), header + faces.join('\n\n') + '\n');
console.log(`\n${faces.length} faces, ${(totalBytes / 1024).toFixed(1)} KB total`);
