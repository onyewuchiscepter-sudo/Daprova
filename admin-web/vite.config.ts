import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Railway (and similar PaaS) inject a dynamic PORT env var and route via a
// generated *.up.railway.app subdomain — `host: true` binds 0.0.0.0 so the
// container's external interface is reachable, and `allowedHosts: true`
// stops Vite's preview server rejecting that unfamiliar Host header. This
// only affects the *served* admin dashboard, not auth — session tokens and
// CORS are still the actual access control.
const port = Number(process.env.PORT) || 5173;

export default defineConfig({
  plugins: [react()],
  server: { port, host: true },
  preview: { port, host: true, allowedHosts: true },
});
