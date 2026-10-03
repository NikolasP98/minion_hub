import type { RequestHandler } from '@sveltejs/kit';
import { requireSchedulingRead } from '$server/auth/scheduling-read';
import { staffSlotsResponse } from './_response';

/** Scheduling staff slot lookup; POS uses its own capability-gated wrapper. */
export const GET: RequestHandler = async ({ locals, url }) =>
  staffSlotsResponse(await requireSchedulingRead(locals), url);
