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

CREATE OR REPLACE VIEW dw.v_seller_kpi AS
WITH base AS (                           -- chỉ item của đơn delivered
  SELECT f.*
  FROM dw.fact_sales_item f
  JOIN dw.dim_order_status os ON os.order_status_key = f.order_status_key
  WHERE os.order_status = 'delivered'
),
sales AS (                               -- tầng item: một dòng mỗi seller
  SELECT seller_key,
         SUM(price)                  AS total_price,
         SUM(freight_value)          AS total_freight,
         COUNT(DISTINCT order_id)    AS n_orders,
         SUM(item_count)             AS n_items,
         COUNT(DISTINCT product_key) AS n_products,
         MIN(purchase_date_key)      AS first_sale,
         MAX(purchase_date_key)      AS last_sale
  FROM base
  GROUP BY seller_key
),
order_score AS (                         -- review gom về cấp đơn, mọi đơn
  SELECT order_id, AVG(review_score) AS score
  FROM dw.fact_review
  GROUP BY order_id
),
seller_order AS (                        -- cặp (seller, đơn) phân biệt
  SELECT DISTINCT seller_key, order_id FROM base
),
rev AS (                                 -- tầng seller-order, chỉ đơn có review
  SELECT so.seller_key,
         COUNT(*)                                 AS n_reviewed_orders,
         AVG(os.score)                            AS avg_review,
         AVG((os.score <= 2)::int)                AS low_review_rate
  FROM seller_order so
  JOIN order_score os ON os.order_id = so.order_id
  GROUP BY so.seller_key
)
SELECT s.seller_key, s.seller_id, s.seller_state, s.seller_city,
       sa.total_price, sa.total_freight,
       sa.n_orders, sa.n_items, sa.n_products,
       sa.total_price / NULLIF(sa.n_orders, 0)      AS avg_order_value,
       sa.total_freight / NULLIF(sa.total_price, 0) AS freight_ratio,
       sa.first_sale, sa.last_sale,
       rv.n_reviewed_orders,
       ROUND(rv.avg_review, 2)                      AS avg_review,
       ROUND(rv.low_review_rate, 4)                 AS low_review_rate
FROM sales sa
JOIN dw.dim_seller s ON s.seller_key = sa.seller_key
LEFT JOIN rev rv     ON rv.seller_key = sa.seller_key;