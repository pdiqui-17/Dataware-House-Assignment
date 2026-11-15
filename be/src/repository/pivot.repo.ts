import { pool } from '../config/db.config.js';
import { PIVOT_AXES } from '../model/pivot.model.js';
import type { PivotParams, PivotSqlRow } from '../types/pivot.js';

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function fixedAxisValues(params: PivotParams, axis: 'rows' | 'cols'): string | null {
  const config = params[axis];
  if (!config.fixedOrder) return null;

  return config.fixedOrder
    .map(
      (item, index) =>
        `(${quoteSqlLiteral(item.key)}, ${quoteSqlLiteral(item.label)}, ${index + 1})`,
    )
    .join(', ');
}

function axisSelectionSql(params: PivotParams, axis: 'rows' | 'cols', maxParam: string): string {
  const config = params[axis];
  const fixedValues = fixedAxisValues(params, axis);
  const totalsName = `${axis}_totals`;
  const selectedName = `selected_${axis}`;
  const keyName = axis === 'rows' ? 'row_key' : 'col_key';
  const labelName = axis === 'rows' ? 'row_label' : 'col_label';
  const sortName = axis === 'rows' ? 'row_sort' : 'col_sort';
  const valueName = axis === 'rows' ? 'row_value' : 'col_value';
  const orderName = axis === 'rows' ? 'row_order' : 'col_order';

  if (fixedValues) {
    const emptyValue =
      params.measure.unit === 'count' ? '0::double precision' : 'NULL::double precision';
    return `${selectedName} AS (
  SELECT fixed.key AS ${keyName},
         fixed.label AS ${labelName},
         COALESCE(totals.value, ${emptyValue}) AS ${valueName},
         fixed.axis_order::int AS ${orderName}
    FROM (VALUES ${fixedValues}) AS fixed(key, label, axis_order)
    LEFT JOIN ${totalsName} AS totals ON totals.${keyName} = fixed.key
)`;
  }

  if (config.kind === 'time') {
    return `${selectedName} AS (
  SELECT latest.${keyName},
         latest.${labelName},
         latest.value AS ${valueName},
         ROW_NUMBER() OVER (ORDER BY latest.${sortName} ASC, latest.${keyName} ASC)::int AS ${orderName}
    FROM (
      SELECT *
        FROM ${totalsName}
       ORDER BY ${sortName} DESC NULLS LAST, ${keyName} DESC
       LIMIT ${maxParam}
    ) AS latest
)`;
  }

  return `${selectedName} AS (
  SELECT top_values.${keyName},
         top_values.${labelName},
         top_values.value AS ${valueName},
         ROW_NUMBER() OVER (ORDER BY top_values.value DESC NULLS LAST, top_values.${keyName} ASC)::int AS ${orderName}
    FROM (
      SELECT *
        FROM ${totalsName}
       ORDER BY value DESC NULLS LAST, ${keyName} ASC
       LIMIT ${maxParam}
    ) AS top_values
)`;
}

function buildWhere(params: PivotParams): { clauses: string[]; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (expression: string, value: unknown, cast = '') => {
    values.push(value);
    clauses.push(`${expression} $${values.length}${cast}`);
  };

  if (params.filters.from !== undefined) add('d.date_key >=', params.filters.from, '::date');
  if (params.filters.to !== undefined) add('d.date_key <=', params.filters.to, '::date');
  if (params.filters.year !== undefined) add('d.year =', params.filters.year);
  if (params.filters.quarter !== undefined) add('d.quarter =', params.filters.quarter);
  if (params.filters.month !== undefined) add('d.month =', params.filters.month);

  if (params.cube === 'sales') {
    if (params.filters.state !== undefined) add('s.seller_state =', params.filters.state);
    if (params.filters.city !== undefined) add('s.seller_city =', params.filters.city);
    if (params.filters.category !== undefined) {
      add('p.product_category_name_english =', params.filters.category);
    }
    if (params.filters.status !== undefined) {
      values.push(params.filters.status);
      clauses.push(`st.order_status = ANY($${values.length}::text[])`);
    }
  } else {
    if (params.filters.state !== undefined) add('c.customer_state =', params.filters.state);
    if (params.filters.city !== undefined) add('c.customer_city =', params.filters.city);
    clauses.unshift('f.is_delivery_eligible = TRUE');
  }

  return { clauses, values };
}

