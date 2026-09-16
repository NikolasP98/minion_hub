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

// Open map by design (pos.service `PosRequirements`): a new requirement adds a
// key here, never a new boolean column. Absent = unchanged; absent key inside
// the object = 'off' (normalizeRequirements).
const requirementsSchema = z.object({
  identityDocument: z.enum(['off', 'optional', 'required']),
});

const putSchema = z.object({
  methods: z.array(paymentMethodSchema).min(1).optional(),
  currency: z.string().min(1).max(10).optional(),
  requireCustomer: z.boolean().optional(),
  allowPriceOverride: z.boolean().optional(),
  emission: emissionSchema.optional(),
  requirements: requirementsSchema.optional(),
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
    try {
      return handlePosError(e);
    } catch (unhandled) {
      // handlePosError re-throws anything that isn't a domain PosError. A
      // save the caller shaped should tell them WHY it failed instead of
      // surfacing an opaque 500.
      // TODO(handoff): could not reproduce the reported 500 (PUT with
      // requirements.identityDocument='required') against a live DB from this
      // sandbox — no database access was available. `validateRequirements`
      // above closes the one real gap found by static review (methods/
      // emission validate before the write, requirements didn't). If this
      // still 500s in a real environment, the next suspect is schema drift:
      // confirm migration 20260915000000_pos_requirements_pending_scheduling.sql
      // actually ran against the live DB — pg-pos-schema.test.ts only checks
      // the Drizzle declaration, not the deployed table.
      const message = unhandled instanceof Error ? unhandled.message : 'could not save settings';
      console.error('[pos/settings PUT] unhandled error', unhandled);
      return json({ error: message, code: 'settings_save_failed' }, { status: 400 });
    }
  }
};
