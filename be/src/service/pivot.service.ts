import { z } from 'zod';

import {
  PIVOT_AXES,
  PIVOT_MEASURES,
  type PivotAxisConfig,
  type PivotCubeName,
  type PivotMeasureConfig,
} from '../model/pivot.model.js';
import { fetchPivotRows } from '../repository/pivot.repo.js';
import type { PivotFilters, PivotParams, PivotResponse, PivotSqlRow } from '../types/pivot.js';

const dateString = z.string().refine(isValidDate, 'Ngày phải hợp lệ theo dạng YYYY-MM-DD');
const integerString = z
  .string()
  .regex(/^-?\d+$/, 'Giá trị phải là số nguyên')
  .transform(Number);
const positiveIntegerString = z
  .string()
  .regex(/^\d+$/, 'Giá trị phải là số nguyên')
  .transform(Number);

const pivotQuerySchema = z
  .object({
    rows: z.string({ required_error: 'Thiếu tham số rows' }).min(1, 'rows không được để trống'),
    cols: z.string({ required_error: 'Thiếu tham số cols' }).min(1, 'cols không được để trống'),
    measure: z.string().optional(),
    from: dateString.optional(),
    to: dateString.optional(),
    year: integerString.optional(),
    quarter: positiveIntegerString
      .pipe(z.number().int().min(1).max(4, 'quarter phải từ 1 đến 4'))
      .optional(),
    month: positiveIntegerString
      .pipe(z.number().int().min(1).max(12, 'month phải từ 1 đến 12'))
      .optional(),
    state: z.string().optional(),
    city: z.string().optional(),
    category: z.string().optional(),
    status: z.string().min(1, 'status không được để trống').optional(),
    max_rows: positiveIntegerString
      .pipe(
        z.number().int().min(1, 'max_rows phải từ 1 đến 50').max(50, 'max_rows phải từ 1 đến 50'),
      )
      .optional(),
    max_cols: positiveIntegerString
      .pipe(
        z.number().int().min(1, 'max_cols phải từ 1 đến 50').max(50, 'max_cols phải từ 1 đến 50'),
      )
      .optional(),
  })
  .superRefine((query, context) => {
    if (query.from && query.to && query.from > query.to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'from phải nhỏ hơn hoặc bằng to',
      });
    }
  });

export class PivotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PivotValidationError';
  }
}

export function parsePivotQuery(input: unknown, cube: PivotCubeName): PivotParams {
  const parsed = pivotQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new PivotValidationError(parsed.error.issues[0]?.message ?? 'Tham số pivot không hợp lệ');
  }

  const query = parsed.data;
  if (cube === 'delivery' && (query.category !== undefined || query.status !== undefined)) {
    throw new PivotValidationError('category và status không áp dụng cho delivery pivot');
  }

  const axes = PIVOT_AXES[cube] as Record<string, PivotAxisConfig>;
  const measures = PIVOT_MEASURES[cube] as Record<string, PivotMeasureConfig>;
  const rows = axes[query.rows];
  const cols = axes[query.cols];

  if (!rows) {
    throw new PivotValidationError(
      `rows không hợp lệ. Giá trị cho phép: ${Object.keys(axes).join(', ')}`,
    );
  }
  if (!cols) {
    throw new PivotValidationError(
      `cols không hợp lệ. Giá trị cho phép: ${Object.keys(axes).join(', ')}`,
    );
  }
  if (query.rows === query.cols) {
    throw new PivotValidationError('rows và cols phải khác nhau');
  }

  const defaultMeasure = cube === 'sales' ? 'total_price' : 'late_rate';
  const measureKey = query.measure ?? defaultMeasure;
  const measure = measures[measureKey];
  if (!measure) {
    throw new PivotValidationError(
      `measure không hợp lệ. Giá trị cho phép: ${Object.keys(measures).join(', ')}`,
    );
  }
  if (
    cube === 'delivery' &&
    (query.rows === 'delay_bucket' || query.cols === 'delay_bucket') &&
    measureKey !== 'eligible_orders' &&
    measureKey !== 'avg_delivery_days'
  ) {
    throw new PivotValidationError(
      'Khi dùng delay_bucket, measure chỉ được là eligible_orders hoặc avg_delivery_days',
    );
  }

  let status: string[] | undefined;
  if (cube === 'sales') {
    if (query.status !== undefined) {
      status = query.status.split(',');
    } else if (query.rows !== 'order_status' && query.cols !== 'order_status') {
      status = ['delivered'];
    }
  }

  const filters: PivotFilters = {
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    ...(query.year === undefined ? {} : { year: query.year }),
    ...(query.quarter === undefined ? {} : { quarter: query.quarter }),
    ...(query.month === undefined ? {} : { month: query.month }),
    ...(query.state === undefined ? {} : { state: query.state }),
    ...(query.city === undefined ? {} : { city: query.city }),
    ...(query.category === undefined ? {} : { category: query.category }),
    ...(status === undefined ? {} : { status }),
  };

  return {
    cube,
    rows,
    cols,
    measure,
    filters,
    maxRows: query.max_rows ?? 20,
    maxCols: query.max_cols ?? 10,
  };
}

