import { assertPulsePersonalOrg } from '$server/services/pulse-dispatch.store';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listPending } from '$server/services/pulse.service';

/** GET /api/pulse/proposals — list pending Pulse cards for the caller's org. */
export const GET: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'pulse', 'view');
  const ctx = await requireCoreCtx(locals);
  await assertPulsePersonalOrg(ctx);
  return json({ proposals: await listPending(ctx) });
};
