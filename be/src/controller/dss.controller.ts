import type { RequestHandler } from 'express';
import { CRITERIA } from '../types/dss.js';
import {
  dssConfigService,
  sellerScorecardService,
  parseWeightOverrides,
} from '../service/dss.service.js';
import {
  deliveryBufferService,
  deliveryBufferTradeoffService,
  DeliveryBufferRangeError,
} from '../service/delivery-buffer.service.js';

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
      error instanceof DssQueryError ||
      (error instanceof Error &&
        (error.message.startsWith('weights') || error.message.startsWith('Mỗi weight')))
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

export const deliveryBufferController: RequestHandler = async (req, res, next) => {
  try {
    const state = queryValue(req.query.state);
    if (state !== undefined && !/^[A-Z]{2}$/.test(state)) {
      throw new DssQueryError('state must contain exactly two uppercase letters');
    }

    const target = parseRate(queryValue(req.query.target_late_rate));
    const kMin = parseInteger(queryValue(req.query.k_min), -10, 'k_min');
    const kMax = parseInteger(queryValue(req.query.k_max), 10, 'k_max');
    if (kMin > kMax) {
      throw new DssQueryError('k_min must be less than or equal to k_max');
    }

    const runRaw = queryValue(req.query.run_id);
    const runId = runRaw === undefined ? undefined : parseInteger(runRaw, 0, 'run_id');
    if (runId !== undefined && runId < 1) {
      throw new DssQueryError('run_id must be a positive integer');
    }

    const result = await deliveryBufferService({ state, target, kMin, kMax, runId });
    if (!result) {
      res.status(404).json({
        error: 'No delivery policy run or state was found.',
      });
      return;
    }

    res.json(result);
  } catch (error) {
    if (error instanceof DssQueryError || error instanceof DeliveryBufferRangeError) {
      res.status(400).json({ error: error.message });
      return;
    }

    next(error);
  }
};

export const deliveryBufferTradeoffController: RequestHandler = async (req, res, next) => {
  try {
    const splitDate = queryValue(req.query.split_date);
    const testEnd = queryValue(req.query.test_end);
    if (!isValidIsoDate(splitDate) || !isValidIsoDate(testEnd)) {
      throw new DssQueryError('split_date and test_end must be valid YYYY-MM-DD dates');
    }
    if ((splitDate === undefined) !== (testEnd === undefined)) {
      throw new DssQueryError('split_date and test_end must be provided together');
    }

    const result = await deliveryBufferTradeoffService({ splitDate, testEnd });
    if (!result) {
      res.status(404).json({ error: 'No run found for the requested period' });
      return;
    }

    res.json(result);
  } catch (error) {
    if (error instanceof DssQueryError) {
      res.status(400).json({ error: error.message });
      return;
    }

    next(error);
  }
};

function parseRate(value: string | undefined): number {
  if (value === undefined) return 0.05;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
    throw new DssQueryError('target_late_rate must be a number in (0, 1)');
  }
  return parsed;
}

function parseInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new DssQueryError(`${name} must be an integer`);
  }
  return Number(value);
}

function isValidIsoDate(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
