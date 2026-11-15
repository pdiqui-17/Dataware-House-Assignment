export type PivotCubeName = 'sales' | 'delivery';
export type PivotAxisKind = 'time' | 'category';
export type PivotUnit = 'currency' | 'count' | 'ratio' | 'days';

export interface PivotAxisConfig {
  key: string;
  label: string;
  kind: PivotAxisKind;
  keyExpr: string;
  labelExpr: string;
  sortExpr: string;
  fixedOrder?: readonly { key: string; label: string }[];
}

export interface PivotMeasureConfig {
  key: string;
  label: string;
  unit: PivotUnit;
  aggregateSql: string;
  decimals: number;
}

const yearQuarterKey = "d.year::text || '-Q' || d.quarter::text";
const yearMonthKey = "to_char(d.date_key, 'YYYY-MM')";

export const DELIVERY_DELAY_BUCKETS = [
  { key: 'early_8plus', label: 'Sớm từ 8 ngày', side: 'early' },
  { key: 'early_1_7', label: 'Sớm 1-7 ngày', side: 'early' },
  { key: 'on_time', label: 'Đúng ngày dự kiến', side: 'on_time' },
  { key: 'late_1_3', label: 'Trễ 1-3 ngày', side: 'late' },
  { key: 'late_4_7', label: 'Trễ 4-7 ngày', side: 'late' },
  { key: 'late_8plus', label: 'Trễ từ 8 ngày', side: 'late' },
] as const;

export const deliveryDelayBucketSql = (delayExpr = 'f.delay_days'): string => `CASE
  WHEN ${delayExpr} <= -8 THEN 'early_8plus'
  WHEN ${delayExpr} < 0 THEN 'early_1_7'
  WHEN ${delayExpr} = 0 THEN 'on_time'
  WHEN ${delayExpr} <= 3 THEN 'late_1_3'
  WHEN ${delayExpr} <= 7 THEN 'late_4_7'
  ELSE 'late_8plus'
END`;

const delayBucketExpr = deliveryDelayBucketSql();
const delayBucketOrderSql = `CASE ${delayBucketExpr}
  WHEN 'early_8plus' THEN 1
  WHEN 'early_1_7' THEN 2
  WHEN 'on_time' THEN 3
  WHEN 'late_1_3' THEN 4
  WHEN 'late_4_7' THEN 5
  ELSE 6
END`;

export const PIVOT_AXES = {
  sales: {
    year: {
      key: 'year',
      label: 'Năm',
      kind: 'time',
      keyExpr: 'd.year::text',
      labelExpr: 'd.year::text',
      sortExpr: 'd.year',
    },
    year_quarter: {
      key: 'year_quarter',
      label: 'Năm - quý',
      kind: 'time',
      keyExpr: yearQuarterKey,
      labelExpr: yearQuarterKey,
      sortExpr: '(d.year * 10 + d.quarter)',
    },
    year_month: {
      key: 'year_month',
      label: 'Năm - tháng',
      kind: 'time',
      keyExpr: yearMonthKey,
      labelExpr: yearMonthKey,
      sortExpr: "to_char(d.date_key, 'YYYY-MM')",
    },
    seller_state: {
      key: 'seller_state',
      label: 'Bang seller',
      kind: 'category',
      keyExpr: "COALESCE(s.seller_state, 'unknown')",
      labelExpr: "COALESCE(s.seller_state, 'unknown')",
      sortExpr: "COALESCE(s.seller_state, 'unknown')",
    },
    seller_city: {
      key: 'seller_city',
      label: 'Bang - thành phố seller',
      kind: 'category',
      keyExpr: "COALESCE(s.seller_state, 'unknown') || ' - ' || COALESCE(s.seller_city, 'unknown')",
      labelExpr:
        "COALESCE(s.seller_state, 'unknown') || ' - ' || COALESCE(s.seller_city, 'unknown')",
      sortExpr:
        "COALESCE(s.seller_state, 'unknown') || ' - ' || COALESCE(s.seller_city, 'unknown')",
    },
    category: {
      key: 'category',
      label: 'Danh mục sản phẩm',
      kind: 'category',
      keyExpr: "COALESCE(p.product_category_name, 'unknown')",
      labelExpr:
        "COALESCE(p.product_category_name_english, COALESCE(p.product_category_name, 'unknown'))",
      sortExpr: "COALESCE(p.product_category_name, 'unknown')",
    },
    order_status: {
      key: 'order_status',
      label: 'Trạng thái đơn hàng',
      kind: 'category',
      keyExpr: "COALESCE(st.order_status, 'unknown')",
      labelExpr: "COALESCE(st.order_status, 'unknown')",
      sortExpr: "COALESCE(st.order_status, 'unknown')",
    },
  },
  delivery: {
    year: {
      key: 'year',
      label: 'Năm',
      kind: 'time',
      keyExpr: 'd.year::text',
      labelExpr: 'd.year::text',
      sortExpr: 'd.year',
    },
    year_quarter: {
      key: 'year_quarter',
      label: 'Năm - quý',
      kind: 'time',
      keyExpr: yearQuarterKey,
      labelExpr: yearQuarterKey,
      sortExpr: '(d.year * 10 + d.quarter)',
    },
    year_month: {
      key: 'year_month',
      label: 'Năm - tháng',
      kind: 'time',
      keyExpr: yearMonthKey,
      labelExpr: yearMonthKey,
      sortExpr: "to_char(d.date_key, 'YYYY-MM')",
    },
    customer_state: {
      key: 'customer_state',
      label: 'Bang khách hàng',
      kind: 'category',
      keyExpr: "COALESCE(c.customer_state, 'unknown')",
      labelExpr: "COALESCE(c.customer_state, 'unknown')",
      sortExpr: "COALESCE(c.customer_state, 'unknown')",
    },
    customer_city: {
      key: 'customer_city',
      label: 'Bang - thành phố khách hàng',
      kind: 'category',
      keyExpr:
        "COALESCE(c.customer_state, 'unknown') || ' - ' || COALESCE(c.customer_city, 'unknown')",
      labelExpr:
        "COALESCE(c.customer_state, 'unknown') || ' - ' || COALESCE(c.customer_city, 'unknown')",
      sortExpr:
        "COALESCE(c.customer_state, 'unknown') || ' - ' || COALESCE(c.customer_city, 'unknown')",
    },
    delay_bucket: {
      key: 'delay_bucket',
      label: 'Nhóm độ trễ',
      kind: 'category',
      keyExpr: delayBucketExpr,
      labelExpr: delayBucketExpr,
      sortExpr: delayBucketOrderSql,
      fixedOrder: DELIVERY_DELAY_BUCKETS,
    },
  },
} as const satisfies Record<PivotCubeName, Record<string, PivotAxisConfig>>;

