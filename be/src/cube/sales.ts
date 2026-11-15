import type { CubeConfig } from '../engine/buildQuery.js';

export const sales = {
  name: 'sales',
  from: 'dw.fact_sales_item f',
  joins: {
    date: 'JOIN dw.dim_date d ON d.date_key = f.purchase_date_key',
    seller: 'JOIN dw.dim_seller s ON s.seller_key = f.seller_key',
    product: 'JOIN dw.dim_product p ON p.product_key = f.product_key',
    status: 'JOIN dw.dim_order_status os ON os.order_status_key = f.order_status_key',
  },
  baseWhere: [],
  hierarchies: {
    time: [
      { name: 'year', col: 'd.year', join: 'date' },
      { name: 'quarter', col: 'd.quarter', join: 'date' },
      { name: 'month', col: 'd.month', join: 'date' },
    ],
    seller_geo: [
      { name: 'seller_state', col: 's.seller_state', join: 'seller' },
      { name: 'seller_city', col: 's.seller_city', join: 'seller' },
    ],
    product: [
      { name: 'category', col: 'p.product_category_name_english', join: 'product' },
      { name: 'product', col: 'p.product_id', join: 'product' },
    ],
  },
  measures: {
    total_price: { sql: 'SUM(f.price)::float8', additive: true },
    total_freight: { sql: 'SUM(f.freight_value)::float8', additive: true },
    n_orders: { sql: 'COUNT(DISTINCT f.order_id)::int', additive: false },
    n_items: { sql: 'COUNT(*)::int', additive: true },
  },
  filters: {
    from: { join: 'date', cond: 'd.date_key >= ?' },
    to: { join: 'date', cond: 'd.date_key <= ?' },
    year: { join: 'date', cond: 'd.year = ?' },
    quarter: { join: 'date', cond: 'd.quarter = ?' },
    month: { join: 'date', cond: 'd.month = ?' },
    state: { join: 'seller', cond: 's.seller_state = ?' },
    city: { join: 'seller', cond: 's.seller_city = ?' },
    category: { join: 'product', cond: 'p.product_category_name_english = ?' },
    status: {
      join: 'status',
      cond: 'os.order_status = ANY(?)',
      parse: (v: string) => v.split(','),
    },
  },
  defaults: { status: 'delivered' },
} satisfies CubeConfig;
