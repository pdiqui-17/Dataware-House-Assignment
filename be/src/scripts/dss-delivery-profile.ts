import { mkdir, writeFile } from 'node:fs/promises';

import { pool } from '../config/db.config.js';
import { defaultConfig } from '../config/delivery-policy.config.js';
import { loadBase, verifyBase } from '../repository/delivery-policy.repo.js';

interface MonthMetrics {
  total: number;
  eligible: number;
  late: number;
}

function toCsv(rows: unknown[][]): string {
  return rows
    .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

function percentile(values: number[], proportion: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(proportion * sorted.length) - 1);
  return sorted[index] ?? null;
}

try {
  await verifyBase();
  const data = await loadBase();
  const monthly = new Map<string, MonthMetrics>();

  for (const row of data) {
    const month = row.purchase_date.slice(0, 7);
    const metrics = monthly.get(month) ?? { total: 0, eligible: 0, late: 0 };
    metrics.eligible += 1;
    if (row.delay_days > 0) metrics.late += 1;
    monthly.set(month, metrics);
  }

  const totals = await pool.query(
    `SELECT to_char(date_trunc('month', purchase_date_key), 'YYYY-MM') AS month,
            COUNT(*)::int AS total
       FROM dw.fact_delivery_order
      GROUP BY 1
      ORDER BY 1`,
  );

  for (const row of totals.rows) {
    const metrics = monthly.get(String(row.month)) ?? { total: 0, eligible: 0, late: 0 };
    metrics.total = Number(row.total);
    monthly.set(String(row.month), metrics);
  }

  const months = [...monthly].sort(([a], [b]) => a.localeCompare(b));
  const eligibilityRates = months.map(([, metrics]) =>
    metrics.total > 0 ? metrics.eligible / metrics.total : 0,
  );
  const baselineRate =
    eligibilityRates.length > 0
      ? eligibilityRates.reduce((sum, rate) => sum + rate, 0) / eligibilityRates.length
      : 0;
  const monthReport = months.map(([month, metrics], index) => {
    const eligibleRate = metrics.total > 0 ? metrics.eligible / metrics.total : 0;
    return {
      month,
      ...metrics,
      pct_eligible: eligibleRate * 100,
      eligible_rate: eligibleRate,
      late_rate: metrics.eligible > 0 ? metrics.late / metrics.eligible : 0,
      biased_low: metrics.total > 0 && (eligibilityRates[index] ?? 0) < baselineRate * 0.75,
    };
  });

  const delaysByState = new Map<string, number[]>();
  for (const row of data) {
    delaysByState.set(row.customer_state, [
      ...(delaysByState.get(row.customer_state) ?? []),
      row.delay_days,
    ]);
  }

  const states = [...delaysByState]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([state, delays]) => ({
      state,
      n: delays.length,
      min: Math.min(...delays),
      p5: percentile(delays, 0.05),
      p50: percentile(delays, 0.5),
      p95: percentile(delays, 0.95),
      p99: percentile(delays, 0.99),
      max: Math.max(...delays),
      late_rate: delays.filter((delay) => delay > 0).length / delays.length,
    }));

  const candidates: unknown[][] = [];
  for (let splitIndex = 0; splitIndex < months.length; splitIndex += 1) {
    const splitDate = `${months[splitIndex]?.[0]}-01`;
    const trainCount = data.filter(
      (row) =>
        row.purchase_date < splitDate &&
        (defaultConfig.trainStartDate === null ||
          row.purchase_date >= defaultConfig.trainStartDate),
    ).length;

    for (let endIndex = splitIndex + 2; endIndex < months.length; endIndex += 1) {
      const endMonth = months[endIndex]?.[0];
      if (!endMonth) continue;

      const testEnd = new Date(
        Date.UTC(Number(endMonth.slice(0, 4)), Number(endMonth.slice(5, 7)), 0),
      )
        .toISOString()
        .slice(0, 10);
      if (monthReport.find((month) => month.month === endMonth)?.biased_low) continue;

      const testRows = data.filter(
        (row) => row.purchase_date >= splitDate && row.purchase_date <= testEnd,
      );
      const stateCounts = new Map<string, number>();
      for (const row of testRows) {
        stateCounts.set(row.customer_state, (stateCounts.get(row.customer_state) ?? 0) + 1);
      }

      const wellPoweredStates = [...stateCounts.values()].filter(
        (count) => count >= defaultConfig.minSegmentNTest,
      );
      if (trainCount > 0 && wellPoweredStates.length >= 3) {
        candidates.push([splitDate, testEnd, trainCount, testRows.length]);
      }
    }
  }

  const output = {
    months: monthReport,
    states,
    suggested_splits: candidates.slice(0, 12),
  };
  await mkdir('reports', { recursive: true });
  await writeFile('reports/delivery_policy_profile.json', JSON.stringify(output, null, 2), 'utf8');
  await writeFile(
    'reports/delivery_policy_profile_monthly.csv',
    toCsv([
      ['month', 'total', 'eligible', 'pct_eligible', 'late', 'late_rate', 'biased_low'],
      ...monthReport.map((month) => [
        month.month,
        month.total,
        month.eligible,
        month.pct_eligible,
        month.late,
        month.late_rate,
        month.biased_low,
      ]),
    ]),
    'utf8',
  );

  console.log('Monthly eligibility profile (pct_eligible is a percentage):');
  console.table(monthReport);
  const recentMonths = monthReport.filter(
    (month) => month.month >= '2018-05' && month.month <= '2018-08',
  );
  if (recentMonths.length > 0) {
    console.log('Eligibility rates for May to August 2018:');
    console.table(
      recentMonths.map(({ month, total, eligible, pct_eligible, biased_low }) => ({
        month,
        total,
        eligible,
        pct_eligible,
        biased_low,
      })),
    );
  }
  console.log('Delay distribution by state:');
  console.table(states);
  console.log('Suggested split_date, test_end_date, n_train, n_test:');
  console.table(candidates.slice(0, 12));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