export async function pivotService(params: PivotParams): Promise<PivotResponse> {
  const rows = await fetchPivotRows(params);
  return buildPivotResponse(params, rows);
}

export function buildPivotResponse(params: PivotParams, sqlRows: PivotSqlRow[]): PivotResponse {
  const metadata = sqlRows.find((row) => row.record_type === 'meta');
  const totalRows = Number(metadata?.total_rows ?? 0);
  const totalCols = Number(metadata?.total_cols ?? 0);

  if (totalRows === 0 || totalCols === 0) {
    return {
      cube: params.cube,
      rows: params.rows.key,
      cols: params.cols.key,
      measure: params.measure.key,
      meta: {
        filters: params.filters,
        unit: params.measure.unit,
        n_rows: 0,
        n_cols: 0,
        total_rows: 0,
        total_cols: 0,
        truncated: { rows: false, cols: false },
        notes: [],
      },
      row_headers: [],
      col_headers: [],
      matrix: [],
      row_totals: [],
      col_totals: [],
      grand_total: null,
    };
  }

  const rowHeaders = readHeaders(sqlRows, 'row_header');
  const colHeaders = readHeaders(sqlRows, 'col_header');
  const rowTotals = readTotals(sqlRows, 'row_total', 'row_key', params.measure.decimals);
  const colTotals = readTotals(sqlRows, 'col_total', 'col_key', params.measure.decimals);
  const cells = new Map<string, number | null>();

  for (const row of sqlRows) {
    if (row.record_type !== 'cell' || row.row_key === null || row.col_key === null) continue;
    cells.set(
      JSON.stringify([row.row_key, row.col_key]),
      roundValue(row.value, params.measure.decimals),
    );
  }

  const matrix = rowHeaders.map((rowHeader) =>
    colHeaders.map(
      (colHeader) => cells.get(JSON.stringify([rowHeader.key, colHeader.key])) ?? null,
    ),
  );
  const truncated = {
    rows: totalRows > rowHeaders.length,
    cols: totalCols > colHeaders.length,
  };

  return {
    cube: params.cube,
    rows: params.rows.key,
    cols: params.cols.key,
    measure: params.measure.key,
    meta: {
      filters: params.filters,
      unit: params.measure.unit,
      n_rows: rowHeaders.length,
      n_cols: colHeaders.length,
      total_rows: totalRows,
      total_cols: totalCols,
      truncated,
      notes:
        truncated.rows || truncated.cols
          ? [
              'Tổng hàng, tổng cột và tổng chung được tính trực tiếp từ dữ liệu, có thể khác tổng các ô hiển thị khi bị cắt hoặc khi measure không cộng được.',
            ]
          : [],
    },
    row_headers: rowHeaders,
    col_headers: colHeaders,
    matrix,
    row_totals: rowHeaders.map((header) => rowTotals.get(header.key) ?? null),
    col_totals: colHeaders.map((header) => colTotals.get(header.key) ?? null),
    grand_total: roundValue(metadata?.value ?? null, params.measure.decimals),
  };
}

function readHeaders(rows: PivotSqlRow[], type: 'row_header' | 'col_header') {
  const keyName = type === 'row_header' ? 'row_key' : 'col_key';
  const labelName = type === 'row_header' ? 'row_label' : 'col_label';
  const orderName = type === 'row_header' ? 'row_order' : 'col_order';

  return rows
    .filter((row) => row.record_type === type && row[keyName] !== null)
    .sort((a, b) => Number(a[orderName] ?? 0) - Number(b[orderName] ?? 0))
    .map((row) => ({ key: row[keyName]!, label: row[labelName] ?? row[keyName]! }));
}

function readTotals(
  rows: PivotSqlRow[],
  type: 'row_total' | 'col_total',
  keyName: 'row_key' | 'col_key',
  decimals: number,
): Map<string, number | null> {
  return new Map(
    rows
      .filter((row) => row.record_type === type && row[keyName] !== null)
      .map((row) => [row[keyName]!, roundValue(row.value, decimals)]),
  );
}

function roundValue(value: number | string | null, decimals: number): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (decimals === 0) return Math.round(parsed);
  return Number(parsed.toFixed(decimals));
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
