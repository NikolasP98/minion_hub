import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listPeriodLocks, setPeriodLock } from '$server/services/pos.service';
import { handlePosError } from '../../pos/_errors';

/** GET /api/finances/period-locks — the months the accountant has closed. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ locks: await listPeriodLocks(ctx) });
};

const putSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  locked: z.boolean(),
  note: z.string().max(500).nullable().optional(),
});

/** PUT /api/finances/period-locks — `{period: 'YYYY-MM', locked, note?}`.
 *  `finance:manage`: closing a month refuses every POS mutation in it (spec
 *  2026-10-15 T4), so this is the accountant's call, not a clerk's. */
export const PUT: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  await requireOrgCapability(locals, 'finance', 'manage');
  const body = await parseBody(request, putSchema);
  const actor = {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? locals.user?.email ?? null,
  };
  try {
    return json({ locks: await setPeriodLock(ctx, { ...body, actor }) });
  } catch (e) {
    return handlePosError(e);
  }
};
