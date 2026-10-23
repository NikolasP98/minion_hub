import { assertPulsePersonalOrg } from '$server/services/pulse-dispatch.store';
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getPulseReceipt } from '$server/services/pulse.service';
export const GET: RequestHandler = async ({ locals, params }) => {
  requireAuth(locals);
  await requireOrgCapability(locals, 'pulse', 'view');
  const ctx = await requireCoreCtx(locals);
  await assertPulsePersonalOrg(ctx);
  return json(await getPulseReceipt(ctx, params.id));
};
