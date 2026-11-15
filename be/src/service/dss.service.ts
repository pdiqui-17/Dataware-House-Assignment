import { scoreSellers } from '../model/sellerScorecard.model.js';
import {
  fetchRules,
  fetchSellerMetrics,
  fetchSettings,
  fetchWeights,
} from '../repository/dss.repo.js';
import type { DssConfig, SellerScorecardParams, WeightConfig } from '../types/dss.js';

export const dssConfigService = async (): Promise<DssConfig> => {
  const [weights, rules, settings] = await Promise.all([
    fetchWeights(),
    fetchRules(),
    fetchSettings(),
  ]);
  return { weights, rules, settings };
};

const applyWeightOverrides = (
  configured: WeightConfig[],
  overrides: Record<string, number> | undefined,
): WeightConfig[] => {
  if (overrides === undefined) return configured;
  return configured.map((weight) => ({
    ...weight,
    weight: overrides[weight.criterion] ?? weight.weight,
  }));
};

export const sellerScorecardService = async (params: SellerScorecardParams) => {
  const [metrics, config] = await Promise.all([
    fetchSellerMetrics(params.state),
    dssConfigService(),
  ]);
  const weights = applyWeightOverrides(config.weights, parseWeightOverrides(params.weights));
  const rows = scoreSellers(metrics, weights, config.rules, config.settings);

  return {
    rows: rows.slice(0, params.limit),
    total: rows.length,
    weights,
  };
};

export const parseWeightOverrides = (
  value: string | undefined,
): Record<string, number> | undefined => {
  if (value === undefined) return undefined;
  const overrides: Record<string, number> = {};
  for (const item of value.split(',')) {
    const parts = item.split(':');
    const criterion = parts[0]?.trim();
    const rawWeight = parts[1]?.trim();
    if (!criterion || rawWeight === undefined || parts.length !== 2) {
      throw new Error('weights phải có dạng criterion:number,criterion:number');
    }
    const weight = Number(rawWeight);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error('Mỗi weight phải là số từ 0 đến 1');
    }
    if (overrides[criterion] !== undefined) {
      throw new Error(`weights bị lặp criterion: ${criterion}`);
    }
    overrides[criterion] = weight;
  }
  return overrides;
};
