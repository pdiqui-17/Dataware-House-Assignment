import { pool } from '../config/db.config.js';

import { delivery, deliverDistribution } from '../cube/delivery.js';
import { buildQuery } from '../engine/buildQuery.js';
import type {
  AnalysisParams,
  AnalysisResult,
  DistributionResult,
  DistributionRow,
} from '../types/delivery.js';

export const deliveryAnalysis = async ({
  dim,
  depth,
  from,
  to,
  state,
  category,
  status,
  year,
  quarter,
  month,
  city,
}: AnalysisParams): Promise<AnalysisResult> => {
  const query = buildQuery(delivery, {
    dim,
    depth,
    filters: {
      from,
      to,
      year,
      quarter,
      month,
      state,
      city,
      category,
      status: status?.join(','),
    },
  });

  const { rows } = await pool.query<AnalysisResult['rows'][number]>(query.text, query.values);

  return { rows, levels: query.levels };
};

export const deliveryDistribution = async ({
  dim,
  depth,
  from,
  to,
  state,
  category,
  status,
  year,
  quarter,
  month,
  city,
}: AnalysisParams): Promise<DistributionResult> => {
  const query = buildQuery(deliverDistribution, {
    dim,
    depth,
    includeHierarchy: false,
    filters: {
      from,
      to,
      year,
      quarter,
      month,
      state,
      city,
      category,
      status: status?.join(','),
    },
  });

  const { rows } = await pool.query<DistributionRow>(query.text, query.values);

  return { rows, levels: query.levels };
};
