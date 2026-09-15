import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listClientAccounts } from '$server/services/pos-accounts.service';
import { handlePosError } from '../_errors';

/**
 * GET /api/pos/accounts?limit= — every client holding credit, a live package
 * or an open plan. Read-only; the detail route does the per-client breakdown.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  // Reads here expose client stored-value balances and paid-session history —
  // money + PII, not catalog. Writes are gated centrally by apiWriteCapability;
  // this is the matching READ gate (RBAC checklist step 1).
  await requireOrgCapability(locals, 'pos', 'view');
  const limitParam = Number(url.searchParams.get('limit'));
  try {
    return json({
      accounts: await listClientAccounts(ctx, {
        limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      }),
    });
  } catch (e) {
    return handlePosError(e);
  }
};
