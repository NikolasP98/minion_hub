import type { Handle } from '@sveltejs/kit';
import { canonicalPath } from '$lib/canonical-path';

/** Install before authentication so cached absence or denial never hides a later receipt. */
export const planOperationCacheHandle: Handle = async ({ event, resolve }) => {
  if (!canonicalPath(event.url.pathname).startsWith('/api/pos/plans/operations/'))
    return resolve(event);
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const response = await resolve(event);
  response.headers.set('cache-control', 'private, no-store');
  return response;
};
