import type { RequestHandler } from 'express';

import { sellerByIdService, sellerListService } from '../service/seller.service.js';
import { SORT_COLUMNS, type SellerParams, type SortColumn } from '../types/seller.js';

type SellerQuery = Record<string, string | undefined>;

class SellerQueryError extends Error {}

const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const integerQuery = (
  value: string | undefined,
  name: string,
  minimum: number,
): number | undefined => {
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value)) throw new SellerQueryError(`${name} phải là số nguyên`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new SellerQueryError(`${name} phải lớn hơn hoặc bằng ${minimum}`);
  }
  return parsed;
};

const numberQuery = (
  value: string | undefined,
  name: string,
  minimum: number,
  maximum?: number,
): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) {
    const range = maximum === undefined
      ? `lớn hơn hoặc bằng ${minimum}`
      : `từ ${minimum} đến ${maximum}`;
    throw new SellerQueryError(`${name} phải là số ${range}`);
  }
  return parsed;
};

const parseSellerParams = (query: SellerQuery): SellerParams => {
  const state = queryString(query.state);
  if (state !== undefined && !/^[A-Z]{2}$/.test(state)) {
    throw new SellerQueryError('state phải gồm đúng 2 chữ cái in hoa');
  }

  const city = queryString(query.city);
  if (city !== undefined && city.length > 64) {
    throw new SellerQueryError('city không được dài quá 64 ký tự');
  }

  const q = queryString(query.q);
  if (q !== undefined && (q.length < 3 || q.length > 32)) {
    throw new SellerQueryError('q phải dài từ 3 đến 32 ký tự');
  }

  const sort = queryString(query.sort);
  if (sort !== undefined && !Object.hasOwn(SORT_COLUMNS, sort)) {
    throw new SellerQueryError(`sort phải thuộc: ${Object.keys(SORT_COLUMNS).join(', ')}`);
  }

  const order = queryString(query.order) ?? 'desc';
  if (order !== 'asc' && order !== 'desc') {
    throw new SellerQueryError('order phải là asc hoặc desc');
  }

  const hasReview = queryString(query.has_review);
  if (hasReview !== undefined && hasReview !== 'true' && hasReview !== 'false') {
    throw new SellerQueryError('has_review phải là true hoặc false');
  }

  return {
    state,
    city,
    q,
    min_orders: integerQuery(queryString(query.min_orders), 'min_orders', 0),
    min_reviewed_orders: integerQuery(
      queryString(query.min_reviewed_orders),
      'min_reviewed_orders',
      0,
    ),
    min_review: numberQuery(queryString(query.min_review), 'min_review', 1, 5),
    max_freight_ratio: numberQuery(
      queryString(query.max_freight_ratio),
      'max_freight_ratio',
      0,
    ),
    has_review: hasReview as SellerParams['has_review'],
    sort: sort as SortColumn | undefined,
    order: order as SellerParams['order'],
    page: integerQuery(queryString(query.page) ?? '1', 'page', 1),
    limit: integerQuery(queryString(query.limit) ?? '20', 'limit', 1),
  };
};

export const sellerListController: RequestHandler<
  Record<string, never>,
  unknown,
  unknown,
  SellerQuery
> = async (req, res, next) => {
  try {
    const params = parseSellerParams(req.query);
    if (params.limit !== undefined && params.limit > 100) {
      throw new SellerQueryError('limit không được lớn hơn 100');
    }
    const result = await sellerListService(params);
    res.json({
      data: result.rows,
      pagination: {
        page: params.page,
        limit: params.limit,
        total: result.total,
        total_pages: Math.ceil(result.total / (params.limit ?? 20)),
      },
    });
  } catch (error) {
    if (error instanceof SellerQueryError) {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
};

export const sellerDetailController: RequestHandler<{ id: string }> = async (req, res, next) => {
  try {
    const seller = await sellerByIdService(req.params.id);
    if (seller === undefined) {
      res.status(404).json({ error: 'Seller không tồn tại' });
      return;
    }
    res.json({ data: seller });
  } catch (error) {
    next(error);
  }
};
