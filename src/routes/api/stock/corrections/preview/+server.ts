import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { previewStockCorrection } from '$server/services/stock-corrections.service';
import { correctionResponse, logLockRefusal, noStore } from '../../_corrections-http';

/** POST /api/stock/corrections/preview — `{ request, reason }`. Read-only; the service derives the capabilities from the verified effect. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = (await request.json().catch(() => null)) as {
    request?: unknown;
    reason?: unknown;
  } | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'invalid body');
  const extra = Object.keys(body).filter((k) => k !== 'request' && k !== 'reason');
  if (extra.length) throw error(400, `unknown key ${extra[0]}`);
  try {
    return json(await previewStockCorrection(ctx, body.request, body.reason), noStore);
  } catch (e) {
    await logLockRefusal(
      ctx,
      locals.user?.displayName ?? locals.user?.email ?? null,
      e,
      body.request,
    );
    return correctionResponse(e);
  }
};
