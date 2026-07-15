import { error } from '@sveltejs/kit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 404 a route param that cannot be a uuid before Postgres tries to cast it.
 * Capture fixtures ("audit-stock-item"), stale links, and hand-edited URLs
 * reach uuid-keyed detail routes and would otherwise turn into a 22P02 → 500.
 */
export function uuidParamOr404(value: string): string {
  if (!UUID_RE.test(value)) throw error(404, 'Not found');
  return value;
}
