import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { listEmployees, enrolEmployee } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../_shared';

const postSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().max(320).nullable().optional(),
  profileId: z.string().max(200).nullable().optional(),
  partyId: z.string().max(200).nullable().optional(),
  designation: z.string().max(200).nullable().optional(),
  department: z.string().max(200).nullable().optional(),
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'intern']).nullable().optional(),
  joinedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/** GET /api/scheduling/hr/employees[?all=1] — roster (active by default). */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await hrCtx(locals);
  return hrTry(async () => ({
    employees: await listEmployees(ctx, { includeLeft: url.searchParams.get('all') === '1' }),
  }));
};

/** POST — enrol: employee + bookable resource in one transaction. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, postSchema);
  return hrTry(async () => ({ employee: await enrolEmployee(ctx, b) }));
};
