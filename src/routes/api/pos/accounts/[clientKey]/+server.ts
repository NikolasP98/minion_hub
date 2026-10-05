import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getClientAccountDetail } from '$server/services/pos-accounts.service';
import { PosError } from '$server/services/pos/errors';
import { handlePosError } from '../../_errors';

/**
 * GET /api/pos/accounts/:clientKey — one client's ledger, package grants and
 * payment plans. `clientKey` is `contact:<uuid>` or `party:<uuid>`
 * (`clientKeyOf` in pos-accounts.service.ts).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  // Reads here expose client stored-value balances and paid-session history —
  // money + PII, not catalog. Writes are gated centrally by apiWriteCapability;
  // this is the matching READ gate (RBAC checklist step 1).
  await requireOrgCapability(locals, 'pos', 'view');
  try {
    const detail = await getClientAccountDetail(ctx, params.clientKey as string);
    if (!detail) throw new PosError('client account not found', 'not_found');
    return json(detail);
  } catch (e) {
    return handlePosError(e);
  }
};
