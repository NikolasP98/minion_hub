import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { lookupOwnPlanOperation } from '$server/services/pos/plan-operation';
import { handlePosError } from '../../../_errors';

/** Minimal receipt lookup shares create authority; it cannot enumerate agreements. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'create');
  try {
    const plan = await lookupOwnPlanOperation(ctx, params.operationId);
    if (!plan) throw error(404);
    return json({ plan }, { headers: { 'cache-control': 'private, no-store' } });
  } catch (failure) {
    return handlePosError(failure);
  }
};
