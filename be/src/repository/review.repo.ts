import { pool } from '../config/db.config.js';
import { ReviewGroup, type ReviewByDelayParams } from '../types/review.js';

export interface ReviewByDelayRow {
  group: string;
  n_orders: number;
  avg_score: number | null;
  low_review_rate: number | null;
}

export interface ReviewByDelaySummary {
  total_orders: number;
  orders_with_review: number;
  orders_without_review: number;
  p0: number;
  avg_late: number | null;
  avg_ok: number | null;
}

export interface ReviewByDelayResult {
  rows: ReviewByDelayRow[];
  summary: ReviewByDelaySummary;
}

export const reviewByDelay = async ({
  from,
  to,
  state,
  group = ReviewGroup.BUCKET,
}: ReviewByDelayParams): Promise<ReviewByDelayResult> => {
  const values: string[] = [];
  const where: string[] = [];
  const add = (condition: string, value: string): void => {
    values.push(value);
    where.push(condition.replace('?', `$${values.length}`));
  };

  if (from) add('orv.purchase_date_key >= ?', from);
  if (to) add('orv.purchase_date_key <= ?', to);
  if (state) add('orv.customer_state = ?', state);

  const groupExpression =
    group === ReviewGroup.BUCKET
      ? 'f.delay_bucket'
      : `CASE WHEN f.is_delayed THEN 'late' ELSE 'not_late' END`;

  const sql = `
    WITH filtered AS (
      SELECT *
      FROM dw.v_order_review orv
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ),
    summary AS (
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE has_review)::int AS orders_with_review,
        COUNT(*) FILTER (WHERE NOT has_review)::int AS orders_without_review,
        COALESCE(
          COUNT(*) FILTER (WHERE NOT has_review)::float8 / NULLIF(COUNT(*), 0),
          0
        ) AS p0,
        AVG(avg_score) FILTER (WHERE is_delayed)::float8 AS avg_late,
        AVG(avg_score) FILTER (WHERE NOT is_delayed)::float8 AS avg_ok
      FROM filtered
    )
    SELECT
      ${groupExpression} AS "group",
      COUNT(*)::int AS n_orders,
      AVG(avg_score)::float8 AS avg_score,
      (
        COUNT(*) FILTER (WHERE has_review AND is_low_review)::float8
        / NULLIF(COUNT(*) FILTER (WHERE has_review), 0)
      ) AS low_review_rate,
      summary.total_orders,
      summary.orders_with_review,
      summary.orders_without_review,
      summary.p0,
      summary.avg_late,
      summary.avg_ok
    FROM filtered f
    CROSS JOIN summary
    GROUP BY ${groupExpression}, summary.total_orders,
      summary.orders_with_review, summary.orders_without_review,
      summary.p0, summary.avg_late, summary.avg_ok
    ORDER BY CASE ${groupExpression}
      WHEN 'early_8plus' THEN 1
      WHEN 'early_1_7' THEN 2
      WHEN 'on_time' THEN 3
      WHEN 'late_1_3' THEN 4
      WHEN 'late_4_7' THEN 5
      WHEN 'late_8plus' THEN 6
      WHEN 'not_late' THEN 1
      WHEN 'late' THEN 2
      ELSE 99
    END;
  `;

  const { rows } = await pool.query<ReviewByDelayRow & ReviewByDelaySummary>(sql, values);
  const first = rows[0];

  return {
    rows: rows.map(({ group: groupName, n_orders, avg_score, low_review_rate }) => ({
      group: groupName,
      n_orders,
      avg_score,
      low_review_rate,
    })),
    summary: {
      total_orders: first?.total_orders ?? 0,
      orders_with_review: first?.orders_with_review ?? 0,
      orders_without_review: first?.orders_without_review ?? 0,
      p0: first?.p0 ?? 0,
      avg_late: first?.avg_late ?? null,
      avg_ok: first?.avg_ok ?? null,
    },
  };
};
