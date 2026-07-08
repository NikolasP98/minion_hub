import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { getFinSettings, updateFinSettings, refreshExchangeRate } from '$server/services/finance.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ settings: await getFinSettings(ctx) });
};

const putSchema = z.object({
  currency: z.string().min(2).max(8).optional(),
  taxRate: z.number().min(0).max(0.9999).optional(), // fraction, not percent
  fxMode: z.enum(['auto', 'manual']).optional(),
  fxManualRate: z.number().positive().nullable().optional(),
});

export const PUT: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'finance', 'edit');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, putSchema);
  try {
    return json({ settings: await updateFinSettings(ctx, body) });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid settings');
  }
};

/** Refresh the auto exchange rate from the online source. */
export const POST: RequestHandler = async ({ locals }) => {
  await requireOrgCapability(locals, 'finance', 'edit');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  try {
    return json({ settings: await refreshExchangeRate(ctx) });
  } catch (e) {
    throw error(502, e instanceof Error ? e.message : 'exchange refresh failed');
  }
};
