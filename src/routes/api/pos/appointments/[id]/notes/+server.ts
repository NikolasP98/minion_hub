import type { RequestHandler } from '@sveltejs/kit';
import { PUT as schedulingNotes } from '../../../../scheduling/bookings/[id]/notes/+server';

/** PUT /api/pos/appointments/[id]/notes — scheduling handler under the POS path (pos:edit). */
export const PUT: RequestHandler = (event) => schedulingNotes(event);
