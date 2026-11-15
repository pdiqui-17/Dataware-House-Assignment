import type { CubeConfig } from '../engine/buildQuery.js';
import { deliveryDelayBucketSql } from '../model/pivot.model.js';

export const delivery = {
  name: 'delivery',
  from: 'dw.fact_delivery_order f',
  joins: {
    date: 'JOIN dw.dim_date d ON d.date_key = f.purchase_date_key',
    customer: 'JOIN dw.dim_customer c ON c.customer_key = f.customer_key',
  },
  baseWhere: ['f.is_delivery_eligible = true'], // luôn áp dụng
  hierarchies: {
    time: [
      { name: 'year', col: 'd.year', join: 'date' },
      { name: 'quarter', col: 'd.quarter', join: 'date' },
      { name: 'month', col: 'd.month', join: 'date' },
    ],
    customer_geo: [
      { name: 'customer_state', col: 'c.customer_state', join: 'customer' },
      { name: 'customer_city', col: 'c.customer_city', join: 'customer' },
    ],
  },
  measures: {
    eligible_orders: { sql: 'COUNT(*)::int' },
    late_orders: { sql: 'COUNT(*) FILTER (WHERE f.is_delayed)::int' },
    late_rate: { sql: '100.0 * COUNT(*) FILTER (WHERE f.is_delayed) / NULLIF(COUNT(*),0)' },
    avg_delivery_days: { sql: 'AVG(f.delivery_days)::float8' },
    avg_delay_days: { sql: 'AVG(f.delay_days)::float8' },
  },
  filters: {
    from: { join: 'date', cond: 'd.date_key >= ?' },
    to: { join: 'date', cond: 'd.date_key <= ?' },
    year: { join: 'date', cond: 'd.year = ?' },
    quarter: { join: 'date', cond: 'd.quarter = ?' },
    month: { join: 'date', cond: 'd.month = ?' },
    state: { join: 'customer', cond: 'c.customer_state = ?' },
    city: { join: 'customer', cond: 'c.customer_city = ?' },
  },
  defaults: {},
} satisfies CubeConfig;

export const deliverDistribution = {
  name: 'delivery',
  from: `(SELECT
            f.delay_days,
            d.date_key,
            d.year,
            d.quarter,
            d.month,
            c.customer_state,
            c.customer_city,
            ${deliveryDelayBucketSql('f.delay_days')} AS bucket
          FROM dw.fact_delivery_order f
          JOIN dw.dim_date d ON d.date_key = f.purchase_date_key
          JOIN dw.dim_customer c ON c.customer_key = f.customer_key
          WHERE f.is_delivery_eligible = true) t`,
  groupingLevels: [{ name: 'bucket', col: 't.bucket' }],
  hierarchies: {
    time: [
      { name: 'year', col: 't.year' },
      { name: 'quarter', col: 't.quarter' },
      { name: 'month', col: 't.month' },
    ],
    customer_geo: [
      { name: 'customer_state', col: 't.customer_state' },
      { name: 'customer_city', col: 't.customer_city' },
    ],
  },
  measures: {
    n_orders: { sql: 'COUNT(*)::int' },
    pct: { sql: 'ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2)::float8' },
  },
  filters: {
    from: { cond: 't.date_key >= ?' },
    to: { cond: 't.date_key <= ?' },
    year: { cond: 't.year = ?' },
    quarter: { cond: 't.quarter = ?' },
    month: { cond: 't.month = ?' },
    state: { cond: 't.customer_state = ?' },
    city: { cond: 't.customer_city = ?' },
  },
  defaults: {},
} satisfies CubeConfig;
