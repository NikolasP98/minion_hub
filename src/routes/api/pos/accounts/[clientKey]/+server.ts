import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import {
  creditBalance,
  getPlan,
  listLedger,
  listPlans,
  parseClientKey,
} from '$server/services/pos-accounts.service';
import { listGrants } from '$server/services/pos-packages.service';
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
    const client = parseClientKey(params.clientKey as string);
    const [balance, ledger, grants, plans] = await Promise.all([
      creditBalance(ctx, client),
      listLedger(ctx, client),
      listGrants(ctx, client),
      listPlans(ctx, { client }),
    ]);
    // ponytail: N+1 on plan progress — a client holds one or two plans, and
    // getPlan is the one place the paid-to-date rule lives. Batch it only if a
    // client ever holds enough plans for the round-trips to show.
    const planDetails = await Promise.all(plans.map((p) => getPlan(ctx, p.id)));
    return json({
      clientKey: params.clientKey,
      client,
      balance,
      ledger,
      grants,
      plans: planDetails.filter((p) => p !== null),
    });
  } catch (e) {
    return handlePosError(e);
  }
};
