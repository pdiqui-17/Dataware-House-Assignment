CREATE OR REPLACE VIEW dw.v_order_single_seller AS
WITH single_seller_orders AS (
    SELECT
        order_id,
        MIN(seller_key)        AS seller_key,        -- chỉ có 1 giá trị duy nhất do HAVING
        MIN(purchase_date_key) AS purchase_date_key,
        SUM(price)             AS order_price,
        SUM(freight_value)     AS freight_value,
        COUNT(*)               AS n_items
    FROM dw.fact_sales_item
    GROUP BY order_id
    HAVING COUNT(DISTINCT seller_key) = 1
)
SELECT
    s.order_id,
    s.seller_key,
    sel.seller_id,
    sel.seller_city,
    sel.seller_state,
    s.purchase_date_key AS purchase_date,
    s.n_items,
    s.order_price,
    s.freight_value,
    os.order_status,
    d.is_delivery_eligible,
    d.delivery_days,
    d.delay_days,
    d.is_delayed,
    orv.n_reviews,
    orv.has_review,
    orv.is_low_review
FROM single_seller_orders s
JOIN dw.dim_seller sel          ON sel.seller_key = s.seller_key
JOIN dw.fact_delivery_order d   ON d.order_id = s.order_id
JOIN dw.dim_order_status os     ON os.order_status_key = d.order_status_key
LEFT JOIN dw.v_order_review orv ON orv.order_id = s.order_id;

CREATE OR REPLACE VIEW dw.v_seller_metrics AS
WITH sales AS (
    SELECT f.seller_key,
           COUNT(DISTINCT f.order_id) AS n_orders,
           COUNT(*)                   AS n_items,
           SUM(f.price)               AS gmv,
           SUM(f.freight_value)       AS freight
    FROM dw.fact_sales_item f
    JOIN dw.dim_order_status os ON os.order_status_key = f.order_status_key
    WHERE os.order_status NOT IN ('canceled', 'unavailable')
    GROUP BY f.seller_key
),
ops AS (
    SELECT seller_key,
           COUNT(*)                                                    AS n_single_orders,
           COUNT(*) FILTER (WHERE is_delivery_eligible)                AS n_eligible,
           COUNT(*) FILTER (WHERE is_delivery_eligible AND is_delayed) AS n_late,
           AVG(delivery_days) FILTER (WHERE is_delivery_eligible)      AS avg_delivery_days,
           COUNT(*) FILTER (WHERE has_review)                          AS n_reviewed,
           COUNT(*) FILTER (WHERE has_review AND is_low_review)        AS n_low_review
    FROM dw.v_order_single_seller
    GROUP BY seller_key
)
SELECT s.seller_key, sel.seller_id, sel.seller_city, sel.seller_state,
       s.n_orders, s.n_items, s.gmv, s.freight,
       COALESCE(o.n_single_orders, 0) AS n_single_orders,
       COALESCE(o.n_eligible, 0)      AS n_eligible,
       COALESCE(o.n_late, 0)          AS n_late,
       o.n_late::numeric   / NULLIF(o.n_eligible, 0) AS late_rate,
       o.n_low_review::numeric / NULLIF(o.n_reviewed, 0) AS low_review_rate,
       o.avg_delivery_days,
       (COALESCE(o.n_eligible, 0) >= 30) AS is_reliable
FROM sales s
JOIN dw.dim_seller sel ON sel.seller_key = s.seller_key
LEFT JOIN ops o ON o.seller_key = s.seller_key;
CREATE OR REPLACE VIEW dw.v_seller_metrics AS
WITH sales AS (
    SELECT f.seller_key,
           COUNT(DISTINCT f.order_id) AS n_orders,
           COUNT(*)                   AS n_items,
           SUM(f.price)               AS gmv,
           SUM(f.freight_value)       AS freight
    FROM dw.fact_sales_item f
    JOIN dw.dim_order_status os ON os.order_status_key = f.order_status_key
    WHERE os.order_status NOT IN ('canceled', 'unavailable')
    GROUP BY f.seller_key
),
ops AS (
    SELECT seller_key,
           COUNT(*)                                                    AS n_single_orders,
           COUNT(*) FILTER (WHERE is_delivery_eligible)                AS n_eligible,
           COUNT(*) FILTER (WHERE is_delivery_eligible AND is_delayed) AS n_late,
           AVG(delivery_days) FILTER (WHERE is_delivery_eligible)      AS avg_delivery_days,
           COUNT(*) FILTER (WHERE has_review)                          AS n_reviewed,
           COUNT(*) FILTER (WHERE has_review AND is_low_review)        AS n_low_review
    FROM dw.v_order_single_seller
    GROUP BY seller_key
)
SELECT s.seller_key, sel.seller_id, sel.seller_city, sel.seller_state,
       s.n_orders, s.n_items, s.gmv, s.freight,
       COALESCE(o.n_single_orders, 0) AS n_single_orders,
       COALESCE(o.n_eligible, 0)      AS n_eligible,
       COALESCE(o.n_late, 0)          AS n_late,
       o.n_late::numeric   / NULLIF(o.n_eligible, 0) AS late_rate,
       o.n_low_review::numeric / NULLIF(o.n_reviewed, 0) AS low_review_rate,
       o.avg_delivery_days,
       (COALESCE(o.n_eligible, 0) >= 30) AS is_reliable
FROM sales s
JOIN dw.dim_seller sel ON sel.seller_key = s.seller_key
LEFT JOIN ops o ON o.seller_key = s.seller_key;

SELECT
  COUNT(*)                            AS n_seller,
  COUNT(*) FILTER (WHERE is_reliable) AS n_reliable,
  ROUND(100.0 * COUNT(*) FILTER (WHERE is_reliable) / COUNT(*), 1) AS pct_reliable,

  PERCENTILE_CONT(ARRAY[0.1,0.5,0.9]) WITHIN GROUP (ORDER BY late_rate)
      FILTER (WHERE is_reliable)      AS late_rate_p,
  PERCENTILE_CONT(ARRAY[0.1,0.5,0.9]) WITHIN GROUP (ORDER BY low_review_rate)
      FILTER (WHERE is_reliable)      AS low_review_p,
  PERCENTILE_CONT(ARRAY[0.1,0.5,0.9]) WITHIN GROUP (ORDER BY gmv)
      FILTER (WHERE is_reliable)      AS gmv_p
FROM dw.v_seller_metrics;

SELECT
  ROUND(100.0 * SUM(gmv) FILTER (WHERE is_reliable) / SUM(gmv), 1) AS pct_gmv_reliable,
  ROUND(100.0 * SUM(n_orders) FILTER (WHERE is_reliable) / SUM(n_orders), 1) AS pct_orders_reliable
FROM dw.v_seller_metrics;

SELECT
  COUNT(*) FILTER (WHERE n_eligible >= 10) AS ge10,
  COUNT(*) FILTER (WHERE n_eligible >= 20) AS ge20,
  COUNT(*) FILTER (WHERE n_eligible >= 30) AS ge30,
  COUNT(*) FILTER (WHERE n_eligible >= 50) AS ge50
FROM dw.v_seller_metrics;