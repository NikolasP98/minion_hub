import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { requireOrgCapability } from '$server/services/rbac.service';
import {
  deleteBundleComponent,
  getPackageValidityDays,
  listBundleEdges,
  setBundleComponent,
  setPackageValidityDays,
} from '$server/services/pos.service';
import { handlePosError } from '../../../_errors';

/**
 * Package composition for one sellable: the `fin_product_components` edges that
 * turn it into a package, plus its validity window.
 *
 * The edges and `metadata.packageValidityDays` are FINANCE-catalog rows reached
 * through a pos URL, so — exactly like the field guard in `_owning-modules.ts`
 * — the central `/api/pos` capability is necessary but not sufficient: the
 * owning module's capability is required on top.
 */
const putSchema = z.object({
  components: z
    .array(
      z.object({
        childProductId: z.string().uuid(),
        qty: z.number().positive(),
        lineNo: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  /** null clears the expiry; omitted leaves it alone. */
  packageValidityDays: z.number().int().positive().nullable().optional(),
});

const deleteSchema = z.object({ componentId: z.string().uuid() });

/** GET /api/pos/sellables/:id/components */
export const GET: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  // Reads here expose client stored-value balances and paid-session history —
  // money + PII, not catalog. Writes are gated centrally by apiWriteCapability;
  // this is the matching READ gate (RBAC checklist step 1).
  await requireOrgCapability(locals, 'pos', 'view');
  try {
    const edges = await listBundleEdges(ctx);
    return json({
      components: edges.filter((e) => e.bundleProductId === params.id),
      packageValidityDays: await getPackageValidityDays(ctx, params.id as string),
    });
  } catch (e) {
    return handlePosError(e);
  }
};

/**
 * PUT /api/pos/sellables/:id/components — REPLACES the edge set (same shape as
 * updateSellable's `consumption` patch: anything missing from the body is
 * removed), and optionally sets the validity window.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'finance', 'edit');
  const body = await parseBody(request, putSchema);
  const bundleProductId = params.id as string;
  try {
    if (body.packageValidityDays !== undefined)
      await setPackageValidityDays(ctx, bundleProductId, body.packageValidityDays);
    if (body.components) {
      const existing = (await listBundleEdges(ctx)).filter(
        (e) => e.bundleProductId === bundleProductId,
      );
      const keep = new Set(body.components.map((c) => c.childProductId));
      for (const edge of existing)
        if (!keep.has(edge.childProductId)) await deleteBundleComponent(ctx, edge.id);
      for (const [i, c] of body.components.entries())
        await setBundleComponent(ctx, { bundleProductId, ...c, lineNo: c.lineNo ?? i });
    }
    const edges = await listBundleEdges(ctx);
    return json({
      ok: true,
      components: edges.filter((e) => e.bundleProductId === bundleProductId),
      packageValidityDays: await getPackageValidityDays(ctx, bundleProductId),
    });
  } catch (e) {
    return handlePosError(e);
  }
};

/** DELETE /api/pos/sellables/:id/components — remove one edge by id. */
export const DELETE: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'finance', 'delete');
  const { componentId } = await parseBody(request, deleteSchema);
  try {
    if (!(await deleteBundleComponent(ctx, componentId))) throw error(404);
    return json({ ok: true });
  } catch (e) {
    return handlePosError(e);
  }
};
