import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { reingestDocument, resolvePrincipal } from '$server/services/brains.service';

/** POST /api/brains/:id/documents/:docId/reingest — reset to pending + re-enqueue. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const principal = await resolvePrincipal(ctx);
  await reingestDocument(ctx, params.id!, params.docId!, principal);
  return json({ ok: true });
};
