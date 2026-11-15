import { describe, expect, it } from 'vitest';

import { DELIVERY_DELAY_BUCKETS } from '../model/pivot.model.js';
import type { PivotSqlRow } from '../types/pivot.js';
import { buildPivotResponse, parsePivotQuery, PivotValidationError } from './pivot.service.js';

describe('pivot query validation', () => {
  it('requires rows and cols', () => {
    expect(() => parsePivotQuery({}, 'sales')).toThrow('Thiếu tham số rows');
    expect(() => parsePivotQuery({ rows: 'year' }, 'sales')).toThrow('Thiếu tham số cols');
  });

  it('requires different axes from the cube whitelist', () => {
    expect(() => parsePivotQuery({ rows: 'year', cols: 'year' }, 'sales')).toThrow(
      'rows và cols phải khác nhau',
    );
    expect(() => parsePivotQuery({ rows: 'product', cols: 'year' }, 'sales')).toThrow(
      'rows không hợp lệ',
    );
  });

  it('validates measure and the delay-bucket restriction', () => {
    expect(() =>
      parsePivotQuery({ rows: 'year', cols: 'category', measure: 'unknown' }, 'sales'),
    ).toThrow('measure không hợp lệ');
    expect(() =>
      parsePivotQuery(
        { rows: 'delay_bucket', cols: 'customer_state', measure: 'late_rate' },
        'delivery',
      ),
    ).toThrow('measure chỉ được là eligible_orders hoặc avg_delivery_days');
  });

  it('validates limits, dates, and range order', () => {
    expect(() =>
      parsePivotQuery({ rows: 'year', cols: 'category', max_rows: '0' }, 'sales'),
    ).toThrow('max_rows phải từ 1 đến 50');
    expect(() =>
      parsePivotQuery({ rows: 'year', cols: 'category', max_cols: '51' }, 'sales'),
    ).toThrow('max_cols phải từ 1 đến 50');
    expect(() =>
      parsePivotQuery({ rows: 'year', cols: 'category', from: '2018-02-30' }, 'sales'),
    ).toThrow('Ngày phải hợp lệ theo dạng YYYY-MM-DD');
    expect(() =>
      parsePivotQuery(
        { rows: 'year', cols: 'category', from: '2018-02-02', to: '2018-02-01' },
        'sales',
      ),
    ).toThrow('from phải nhỏ hơn hoặc bằng to');
  });

  it('omits the default delivered filter when order_status is an axis', () => {
    const statusPivot = parsePivotQuery({ rows: 'order_status', cols: 'year' }, 'sales');
    const ordinaryPivot = parsePivotQuery({ rows: 'year', cols: 'category' }, 'sales');

    expect(statusPivot.filters.status).toBeUndefined();
    expect(ordinaryPivot.filters.status).toEqual(['delivered']);
  });

  it('rejects delivery-only unsupported filters', () => {
    expect(() =>
      parsePivotQuery({ rows: 'year', cols: 'customer_state', status: 'delivered' }, 'delivery'),
    ).toThrow(PivotValidationError);
  });
});

describe('buildPivotResponse', () => {
  const params = parsePivotQuery(
    { rows: 'year_month', cols: 'category', measure: 'total_price' },
    'sales',
  );

  it('places values by headers, preserves missing cells, and rounds currency', () => {
    const rows: PivotSqlRow[] = [
      sqlRow('row_header', {
        row_key: '2018-02',
        row_label: '2018-02',
        value: 2.555,
        row_order: 2,
      }),
      sqlRow('row_header', { row_key: '2018-01', row_label: '2018-01', value: 10, row_order: 1 }),
      sqlRow('col_header', {
        col_key: 'health',
        col_label: 'health_beauty',
        value: 10,
        col_order: 1,
      }),
      sqlRow('col_header', { col_key: 'toys', col_label: 'toys', value: 2.555, col_order: 2 }),
      sqlRow('cell', { row_key: '2018-01', col_key: 'health', value: 9.456 }),
      sqlRow('cell', { row_key: '2018-02', col_key: 'toys', value: 2.555 }),
      sqlRow('row_total', { row_key: '2018-01', value: 10.006 }),
      sqlRow('row_total', { row_key: '2018-02', value: 2.555 }),
      sqlRow('col_total', { col_key: 'health', value: 9.456 }),
      sqlRow('col_total', { col_key: 'toys', value: 2.555 }),
      sqlRow('meta', { value: 12.561, total_rows: 2, total_cols: 2 }),
    ];

    const response = buildPivotResponse(params, rows);

    expect(response.row_headers.map((header) => header.key)).toEqual(['2018-01', '2018-02']);
    expect(response.col_headers.map((header) => header.key)).toEqual(['health', 'toys']);
    expect(response.matrix).toEqual([
      [9.46, null],
      [null, 2.56],
    ]);
    expect(response.row_totals).toEqual([10.01, 2.56]);
    expect(response.col_totals).toEqual([9.46, 2.56]);
    expect(response.grand_total).toBe(12.56);
  });

  it('returns the six delay buckets in their configured order', () => {
    const bucketParams = parsePivotQuery(
      { rows: 'delay_bucket', cols: 'customer_state', measure: 'eligible_orders' },
      'delivery',
    );
    const rows = DELIVERY_DELAY_BUCKETS.map((bucket, index) =>
      sqlRow('row_header', {
        row_key: bucket.key,
        row_label: bucket.label,
        value: index,
        row_order: index + 1,
      }),
    );
    rows.push(
      sqlRow('col_header', { col_key: 'SP', col_label: 'SP', value: 1, col_order: 1 }),
      sqlRow('meta', { value: 6, total_rows: 6, total_cols: 1 }),
    );

    const response = buildPivotResponse(bucketParams, rows);

    expect(response.row_headers.map((header) => header.key)).toEqual(
      DELIVERY_DELAY_BUCKETS.map((bucket) => bucket.key),
    );
  });

  it('returns an empty pivot shape when filtered data is empty', () => {
    const response = buildPivotResponse(params, [
      sqlRow('meta', { value: null, total_rows: 0, total_cols: 0 }),
    ]);

    expect(response.row_headers).toEqual([]);
    expect(response.col_headers).toEqual([]);
    expect(response.matrix).toEqual([]);
    expect(response.row_totals).toEqual([]);
    expect(response.col_totals).toEqual([]);
    expect(response.grand_total).toBeNull();
  });
});

function sqlRow(
  recordType: PivotSqlRow['record_type'],
  overrides: Partial<PivotSqlRow> = {},
): PivotSqlRow {
  return {
    record_type: recordType,
    row_key: null,
    row_label: null,
    col_key: null,
    col_label: null,
    value: null,
    row_order: null,
    col_order: null,
    total_rows: 0,
    total_cols: 0,
    ...overrides,
  };
}
