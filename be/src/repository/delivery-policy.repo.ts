import { pool } from '../config/db.config.js';
import type {
  DeliveryCurveRow,
  OrderRow,
  PolicyEvaluationRow,
  PolicyEvaluationSummary,
  ReviewBucket,
} from '../model/delivery-policy.model.js';

export interface SaveDeliveryRunInput {
  params: unknown;
  trainStart: string | null;
  splitDate: string;
  testEnd: string;
  safetyMargin: number;
  nTrain: number;
  nTest: number;
  curves: DeliveryCurveRow[];
  policies: Record<string, unknown>[];
  backtests: Record<string, unknown>[];
  buckets: ReviewBucket[];
  evaluationRows: PolicyEvaluationRow[];
  evaluationSummaries: PolicyEvaluationSummary[];
}

export interface DeliveryRunData {
  run: Record<string, unknown>;
  curves: DeliveryCurveRow[];
  policies: { segment: string; k_recommended: number; fallback: boolean; attainable: boolean }[];
  buckets: ReviewBucket[];
}

export async function loadBase(): Promise<OrderRow[]> {
  const { rows } = await pool.query(
    `SELECT customer_state,
            purchase_date::text,
            estimated_days,
            delay_days,
            avg_review_score
       FROM dw.v_delivery_promise_base
      ORDER BY customer_state, purchase_date, order_id`,
  );

  return rows.map((row) => ({
    customer_state: String(row.customer_state),
    purchase_date: String(row.purchase_date),
    estimated_days: Number(row.estimated_days),
    delay_days: Number(row.delay_days),
    avg_review_score: row.avg_review_score === null ? null : Number(row.avg_review_score),
  }));
}

