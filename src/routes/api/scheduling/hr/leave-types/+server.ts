import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { listLeaveTypes, upsertLeaveType } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../_shared';

const postSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(200),
  paid: z.boolean().optional(),
  allowNegative: z.boolean().optional(),
  includeHoliday: z.boolean().optional(),
  maxDaysPerRequest: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await hrCtx(locals);
  return hrTry(async () => ({ leaveTypes: await listLeaveTypes(ctx) }));
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, postSchema);
  return hrTry(async () => ({ leaveType: await upsertLeaveType(ctx, b) }));
};
