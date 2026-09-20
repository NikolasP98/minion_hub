import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getPosSettings, updatePosSettings } from '$server/services/pos.service';
import { handlePosError } from '../_errors';
import { REQUIREMENT_KINDS, REQUIREMENT_LEVELS, type RequirementKind } from '$lib/pos/requirements';

const paymentMethodSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  enabled: z.boolean(),
  takesTendered: z.boolean(),
  surcharge: z.object({ type: z.enum(['percent', 'fixed']), amount: z.number() }).optional(),
  documentDefault: z.enum(['03', '01']).nullable().optional(),
  sunat: z.boolean().optional(),
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
const requirementLevel = z.enum(REQUIREMENT_LEVELS);
const requirementsSchema = z.object(
  Object.fromEntries(REQUIREMENT_KINDS.map((k) => [k, requirementLevel.optional()])) as Record<
    RequirementKind,
    z.ZodOptional<typeof requirementLevel>
  >,
);

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
      // TODO(handoff): the confirmed root cause (QA-stack app logs) was
      // `seedShadowSeries` (pos-emission.service.ts) hitting the PARTIAL
      // unique index `pos_series_one_active_per_env` — its `on conflict`
      // targeted only `pos_series_org_doc_serie_uniq`, so an org with an
      // existing active beta serie under a non-B999/F999 name still 500'd.
      // Fixed by widening the ON CONFLICT to untargeted `do nothing` (absorbs
      // either unique index) + a `series_conflict`→409 PosError fallback for
      // anything that slips through. This catch-all stays as a last resort
      // for any OTHER unexpected persistence error on this endpoint.
      const message = unhandled instanceof Error ? unhandled.message : 'could not save settings';
      console.error('[pos/settings PUT] unhandled error', unhandled);
      return json({ error: message, code: 'settings_save_failed' }, { status: 400 });
    }
  }
};
