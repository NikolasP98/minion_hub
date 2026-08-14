import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getPosSettings, updatePosSettings } from '$server/services/pos.service';
import { handlePosError } from '../_errors';

const paymentMethodSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  enabled: z.boolean(),
  takesTendered: z.boolean(),
  surcharge: z.object({ type: z.enum(['percent', 'fixed']), amount: z.number() }).optional(),
  documentDefault: z.enum(['03', '01']).nullable().optional(),
});

// 'prod' is deliberately NOT in this enum (spec 2026-08-14-pos-shadow-
// emission-spec.md §1) — the value doesn't exist yet, zod rejects it before
// it ever reaches pos.service's validateEmission.
const emissionSchema = z.object({
  mode: z.enum(['off', 'shadow']),
  docTypeDefault: z.enum(['03', '01']),
});

const putSchema = z.object({
  methods: z.array(paymentMethodSchema).min(1).optional(),
  currency: z.string().min(1).max(10).optional(),
  requireCustomer: z.boolean().optional(),
  allowPriceOverride: z.boolean().optional(),
  emission: emissionSchema.optional(),
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
