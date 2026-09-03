import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { decideLeaveRequest } from '$server/services/hr.service';
import { hrCtx, hrTry } from '../../_shared';

const patchSchema = z.object({ status: z.enum(['approved', 'rejected', 'cancelled']) });

/** PATCH /api/scheduling/hr/leave-requests/:id { status } — approve / reject / cancel. */
export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, patchSchema);
  return hrTry(async () => ({ request: await decideLeaveRequest(ctx, params.id!, b.status) }));
};
