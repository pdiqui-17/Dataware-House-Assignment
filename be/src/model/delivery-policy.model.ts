export interface OrderRow {
  customer_state: string;
  purchase_date: string;
  estimated_days: number;
  delay_days: number;
  avg_review_score: number | null;
}

export interface ReviewBucket {
  bucket_label: string;
  delay_min: number | null;
  delay_max: number | null;
  n_reviewed: number;
  mean_score: number;
}

export interface DeliveryCurveRow {
  segment: string;
  k: number;
  promised_days_avg: number | null;
  late_rate_train: number;
  late_rate_test: number | null;
  expected_review: number | null;
  n_train: number;
  n_test: number;
}

export type DeliveryPolicyName = 'current_k0' | 'global_k' | 'state_k';
export type DeliveryPolicyStatus = 'met' | 'missed' | 'low_power';

export interface PolicyEvaluationParams {
  targetLateRate: number;
  minSegmentNTest: number;
  kGlobal: number;
  kState: Record<string, number>;
}

export interface PolicyEvaluationRow {
  policy: DeliveryPolicyName;
  segment: string;
  k: number;
  n_test: number;
  late_rate_test: number;
  ci_low: number | null;
  ci_high: number | null;
  status: DeliveryPolicyStatus;
  significantly_above_target: boolean;
}

export interface PolicyEvaluationSummary {
  policy: DeliveryPolicyName;
  late_rate: number;
  promised_days_avg: number;
  n_segments_scored: number;
  n_segments_met: number;
  pct_orders_in_met: number | null;
  worst_segment: string | null;
  worst_late_rate: number | null;
}

export const lateRate = (delays: number[], k: number): number =>
  delays.length === 0 ? 0 : delays.filter((delay) => delay > k).length / delays.length;

export const wilsonInterval = (
  events: number,
  n: number,
  z = 1.959963984540054,
): [number, number] => {
  if (n <= 0) return [0, 0];

  const proportion = events / n;
  const zSquared = z * z;
  const denominator = 1 + zSquared / n;
  const center = (proportion + zSquared / (2 * n)) / denominator;
  const halfWidth =
    (z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * n)) / n)) / denominator;

  return [Math.max(0, center - halfWidth), Math.min(1, center + halfWidth)];
};

interface BucketRange {
  label: string;
  min: number | null;
  max: number | null;
}

const labelRanges = (edges: number[]): BucketRange[] => {
  const ranges: BucketRange[] = [{ label: `le_${edges[0]}`, min: null, max: edges[0] ?? null }];

  for (let i = 1; i < edges.length; i += 1) {
    const lower = edges[i - 1] ?? 0;
    const upper = edges[i] ?? 0;
    ranges.push({ label: `${lower + 1}_${upper}`, min: lower, max: upper });
  }

  ranges.push({ label: `gt_${edges.at(-1)}`, min: edges.at(-1) ?? null, max: null });
  return ranges;
};

export function buildReviewBuckets(
  rows: OrderRow[],
  edges: number[],
  minN: number,
): ReviewBucket[] {
  const ranges = labelRanges(edges);
  const groups = ranges.map((range) => ({ ...range, scores: [] as number[] }));

  for (const row of rows) {
    if (row.avg_review_score === null) continue;

    const index = ranges.findIndex((range, i) => {
      if (i === 0) return row.delay_days <= (range.max ?? Infinity);
      if (i === ranges.length - 1) return row.delay_days > (range.min ?? -Infinity);
      return row.delay_days > (range.min ?? -Infinity) && row.delay_days <= (range.max ?? Infinity);
    });

    groups[Math.max(0, index)]?.scores.push(row.avg_review_score);
  }

  for (let i = 0; i < groups.length; i += 1) {
    while (groups.length > 1 && (groups[i]?.scores.length ?? 0) < minN) {
      const target = i > 0 ? i - 1 : 1;
      const source = groups[i];
      const adjacent = groups[target];
      if (!source || !adjacent) break;

      adjacent.scores.push(...source.scores);
      adjacent.min =
        source.min === null || adjacent.min === null ? null : Math.min(source.min, adjacent.min);
      adjacent.max =
        source.max === null || adjacent.max === null ? null : Math.max(source.max, adjacent.max);
      groups.splice(i, 1);

      if (target < i) i -= 1;
      else i = Math.max(-1, i - 1);
    }
  }

  return groups.map((group) => ({
    bucket_label: group.label,
    delay_min: group.min,
    delay_max: group.max,
    n_reviewed: group.scores.length,
    mean_score:
      group.scores.length === 0
        ? 0
        : group.scores.reduce((sum, score) => sum + score, 0) / group.scores.length,
  }));
}

export const reviewForDelay = (delay: number, buckets: ReviewBucket[]): number => {
  const bucket = buckets.find(
    (candidate) =>
      (candidate.delay_min === null || delay > candidate.delay_min) &&
      (candidate.delay_max === null || delay <= candidate.delay_max),
  );

  return bucket?.mean_score ?? 0;
};

