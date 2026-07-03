import type { NextFunction, Request, Response } from 'express';

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message = 'Resource not found', details?: unknown) {
  return new AppError(404, 'NOT_FOUND', message, details);
}
export function unauthorized(message = 'Unauthorized', details?: unknown) {
  return new AppError(401, 'UNAUTHORIZED', message, details);
}
export function forbidden(message = 'Forbidden', details?: unknown) {
  return new AppError(403, 'FORBIDDEN', message, details);
}
export function badRequest(message = 'Bad request', details?: unknown) {
  return new AppError(400, 'BAD_REQUEST', message, details);
}
export function conflict(message = 'Conflict', details?: unknown) {
  return new AppError(409, 'CONFLICT', message, details);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  console.error('[unhandled]', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
