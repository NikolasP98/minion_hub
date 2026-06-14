import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { findDuplicates, mergeContacts } from '$server/services/crm-cleanup.service';

/** GET /api/crm/cleanup/duplicates — likely-duplicate groups (by DNI / name). */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ groups: await findDuplicates(ctx) });
};

/** POST /api/crm/cleanup/duplicates { survivorId, loserIds[] } — merge. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  if (typeof body.survivorId !== 'string' || !Array.isArray(body.loserIds)) {
    throw error(400, 'survivorId and loserIds required');
  }
  await mergeContacts(ctx, body.survivorId, body.loserIds.filter((x: unknown) => typeof x === 'string'));
  return json({ ok: true });
};
