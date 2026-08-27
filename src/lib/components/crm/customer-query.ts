/** Query fields that can change ordering or pagination, but never the number
 * of matching CRM contacts. */
const COUNT_INDEPENDENT_PARAMS = ['sort', 'sortDir', 'limit', 'offset', 'includeTotal'] as const;

/** Stable identity for the filters that determine the exact contact count. */
export function crmCountScopeFingerprint(params: URLSearchParams): string {
  const scope = new URLSearchParams(params);
  for (const key of COUNT_INDEPENDENT_PARAMS) scope.delete(key);
  scope.sort();
  return scope.toString();
}
