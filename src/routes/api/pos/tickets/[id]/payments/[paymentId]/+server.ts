import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { hasOrgCapability, requireOrgCapability } from '$server/services/rbac.service';
import { changePaymentMethod } from '$server/services/pos.service';
import { handlePosError } from '../../../../_errors';

const patchSchema = z.object({
  method: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1).max(200),
});

/** PATCH /api/pos/tickets/:id/payments/:paymentId — body `{ method, reason }`.
 *  `pos:edit` corrects a payment while its shift is open; a closed shift's
 *  correction (a zero-net pair on the caller's open shift) also needs
 *  `pos:manage`, which the service checks from `canCorrectClosed`
 *  (spec 2026-10-15-hub-pos-shift-scoped-edits-and-emission-on-close S1). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404);
  await requireOrgCapability(locals, 'pos', 'edit');
  const body = await parseBody(request, patchSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  try {
    const result = await changePaymentMethod(ctx, params.id!, params.paymentId!, {
      ...body,
      actor,
      canCorrectClosed: await hasOrgCapability(locals, 'pos', 'manage'),
    });
    return json({ ok: true, ...result });
  } catch (e) {
    return handlePosError(e);
  }
};
