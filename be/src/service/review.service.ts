import { reviewByDelay } from '../repository/review.repo.js';
import { ReviewGroup, type ReviewByDelayParams } from '../types/review.js';

const labels: Record<ReviewGroup, Record<string, string>> = {
  [ReviewGroup.BUCKET]: {
    early_8plus: 'Sớm từ 8 ngày',
    early_1_7: 'Sớm 1-7 ngày',
    on_time: 'Đúng ngày dự kiến',
    late_1_3: 'Trễ 1-3 ngày',
    late_4_7: 'Trễ 4-7 ngày',
    late_8plus: 'Trễ từ 8 ngày',
  },
  [ReviewGroup.FLAG]: {
    not_late: 'Không trễ',
    late: 'Trễ',
  },
};

export const reviewByDelayService = async (params: ReviewByDelayParams) => {
  const result = await reviewByDelay(params);
  const group = params.group ?? ReviewGroup.BUCKET;

  return {
    meta: {
      group,
      filters: {
        ...(params.from ? { from: params.from } : {}),
        ...(params.to ? { to: params.to } : {}),
        ...(params.state ? { state: params.state } : {}),
      },
      ...(group === ReviewGroup.BUCKET
        ? {
            total_orders: result.summary.total_orders,
            orders_with_review: result.summary.orders_with_review,
            orders_without_review: result.summary.orders_without_review,
          }
        : {
            p0: result.summary.p0,
            avg_late: result.summary.avg_late,
            avg_ok: result.summary.avg_ok,
          }),
    },
    data: result.rows.map((row) => ({
      ...row,
      label: labels[group][row.group] ?? row.group,
    })),
  };
};