export function learnK(
  delays: number[],
  target: number,
  kMin: number,
  kMax: number,
  reviews?: number[],
  buckets?: ReviewBucket[],
  maxReviewDrop: number | null = null,
) {
  const reviewAt = (k: number): number | null => {
    if (delays.length === 0 || !reviews || !buckets) return null;

    return (
      delays.reduce((sum, delay, i) => {
        const hasReview = reviews[i] !== null && reviews[i] !== undefined;
        return sum + (hasReview ? reviewForDelay(delay - k, buckets) : 0);
      }, 0) / delays.length
    );
  };

  const baselineReview = reviewAt(0);

  for (let k = kMin; k <= kMax; k += 1) {
    if (lateRate(delays, k) > target) continue;

    const expectedReview = reviewAt(k);
    if (
      maxReviewDrop !== null &&
      baselineReview !== null &&
      expectedReview !== null &&
      expectedReview < baselineReview - maxReviewDrop
    )
      continue;

    return { k, attainable: true, lateRate: lateRate(delays, k) };
  }

  return { k: kMax, attainable: false, lateRate: lateRate(delays, kMax) };
}

export function recommendFromCurve(
  rows: DeliveryCurveRow[],
  target: number,
  kMin: number,
  kMax: number,
  maxReviewDrop: number | null,
) {
  const ordered = rows.filter((row) => row.k >= kMin && row.k <= kMax).sort((a, b) => a.k - b.k);
  const baselineReview = ordered.find((row) => row.k === 0)?.expected_review ?? null;

  const recommended = ordered.find((row) => {
    if (row.late_rate_train > target) return false;
    if (maxReviewDrop === null || baselineReview === null) return true;
    if (row.expected_review === null) return false;
    return row.expected_review >= baselineReview - maxReviewDrop;
  });

  return recommended ? { k: recommended.k, attainable: true } : { k: kMax, attainable: false };
}

export function evaluatePolicies(
  curveRows: DeliveryCurveRow[],
  params: PolicyEvaluationParams,
): { rows: PolicyEvaluationRow[]; summaries: PolicyEvaluationSummary[] } {
  const stateSegments = [...new Set(curveRows.map((row) => row.segment))]
    .filter((segment) => segment !== 'ALL')
    .sort((a, b) => a.localeCompare(b));
  const policies: DeliveryPolicyName[] = ['current_k0', 'global_k', 'state_k'];
  const rows: PolicyEvaluationRow[] = [];

  for (const policy of policies) {
    for (const segment of stateSegments) {
      const k =
        policy === 'current_k0'
          ? 0
          : policy === 'global_k'
            ? params.kGlobal
            : (params.kState[segment] ?? params.kGlobal);
      const curveRow = curveRows.find((row) => row.segment === segment && row.k === k);

      if (!curveRow) continue;

      const lateRateTest = curveRow.late_rate_test ?? 0;
      const lateCount = Math.round(lateRateTest * curveRow.n_test);
      const [ciLow, ciHigh] = wilsonInterval(lateCount, curveRow.n_test);
      const status: DeliveryPolicyStatus =
        curveRow.n_test < params.minSegmentNTest
          ? 'low_power'
          : lateRateTest <= params.targetLateRate
            ? 'met'
            : 'missed';

      rows.push({
        policy,
        segment,
        k,
        n_test: curveRow.n_test,
        late_rate_test: lateRateTest,
        ci_low: curveRow.n_test > 0 ? ciLow : null,
        ci_high: curveRow.n_test > 0 ? ciHigh : null,
        status,
        significantly_above_target: ciLow > params.targetLateRate,
      });
    }
  }

  const summaries = policies.map((policy) => {
    const policyRows = rows.filter((row) => row.policy === policy);
    const scoredRows = policyRows.filter((row) => row.status !== 'low_power');
    const totalTest = policyRows.reduce((sum, row) => sum + row.n_test, 0);
    const totalScoredTest = scoredRows.reduce((sum, row) => sum + row.n_test, 0);
    const lateCount = policyRows.reduce((sum, row) => sum + row.late_rate_test * row.n_test, 0);
    const promisedDays = policyRows.reduce((sum, row) => {
      const curveRow = curveRows.find(
        (candidate) => candidate.segment === row.segment && candidate.k === row.k,
      );
      return sum + (curveRow?.promised_days_avg ?? 0) * row.n_test;
    }, 0);
    const metRows = scoredRows.filter((row) => row.status === 'met');
    const worstRow = [...scoredRows].sort(
      (a, b) => b.late_rate_test - a.late_rate_test || a.segment.localeCompare(b.segment),
    )[0];

    return {
      policy,
      late_rate: totalTest > 0 ? lateCount / totalTest : 0,
      promised_days_avg: totalTest > 0 ? promisedDays / totalTest : 0,
      n_segments_scored: scoredRows.length,
      n_segments_met: metRows.length,
      pct_orders_in_met:
        totalScoredTest > 0
          ? metRows.reduce((sum, row) => sum + row.n_test, 0) / totalScoredTest
          : null,
      worst_segment: worstRow?.segment ?? null,
      worst_late_rate: worstRow?.late_rate_test ?? null,
    };
  });

  return { rows, summaries };
}

export const isReviewMonotone = (buckets: ReviewBucket[]): boolean =>
  buckets.every(
    (bucket, i) => i === 0 || (buckets[i - 1]?.mean_score ?? Infinity) >= bucket.mean_score,
  );
