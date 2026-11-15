import { pool } from '../config/db.config.js';
import { hierarchies } from '../config/hierarchies.config.js';
import { sales } from '../cube/sales.js';
import { buildQuery } from '../engine/buildQuery.js';
import type { AnalysisParams, AnalysisResult } from '../types/sale.js';

export const rollUp = async ({
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
  const query = buildQuery(sales, {
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

  return { rows, levels: hierarchies[dim].slice(0, depth) };
};
