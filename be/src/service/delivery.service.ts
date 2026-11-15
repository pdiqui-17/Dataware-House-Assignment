import { deliveryAnalysis, deliveryDistribution } from '../repository/delivery.repo.js';
import type {
  AnalysisData,
  AnalysisParams,
  AnalysisServiceResult,
  DistributionBucket,
  DistributionServiceResult,
} from '../types/delivery.js';
import { DELIVERY_DELAY_BUCKETS } from '../model/pivot.model.js';

export const deliveryAnalysisService = async (
  filter: AnalysisParams,
): Promise<AnalysisServiceResult> => {
  const { rows, levels } = await deliveryAnalysis(filter);

  const data: AnalysisData[] = rows.map((row) => {
    const level = levels.filter((_, index) => row[`g${index + 1}`] === 0).length;
    const keys: AnalysisData['keys'] = {};

    levels.forEach((levelDefinition, index) => {
      const value = row[`l${index + 1}`];
      if (row[`g${index + 1}`] === 0 && value !== undefined) {
        keys[levelDefinition.name] = value;
      }
    });

    return {
      level,
      level_name: level === 0 ? 'grand_total' : (levels[level - 1]?.name ?? 'grand_total'),
      keys,
      measures: {
        eligible_orders: row.eligible_orders,
        late_orders: row.late_orders,
        late_rate: row.late_rate,
        avg_delivery_days: row.avg_delivery_days,
        avg_delay_days: row.avg_delay_days,
      },
    };
  });

  return { dim: filter.dim, levels: levels.map((level) => level.name), data };
};

export const deliveryDistributionService = async (
  filter: AnalysisParams,
): Promise<DistributionServiceResult> => {
  const { rows } = await deliveryDistribution(filter);
  const buckets: DistributionBucket[] = DELIVERY_DELAY_BUCKETS.map((bucket) => ({ ...bucket }));
  const bucketIndex = 1;
  const counts = new Map(
    rows.flatMap((row) => {
      const bucket = row[`l${bucketIndex}`];
      return typeof bucket === 'string' ? [[bucket, row.n_orders] as const] : [];
    }),
  );
  const total = buckets.reduce((sum, bucket) => sum + (counts.get(bucket.key) ?? 0), 0);
  const data = buckets.map((bucket) => {
    const nOrders = counts.get(bucket.key) ?? 0;
    return {
      bucket: bucket.key,
      label: bucket.label,
      side: bucket.side,
      n_orders: nOrders,
      pct: total === 0 ? 0 : Number(((nOrders * 100) / total).toFixed(2)),
    };
  });
  const earlyOrders = data
    .filter((bucket) => bucket.side === 'early')
    .reduce((sum, bucket) => sum + bucket.n_orders, 0);
  const onTimeOrders = data.find((bucket) => bucket.side === 'on_time')?.n_orders ?? 0;
  const lateOrders = data
    .filter((bucket) => bucket.side === 'late')
    .reduce((sum, bucket) => sum + bucket.n_orders, 0);

  return {
    meta: {
      cube: 'delivery',
      metric: 'delay_days',
      basis: 'eligible_orders',
      total,
      filters: {
        ...(filter.from === undefined ? {} : { from: filter.from }),
        ...(filter.to === undefined ? {} : { to: filter.to }),
        ...(filter.year === undefined ? {} : { year: filter.year }),
        ...(filter.quarter === undefined ? {} : { quarter: filter.quarter }),
        ...(filter.month === undefined ? {} : { month: filter.month }),
        ...(filter.state === undefined ? {} : { state: filter.state }),
        ...(filter.city === undefined ? {} : { city: filter.city }),
      },
      buckets,
      notes: ['Chỉ tính đơn đủ điều kiện (delivered, có đủ timestamp).'],
    },
    summary: {
      early_orders: earlyOrders,
      on_time_orders: onTimeOrders,
      late_orders: lateOrders,
      late_rate: total === 0 ? 0 : Number(((lateOrders * 100) / total).toFixed(2)),
    },
    data,
  };
};
