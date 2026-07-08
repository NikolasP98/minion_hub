import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getPosSettings, updatePosSettings } from '$server/services/pos.service';
import { handlePosError } from '../_errors';

const putSchema = z.object({
  methods: z.array(z.string().min(1).max(40)).min(1).optional(),
  currency: z.string().min(1).max(10).optional(),
  requireCustomer: z.boolean().optional(),
  allowPriceOverride: z.boolean().optional(),
});

/** GET /api/pos/settings */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  return json(await getPosSettings(ctx));
};

/** PUT /api/pos/settings */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'manage');
  const body = await parseBody(request, putSchema);
  try {
    const settings = await updatePosSettings(ctx, body);
    return json({ ok: true, settings });
  } catch (e) {
    return handlePosError(e);
  }
};
