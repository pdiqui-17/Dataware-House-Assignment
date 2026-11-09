BEGIN;

-- Old runs use passed/failed, so clear them before tightening the status constraint.
DELETE FROM dss.delivery_run;

ALTER TABLE dss.delivery_run
  ADD COLUMN IF NOT EXISTS safety_margin NUMERIC(5, 4) NOT NULL DEFAULT 0;

ALTER TABLE dss.delivery_backtest
  DROP CONSTRAINT IF EXISTS delivery_backtest_status_check;

ALTER TABLE dss.delivery_backtest
  ADD CONSTRAINT delivery_backtest_status_check
  CHECK (status IN ('met', 'missed', 'low_power'));

ALTER TABLE dss.delivery_backtest
  ADD COLUMN IF NOT EXISTS significantly_above_target BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS dss.delivery_policy_eval (
  run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
  policy VARCHAR(12) NOT NULL CHECK (policy IN ('current_k0', 'global_k', 'state_k')),
  late_rate NUMERIC(6, 5) NOT NULL,
  promised_days_avg NUMERIC(6, 2) NOT NULL,
  n_segments_scored INT NOT NULL,
  n_segments_met INT NOT NULL,
  pct_orders_in_met NUMERIC(6, 5),
  worst_segment VARCHAR(8),
  worst_late_rate NUMERIC(6, 5),
  PRIMARY KEY (run_id, policy)
);

CREATE TABLE IF NOT EXISTS dss.delivery_policy_eval_segment (
  run_id BIGINT REFERENCES dss.delivery_run(run_id) ON DELETE CASCADE,
  policy VARCHAR(12) NOT NULL CHECK (policy IN ('current_k0', 'global_k', 'state_k')),
  segment VARCHAR(8) NOT NULL,
  k SMALLINT NOT NULL,
  n_test INT NOT NULL,
  late_rate_test NUMERIC(6, 5) NOT NULL,
  ci_low NUMERIC(6, 5),
  ci_high NUMERIC(6, 5),
  status VARCHAR(10) NOT NULL CHECK (status IN ('met', 'missed', 'low_power')),
  significantly_above_target BOOLEAN NOT NULL,
  PRIMARY KEY (run_id, policy, segment)
);

COMMIT;
