import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listPartyPaidServices } from '$server/services/pos-accounts.service';
import { handlePosError } from '../_errors';

/**
 * GET /api/pos/treatments?partyId=&crmContactId=&limit= — one client's paid
 * service lines (newest first) with the appointment each is linked to. The
 * checkup form digs into this to pick the treatment a checkup follows.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  // Paid history is money + PII — same READ gate as the packages/grants read.
  await requireOrgCapability(locals, 'pos', 'view');
  const limitParam = Number(url.searchParams.get('limit'));
  try {
    const treatments = await listPartyPaidServices(
      ctx,
      {
        partyId: url.searchParams.get('partyId'),
        crmContactId: url.searchParams.get('crmContactId'),
      },
      { limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined },
    );
    return json({ treatments });
  } catch (e) {
    return handlePosError(e);
  }
};
