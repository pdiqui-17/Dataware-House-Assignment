import { rollUp } from '../repository/sale.repo.js';
import type { AnalysisData, AnalysisParams, AnalysisServiceResult } from '../types/sale.js';

// {
//   "dim": "time",
//   "levels": ["year", "quarter", "month"],
//   "data": [
//     { "level": 3, "level_name": "month",   "keys": {"year":2017,"quarter":1,"month":1}, "total_price": 111798.3, "n_orders": 748, ... },
//     { "level": 3, "level_name": "month",   "keys": {"year":2017,"quarter":1,"month":2}, ... },
//     { "level": 2, "level_name": "quarter", "keys": {"year":2017,"quarter":1}, ... },
//     { "level": 1, "level_name": "year",    "keys": {"year":2017}, ... },
//     { "level": 0, "level_name": "grand_total", "keys": {}, ... }
//   ]
// } ==> this is sample payload

export const rollUpSerivce = async (filter: AnalysisParams): Promise<AnalysisServiceResult> => {
  const { rows, levels } = await rollUp(filter);

  const data: AnalysisData[] = rows.map((r) => {
    // mức = số cột chưa bị gộp (g = 0); 0 nghĩa là tổng cộng
    const level = levels.filter((_, i) => r[`g${i + 1}`] === 0).length;
    const keys: AnalysisData['keys'] = {};

    levels.forEach((l, i) => {
      const value = r[`l${i + 1}`];
      if (r[`g${i + 1}`] === 0 && value !== undefined) {
        keys[l.name] = value;
      }
    });

    return {
      level,
      level_name: level === 0 ? 'grand_total' : (levels[level - 1]?.name ?? 'grand_total'),
      keys,
      total_price: r.total_price,
      total_freight: r.total_freight,
      n_orders: r.n_orders,
      n_items: r.n_items,
    };
  });

  return { dim: filter.dim, levels: levels.map((l) => l.name), data };
};
