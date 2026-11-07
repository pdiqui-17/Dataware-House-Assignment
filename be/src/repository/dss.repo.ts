import { pool } from "../config/db.config.js";
import { Criterion, SellerMetrics, WeightConfig, Settings, Rule } from "../types/dss.js";


const num = (v : unknown) : number | null => v === null || v === undefined ? null : Number(v);

const numReq = (v: unknown): number => Number(v);

export const fetchSellerMetrics = async (state?: string): Promise<SellerMetrics[]> => {
  const values: string[] = [];
  const stateFilter = state === undefined ? '' : ' WHERE seller_state = $1';
  if (state !== undefined) values.push(state);

  const { rows } = await pool.query(
    `SELECT seller_id, seller_city, seller_state,
            n_orders, gmv, freight, n_eligible, n_late,
            late_rate, low_review_rate, avg_delivery_days
          FROM dw.v_seller_metrics${stateFilter}`,
    values,
  );

  return rows.map((r) => ({
    seller_id: r.seller_id,
    seller_city: r.seller_city,
    seller_state: r.seller_state,
    n_orders: numReq(r.n_orders),
    gmv: numReq(r.gmv),
    freight: numReq(r.freight),
    n_eligible: numReq(r.n_eligible),
    n_late: numReq(r.n_late),
    late_rate: num(r.late_rate),
    low_review_rate: num(r.low_review_rate),
    avg_delivery_days: num(r.avg_delivery_days),
  }));
};


export const fetchWeights = async (): Promise<WeightConfig[]> =>
{
    const {rows} = await pool.query(
      `SELECT criterion, weight, direction FROM dss.scoring_weights`,
    );

    return rows.map((r) => (
      {
        criterion : r.criterion as Criterion,
        weight: numReq(r.weight),
        direction: r.direction,
      }
    ))
}

export async function fetchRules(): Promise<Rule[]> {
  const { rows } = await pool.query(
    `SELECT * FROM dss.decision_rules WHERE is_active ORDER BY priority`,
  );
  return rows.map((r) => ({
    rule_id: r.rule_id,
    priority: r.priority,
    label: r.label,
    min_score: num(r.min_score),
    max_score: num(r.max_score),
    min_gmv_pct: num(r.min_gmv_pct),
    min_late_rate: num(r.min_late_rate),
    max_late_rate: num(r.max_late_rate),
    min_low_review_rate: num(r.min_low_review_rate),
    max_low_review_rate: num(r.max_low_review_rate),
    action_text: r.action_text,
  }));
}
 
export async function fetchSettings(): Promise<Settings> {
  const { rows } = await pool.query(`SELECT setting_key, setting_value FROM dss.settings`);
  const map = new Map<string, number>(rows.map((r) => [r.setting_key, numReq(r.setting_value)]));
  return {
    min_eligible_orders: map.get('min_eligible_orders') ?? 30,
    big_unreliable_gmv: map.get('big_unreliable_gmv') ?? 8168,
  };
}