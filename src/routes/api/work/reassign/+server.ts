import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { reassign } from '$server/services/assignment.service';

const patchSchema = z.object({
  docType: z.string().min(1).max(100),
  docId: z.string().min(1).max(200),
  newOwner: z.string().max(200).nullable().optional(),
});

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { docType, docId, newOwner } = await parseBody(request, patchSchema);
  const res = await reassign(ctx, docType, docId, newOwner ?? null, {
    id: locals.user?.supabaseId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
    isAdmin: locals.user?.role === 'admin',
  });
  if (res === 'not_found') throw error(404);
  if (res === 'forbidden') throw error(403, 'Not allowed to reassign this item');
  return json({ ok: true });
};