export async function verifyBase(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n,
            COUNT(DISTINCT order_id)::int AS distinct_n,
            COUNT(*) FILTER (
              WHERE delay_days <> delivery_days - estimated_days
            )::int AS bad_delay,
            (SELECT COUNT(*)
               FROM dw.fact_delivery_order
              WHERE is_delivery_eligible)::int AS eligible
       FROM dw.v_delivery_promise_base`,
  );
  const row = rows[0];

  if (
    !row ||
    Number(row.n) !== Number(row.eligible) ||
    Number(row.n) !== Number(row.distinct_n) ||
    Number(row.bad_delay) !== 0
  ) {
    throw new Error(`v_delivery_promise_base validation failed: ${JSON.stringify(row)}`);
  }
}

export async function saveRun(input: SaveDeliveryRunInput): Promise<number> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const created = await client.query(
      `INSERT INTO dss.delivery_run (
         params, train_start, split_date, test_end, n_train, n_test, safety_margin
       )
       VALUES ($1::jsonb, $2, $3, $4, $5, $6, $7)
       RETURNING run_id`,
      [
        JSON.stringify(input.params),
        input.trainStart,
        input.splitDate,
        input.testEnd,
        input.nTrain,
        input.nTest,
        input.safetyMargin,
      ],
    );
    const runId = Number(created.rows[0].run_id);

    await client.query(
      `INSERT INTO dss.delivery_curve
       SELECT $1, *
         FROM unnest(
           $2::text[], $3::smallint[], $4::numeric[], $5::numeric[],
           $6::numeric[], $7::numeric[], $8::int[], $9::int[]
         )`,
      [
        runId,
        input.curves.map((row) => row.segment),
        input.curves.map((row) => row.k),
        input.curves.map((row) => row.promised_days_avg),
        input.curves.map((row) => row.late_rate_train),
        input.curves.map((row) => row.late_rate_test),
        input.curves.map((row) => row.expected_review),
        input.curves.map((row) => row.n_train),
        input.curves.map((row) => row.n_test),
      ],
    );

    await client.query(
      `INSERT INTO dss.delivery_policy
       SELECT $1, *
         FROM unnest($2::text[], $3::smallint[], $4::boolean[], $5::boolean[])`,
      [
        runId,
        input.policies.map((row) => row.segment),
        input.policies.map((row) => row.k_recommended),
        input.policies.map((row) => row.fallback),
        input.policies.map((row) => row.attainable),
      ],
    );

    await client.query(
      `INSERT INTO dss.delivery_backtest (
         run_id, segment, k, n_test, predicted_late, actual_late, deviation,
         ci_low, ci_high, status, significantly_above_target
       )
       SELECT $1, *
         FROM unnest(
           $2::text[], $3::smallint[], $4::int[], $5::numeric[], $6::numeric[],
           $7::numeric[], $8::numeric[], $9::numeric[], $10::text[], $11::boolean[]
         )`,
      [
        runId,
        input.backtests.map((row) => row.segment),
        input.backtests.map((row) => row.k),
        input.backtests.map((row) => row.n_test),
        input.backtests.map((row) => row.predicted_late),
        input.backtests.map((row) => row.actual_late),
        input.backtests.map((row) => row.deviation),
        input.backtests.map((row) => row.ci_low),
        input.backtests.map((row) => row.ci_high),
        input.backtests.map((row) => row.status),
        input.backtests.map((row) => row.significantly_above_target),
      ],
    );

    await client.query(
      `INSERT INTO dss.review_bucket
       SELECT $1, *
         FROM unnest(
           $2::text[], $3::int[], $4::int[], $5::int[], $6::numeric[]
         )`,
      [
        runId,
        input.buckets.map((row) => row.bucket_label),
        input.buckets.map((row) => row.delay_min),
        input.buckets.map((row) => row.delay_max),
        input.buckets.map((row) => row.n_reviewed),
        input.buckets.map((row) => row.mean_score),
      ],
    );

    await client.query(
      `INSERT INTO dss.delivery_policy_eval (
         run_id, policy, late_rate, promised_days_avg, n_segments_scored,
         n_segments_met, pct_orders_in_met, worst_segment, worst_late_rate
       )
       SELECT $1, *
         FROM unnest(
           $2::text[], $3::numeric[], $4::numeric[], $5::int[], $6::int[],
           $7::numeric[], $8::text[], $9::numeric[]
         )`,
      [
        runId,
        input.evaluationSummaries.map((row) => row.policy),
        input.evaluationSummaries.map((row) => row.late_rate),
        input.evaluationSummaries.map((row) => row.promised_days_avg),
        input.evaluationSummaries.map((row) => row.n_segments_scored),
        input.evaluationSummaries.map((row) => row.n_segments_met),
        input.evaluationSummaries.map((row) => row.pct_orders_in_met),
        input.evaluationSummaries.map((row) => row.worst_segment),
        input.evaluationSummaries.map((row) => row.worst_late_rate),
      ],
    );

    await client.query(
      `INSERT INTO dss.delivery_policy_eval_segment (
         run_id, policy, segment, k, n_test, late_rate_test, ci_low, ci_high,
         status, significantly_above_target
       )
       SELECT $1, *
         FROM unnest(
           $2::text[], $3::text[], $4::smallint[], $5::int[], $6::numeric[],
           $7::numeric[], $8::numeric[], $9::text[], $10::boolean[]
         )`,
      [
        runId,
        input.evaluationRows.map((row) => row.policy),
        input.evaluationRows.map((row) => row.segment),
        input.evaluationRows.map((row) => row.k),
        input.evaluationRows.map((row) => row.n_test),
        input.evaluationRows.map((row) => row.late_rate_test),
        input.evaluationRows.map((row) => row.ci_low),
        input.evaluationRows.map((row) => row.ci_high),
        input.evaluationRows.map((row) => row.status),
        input.evaluationRows.map((row) => row.significantly_above_target),
      ],
    );

    await client.query('COMMIT');
    return runId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function activateRun(runId: number): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('UPDATE dss.delivery_run SET is_active = FALSE WHERE is_active');
    await client.query('UPDATE dss.delivery_run SET is_active = TRUE WHERE run_id = $1', [runId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function clearActiveRun(): Promise<void> {
  await pool.query('UPDATE dss.delivery_run SET is_active = FALSE WHERE is_active');
}

export async function fetchDeliveryBufferData(runId?: number): Promise<DeliveryRunData | null> {
  const runResult = await pool.query(
    `SELECT run_id, created_at, params, train_start::text, split_date::text,
            test_end::text, n_train, n_test, safety_margin
       FROM dss.delivery_run
      WHERE run_id = COALESCE(
        $1,
        (SELECT run_id FROM dss.delivery_run WHERE is_active ORDER BY run_id DESC LIMIT 1)
      )`,
    [runId ?? null],
  );
  const run = runResult.rows[0];
  if (!run) return null;

  const [curveResult, policyResult, bucketResult] = await Promise.all([
    pool.query(
      `SELECT segment, k, promised_days_avg, late_rate_train, late_rate_test,
              expected_review, n_train, n_test
         FROM dss.delivery_curve
        WHERE run_id = $1
        ORDER BY segment, k`,
      [run.run_id],
    ),
    pool.query(
      `SELECT segment, k_recommended, fallback, attainable
         FROM dss.delivery_policy
        WHERE run_id = $1
        ORDER BY segment`,
      [run.run_id],
    ),
    pool.query(
      `SELECT bucket_label, delay_min, delay_max, n_reviewed, mean_score
         FROM dss.review_bucket
        WHERE run_id = $1
        ORDER BY delay_min NULLS FIRST`,
      [run.run_id],
    ),
  ]);

  return {
    run,
    curves: curveResult.rows.map((row) => ({
      segment: String(row.segment),
      k: Number(row.k),
      promised_days_avg: row.promised_days_avg === null ? null : Number(row.promised_days_avg),
      late_rate_train: Number(row.late_rate_train),
      late_rate_test: row.late_rate_test === null ? null : Number(row.late_rate_test),
      expected_review: row.expected_review === null ? null : Number(row.expected_review),
      n_train: Number(row.n_train),
      n_test: Number(row.n_test),
    })),
    policies: policyResult.rows.map((row) => ({
      segment: String(row.segment),
      k_recommended: Number(row.k_recommended),
      fallback: Boolean(row.fallback),
      attainable: Boolean(row.attainable),
    })),
    buckets: bucketResult.rows.map((row) => ({
      bucket_label: String(row.bucket_label),
      delay_min: row.delay_min === null ? null : Number(row.delay_min),
      delay_max: row.delay_max === null ? null : Number(row.delay_max),
      n_reviewed: Number(row.n_reviewed),
      mean_score: Number(row.mean_score),
    })),
  };
}

export async function fetchTradeoff(params: {
  splitDate?: string;
  testEnd?: string;
}): Promise<Record<string, unknown>[] | null> {
  const activeResult = await pool.query(
    `SELECT split_date::text, test_end::text
       FROM dss.delivery_run
      WHERE is_active
      ORDER BY run_id DESC
      LIMIT 1`,
  );
  const activeRun = activeResult.rows[0];
  if (!activeRun && (!params.splitDate || !params.testEnd)) return null;

  const splitDate = params.splitDate ?? String(activeRun.split_date);
  const testEnd = params.testEnd ?? String(activeRun.test_end);
  const { rows } = await pool.query(
    `SELECT latest.run_id,
            latest.split_date,
            latest.test_end,
            latest.safety_margin,
            latest.late_rate,
            latest.promised_days_avg,
            latest.n_segments_scored,
            latest.n_segments_met,
            latest.pct_orders_in_met,
            latest.worst_segment,
            latest.worst_late_rate
       FROM (
         SELECT DISTINCT ON (run.safety_margin)
                run.run_id,
                run.split_date::text AS split_date,
                run.test_end::text AS test_end,
                run.safety_margin,
                evaluation.late_rate,
                evaluation.promised_days_avg,
                evaluation.n_segments_scored,
                evaluation.n_segments_met,
                evaluation.pct_orders_in_met,
                evaluation.worst_segment,
                evaluation.worst_late_rate
           FROM dss.delivery_run AS run
           JOIN dss.delivery_policy_eval AS evaluation
             ON evaluation.run_id = run.run_id
            AND evaluation.policy = 'state_k'
          WHERE run.split_date = $1::date
            AND run.test_end = $2::date
          ORDER BY run.safety_margin, run.run_id DESC
       ) AS latest
      ORDER BY latest.safety_margin, latest.run_id`,
    [splitDate, testEnd],
  );

  if (rows.length === 0) return null;

  return rows.map((row) => ({
    run_id: Number(row.run_id),
    split_date: String(row.split_date),
    test_end: String(row.test_end),
    safety_margin: Number(row.safety_margin),
    late_rate: Number(row.late_rate),
    promised_days_avg: Number(row.promised_days_avg),
    n_segments_scored: Number(row.n_segments_scored),
    n_segments_met: Number(row.n_segments_met),
    pct_orders_in_met: row.pct_orders_in_met === null ? null : Number(row.pct_orders_in_met),
    worst_segment: row.worst_segment,
    worst_late_rate: row.worst_late_rate === null ? null : Number(row.worst_late_rate),
  }));
}
