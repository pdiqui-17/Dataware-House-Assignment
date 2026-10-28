import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { healthRouter } from './modules/health/health.routes.js';
import { dbRouter } from './modules/health/health.routes.js';
export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()) }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

app.get('/', (_req, res) => {
  res.json({ data: { name: 'Express TypeScript API', version: '1.0.0' } });
});

app.use('/api/v1/health', healthRouter);

app.use('/api/v1/db-health', dbRouter);

app.use(notFound);
app.use(errorHandler);
