export type HasReview = 'true' | 'false';

export type OrderDir = 'asc' | 'desc';

export const SORT_COLUMNS = {
  total_price: 'total_price',
  n_orders: 'n_orders',
  n_items: 'n_items',
  avg_review: 'avg_review',
  freight_ratio: 'freight_ratio',
  low_review_rate: 'low_review_rate',
  avg_order_value: 'avg_order_value',
  last_sale: 'last_sale',
} as const;

export type SortColumn = keyof typeof SORT_COLUMNS;

export interface SellerParams {
  state?: string;
  city?: string;
  q?: string;
  min_orders?: number;
  min_reviewed_orders?: number;
  min_review?: number;
  max_freight_ratio?: number;
  sort?: SortColumn;
  has_review?: HasReview;
  order?: OrderDir;
  page?: number;
  limit?: number;
}

export interface SellerRow {
  seller_key: number;
  seller_id: string;
  seller_state: string;
  seller_city: string;
  total_price: number;
  total_freight: number;
  n_orders: number;
  n_items: number;
  n_products: number;
  avg_order_value: number;
  freight_ratio: number;
  first_sale: number;
  last_sale: number;
  n_reviewed_orders: number;
  avg_review: number | null;
  low_review_rate: number | null;
}