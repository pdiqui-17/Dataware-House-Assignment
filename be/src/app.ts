import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { healthRouter } from './modules/health/health.routes.js';
import { dbRouter } from './modules/health/health.routes.js';
import { deliveryRouter } from './modules/delivery.routes.js';
import { dssRouter } from './modules/dss.routes.js';
import { metaRouter } from './modules/meta.routes.js';
import { reviewRouter } from './modules/review.routes.js';
import { saleRouter } from './modules/sale.routes.js';
import { sellerRouter } from './modules/seller.routes.js';
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

app.use('/api/v1/sale', saleRouter);
app.use('/api/v1/delivery', deliveryRouter);
app.use('/api/v1/meta', metaRouter);
app.use('/api/v1/reviews', reviewRouter);
app.use('/api/v1/seller', sellerRouter);
app.use('/api/v1/dss', dssRouter);

app.use(notFound);
app.use(errorHandler);
