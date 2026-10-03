import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { cancelPlanOperation } from '$server/services/pos/plan-operation';
import { handlePosError } from '../../../../_errors';

/** Cancels creation admission; an already-created agreement is returned, never cancelled. */
export const POST: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'create');
  try {
    return json(await cancelPlanOperation(ctx, params.operationId), {
      headers: { 'cache-control': 'private, no-store' },
    });
  } catch (failure) {
    return handlePosError(failure);
  }
};
