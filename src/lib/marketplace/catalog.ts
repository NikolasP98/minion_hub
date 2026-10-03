export type MarketplaceSort = 'popular' | 'newest' | 'name';
export interface MarketplaceFilters {
  category?: string;
  search?: string;
  model?: string;
  featured?: boolean;
  sort?: MarketplaceSort;
  limit?: number;
  offset?: number;
}

/** Stable URL identity for every server-side catalog filter. */
export function catalogSearchParams(filters: MarketplaceFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ['category', 'search', 'model', 'sort'] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (filters.featured) params.set('featured', 'true');
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  return params;
}
