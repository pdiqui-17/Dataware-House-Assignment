import type { RequestHandler } from 'express';

import { delivery } from '../cube/delivery.js';
import {
  deliveryAnalysisService,
  deliveryDistributionService,
} from '../service/delivery.service.js';
import type { AnalysisDimension, AnalysisParams } from '../types/delivery.js';

type DeliveryQuery = {
  dim?: string;
  depth?: string;
  from?: string;
  to?: string;
  year?: string;
  quarter?: string;
  month?: string;
  state?: string;
  city?: string;
};

class DeliveryQueryError extends Error {}

const parseDeliveryParams = (query: DeliveryQuery): AnalysisParams => {
  const dim = queryString(query.dim) ?? 'time';
  if (!isDeliveryDimension(dim)) {
    throw new DeliveryQueryError(`dim phải thuộc: ${Object.keys(delivery.hierarchies).join(', ')}`);
  }

  const hierarchy = delivery.hierarchies[dim];
  const depth = integerQuery(queryString(query.depth), 'depth') ?? hierarchy.length;
  if (depth < 1 || depth > hierarchy.length) {
    throw new DeliveryQueryError(`depth phải từ 1 đến ${hierarchy.length}`);
  }

  const from = queryString(query.from);
  const to = queryString(query.to);
  const isDate = (value: string | undefined): boolean =>
    value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!isDate(from) || !isDate(to)) {
    throw new DeliveryQueryError('from/to phải có dạng YYYY-MM-DD');
  }

  const year = integerQuery(queryString(query.year), 'year');
  const quarter = integerQuery(queryString(query.quarter), 'quarter');
  const month = integerQuery(queryString(query.month), 'month');
  if (quarter !== undefined && (quarter < 1 || quarter > 4)) {
    throw new DeliveryQueryError('quarter phải từ 1 đến 4');
  }
  if (month !== undefined && (month < 1 || month > 12)) {
    throw new DeliveryQueryError('month phải từ 1 đến 12');
  }

  return {
    dim,
    depth,
    from,
    to,
    year,
    quarter,
    month,
    state: queryString(query.state),
    city: queryString(query.city),
  };
};

const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const isDeliveryDimension = (value: string): value is AnalysisDimension =>
  Object.hasOwn(delivery.hierarchies, value);

const integerQuery = (value: string | undefined, name: string): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new DeliveryQueryError(`${name} phải là số nguyên`);
  return parsed;
};

export const deliveryAnalysisController: RequestHandler<
  Record<string, never>,
  unknown,
  unknown,
  DeliveryQuery
> = async (req, res, next) => {
  try {
    const params = parseDeliveryParams(req.query);
    res.json(await deliveryAnalysisService(params));
  } catch (error) {
    if (error instanceof DeliveryQueryError) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
};

export const deliveryDistributionController: RequestHandler<
  Record<string, never>,
  unknown,
  unknown,
  DeliveryQuery
> = async (req, res, next) => {
  try {
    res.json(await deliveryDistributionService(parseDeliveryParams(req.query)));
  } catch (error) {
    if (error instanceof DeliveryQueryError) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
};
