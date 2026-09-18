// True inside Cloudflare Workers (worker.ts), false on Node (index.ts).
export const IS_WORKERS = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === 'Cloudflare-Workers';
