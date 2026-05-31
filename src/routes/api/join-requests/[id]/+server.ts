import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { reviewJoinRequest } from '$server/services/join-request.service';

/** POST /api/join-requests/[id] — approve or deny a join request. Body: { status: 'approved' | 'denied' } */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAdmin(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx) throw error(401);

  const body = await request.json();
  const status = body.status;
  if (status !== 'approved' && status !== 'denied') {
    throw error(400, 'status must be "approved" or "denied"');
  }

  if (!params.id) throw error(400, 'request id required');
  await reviewJoinRequest(ctx.db, {
    requestId: params.id,
    orgId: ctx.tenantId,
    reviewerId: user.id,
    status,
  });

  return json({ ok: true });
};
