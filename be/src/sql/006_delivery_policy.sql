CREATE OR REPLACE VIEW dw.v_delivery_promise_base AS
WITH rv AS (
  SELECT order_id, AVG(review_score)::numeric(4,2) AS avg_review_score
  FROM dw.fact_review GROUP BY order_id
)
SELECT d.order_id, c.customer_state, d.purchase_date_key AS purchase_date,
       (d.estimated_delivery_date_key - d.purchase_date_key) AS estimated_days,
       d.delivery_days, d.delay_days, rv.avg_review_score
FROM dw.fact_delivery_order d
JOIN dw.dim_customer c ON c.customer_key = d.customer_key
LEFT JOIN rv ON rv.order_id = d.order_id
WHERE d.is_delivery_eligible;

CREATE SCHEMA IF NOT EXISTS dss;

CREATE TABLE IF NOT EXISTS dss.delivery_run (
  run_id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), params JSONB NOT NULL,
  train_start DATE, split_date DATE NOT NULL, test_end DATE NOT NULL,
  n_train INT NOT NULL, n_test INT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS dss.delivery_curve (
  run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
  segment VARCHAR(8) NOT NULL, k SMALLINT NOT NULL, promised_days_avg NUMERIC(6,2),
  late_rate_train NUMERIC(6,5) NOT NULL, late_rate_test NUMERIC(6,5), expected_review NUMERIC(4,3),
  n_train INT NOT NULL, n_test INT NOT NULL, PRIMARY KEY (run_id, segment, k)
);
CREATE TABLE IF NOT EXISTS dss.delivery_policy (
  run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
  segment VARCHAR(8) NOT NULL, k_recommended SMALLINT NOT NULL, fallback BOOLEAN NOT NULL,
  attainable BOOLEAN NOT NULL, PRIMARY KEY (run_id, segment)
);
CREATE TABLE IF NOT EXISTS dss.delivery_backtest (
  run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
  segment VARCHAR(8) NOT NULL, k SMALLINT NOT NULL, n_test INT NOT NULL,
  predicted_late NUMERIC(6,5), actual_late NUMERIC(6,5), deviation NUMERIC(6,5),
  ci_low NUMERIC(6,5), ci_high NUMERIC(6,5),
  status VARCHAR(10) NOT NULL CHECK (status IN ('passed','failed','low_power')),
  PRIMARY KEY (run_id, segment)
);
CREATE TABLE IF NOT EXISTS dss.review_bucket (
  run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
  bucket_label VARCHAR(24) NOT NULL, delay_min INT, delay_max INT,
  n_reviewed INT NOT NULL, mean_score NUMERIC(4,3) NOT NULL, PRIMARY KEY (run_id, bucket_label)
);
