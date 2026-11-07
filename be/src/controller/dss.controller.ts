import type { RequestHandler } from 'express';
import { CRITERIA } from '../types/dss.js';
import {
  dssConfigService,
  sellerScorecardService,
  parseWeightOverrides,
} from '../service/dss.service.js';

class DssQueryError extends Error {}

const queryValue = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const parseLimit = (value: string | undefined): number => {
  if (value === undefined) return 50;
  if (!/^\d+$/.test(value)) throw new DssQueryError('limit phải là số nguyên dương');
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new DssQueryError('limit phải từ 1 đến 100');
  }
  return limit;
};

export const sellerScorecardController: RequestHandler = async (req, res, next) => {
  try {
    const state = queryValue(req.query.state);
    if (state !== undefined && !/^[A-Z]{2}$/.test(state)) {
      throw new DssQueryError('state phải gồm đúng 2 chữ cái in hoa');
    }

    const weights = queryValue(req.query.weights);
    const parsedOverrides = parseWeightOverrides(weights);
    if (parsedOverrides !== undefined) {
      const unknown = Object.keys(parsedOverrides).filter(
        (criterion) => !CRITERIA.includes(criterion as (typeof CRITERIA)[number]),
      );
      if (unknown.length > 0) {
        throw new DssQueryError(`criterion không hợp lệ: ${unknown.join(', ')}`);
      }
    }

    const result = await sellerScorecardService({
      state,
      limit: parseLimit(queryValue(req.query.limit)),
      weights,
    });
    res.json({
      data: result.rows,
      pagination: { limit: parseLimit(queryValue(req.query.limit)), total: result.total },
      weights: result.weights,
    });
  } catch (error) {
    if (
      error instanceof DssQueryError
      || error instanceof Error
        && (error.message.startsWith('weights') || error.message.startsWith('Mỗi weight'))
    ) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
};

export const dssConfigController: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await dssConfigService() });
  } catch (error) {
    next(error);
  }
};
