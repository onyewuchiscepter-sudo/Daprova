import rateLimit from 'express-rate-limit';

// FR/B5.3: 100 req/min per IP on public assessment endpoints.
export const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});

// B5.3: 500 req/min per org on admin endpoints. Keyed by org_id from the
// verified session (falls back to IP if unauthenticated, e.g. failed auth attempts).
export const adminLimiter = rateLimit({
  windowMs: 60_000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.org_id ?? req.ip ?? 'unknown',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
});
