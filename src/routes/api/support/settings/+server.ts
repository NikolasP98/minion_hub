import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { getSlaConfig, setSlaConfig, DEFAULT_SLA, PRIORITIES } from '$server/services/support.service';

const slaTierSchema = z.object({
  responseMins: z.coerce.number().nonnegative(),
  resolutionMins: z.coerce.number().nonnegative(),
});
const putSchema = z.object({ priorities: z.partialRecord(z.enum(PRIORITIES), slaTierSchema) });

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await getSlaConfig(ctx));
};

/** PUT /api/support/settings — admin: update the per-org default SLA. */
export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, putSchema);
  // Same merge-with-default that getSlaConfig applies on read, done here so a
  // partial PUT still satisfies the service's full-Record<Priority,SlaTier> type.
  await setSlaConfig(ctx, { priorities: { ...DEFAULT_SLA.priorities, ...body.priorities } });
  return json({ ok: true });
};
