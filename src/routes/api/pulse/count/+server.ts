import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { countPending } from '$server/services/pulse.service';

/** GET /api/pulse/count — pending Pulse card count (badge). */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'pulse', 'view');
  const ctx = await requireCoreCtx(locals);
  return json({ count: await countPending(ctx) });
};
