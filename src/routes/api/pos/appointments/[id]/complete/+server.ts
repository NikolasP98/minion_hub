import type { RequestHandler } from '@sveltejs/kit';
import { POST as schedulingComplete } from '../../../../scheduling/bookings/[id]/complete/+server';

/**
 * POST /api/pos/appointments/[id]/complete — the scheduling handler under the
 * POS path: the central gate maps `/api/pos` writes to `pos:edit`, so a
 * cashier can close an appointment from the POS calendar without a scheduling
 * role. Same body and response as the scheduling route.
 */
export const POST: RequestHandler = (event) => schedulingComplete(event);
