import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireOrgCapability } from '$server/services/rbac.service';
import { createRequest, listPendingRequests } from '$server/services/join/requests.service';
import { readJoinRequestBody } from '$server/services/join/request-input';
import { resolveJoinRequestTarget } from '$server/services/join/request-target';

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  if (!user.supabaseId) throw error(400, 'supabase session required');
  const body = await readJoinRequestBody(request);
  const defaultOrg = await resolveJoinRequestTarget();
  const r = await createRequest(
    { id: user.id, supabaseId: user.supabaseId, email: user.email, displayName: user.displayName },
    defaultOrg.id,
    body.message,
  );
  return json({ ok: true, id: r.id, status: r.status });
};

export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'users', 'manage');
  if (!locals.tenantCtx) throw error(401, 'tenant context required');
  return json({ requests: await listPendingRequests(locals.tenantCtx.tenantId) });
};
