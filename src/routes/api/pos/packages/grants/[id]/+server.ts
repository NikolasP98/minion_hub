import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { cancelGrant, getGrant, listRedemptions } from '$server/services/pos-packages.service';
import { handlePosError } from '../../../_errors';

/** GET /api/pos/packages/grants/:id — the grant plus its redemption history. */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  // Reads here expose client stored-value balances and paid-session history —
  // money + PII, not catalog. Writes are gated centrally by apiWriteCapability;
  // this is the matching READ gate (RBAC checklist step 1).
  await requireOrgCapability(locals, 'pos', 'view');
  try {
    const grant = await getGrant(ctx, params.id as string);
    if (!grant) throw error(404);
    return json({ ...grant, redemptions: await listRedemptions(ctx, { grantId: params.id }) });
  } catch (e) {
    return handlePosError(e);
  }
};

/**
 * DELETE /api/pos/packages/grants/:id — cancel a grant. 409 `package_in_use`
 * while any session is still drawn (spec §3.6). Manager-grade: it writes off
 * sessions the client paid for.
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'manage');
  try {
    const grant = await cancelGrant(ctx, params.id as string, {
      id: ctx.profileId ?? null,
      name: locals.user?.displayName ?? locals.user?.email ?? null,
    });
    return json({ ok: true, grant });
  } catch (e) {
    return handlePosError(e);
  }
};
