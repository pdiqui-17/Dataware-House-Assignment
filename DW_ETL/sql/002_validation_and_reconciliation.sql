-- Run in PostgreSQL using psql or a PostgreSQL SQL client.
SET search_path TO dw, public;

-- 1. Core row counts
SELECT 'dim_date' AS table_name, COUNT(*) AS row_count FROM dim_date
UNION ALL SELECT 'dim_seller', COUNT(*) FROM dim_seller
UNION ALL SELECT 'dim_product', COUNT(*) FROM dim_product
UNION ALL SELECT 'dim_customer', COUNT(*) FROM dim_customer
UNION ALL SELECT 'dim_order_status', COUNT(*) FROM dim_order_status
UNION ALL SELECT 'fact_sales_item', COUNT(*) FROM fact_sales_item
UNION ALL SELECT 'fact_delivery_order', COUNT(*) FROM fact_delivery_order
UNION ALL SELECT 'fact_review', COUNT(*) FROM fact_review
ORDER BY table_name;

-- 2. Sales amounts from the DW (should be reconciled to source order-items CSV)
SELECT
    COUNT(*) AS sales_item_rows,
    COUNT(DISTINCT order_id) AS distinct_orders_with_items,
    SUM(price) AS total_item_value,
    SUM(freight_value) AS total_freight_value,
    SUM(price + freight_value) AS total_item_plus_freight
FROM fact_sales_item;

-- 3. Sales by current ETL snapshot status
SELECT
    st.order_status,
    COUNT(*) AS item_rows,
    COUNT(DISTINCT f.order_id) AS distinct_orders,
    SUM(f.price) AS item_value,
    SUM(f.freight_value) AS freight_value
FROM fact_sales_item f
JOIN dim_order_status st USING (order_status_key)
GROUP BY st.order_status
ORDER BY item_value DESC NULLS LAST;

-- 4. Delivery KPI, only eligible orders in denominator
SELECT
    COUNT(*) FILTER (WHERE is_delivery_eligible) AS eligible_orders,
    COUNT(*) FILTER (WHERE is_delivery_eligible AND is_delayed) AS delayed_orders,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE is_delivery_eligible AND is_delayed)
        / NULLIF(COUNT(*) FILTER (WHERE is_delivery_eligible), 0), 2
    ) AS delayed_rate_pct,
    ROUND(AVG(delivery_days) FILTER (WHERE is_delivery_eligible), 2) AS avg_delivery_days,
    ROUND(AVG(delay_days) FILTER (WHERE is_delivery_eligible), 2) AS avg_delay_days
FROM fact_delivery_order;

-- 5. Delivery KPI by purchase month
SELECT
    DATE_TRUNC('month', purchase_date_key)::date AS purchase_month,
    COUNT(*) FILTER (WHERE is_delivery_eligible) AS eligible_orders,
    COUNT(*) FILTER (WHERE is_delivery_eligible AND is_delayed) AS delayed_orders,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE is_delivery_eligible AND is_delayed)
        / NULLIF(COUNT(*) FILTER (WHERE is_delivery_eligible), 0), 2
    ) AS delayed_rate_pct,
    ROUND(AVG(delivery_days) FILTER (WHERE is_delivery_eligible), 2) AS avg_delivery_days
FROM fact_delivery_order
GROUP BY DATE_TRUNC('month', purchase_date_key)::date
ORDER BY purchase_month;

-- 6. Review score overview
SELECT
    COUNT(*) AS review_rows,
    ROUND(AVG(review_score)::numeric, 2) AS avg_review_score,
    COUNT(*) FILTER (WHERE review_score <= 2) AS low_score_reviews,
    ROUND(100.0 * COUNT(*) FILTER (WHERE review_score <= 2) / NULLIF(COUNT(*), 0), 2) AS low_score_pct
FROM fact_review;

-- 7. Review score distribution
SELECT review_score, COUNT(*) AS review_count
FROM fact_review
GROUP BY review_score
ORDER BY review_score;

-- 8. Seller performance (item-level metrics; seller order count is distinct per seller)
SELECT
    s.seller_id,
    s.seller_city,
    s.seller_state,
    COUNT(*) AS sales_item_count,
    COUNT(DISTINCT f.order_id) AS seller_order_count,
    SUM(f.price) AS item_value,
    SUM(f.freight_value) AS freight_value,
    ROUND(AVG(r.review_score)::numeric, 2) AS avg_review_score
FROM fact_sales_item f
JOIN dim_seller s USING (seller_key)
JOIN fact_delivery_order d ON d.order_id = f.order_id
LEFT JOIN (
    SELECT order_id, AVG(review_score)::numeric AS review_score
    FROM fact_review
    GROUP BY order_id
) r ON r.order_id = f.order_id
GROUP BY s.seller_id, s.seller_city, s.seller_state
ORDER BY item_value DESC
LIMIT 100;

-- NOTE: Delivery KPI is intentionally not attributed to individual sellers.
-- The seller query above is for sales/item metrics and an order-associated review
-- context only. If one order contains items from multiple sellers, the review can
-- appear in each seller's associated-order context; do not sum seller review counts
-- to infer marketplace-wide review totals.
