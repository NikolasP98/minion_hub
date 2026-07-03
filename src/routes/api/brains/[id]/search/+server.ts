import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { searchBrain, resolvePrincipal } from '$server/services/brains.service';

const postSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  limit: z.number().int().positive().max(50).optional(),
});

/** POST /api/brains/:id/search — { query, limit? } → ranked chunks (cosine top-k). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const principal = await resolvePrincipal(ctx);
  const hits = await searchBrain(ctx, params.id!, body.query, body.limit, principal);
  return json({ hits });
};
