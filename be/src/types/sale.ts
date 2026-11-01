import type { hierarchies } from '../config/hierarchies.config.js';

export type AnalysisDimension = keyof typeof hierarchies;

export type HierarchyLevel = (typeof hierarchies)[keyof typeof hierarchies][number];

export type AnalysisLevels = readonly HierarchyLevel[];
export type AnalysisLevelName = HierarchyLevel['name'];

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

export interface AnalysisRow {
  [key: `l${number}`]: string | number | null;
  [key: `g${number}`]: boolean | number;
  total_price: number;
  total_freight: number;
  n_orders: number;
  n_items: number;
}

export interface AnalysisResult {
  rows: AnalysisRow[];
  levels: AnalysisLevels;
}

export type AnalysisKeyValue = string | number | null;

export interface AnalysisData {
  level: number;
  level_name: AnalysisLevelName | 'grand_total';
  keys: Record<string, AnalysisKeyValue>;
  total_price: number;
  total_freight: number;
  n_orders: number;
  n_items: number;
}

export interface AnalysisServiceResult {
  dim: AnalysisDimension;
  levels: AnalysisLevelName[];
  data: AnalysisData[];
}

export interface AnalysisQuery {
  dim?: string;
  depth?: string;
  from?: string;
  to?: string;
  year?: string;
  quarter?: string;
  month?: string;
  state?: string;
  city?: string;
  category?: string;
  status?: string;
}
