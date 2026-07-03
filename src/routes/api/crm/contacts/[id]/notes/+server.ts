import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { addNote } from '$server/services/crm-contacts.service';

const postSchema = z.object({ body: z.string().min(1).max(20_000) });

/** POST /api/crm/contacts/[id]/notes { body } — log a note onto the journey. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { body } = await parseBody(request, postSchema);
  const note = await addNote(ctx, params.id!, body.trim(), locals.user?.supabaseId ?? null);
  return json({ note }, { status: 201 });
};