export async function fetchPivotRows(params: PivotParams): Promise<PivotSqlRow[]> {
  const { clauses, values } = buildWhere(params);
  const rowLimitParam = `$${values.length + 1}`;
  const colLimitParam = `$${values.length + 2}`;
  values.push(params.maxRows, params.maxCols);

  const fromSql =
    params.cube === 'sales'
      ? `dw.fact_sales_item f
       JOIN dw.dim_date d ON d.date_key = f.purchase_date_key
       JOIN dw.dim_seller s ON s.seller_key = f.seller_key
       JOIN dw.dim_product p ON p.product_key = f.product_key
       JOIN dw.dim_order_status st ON st.order_status_key = f.order_status_key`
      : `dw.fact_delivery_order f
       JOIN dw.dim_date d ON d.date_key = f.purchase_date_key
       JOIN dw.dim_customer c ON c.customer_key = f.customer_key`;

  const rowFixed = fixedAxisValues(params, 'rows') !== null;
  const colFixed = fixedAxisValues(params, 'cols') !== null;
  const rowCountSql = rowFixed
    ? `CASE WHEN EXISTS (SELECT 1 FROM base) THEN ${params.rows.fixedOrder?.length ?? 0} ELSE 0 END`
    : '(SELECT COUNT(*)::int FROM rows_totals)';
  const colCountSql = colFixed
    ? `CASE WHEN EXISTS (SELECT 1 FROM base) THEN ${params.cols.fixedOrder?.length ?? 0} ELSE 0 END`
    : '(SELECT COUNT(*)::int FROM cols_totals)';
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join('\n  AND ')}` : '';
  const query = `WITH base AS MATERIALIZED (
  SELECT (${params.rows.keyExpr})::text AS row_key,
         (${params.rows.labelExpr})::text AS row_label,
         (${params.rows.sortExpr}) AS row_sort,
         (${params.cols.keyExpr})::text AS col_key,
         (${params.cols.labelExpr})::text AS col_label,
         (${params.cols.sortExpr}) AS col_sort,
         f.price,
         f.freight_value,
         f.item_count,
         f.order_id,
         f.is_delayed,
         f.delivery_days,
         f.delay_days
    FROM ${fromSql}
    ${whereSql}
),
rows_totals AS (
  SELECT b.row_key, b.row_label, b.row_sort,
         ${params.measure.aggregateSql} AS value
    FROM base AS b
   GROUP BY b.row_key, b.row_label, b.row_sort
),
cols_totals AS (
  SELECT b.col_key, b.col_label, b.col_sort,
         ${params.measure.aggregateSql} AS value
    FROM base AS b
   GROUP BY b.col_key, b.col_label, b.col_sort
),
${axisSelectionSql(params, 'rows', rowLimitParam)},
${axisSelectionSql(params, 'cols', colLimitParam)},
cells AS (
  SELECT b.row_key, b.row_label, b.col_key, b.col_label,
         sr.row_order, sc.col_order,
         ${params.measure.aggregateSql} AS value
    FROM base AS b
    JOIN selected_rows AS sr ON sr.row_key = b.row_key
    JOIN selected_cols AS sc ON sc.col_key = b.col_key
   GROUP BY b.row_key, b.row_label, b.col_key, b.col_label, sr.row_order, sc.col_order
),
result_rows AS (
  SELECT 'row_header'::text AS record_type,
         row_key, row_label, NULL::text AS col_key, NULL::text AS col_label,
         row_value::double precision AS value, row_order, NULL::int AS col_order
    FROM selected_rows
  UNION ALL
  SELECT 'col_header', NULL::text, NULL::text, col_key, col_label,
         col_value::double precision, NULL::int, col_order
    FROM selected_cols
  UNION ALL
  SELECT 'cell', row_key, row_label, col_key, col_label,
         value::double precision, row_order, col_order
    FROM cells
  UNION ALL
  SELECT 'row_total', row_key, row_label, NULL::text, NULL::text,
         row_value::double precision, row_order, NULL::int
    FROM selected_rows
  UNION ALL
  SELECT 'col_total', NULL::text, NULL::text, col_key, col_label,
         col_value::double precision, NULL::int, col_order
    FROM selected_cols
),
meta AS (
  SELECT ${rowCountSql} AS total_rows,
         ${colCountSql} AS total_cols,
         (${params.measure.aggregateSql})::double precision AS grand_total
    FROM base AS b
)
SELECT result_rows.*, meta.total_rows, meta.total_cols
  FROM result_rows CROSS JOIN meta
UNION ALL
SELECT 'meta', NULL::text, NULL::text, NULL::text, NULL::text,
       meta.grand_total, NULL::int, NULL::int, meta.total_rows, meta.total_cols
  FROM meta`;

  const { rows } = await pool.query<PivotSqlRow>(query, values);
  return rows;
}

export const pivotAxisWhitelist = PIVOT_AXES;
