import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { updateEmployee } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../../_shared';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().max(320).nullable().optional(),
  designation: z.string().max(200).nullable().optional(),
  joinedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  partyId: z.string().max(200).nullable().optional(),
  status: z.enum(['active', 'left']).optional(),
  leftOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/** PATCH /api/scheduling/hr/employees/:id — edit; `status:'left'` needs `leftOn`. */
export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, patchSchema);
  return hrTry(async () => {
    await updateEmployee(ctx, params.id!, b);
    return { ok: true };
  });
};
