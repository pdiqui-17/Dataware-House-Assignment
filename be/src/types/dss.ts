export const CRITERIA = ['gmv', 'late_rate', 'low_review_rate'] as const;
export type Criterion = (typeof CRITERIA)[number]; // why ?

export type RuleLabel = 'Retain' | 'Improve' | 'Watch' | 'Review';
export type DisplayLabel =
  | RuleLabel
  | 'Insufficient data'
  | 'Insufficient data - high GMV';

export const ALL_LABELS: DisplayLabel[] = [
  'Retain',
  'Improve',
  'Watch',
  'Review',
  'Insufficient data',
  'Insufficient data - high GMV',
];

/** Một dòng của dw.v_seller_metrics (đã ép NUMERIC/BIGINT từ string sang number). */
export interface SellerMetrics {
  seller_id: string;
  seller_city: string | null;
  seller_state: string | null;
  n_orders: number;
  gmv: number;
  freight: number;
  n_eligible: number;
  n_late: number;
  late_rate: number | null;
  low_review_rate: number | null;
  avg_delivery_days: number | null;
}

export interface WeightConfig {
  criterion: Criterion;
  weight: number;
  direction: 'higher' | 'lower';
}

export interface Rule {
  rule_id: number;
  priority: number;
  label: RuleLabel;
  min_score: number | null;
  max_score: number | null;
  min_gmv_pct: number | null;
  min_late_rate: number | null;
  max_late_rate: number | null;
  min_low_review_rate: number | null;
  max_low_review_rate: number | null;
  action_text: string;
}

export interface Settings {
  min_eligible_orders: number;
  big_unreliable_gmv: number;
}

export interface ScoredSeller extends SellerMetrics {
  rank: number | null;
  score: number | null;
  gmv_pct: number | null;
  parts: Record<Criterion, number> | null;
  label: DisplayLabel;
  action: string | null;
  /** freight / gmv, chỉ để hiển thị, không tham gia chấm điểm */
  freight_ratio: number | null;
}

export interface SellerScorecardParams {
  state?: string;
  limit: number;
  weights?: string;
}

export interface DssConfig {
  weights: WeightConfig[];
  rules: Rule[];
  settings: Settings;
}