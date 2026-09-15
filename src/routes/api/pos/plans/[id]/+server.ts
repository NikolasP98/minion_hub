import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { cancelPlan, getPlan } from '$server/services/pos-accounts.service';
import { handlePosError } from '../../_errors';

/** GET /api/pos/plans/:id — the plan plus derived paid/remaining. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  // Reads here expose client stored-value balances and paid-session history —
  // money + PII, not catalog. Writes are gated centrally by apiWriteCapability;
  // this is the matching READ gate (RBAC checklist step 1).
  await requireOrgCapability(locals, 'pos', 'view');
  try {
    const detail = await getPlan(ctx, params.id as string);
    if (!detail) throw error(404);
    return json(detail);
  } catch (e) {
    return handlePosError(e);
  }
};

/**
 * DELETE /api/pos/plans/:id — cancel an open plan (409 `plan_settled` once it
 * is paid off). Manager-grade, like cancelling a grant: already-paid
 * instalments stay valid and are not refunded here.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'manage');
  try {
    const plan = await cancelPlan(ctx, params.id as string, {
      id: ctx.profileId ?? null,
      name: locals.user?.displayName ?? locals.user?.email ?? null,
    });
    return json({ ok: true, plan });
  } catch (e) {
    return handlePosError(e);
  }
};
