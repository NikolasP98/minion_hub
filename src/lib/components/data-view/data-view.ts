/**
 * Data views (owner ask 2026-09-29 / 2026-10-02): one dataset, several
 * renderings, switched per page. The kinds a page MAY offer are a per-page
 * configuration (`views`); a surface that is strictly a table offers one and
 * renders no switcher. See meta proposals/2026-09-29-hub-data-view-container.md.
 */
export const DATA_VIEW_KINDS = ['calendar', 'table', 'board', 'gallery'] as const;
export type DataViewKind = (typeof DATA_VIEW_KINDS)[number];

export type DataViewCatalog<K extends DataViewKind = DataViewKind> = readonly [K, ...K[]];

export function isDataViewKind(value: unknown): value is DataViewKind {
  return typeof value === 'string' && (DATA_VIEW_KINDS as readonly string[]).includes(value);
}

/** A stored/URL value → one of the page's views, else its first. */
export function parseDataView<K extends DataViewKind>(
  value: string | null | undefined,
  views: DataViewCatalog<K>,
): K {
  if (!Array.isArray(views) || views.length === 0)
    throw new Error('DataView requires at least one view');
  if (!views.every(isDataViewKind) || new Set(views).size !== views.length)
    throw new Error('DataView requires unique supported views');
  return (views as readonly string[]).includes(value ?? '') ? (value as K) : views[0];
}

/**
 * Collection states (spec 013 FR-005): every list presents loading, refreshing,
 * stale, empty, filtered-empty, denied, partial and failed the same way through
 * `DataView`. `failed` means nothing was ever loaded — a refresh that fails
 * while a last-good snapshot is on screen is `stale`, never `failed`.
 */
export const COLLECTION_STATES = [
  'initial-load',
  'refreshing',
  'stale',
  'empty',
  'no-results',
  'denied',
  'partial',
  'failed',
  'recovered',
] as const;
export type CollectionState = (typeof COLLECTION_STATES)[number];

/** States that replace the renderer; the others keep the rows on screen. */
export function collectionShowsRows(state: CollectionState | undefined): boolean {
  return !(
    state === 'initial-load' ||
    state === 'empty' ||
    state === 'no-results' ||
    state === 'denied' ||
    state === 'failed'
  );
}
