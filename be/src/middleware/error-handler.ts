import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() },
    });
    return;
  }

  logger.error({ err, method: req.method, path: req.originalUrl }, 'Unhandled request error');

  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({
    error: {
      code: status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR',
      message: env.NODE_ENV === 'production' && status >= 500
        ? 'Internal server error'
        : (err instanceof Error ? err.message : 'Unexpected error'),
    },
  });
};
