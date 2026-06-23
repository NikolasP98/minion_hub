import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { setOrderStatus, ORDER_STATUSES, type OrderStatus } from '$server/services/sales.service';

/** PATCH /api/sales/orders/:id — { status } */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json();
  const status = body?.status as OrderStatus;
  if (!ORDER_STATUSES.includes(status)) throw error(400, 'invalid status');
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const order = await setOrderStatus(ctx, params.id!, status, actor);
  if (!order) throw error(404);
  return json(order);
};
