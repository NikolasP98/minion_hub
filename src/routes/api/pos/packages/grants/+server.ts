import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listGrants } from '$server/services/pos-packages.service';
import { handlePosError } from '../../_errors';

/**
 * GET /api/pos/packages/grants?partyId=&crmContactId=&serviceProductId=&limit=
 * — one client's package grants with sessions used/remaining and the DERIVED
 * status (a grant whose stored status is 'active' may read 'expired' here).
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
    const grants = await listGrants(
      ctx,
      {
        partyId: url.searchParams.get('partyId'),
        crmContactId: url.searchParams.get('crmContactId'),
      },
      {
        serviceProductId: url.searchParams.get('serviceProductId') ?? undefined,
        limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
      },
    );
    return json({ grants });
  } catch (e) {
    return handlePosError(e);
  }
};