export const PIVOT_MEASURES = {
  sales: {
    total_price: {
      key: 'total_price',
      label: 'Tổng giá trị hàng',
      unit: 'currency',
      aggregateSql: 'SUM(b.price)::double precision',
      decimals: 2,
    },
    total_freight: {
      key: 'total_freight',
      label: 'Tổng phí vận chuyển',
      unit: 'currency',
      aggregateSql: 'SUM(b.freight_value)::double precision',
      decimals: 2,
    },
    n_orders: {
      key: 'n_orders',
      label: 'Số đơn hàng',
      unit: 'count',
      aggregateSql: 'COUNT(DISTINCT b.order_id)::double precision',
      decimals: 0,
    },
    n_items: {
      key: 'n_items',
      label: 'Số mặt hàng',
      unit: 'count',
      aggregateSql: 'SUM(b.item_count)::double precision',
      decimals: 0,
    },
  },
  delivery: {
    eligible_orders: {
      key: 'eligible_orders',
      label: 'Số đơn đủ điều kiện',
      unit: 'count',
      aggregateSql: 'COUNT(*)::double precision',
      decimals: 0,
    },
    late_orders: {
      key: 'late_orders',
      label: 'Số đơn trễ',
      unit: 'count',
      aggregateSql: 'COUNT(*) FILTER (WHERE b.is_delayed)::double precision',
      decimals: 0,
    },
    late_rate: {
      key: 'late_rate',
      label: 'Tỷ lệ trễ',
      unit: 'ratio',
      aggregateSql:
        '(COUNT(*) FILTER (WHERE b.is_delayed)::numeric / NULLIF(COUNT(*), 0))::double precision',
      decimals: 4,
    },
    avg_delivery_days: {
      key: 'avg_delivery_days',
      label: 'Số ngày giao trung bình',
      unit: 'days',
      aggregateSql: 'AVG(b.delivery_days)::double precision',
      decimals: 2,
    },
    avg_delay_days: {
      key: 'avg_delay_days',
      label: 'Số ngày trễ trung bình',
      unit: 'days',
      aggregateSql: 'AVG(b.delay_days)::double precision',
      decimals: 2,
    },
  },
} as const satisfies Record<PivotCubeName, Record<string, PivotMeasureConfig>>;

export type PivotAxisKey<C extends PivotCubeName> = keyof (typeof PIVOT_AXES)[C] & string;
export type PivotMeasureKey<C extends PivotCubeName> = keyof (typeof PIVOT_MEASURES)[C] & string;

export const getPivotMetadata = () => ({
  sales: {
    axes: Object.values(PIVOT_AXES.sales).map(({ key, label, kind }) => ({ key, label, kind })),
    measures: Object.values(PIVOT_MEASURES.sales).map(({ key, label, unit }) => ({
      key,
      label,
      unit,
    })),
  },
  delivery: {
    axes: Object.values(PIVOT_AXES.delivery).map(({ key, label, kind }) => ({ key, label, kind })),
    measures: Object.values(PIVOT_MEASURES.delivery).map(({ key, label, unit }) => ({
      key,
      label,
      unit,
    })),
  },
});
