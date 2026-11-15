import { pool } from '../config/db.config.js';
import { SORT_COLUMNS, type SellerParams, type SellerRow } from '../types/seller.js';

export interface SellerListResult {
  rows: SellerRow[];
  total: number;
}

const buildSellerConditions = (params: SellerParams): { text: string; values: unknown[] } => {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const add = (condition: string, value: unknown): void => {
    values.push(value);
    conditions.push(condition.replace('?', `$${values.length}`));
  };

  if (params.state !== undefined) add('seller_state = ?', params.state);
  if (params.city !== undefined) add('seller_city = ?', params.city);
  if (params.q !== undefined) add('seller_id ILIKE ?', `%${params.q}%`);
  if (params.min_orders !== undefined) add('n_orders >= ?', params.min_orders);
  if (params.min_reviewed_orders !== undefined) {
    add('COALESCE(n_reviewed_orders, 0) >= ?', params.min_reviewed_orders);
  }
  if (params.min_review !== undefined) add('avg_review >= ?', params.min_review);
  if (params.max_freight_ratio !== undefined) {
    add('freight_ratio <= ?', params.max_freight_ratio);
  }
  if (params.has_review !== undefined) {
    conditions.push(
      params.has_review === 'true'
        ? 'COALESCE(n_reviewed_orders, 0) > 0'
        : 'COALESCE(n_reviewed_orders, 0) = 0',
    );
  }

  return {
    text: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
};

export const sellerList = async (params: SellerParams): Promise<SellerListResult> => {
  const { text: where, values } = buildSellerConditions(params);
  const sortColumn = SORT_COLUMNS[params.sort ?? 'total_price'];
  const direction = params.order === 'asc' ? 'ASC' : 'DESC';
  const limit = params.limit ?? 20;
  const offset = ((params.page ?? 1) - 1) * limit;

  const limitPosition = values.length + 1;
  const offsetPosition = values.length + 2;
  const query = `
    SELECT v.*, COUNT(*) OVER()::int AS total_count
    FROM dw.v_seller_kpi v
    ${where}
    ORDER BY ${sortColumn} ${direction}, seller_id ASC
    LIMIT $${limitPosition} OFFSET $${offsetPosition}
  `;
  const result = await pool.query<SellerRow & { total_count?: number }>(query, [
    ...values,
    limit,
    offset,
  ]);

  const total = result.rows[0]?.total_count ?? 0;
  return {
    rows: result.rows.map((row) => {
      const seller = { ...row };
      delete seller.total_count;
      return seller as SellerRow;
    }),
    total,
  };
};

export const sellerById = async (sellerId: string): Promise<SellerRow | undefined> => {
  const result = await pool.query<SellerRow>(
    'SELECT * FROM dw.v_seller_kpi WHERE seller_id = $1',
    [sellerId],
  );
  return result.rows[0];
};