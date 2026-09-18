import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Railway (and similar PaaS) inject a dynamic PORT env var and route via a
// generated *.up.railway.app subdomain — `host: true` binds 0.0.0.0 so the
// container's external interface is reachable, and `allowedHosts: true`
// stops Vite's preview server rejecting that unfamiliar Host header. This
// only affects the *served* admin dashboard, not auth — session tokens and
// CORS are still the actual access control.
const port = Number(process.env.PORT) || 5173;

// On a Cloudflare Pages build, a missing var would otherwise ship a bundle
// that silently calls localhost:4001 and the Firebase emulator.
if (process.env.CF_PAGES) {
  for (const name of ['VITE_API_BASE', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_ASSESSMENT_WEB_ORIGIN']) {
    if (!process.env[name]) throw new Error(`${name} must be set in the Cloudflare Pages build environment.`);
  }
}

export default defineConfig({
  plugins: [react()],
  server: { port, host: true },
  preview: { port, host: true, allowedHosts: true },
});
