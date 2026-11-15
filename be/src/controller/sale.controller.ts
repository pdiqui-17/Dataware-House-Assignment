import type { RequestHandler } from 'express';

import { hierarchies } from '../config/hierarchies.config.js';
import { rollUpSerivce } from '../service/sale.service.js';
import type { AnalysisDimension, AnalysisParams, AnalysisQuery } from '../types/sale.js';

const isAnalysisDimension = (value: string): value is AnalysisDimension =>
  Object.hasOwn(hierarchies, value);

const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

export const rollUpController: RequestHandler<
  Record<string, never>,
  unknown,
  unknown,
  AnalysisQuery
> = async (req, res, next) => {
  try {
    const query = req.query;
    const dim = queryString(query.dim) ?? 'time';

    if (!isAnalysisDimension(dim)) {
      res.status(400).json({ error: `dim phải thuộc: ${Object.keys(hierarchies).join(', ')}` });
      return;
    }

    const max = hierarchies[dim].length;
    const depth = Number(queryString(query.depth) ?? max);
    if (!Number.isInteger(depth) || depth < 1 || depth > max) {
      res.status(400).json({ error: `depth phải từ 1 đến ${max}` });
      return;
    }

    const from = queryString(query.from);
    const to = queryString(query.to);
    const isDate = (value: string | undefined): boolean =>
      value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value);

    if (!isDate(from) || !isDate(to)) {
      res.status(400).json({ error: 'from/to phải có dạng YYYY-MM-DD' });
      return;
    }

    const parseInteger = (value: string | undefined): number | undefined => {
      if (value === undefined) return undefined;
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : undefined;
    };

    const yearValue = queryString(query.year);
    const quarterValue = queryString(query.quarter);
    const monthValue = queryString(query.month);
    const year = parseInteger(yearValue);
    const quarter = parseInteger(quarterValue);
    const month = parseInteger(monthValue);

    if (
      (yearValue !== undefined && year === undefined) ||
      (quarterValue !== undefined && quarter === undefined) ||
      (monthValue !== undefined && month === undefined)
    ) {
      res.status(400).json({ error: 'year/quarter/month phải là số nguyên' });
      return;
    }

    if (quarter !== undefined && (quarter < 1 || quarter > 4)) {
      res.status(400).json({ error: 'quarter phải từ 1 đến 4' });
      return;
    }
    if (month !== undefined && (month < 1 || month > 12)) {
      res.status(400).json({ error: 'month phải từ 1 đến 12' });
      return;
    }

    const status = queryString(query.status);
    const params: AnalysisParams = {
      dim,
      depth,
      from,
      to,
      year,
      quarter,
      month,
      state: queryString(query.state),
      city: queryString(query.city),
      category: queryString(query.category),
      status: status?.split(',') ?? ['delivered'],
    };

    res.json(await rollUpSerivce(params));
  } catch (error) {
    next(error);
  }
};
