# Delivery promise policy (Module B)

1. Apply `src/sql/006_delivery_policy.sql` once for the original v1 schema. For the v2 schema, apply `src/sql/006_delivery_policy_v2.sql`; it deletes old delivery-policy runs because they use the old `passed`/`failed` statuses.
2. Run `npm run dss:delivery:profile` to create the monthly profile at `reports/delivery_policy_profile.json` and CSV, then choose a time split.
3. Build a model and backtest with `npm run dss:delivery:build -- --split-date 2018-03-01 --test-end 2018-08-31`. To compare margins, use `--margins 0,0.005,0.01`. Do not combine `--margins` with `--split-dates`.
4. Read the active policy comparison from `GET /api/v1/dss/delivery-buffer`; pass `state`, `target_late_rate`, `k_min`, `k_max`, or `run_id` as needed. Read margin tradeoffs from `GET /api/v1/dss/delivery-buffer/tradeoff`.

Each run is written transactionally. Only a run with the configured `safetyMargin` becomes active after the margin sweep is complete. Reports are written to `reports/delivery_policy/`. Configure defaults in `src/config/delivery-policy.config.ts`; date split values intentionally remain unset until selected from the profile.
