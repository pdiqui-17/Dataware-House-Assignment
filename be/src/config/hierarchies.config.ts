// src/config/hierarchies.ts

export const hierarchies = {
  time: [
    { name: 'year', col: 'd.year' },
    { name: 'quarter', col: 'd.quarter' },
    { name: 'month', col: 'd.month' },
  ],
  seller_geo: [
    { name: 'seller_state', col: 's.seller_state' },
    { name: 'seller_city', col: 's.seller_city' },
  ],
  product: [
    { name: 'category', col: 'p.product_category_name_english' },
    { name: 'product', col: 'p.product_id' },
  ],
} as const;