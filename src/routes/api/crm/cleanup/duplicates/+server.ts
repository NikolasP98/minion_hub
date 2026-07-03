import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { findDuplicates, mergeContacts } from '$server/services/crm-cleanup.service';

/** GET /api/crm/cleanup/duplicates — likely-duplicate groups (by DNI / name). */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ groups: await findDuplicates(ctx) });
};

const postSchema = z.object({
  survivorId: z.string().min(1).max(200),
  loserIds: z.array(z.string().max(200)),
});

/** POST /api/crm/cleanup/duplicates { survivorId, loserIds[] } — merge. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  await mergeContacts(ctx, body.survivorId, body.loserIds);
  return json({ ok: true });
};
