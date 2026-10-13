import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { voidTicket } from '$server/services/pos.service';
import { handlePosError } from '../../../_errors';

/** `refund` says where the money went (spec 2026-10-13 I4); absent = cash. */
const postSchema = z.object({ refund: z.enum(['cash', 'credit', 'none']).optional() });

/** POST /api/pos/tickets/:id/void — body `{ refund?: 'cash'|'credit'|'none' }`. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'manage');
  const body = await parseBody(request, postSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  try {
    const ticket = await voidTicket(ctx, params.id!, actor, body);
    return json({ ok: true, ticket });
  } catch (e) {
    return handlePosError(e);
  }
};
