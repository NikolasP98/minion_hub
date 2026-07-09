import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getRetentionDays, setRetentionDays } from '$server/services/email-ledger.service';

/** GET /api/email-ledger/settings → { retentionDays } */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await requireCoreCtx(locals);
  return json({ retentionDays: await getRetentionDays(ctx) });
};

/**
 * PUT /api/email-ledger/settings  body: { retentionDays }
 * Editing the retention horizon is a channels-config action.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'channels', 'edit');
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => ({}))) as { retentionDays?: unknown };
  const days = Number(body.retentionDays);
  if (!Number.isFinite(days) || days < 0) {
    throw error(400, 'retentionDays must be a non-negative number (0 = keep indefinitely)');
  }
  return json({ retentionDays: await setRetentionDays(ctx, days) });
};
