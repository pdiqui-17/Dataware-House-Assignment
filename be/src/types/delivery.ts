import type { CubeLevel } from '../engine/buildQuery.js';

export type AnalysisDimension = 'time' | 'customer_geo';

export interface AnalysisParams {
  dim: AnalysisDimension;
  depth: number;
  from?: string;
  to?: string;
  year?: number;
  quarter?: number;
  month?: number;
  state?: string;
  city?: string;
  category?: string;
  status?: string[];
}

export interface AnalysisResult {
  rows: AnalysisRow[];
  levels: readonly CubeLevel[];
}

export interface AnalysisRow {
  [key: `l${number}`]: string | number | null;
  [key: `g${number}`]: boolean | number;
  eligible_orders: number;
  late_orders: number;
  late_rate: number | null;
  avg_delivery_days: number | null;
  avg_delay_days: number | null;
}

export interface AnalysisData {
  level: number;
  level_name: string;
  keys: Record<string, string | number | null>;
  measures: Record<string, number | null>;
}

export interface AnalysisServiceResult {
  dim: AnalysisDimension;
  levels: string[];
  data: AnalysisData[];
}

export interface DistributionRow {
  n_orders: number;
  pct: number;
  [key: `l${number}`]: string | number | null;
  [key: `g${number}`]: boolean | number;
}

export interface DistributionResult {
  rows: DistributionRow[];
  levels: readonly CubeLevel[];
}

export type DistributionSide = 'early' | 'on_time' | 'late';

export interface DistributionBucket {
  key: string;
  label: string;
  side: DistributionSide;
}

export interface DistributionData {
  bucket: string;
  label: string;
  side: DistributionSide;
  n_orders: number;
  pct: number;
}

export interface DistributionFilters {
  from?: string;
  to?: string;
  year?: number;
  quarter?: number;
  month?: number;
  state?: string;
  city?: string;
}

export interface DistributionServiceResult {
  meta: {
    cube: 'delivery';
    metric: 'delay_days';
    basis: 'eligible_orders';
    total: number;
    filters: DistributionFilters;
    buckets: DistributionBucket[];
    notes: string[];
  };
  summary: {
    early_orders: number;
    on_time_orders: number;
    late_orders: number;
    late_rate: number;
  };
  data: DistributionData[];
}
