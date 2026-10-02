/**
 * Data views (owner ask 2026-09-29 / 2026-10-02): one dataset, several
 * renderings, switched per page. The kinds a page MAY offer are a per-page
 * configuration (`views`); a surface that is strictly a table offers one and
 * renders no switcher. See meta proposals/2026-09-29-hub-data-view-container.md.
 */
export const DATA_VIEW_KINDS = ['calendar', 'table', 'board', 'gallery'] as const;
export type DataViewKind = (typeof DATA_VIEW_KINDS)[number];

export function isDataViewKind(value: unknown): value is DataViewKind {
  return typeof value === 'string' && (DATA_VIEW_KINDS as readonly string[]).includes(value);
}

/** A stored/URL value → one of the page's views, else its first. */
export function parseDataView<K extends DataViewKind>(
  value: string | null | undefined,
  views: readonly K[],
): K {
  return (views as readonly string[]).includes(value ?? '') ? (value as K) : views[0];
}
