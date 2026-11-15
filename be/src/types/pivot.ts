import type { PivotAxisConfig, PivotCubeName, PivotMeasureConfig } from '../model/pivot.model.js';

export interface PivotFilters {
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

export interface PivotParams {
  cube: PivotCubeName;
  rows: PivotAxisConfig;
  cols: PivotAxisConfig;
  measure: PivotMeasureConfig;
  filters: PivotFilters;
  maxRows: number;
  maxCols: number;
}

export interface PivotSqlRow {
  record_type: 'row_header' | 'col_header' | 'cell' | 'row_total' | 'col_total' | 'meta';
  row_key: string | null;
  row_label: string | null;
  col_key: string | null;
  col_label: string | null;
  value: number | string | null;
  row_order: number | null;
  col_order: number | null;
  total_rows: number;
  total_cols: number;
}

export interface PivotHeader {
  key: string;
  label: string;
}

export interface PivotResponse {
  cube: PivotCubeName;
  rows: string;
  cols: string;
  measure: string;
  meta: {
    filters: PivotFilters;
    unit: string;
    n_rows: number;
    n_cols: number;
    total_rows: number;
    total_cols: number;
    truncated: { rows: boolean; cols: boolean };
    notes: string[];
  };
  row_headers: PivotHeader[];
  col_headers: PivotHeader[];
  matrix: (number | null)[][];
  row_totals: (number | null)[];
  col_totals: (number | null)[];
  grand_total: number | null;
}
