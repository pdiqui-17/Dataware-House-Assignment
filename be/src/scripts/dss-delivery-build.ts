import { mkdir, writeFile } from 'node:fs/promises';

import { defaultConfig, type DeliveryPolicyConfig } from '../config/delivery-policy.config.js';
import { pool } from '../config/db.config.js';
import {
  buildReviewBuckets,
  evaluatePolicies,
  isReviewMonotone,
  lateRate,
  learnK,
  reviewForDelay,
  wilsonInterval,
  type DeliveryCurveRow,
  type PolicyEvaluationRow,
  type PolicyEvaluationSummary,
} from '../model/delivery-policy.model.js';
import {
  activateRun,
  clearActiveRun,
  loadBase,
  saveRun,
  verifyBase,
} from '../repository/delivery-policy.repo.js';

const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}

function parseNumberList(value: string, optionName: string): number[] {
  const values = value.split(',').map((item) => Number(item.trim()));
  if (values.some((item) => !Number.isFinite(item))) {
    throw new Error(`--${optionName} must contain comma-separated numbers.`);
  }
  return values;
}

function writeCsv(rows: unknown[][]): string {
  return rows
    .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

const splitDates = option('split-dates')?.split(',').filter(Boolean) ?? [
  option('split-date') ?? defaultConfig.splitDate,
];
const testEndDate = option('test-end') ?? defaultConfig.testEndDate;
const marginsOption = option('margins');
const margins =
  marginsOption === undefined
    ? [defaultConfig.safetyMargin]
    : parseNumberList(marginsOption, 'margins');
const config: DeliveryPolicyConfig = {
  ...defaultConfig,
  splitDate: splitDates[0] ?? null,
  testEndDate,
};

interface RunReport {
  run_id: number;
  split_date: string;
  test_end_date: string;
  safety_margin: number;
  n_train: number;
  n_test: number;
  review_buckets: unknown[];
  review_monotone: boolean;
  evaluation_rows: PolicyEvaluationRow[];
  evaluation_summaries: PolicyEvaluationSummary[];
  state_policies: Record<string, unknown>[];
  backtests: Record<string, unknown>[];
  failed_segments: string[];
  low_power_segments: string[];
  fallback_segments: string[];
  unattainable_segments: string[];
}

async function buildRun(
  splitDate: string,
  safetyMargin: number,
  allRows: Awaited<ReturnType<typeof loadBase>>,
) {
  const train = allRows.filter(
    (row) =>
      row.purchase_date < splitDate &&
      (config.trainStartDate === null || row.purchase_date >= config.trainStartDate),
  );
  const test = allRows.filter(
    (row) => row.purchase_date >= splitDate && row.purchase_date <= (config.testEndDate ?? ''),
  );

  if (train.length === 0) {
    throw new Error(`No training orders found from ${config.trainStartDate} to ${splitDate}.`);
  }

  if (train.length > 0 && test.length > 0) {
    const lastTrainDate = train.reduce(
      (latest, row) => (row.purchase_date > latest ? row.purchase_date : latest),
      train[0]!.purchase_date,
    );
    const firstTestDate = test.reduce(
      (earliest, row) => (row.purchase_date < earliest ? row.purchase_date : earliest),
      test[0]!.purchase_date,
    );
    if (lastTrainDate && firstTestDate && lastTrainDate >= firstTestDate) {
      throw new Error('Train/test temporal separation failed.');
    }
  }

  const buckets = buildReviewBuckets(train, config.reviewBucketEdges, config.minBucketN);
  const segments = [
    'ALL',
    ...new Set(train.map((row) => row.customer_state).filter((state) => state !== 'ALL')),
  ].sort((a, b) => (a === 'ALL' ? -1 : b === 'ALL' ? 1 : a.localeCompare(b)));
  const rowsForSegment = (rows: typeof allRows, segment: string) =>
    segment === 'ALL' ? rows : rows.filter((row) => row.customer_state === segment);
  const trainAll = rowsForSegment(train, 'ALL');
  const targetUsed = config.targetLateRate - safetyMargin;
  const globalModel = learnK(
    trainAll.map((row) => row.delay_days),
    targetUsed,
    config.kMin,
    config.kMax,
    trainAll.map((row) => row.avg_review_score ?? 0),
    buckets,
    config.maxReviewDrop,
  );

  const curves: DeliveryCurveRow[] = [];
  const statePolicies: Record<string, unknown>[] = [];
  const stateModels = new Map<string, { k: number; attainable: boolean; fallback: boolean }>();

  for (const segment of segments) {
    const segmentTrain = rowsForSegment(train, segment);
    const segmentTest = rowsForSegment(test, segment);
    const fallback = segment !== 'ALL' && segmentTrain.length < config.minSegmentNTrain;
    const model = fallback
      ? globalModel
      : learnK(
          segmentTrain.map((row) => row.delay_days),
          targetUsed,
          config.kMin,
          config.kMax,
          segmentTrain.map((row) => row.avg_review_score ?? 0),
          buckets,
          config.maxReviewDrop,
        );

    stateModels.set(segment, { ...model, fallback });
    statePolicies.push({
      segment,
      k_recommended: model.k,
      fallback,
      attainable: model.attainable,
    });

    const trainDelays = segmentTrain.map((row) => row.delay_days);
    const testDelays = segmentTest.map((row) => row.delay_days);

    for (let k = config.kMin; k <= config.kMax; k += 1) {
      const expectedReview =
        segmentTrain.length === 0
          ? null
          : segmentTrain.reduce(
              (sum, row) => sum + reviewForDelay(row.delay_days - k, buckets),
              0,
            ) / segmentTrain.length;
      const promisedDays =
        segmentTrain.length === 0
          ? null
          : segmentTrain.reduce((sum, row) => sum + row.estimated_days + k, 0) /
            segmentTrain.length;

      curves.push({
        segment,
        k,
        promised_days_avg: promisedDays,
        late_rate_train: lateRate(trainDelays, k),
        late_rate_test: segmentTest.length === 0 ? null : lateRate(testDelays, k),
        expected_review: expectedReview,
        n_train: segmentTrain.length,
        n_test: segmentTest.length,
      });
    }
  }

  const kState = Object.fromEntries(
    [...stateModels]
      .filter(([segment]) => segment !== 'ALL')
      .map(([segment, model]) => [segment, model.k]),
  );
  const evaluation = evaluatePolicies(curves, {
    targetLateRate: config.targetLateRate,
    minSegmentNTest: config.minSegmentNTest,
    kGlobal: globalModel.k,
    kState,
  });
  const evaluationBySegment = new Map(
    evaluation.rows.filter((row) => row.policy === 'state_k').map((row) => [row.segment, row]),
  );
  const backtests = segments.map((segment) => {
    const model = stateModels.get(segment)!;
    const testRows = rowsForSegment(test, segment);
    const curve = curves.find((row) => row.segment === segment && row.k === model.k)!;
    const evaluationRow = evaluationBySegment.get(segment);
    const allSegmentTest = testRows.filter((row) => row.delay_days > model.k).length;
    const [allCiLow, allCiHigh] = wilsonInterval(allSegmentTest, testRows.length);
    const allStatus =
      testRows.length < config.minSegmentNTest
        ? 'low_power'
        : (curve.late_rate_test ?? 0) <= config.targetLateRate
          ? 'met'
          : 'missed';

    return {
      segment,
      k: model.k,
      n_test: testRows.length,
      predicted_late: curve.late_rate_train,
      actual_late: curve.late_rate_test,
      deviation:
        curve.late_rate_test === null ? null : curve.late_rate_test - curve.late_rate_train,
      ci_low:
        segment === 'ALL'
          ? testRows.length > 0
            ? allCiLow
            : null
          : (evaluationRow?.ci_low ?? null),
      ci_high:
        segment === 'ALL'
          ? testRows.length > 0
            ? allCiHigh
            : null
          : (evaluationRow?.ci_high ?? null),
      status: segment === 'ALL' ? allStatus : (evaluationRow?.status ?? 'low_power'),
      significantly_above_target:
        segment === 'ALL'
          ? allCiLow > config.targetLateRate
          : (evaluationRow?.significantly_above_target ?? false),
    };
  });
  const runId = await saveRun({
    params: { ...config, splitDate, testEndDate, safetyMargin },
    trainStart: config.trainStartDate ?? train[0]?.purchase_date ?? null,
    splitDate,
    testEnd: testEndDate!,
    safetyMargin,
    nTrain: train.length,
    nTest: test.length,
    curves,
    policies: statePolicies,
    backtests,
    buckets,
    evaluationRows: evaluation.rows,
    evaluationSummaries: evaluation.summaries,
  });

  const report: RunReport = {
    run_id: runId,
    split_date: splitDate,
    test_end_date: testEndDate!,
    safety_margin: safetyMargin,
    n_train: train.length,
    n_test: test.length,
    review_buckets: buckets,
    review_monotone: isReviewMonotone(buckets),
    evaluation_rows: evaluation.rows,
    evaluation_summaries: evaluation.summaries,
    state_policies: statePolicies,
    backtests,
    failed_segments: backtests
      .filter((row) => row.status === 'missed')
      .map((row) => String(row.segment)),
    low_power_segments: backtests
      .filter((row) => row.status === 'low_power')
      .map((row) => String(row.segment)),
    fallback_segments: statePolicies
      .filter((row) => row.fallback)
      .map((row) => String(row.segment)),
    unattainable_segments: statePolicies
      .filter((row) => !row.attainable)
      .map((row) => String(row.segment)),
  };

  await mkdir('reports/delivery_policy', { recursive: true });
  await writeFile(
    `reports/delivery_policy/run_${runId}.json`,
    JSON.stringify(report, null, 2),
    'utf8',
  );
  await writeFile(
    `reports/delivery_policy/run_${runId}_policies.csv`,
    writeCsv([
      [
        'policy',
        'late_rate',
        'promised_days_avg',
        'n_segments_scored',
        'n_segments_met',
        'pct_orders_in_met',
        'worst_segment',
        'worst_late_rate',
      ],
      ...evaluation.summaries.map((row) => [
        row.policy,
        row.late_rate,
        row.promised_days_avg,
        row.n_segments_scored,
        row.n_segments_met,
        row.pct_orders_in_met,
        row.worst_segment,
        row.worst_late_rate,
      ]),
    ]),
    'utf8',
  );
  await writeFile(
    `reports/delivery_policy/run_${runId}_segments.csv`,
    writeCsv([
      [
        'policy',
        'segment',
        'k',
        'n_test',
        'late_rate_test',
        'ci_low',
        'ci_high',
        'status',
        'significantly_above_target',
      ],
      ...evaluation.rows.map((row) => [
        row.policy,
        row.segment,
        row.k,
        row.n_test,
        row.late_rate_test,
        row.ci_low,
        row.ci_high,
        row.status,
        row.significantly_above_target,
      ]),
    ]),
    'utf8',
  );

  return report;
}

try {
  if (option('split-dates') && marginsOption !== undefined) {
    throw new Error('--split-dates and --margins cannot be used together.');
  }
  if (args.includes('--margins') && marginsOption === undefined) {
    throw new Error('Pass a comma-separated list after --margins.');
  }
  if (!testEndDate || splitDates.some((date) => !date)) {
    throw new Error('Pass --split-date and --test-end before building.');
  }
  if (margins.length === 0 || new Set(margins).size !== margins.length) {
    throw new Error('--margins must contain at least one unique value.');
  }
  if (margins.some((margin) => margin < 0 || margin >= config.targetLateRate)) {
    throw new Error('--margins values must be >= 0 and less than targetLateRate.');
  }
  if (config.kMin > config.kMax) throw new Error('kMin must be <= kMax.');

  await verifyBase();
  const allRows = await loadBase();
  const reports: RunReport[] = [];

  for (const splitDate of splitDates as string[]) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(splitDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(testEndDate) ||
      splitDate > testEndDate
    ) {
      throw new Error('Dates must use YYYY-MM-DD and splitDate must be <= testEndDate.');
    }

    for (const margin of margins) {
      reports.push(await buildRun(splitDate, margin, allRows));
    }
  }

  const activeReport = reports
    .filter((report) => report.safety_margin === config.safetyMargin)
    .at(-1);
  if (activeReport) await activateRun(activeReport.run_id);
  else await clearActiveRun();

  const tradeoffRows = reports
    .filter((report) => report.safety_margin !== config.safetyMargin)
    .concat(activeReport ? [activeReport] : [])
    .map((report) => ({
      run_id: report.run_id,
      safety_margin: report.safety_margin,
      ...report.evaluation_summaries.find((row) => row.policy === 'state_k'),
    }))
    .sort((a, b) => a.safety_margin - b.safety_margin);
  if (tradeoffRows.length > 0) {
    await writeFile(
      'reports/delivery_policy/tradeoff.csv',
      writeCsv([
        [
          'run_id',
          'safety_margin',
          'late_rate',
          'promised_days_avg',
          'n_segments_scored',
          'n_segments_met',
          'pct_orders_in_met',
          'worst_segment',
          'worst_late_rate',
        ],
        ...tradeoffRows.map((row) => [
          row.run_id,
          row.safety_margin,
          row.late_rate,
          row.promised_days_avg,
          row.n_segments_scored,
          row.n_segments_met,
          row.pct_orders_in_met,
          row.worst_segment,
          row.worst_late_rate,
        ]),
      ]),
      'utf8',
    );
  }

  console.log(JSON.stringify({ runs: reports }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
