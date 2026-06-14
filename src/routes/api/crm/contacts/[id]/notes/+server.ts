import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { addNote } from '$server/services/crm-contacts.service';

/** POST /api/crm/contacts/[id]/notes { body } — log a note onto the journey. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  if (!body.body || typeof body.body !== 'string') throw error(400, 'body is required');
  const note = await addNote(ctx, params.id!, body.body.trim(), locals.user?.supabaseId ?? null);
  return json({ note }, { status: 201 });
};
