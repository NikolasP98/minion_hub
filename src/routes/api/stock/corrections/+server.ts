import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  applyStockCorrection,
  getStockCorrectionByOperationKey,
} from '$server/services/stock-corrections.service';
import { parsePreviewRequest } from '$server/services/stock-corrections.logic';
import { correctionResponse, logLockRefusal, noStore } from '../_corrections-http';

const KEYS = ['request', 'operationKey', 'previewHash', 'payloadHash', 'reason'];
const SHA = /^[0-9a-f]{64}$/;

/** POST /api/stock/corrections — apply. A public `stock_only` is refused 422 before any effect. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw error(400, 'invalid body');
  const extra = Object.keys(b).filter((k) => !KEYS.includes(k));
  if (extra.length || KEYS.some((k) => !(k in b))) throw error(400, 'invalid body');
  if (
    typeof b.operationKey !== 'string' ||
    typeof b.previewHash !== 'string' ||
    typeof b.payloadHash !== 'string' ||
    typeof b.reason !== 'string' ||
    !SHA.test(b.previewHash) ||
    !SHA.test(b.payloadHash)
  )
    throw error(400, 'invalid body');
  try {
    const result = await applyStockCorrection(
      ctx,
      {
        request: parsePreviewRequest(b.request),
        operationKey: b.operationKey,
        previewHash: b.previewHash,
        payloadHash: b.payloadHash,
        reason: b.reason,
      },
      { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null },
    );
    return json(result, noStore);
  } catch (e) {
    await logLockRefusal(ctx, locals.user?.displayName ?? locals.user?.email ?? null, e, b.request);
    return correctionResponse(e);
  }
};

/** GET /api/stock/corrections?operationKey=&payloadHash= — authoritative status after a lost response. */
export const GET: RequestHandler = async ({ locals, url }) => {
  // Session guard only: the service admits pos:view OR stock:view (a stockless POS swap has no stock access).
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const operationKey = url.searchParams.get('operationKey') ?? '';
  const payloadHash = url.searchParams.get('payloadHash') ?? '';
  if (!SHA.test(payloadHash)) throw error(400, 'invalid payloadHash');
  try {
    return json(
      await getStockCorrectionByOperationKey(ctx, { operationKey, payloadHash }),
      noStore,
    );
  } catch (e) {
    return correctionResponse(e);
  }
};
