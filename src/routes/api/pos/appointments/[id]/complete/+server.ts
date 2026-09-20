/**
 * POST /api/pos/appointments/[id]/complete — the scheduling handler under the
 * POS path: the central gate maps `/api/pos` writes to `pos:edit`, so a
 * cashier can close an appointment from the POS calendar without a scheduling
 * role. Same body and response as the scheduling route.
 */
export { POST } from '../../../../scheduling/bookings/[id]/complete/+server';
