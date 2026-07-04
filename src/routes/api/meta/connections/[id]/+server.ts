import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { disconnect } from '$server/services/meta/meta-connections.service';

/** DELETE /api/meta/connections/[id] — disconnect (marks revoked, keeps data). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'ads', 'manage');

  const found = await disconnect(ctx, params.id!);
  if (!found) throw error(404, 'connection not found');
  return json({ ok: true, id: params.id, status: 'revoked' });
};
