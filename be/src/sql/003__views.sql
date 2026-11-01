SET search_path TO dw, public;
CREATE OR REPLACE VIEW dw.v_order_review AS
WITH rev AS (
  SELECT order_id,
         AVG(review_score)::numeric(4,2) AS avg_score,
         COUNT(*)                        AS n_reviews
  FROM dw.fact_review
  GROUP BY order_id
)
SELECT
  fo.order_id,
  fo.purchase_date_key,
  c.customer_state,
  fo.delivery_days,
  fo.delay_days,
  fo.is_delayed,
  CASE
    WHEN fo.delay_days <= -8 THEN 'early_8plus'
    WHEN fo.delay_days <   0 THEN 'early_1_7'
    WHEN fo.delay_days =   0 THEN 'on_time'
    WHEN fo.delay_days <=  3 THEN 'late_1_3'
    WHEN fo.delay_days <=  7 THEN 'late_4_7'
    ELSE 'late_8plus'
  END                          AS delay_bucket,
  r.avg_score,
  COALESCE(r.n_reviews, 0)     AS n_reviews,
  (r.order_id IS NOT NULL)     AS has_review,
  (r.avg_score <= 2)           AS is_low_review
FROM dw.fact_delivery_order fo
JOIN dw.dim_customer c ON c.customer_key = fo.customer_key
LEFT JOIN rev r        ON r.order_id = fo.order_id
WHERE fo.is_delivery_eligible = true;

