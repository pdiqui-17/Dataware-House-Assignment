import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { app } from '../app.js';

const databaseDescribe = process.env.RUN_DB_INTEGRATION === 'true' ? describe : describe.skip;

databaseDescribe('pivot endpoints (database integration)', () => {
  it('matches sales grand totals for additive and distinct measures', async () => {
    const [pricePivot, orderPivot, analysis] = await Promise.all([
      request(app).get(
        '/api/v1/sale/pivot?rows=year&cols=category&measure=total_price&max_rows=50&max_cols=50',
      ),
      request(app).get(
        '/api/v1/sale/pivot?rows=year&cols=category&measure=n_orders&max_rows=50&max_cols=50',
      ),
      request(app).get('/api/v1/sale/analysis?dim=time'),
    ]);

    expect(pricePivot.status).toBe(200);
    expect(orderPivot.status).toBe(200);
    expect(pricePivot.body.grand_total).toBe(
      analysis.body.data.find((row: { level: number }) => row.level === 0).total_price,
    );
    expect(orderPivot.body.grand_total).toBe(
      analysis.body.data.find((row: { level: number }) => row.level === 0).n_orders,
    );
  });

  it('matches the eligible-order delivery late rate', async () => {
    const [pivot, analysis] = await Promise.all([
      request(app).get(
        '/api/v1/delivery/pivot?rows=year&cols=customer_state&measure=late_rate&max_rows=50&max_cols=50',
      ),
      request(app).get('/api/v1/delivery/analysis?dim=time'),
    ]);
    const analysisGrandTotal = analysis.body.data.find((row: { level: number }) => row.level === 0);

    expect(pivot.status).toBe(200);
    // The legacy analysis SQL reports a percentage; the pivot contract is a 0..1 ratio.
    expect(pivot.body.grand_total).toBeCloseTo(analysisGrandTotal.measures.late_rate / 100, 4);
  });

  it('returns direct row totals and a transposed result when axes are swapped', async () => {
    const [forward, reverse] = await Promise.all([
      request(app).get(
        '/api/v1/delivery/pivot?rows=year_month&cols=customer_state&measure=eligible_orders&max_rows=50&max_cols=50',
      ),
      request(app).get(
        '/api/v1/delivery/pivot?rows=customer_state&cols=year_month&measure=eligible_orders&max_rows=50&max_cols=50',
      ),
    ]);

    expect(forward.status).toBe(200);
    expect(reverse.status).toBe(200);
    for (let rowIndex = 0; rowIndex < forward.body.matrix.length; rowIndex += 1) {
      expect(
        forward.body.matrix[rowIndex].reduce(
          (sum: number, value: number | null) => sum + (value ?? 0),
          0,
        ),
      ).toBe(forward.body.row_totals[rowIndex]);
    }
    expect(reverse.body.matrix).toEqual(
      forward.body.matrix[0]?.map((_: unknown, columnIndex: number) =>
        forward.body.matrix.map((row: number[]) => row[columnIndex]),
      ),
    );
    expect(reverse.body.grand_total).toBe(forward.body.grand_total);
  });

  it('returns metadata generated from the pivot whitelist', async () => {
    const response = await request(app).get('/api/v1/meta/pivot');

    expect(response.status).toBe(200);
    expect(response.body.data.sales.axes.map((axis: { key: string }) => axis.key)).toContain(
      'year_month',
    );
    expect(response.body.data.delivery.axes.map((axis: { key: string }) => axis.key)).toContain(
      'delay_bucket',
    );
    expect(
      response.body.data.sales.measures.map((measure: { key: string }) => measure.key),
    ).toContain('n_orders');
  });
});
