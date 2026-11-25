import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { closeCase } from '$server/services/reconfirm.service';

const bodySchema = z.object({ note: z.string().max(500).nullable().optional() });
const uuid = z.string().uuid();

/**
 * POST /api/scheduling/reconfirmations/[id]/close (spec 139): staff mark a reminder follow-up as
 * handled ("Marcar como atendido"). Closes the case only; the appointment is never touched.
 * Idempotent: closing a closed case answers 200 as well.
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  await requireOrgCapability(locals, 'scheduling', 'manage');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const { note } = await parseBody(request, bodySchema);
  const id = uuid.safeParse(params.id);
  if (!id.success) return json({ ok: false, code: 'not_found' }, { status: 404 });
  const outcome = await closeCase(ctx, id.data, {
    profileId: ctx.profileId ?? null,
    action: 'attended',
    note: note ?? null,
  });
  if (outcome === 'not_found') return json({ ok: false, code: 'not_found' }, { status: 404 });
  return json({ ok: true });
};
