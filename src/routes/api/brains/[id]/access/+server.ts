import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { listAccess, setAccess, resolvePrincipal } from '$server/services/brains.service';

/** GET /api/brains/:id/access — write-level required (access grants are themselves sensitive). */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const principal = await resolvePrincipal(ctx);
  return json({ access: await listAccess(ctx, params.id!, principal) });
};

const putSchema = z.object({
  rows: z.array(
    z.object({
      principalType: z.enum(['role', 'user', 'agent']),
      principalId: z.string().min(1).max(200),
      level: z.enum(['read', 'write']),
    }),
  ),
});

/** PUT /api/brains/:id/access — replace-all the brain's access grants. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, putSchema);
  const principal = await resolvePrincipal(ctx);
  await setAccess(ctx, params.id!, body.rows, principal);
  return json({ ok: true });
};
