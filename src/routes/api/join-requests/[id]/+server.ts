import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
// Supabase `join_request` is the system-of-record (Turso is telemetry only):
// approveRequest grants the org membership, denyRequest marks it denied.
import { approveRequest, denyRequest } from '$server/services/join/requests.service';

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
  if (status === 'approved') {
    await approveRequest(params.id, { reviewerId: user.id, role: 'user', organizationId: ctx.tenantId });
  } else {
    await denyRequest(params.id, user.id);
  }

  return json({ ok: true });
};
