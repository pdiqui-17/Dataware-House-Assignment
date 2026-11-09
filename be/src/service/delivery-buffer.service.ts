import { defaultConfig, type DeliveryPolicyConfig } from '../config/delivery-policy.config.js';
import {
  evaluatePolicies,
  isReviewMonotone,
  recommendFromCurve,
  type DeliveryCurveRow,
  type DeliveryPolicyName,
  type PolicyEvaluationRow,
} from '../model/delivery-policy.model.js';
import { fetchDeliveryBufferData, fetchTradeoff } from '../repository/delivery-policy.repo.js';

const ASSUMPTIONS = [
  'Hành vi seller không đổi khi cam kết đổi.',
  'Không mô hình hóa việc khách bỏ đơn vì cam kết dài hơn.',
  'Liên hệ giữa độ trễ và điểm review chỉ là tương quan.',
  'Chỉ gồm đơn đã giao; đơn chưa giao bị loại có thể làm tỷ lệ trễ bị ước lượng thấp.',
  'Kết quả nhạy với giai đoạn có tỷ lệ trễ đột biến (2018-02 đến 03); cần học lại định kỳ.',
];

export class DeliveryBufferRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryBufferRangeError';
  }
}

const curveAt = (rows: DeliveryCurveRow[], segment: string, k: number) =>
  rows.find((row) => row.segment === segment && row.k === k);

const evaluationAt = (rows: PolicyEvaluationRow[], policy: DeliveryPolicyName, segment: string) =>
  rows.find((row) => row.policy === policy && row.segment === segment);

const shapePolicy = (
  curve: DeliveryCurveRow | undefined,
  evaluation: PolicyEvaluationRow | undefined,
) => {
  if (!curve || !evaluation) return null;

  return {
    k: evaluation.k,
    promised_days: curve.promised_days_avg,
    late_rate_test: evaluation.late_rate_test,
    status: evaluation.status,
    significantly_above_target: evaluation.significantly_above_target,
    ci: [evaluation.ci_low, evaluation.ci_high],
    n_test: evaluation.n_test,
  };
};

