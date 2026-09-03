import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { listAllocations, upsertAllocation } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../_shared';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const postSchema = z.object({
  id: z.string().max(200).optional(),
  employeeId: z.string().max(200),
  leaveTypeId: z.string().max(200),
  periodStart: DATE,
  periodEnd: DATE,
  days: z.number().nonnegative(),
});

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await hrCtx(locals);
  return hrTry(async () => ({
    allocations: await listAllocations(ctx, url.searchParams.get('employeeId') ?? undefined),
  }));
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, postSchema);
  return hrTry(async () => ({ allocation: await upsertAllocation(ctx, b) }));
};
