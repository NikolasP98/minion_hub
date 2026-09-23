/** Stable persisted category colors. They are domain data (like CRM tag
 * colors), while surrounding UI chrome continues to use semantic tokens. */
export const PRODUCT_CATEGORY_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#f97316',
  '#6366f1',
  '#6b7280',
] as const;

export type ProductCategoryColor = (typeof PRODUCT_CATEGORY_COLORS)[number];
