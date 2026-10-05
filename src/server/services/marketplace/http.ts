import { json } from '@sveltejs/kit';
import { MarketplaceDocumentsUnavailable } from './files';
import type { SyncResult } from './sync';

export function unavailableDocumentsResponse(cause: unknown): Response | undefined {
  if (!(cause instanceof MarketplaceDocumentsUnavailable)) return;
  return json(
    {
      message: cause.message,
      code: 'marketplace_documents_unavailable',
      documentErrorCode: cause.code,
      retryAfterSeconds: cause.retryAfterSeconds,
    },
    {
      status: 503,
      headers: { 'Retry-After': String(cause.retryAfterSeconds), 'Cache-Control': 'no-store' },
    },
  );
}
export function syncResponse(result: SyncResult, manual: boolean) {
  const busy = manual && (result.status === 'busy' || result.status === 'not_due');
  return json(result, {
    status: busy ? 409 : 200,
    headers: {
      'Cache-Control': 'no-store',
      ...(result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : {}),
    },
  });
}