export async function deliveryBufferService(params: {
  state?: string;
  runId?: number;
  target: number;
  kMin: number;
  kMax: number;
}) {
  const result = await fetchDeliveryBufferData(params.runId);
  if (!result) return null;

  const { run, curves, policies, buckets } = result;
  const availableKs = curves.map((row) => row.k);
  const availableMin = Math.min(...availableKs);
  const availableMax = Math.max(...availableKs);

  if (params.kMin < availableMin || params.kMax > availableMax) {
    throw new DeliveryBufferRangeError(
      `k_min and k_max must be within the calculated range ${availableMin}..${availableMax}`,
    );
  }

  const runParams = run.params as Partial<DeliveryPolicyConfig>;
  const safetyMargin = Number(run.safety_margin ?? runParams.safetyMargin ?? 0);
  const targetUsed = params.target - safetyMargin;
  const maxReviewDrop = runParams.maxReviewDrop ?? null;
  const segments = [...new Set(curves.map((row) => row.segment))]
    .filter((segment) => segment !== 'ALL')
    .sort((a, b) => a.localeCompare(b));
  const policyBySegment = new Map(policies.map((policy) => [policy.segment, policy]));
  const allModel = recommendFromCurve(
    curves.filter((row) => row.segment === 'ALL'),
    targetUsed,
    params.kMin,
    params.kMax,
    maxReviewDrop,
  );
  const kState: Record<string, number> = {};
  const stateModel = new Map<string, { k: number; attainable: boolean; fallback: boolean }>();

  for (const segment of segments) {
    const configuredPolicy = policyBySegment.get(segment);
    const fallback = configuredPolicy?.fallback ?? true;
    const learned = fallback
      ? allModel
      : recommendFromCurve(
          curves.filter((row) => row.segment === segment),
          targetUsed,
          params.kMin,
          params.kMax,
          maxReviewDrop,
        );

    kState[segment] = learned.k;
    stateModel.set(segment, { ...learned, fallback });
  }

  const evaluation = evaluatePolicies(curves, {
    targetLateRate: params.target,
    minSegmentNTest: Number(runParams.minSegmentNTest ?? defaultConfig.minSegmentNTest),
    kGlobal: allModel.k,
    kState,
  });
  const assumptions = [
    ...ASSUMPTIONS,
    ...(!isReviewMonotone(buckets)
      ? ['Điểm review theo nhóm độ trễ không giảm đơn điệu trên tập train.']
      : []),
  ];
  const metadata = {
    run_id: Number(run.run_id),
    target_late_rate: params.target,
    safety_margin: safetyMargin,
    learn_period: [String(run.train_start ?? ''), previousDate(String(run.split_date))],
    test_period: [String(run.split_date), String(run.test_end)],
    n_train: Number(run.n_train),
    n_test: Number(run.n_test),
    assumptions,
  };

  if (params.state) {
    const stateCurve = curves.filter((row) => row.segment === params.state);
    const learned = stateModel.get(params.state);
    if (!learned || stateCurve.length === 0) return null;

    const displayedCurve = stateCurve
      .filter((row) => row.k >= params.kMin && row.k <= params.kMax)
      .sort((a, b) => a.k - b.k)
      .map((row) => ({
        k: row.k,
        promised_days: row.promised_days_avg,
        late_rate_train: row.late_rate_train,
        late_rate_test: row.late_rate_test,
        expected_review: row.expected_review,
      }));
    const current = curveAt(stateCurve, params.state, 0);
    const recommended = curveAt(stateCurve, params.state, learned.k);
    const global = curveAt(stateCurve, params.state, allModel.k);

    return {
      data: {
        segment: {
          customer_state: params.state,
          fallback: learned.fallback,
          attainable: learned.attainable,
        },
        current: current
          ? {
              k: 0,
              promised_days: current.promised_days_avg,
              late_rate_test: current.late_rate_test,
              status:
                evaluationAt(evaluation.rows, 'current_k0', params.state)?.status ?? 'low_power',
            }
          : null,
        recommended: shapePolicy(
          recommended,
          evaluationAt(evaluation.rows, 'state_k', params.state),
        )
          ? {
              ...shapePolicy(recommended, evaluationAt(evaluation.rows, 'state_k', params.state)),
              late_rate_train: recommended?.late_rate_train,
              expected_review: recommended?.expected_review,
            }
          : null,
        global_comparison: global
          ? {
              k: allModel.k,
              late_rate_test: global.late_rate_test,
              status:
                evaluationAt(evaluation.rows, 'global_k', params.state)?.status ?? 'low_power',
            }
          : null,
        curve: displayedCurve,
      },
      meta: metadata,
    };
  }

  const summaries = Object.fromEntries(
    evaluation.summaries.map((summary) => [summary.policy, summary]),
  );
  const segmentRows = segments.map((segment) => {
    const statePolicy = stateModel.get(segment)!;
    const nTest = curveAt(curves, segment, 0)?.n_test ?? 0;

    return {
      segment,
      n_test: nTest,
      fallback: statePolicy.fallback,
      state_k: evaluationAt(evaluation.rows, 'state_k', segment),
      global_k: evaluationAt(evaluation.rows, 'global_k', segment),
      current_k0: evaluationAt(evaluation.rows, 'current_k0', segment),
    };
  });

  return {
    data: { summary: summaries, segments: segmentRows },
    meta: metadata,
  };
}

export async function deliveryBufferTradeoffService(params: {
  splitDate?: string;
  testEnd?: string;
}) {
  const data = await fetchTradeoff(params);
  if (!data) return null;
  const firstRow = data[0];

  return {
    data,
    meta: {
      assumptions: ASSUMPTIONS,
      split_date: firstRow?.split_date,
      test_end: firstRow?.test_end,
    },
  };
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}
