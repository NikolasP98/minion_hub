import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import {
  listLeaveRequests,
  createLeaveRequest,
  getLeaveBalance,
} from '$server/services/hr.service';
import { hrCtx, hrTry } from '../_shared';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const postSchema = z.object({
  employeeId: z.string().max(200),
  leaveTypeId: z.string().max(200),
  fromDate: DATE,
  toDate: DATE,
  halfDay: z.boolean().optional(),
  reason: z.string().max(2000).nullable().optional(),
});
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/** GET /api/scheduling/hr/leave-requests[?employeeId&status=a,b&from&to] — add `balance=1&leaveTypeId=…&on=…` for the live balance. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await hrCtx(locals);
  const q = url.searchParams;
  return hrTry(async () => {
    if (q.get('balance') === '1') {
      const employeeId = q.get('employeeId') ?? '';
      const leaveTypeId = q.get('leaveTypeId') ?? '';
      const on = q.get('on') ?? new Date().toISOString().slice(0, 10);
      return { balance: await getLeaveBalance(ctx, employeeId, leaveTypeId, on) };
    }
    const status = (q.get('status') ?? '')
      .split(',')
      .filter((s): s is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(s));
    return {
      requests: await listLeaveRequests(ctx, {
        employeeId: q.get('employeeId') ?? undefined,
        status: status.length ? status : undefined,
        from: q.get('from') ?? undefined,
        to: q.get('to') ?? undefined,
      }),
    };
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await hrCtx(locals);
  const b = await parseBody(request, postSchema);
  return hrTry(async () => ({ request: await createLeaveRequest(ctx, b) }));
};
