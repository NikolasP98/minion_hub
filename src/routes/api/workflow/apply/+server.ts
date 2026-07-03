import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { applyTransition } from '$server/services/workflow.service';

const postSchema = z.object({
  docType: z.string().min(1).max(100),
  docId: z.string().min(1).max(200),
  action: z.string().min(1).max(100),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { docType, docId, action } = await parseBody(request, postSchema);
  const res = await applyTransition(ctx, docType, docId, action, {
    id: locals.user?.supabaseId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
    role: locals.user?.role ?? null,
  });
  if (res === 'not_found' || res === 'no_workflow') throw error(404);
  if (res === 'forbidden') throw error(403, 'Transition not allowed');
  return json({ ok: true });
};
