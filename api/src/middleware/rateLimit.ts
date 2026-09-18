import type { Request, RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { IS_WORKERS } from '../lib/runtime.js';

// The default MemoryStore starts a cleanup setInterval as soon as the limiter
// is created, which Cloudflare Workers forbids at module load ("Disallowed
// operation called within global scope") — so build each limiter on its
// first request instead. On Workers the counts are per isolate, so limits
// are approximate there rather than global.
function lazyLimiter(options: Partial<Options>): RequestHandler {
  let limiter: RequestHandler | undefined;
  return (req, res, next) => (limiter ??= rateLimit(options))(req, res, next);
}

// On Workers, Cloudflare's edge sets CF-Connecting-IP to the real client and
// req.ip carries nothing useful; elsewhere req.ip honours 'trust proxy'.
function clientIp(req: Request): string {
  return (IS_WORKERS ? req.get('cf-connecting-ip') : undefined) ?? req.ip ?? 'unknown';
}

// FR/B5.3: 100 req/min per IP on public assessment endpoints.
export const publicLimiter = lazyLimiter({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  validate: { ip: !IS_WORKERS, creationStack: false },
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});

// B5.3: 500 req/min per org on admin endpoints. Keyed by org_id from the
// verified session (falls back to IP if unauthenticated, e.g. failed auth attempts).
export const adminLimiter = lazyLimiter({
  windowMs: 60_000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.org_id ?? clientIp(req),
  validate: { ip: !IS_WORKERS, creationStack: false },
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});
