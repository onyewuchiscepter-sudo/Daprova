import type { NextFunction, Request, Response } from 'express';
import { verifySessionToken } from '../lib/sessionTokens.js';
import { unauthorized } from '../lib/errors.js';
import type { SessionClaims } from '@daprova/shared';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: SessionClaims;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized('Missing bearer token'));

  try {
    req.auth = verifySessionToken(header.slice('Bearer '.length));
    next();
  } catch {
    next(unauthorized('Invalid or expired session token'));
  }
}
