import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { reassign } from '$server/services/assignment.service';

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { docType, docId, newOwner } = await request.json();
  if (!docType || !docId) throw error(400, 'docType, docId required');
  const res = await reassign(ctx, docType, docId, newOwner ?? null, {
    id: locals.user?.supabaseId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
    isAdmin: locals.user?.role === 'admin',
  });
  if (res === 'not_found') throw error(404);
  if (res === 'forbidden') throw error(403, 'Not allowed to reassign this item');
  return json({ ok: true });
};
