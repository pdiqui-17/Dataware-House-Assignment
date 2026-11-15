
import { Criterion, SellerMetrics, Settings, Rule, CRITERIA, WeightConfig,ScoredSeller, DisplayLabel } from "../types/dss.js";



const minMax = (v: number, min: number, max: number): number => min === max ? 0.5 : (v-min)/(max-min);

const rawValue : Record<Criterion, (r: SellerMetrics) => number> = {
  gmv: (r) => Math.log1p(r.gmv),
  late_rate: (r) => r.late_rate as number,
  low_review_rate: (r) => r.low_review_rate as number
};

export function isReliable(r: SellerMetrics, s: Settings): boolean {

  return (
    r.n_eligible >= s.min_eligible_orders 
    && r.late_rate !== null
    && r.low_review_rate !== null 
  )
}

function matchesRule(
  rule: Rule,
  ctx: { score: number; gmv_pct: number; late_rate: number; low_review_rate: number },
): boolean {
  const ok = (v: number, min: number | null, max: number | null) =>
    (min === null || v >= min) && (max === null || v <= max);
  return (
    ok(ctx.score, rule.min_score, rule.max_score) &&
    ok(ctx.gmv_pct, rule.min_gmv_pct, null) &&
    ok(ctx.late_rate, rule.min_late_rate, rule.max_late_rate) &&
    ok(ctx.low_review_rate, rule.min_low_review_rate, rule.max_low_review_rate)
  );
}
export function scoreSellers(
  rows: SellerMetrics[],
  weights: WeightConfig[],
  rules: Rule[], // đã sắp xếp theo priority tăng dần
  settings: Settings,
): ScoredSeller[] {
  const reliable = rows.filter((r) => isReliable(r, settings));
  const unreliable = rows.filter((r) => !isReliable(r, settings));
 
  // --- min / max từng tiêu chí ---
  const range = {} as Record<Criterion, [number, number]>;
  for (const c of CRITERIA) {
    const vals = reliable.map(rawValue[c]);
    range[c] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 0];
  }
 
  // --- percentile rank của GMV ---
  const byGmv = [...reliable].sort((a, b) => a.gmv - b.gmv);
  const gmvPct = new Map<string, number>();
  byGmv.forEach((r, i) =>
    gmvPct.set(r.seller_id, byGmv.length > 1 ? i / (byGmv.length - 1) : 0.5),
  );
 
  // --- trọng số: chuẩn hóa để tổng = 1 ---
  const wSum = weights.reduce((s, w) => s + w.weight, 0) || 1;
 
  const scored = reliable.map((r) => {
    const parts = {} as Record<Criterion, number>;
    let score = 0;
    for (const w of weights) {
      const [min, max] = range[w.criterion];
      const n = minMax(rawValue[w.criterion](r), min, max);
      parts[w.criterion] = w.direction === 'lower' ? 1 - n : n;
      score += (w.weight / wSum) * parts[w.criterion];
    }
    const pct = gmvPct.get(r.seller_id) ?? 0.5;
    const rule = rules.find((ru) =>
      matchesRule(ru, {
        score,
        gmv_pct: pct,
        late_rate: r.late_rate as number,
        low_review_rate: r.low_review_rate as number,
      }),
    );
    return {
      ...r,
      rank: null as number | null,
      score,
      gmv_pct: pct,
      parts,
      label: (rule?.label ?? 'Watch') as DisplayLabel,
      action: rule?.action_text ?? null,
      freight_ratio: r.gmv > 0 ? r.freight / r.gmv : null,
    } satisfies ScoredSeller;
  });
 
  scored.sort((a, b) => (b.score as number) - (a.score as number));
  scored.forEach((s, i) => (s.rank = i + 1));
 
  const insufficient: ScoredSeller[] = unreliable
    .sort((a, b) => b.gmv - a.gmv)
    .map((r) => {
      const big = r.gmv >= settings.big_unreliable_gmv;
      return {
        ...r,
        rank: null,
        score: null,
        gmv_pct: null,
        parts: null,
        label: big ? 'Insufficient data - high GMV' : 'Insufficient data',
        action: big
          ? 'Doanh số đáng kể nhưng chưa đủ đơn để chấm điểm: tiếp tục theo dõi'
          : null,
        freight_ratio: r.gmv > 0 ? r.freight / r.gmv : null,
      };
    });
 
  return [...scored, ...insufficient];
}