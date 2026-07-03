import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { setOrderStatus, ORDER_STATUSES } from '$server/services/sales.service';
import { statusChangeBlocked } from '$server/services/workflow.service';
import { StaleWriteError } from '$server/services/errors';

const patchSchema = z.object({ status: z.enum(ORDER_STATUSES), expectedUpdatedAt: z.coerce.date().optional() });

/** PATCH /api/sales/orders/:id — { status } */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { status, expectedUpdatedAt } = await parseBody(request, patchSchema);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  // Workflow enforcement — inert until an admin enables a sales_order workflow.
  if (await statusChangeBlocked(ctx, 'sales_order', params.id!, status, { ...actor, role: locals.user?.role ?? null }))
    throw error(409, 'status change not permitted by workflow');
  try {
    const order = await setOrderStatus(ctx, params.id!, status, actor, expectedUpdatedAt);
    if (!order) throw error(404);
    return json(order);
  } catch (e) {
    if (e instanceof StaleWriteError) return json({ error: 'stale', current: e.current }, { status: 409 });
    throw e;
  }
};
