import * as m from '$lib/paraglide/messages';

/** Booking status → label, in the order boards and pickers list them. */
export const BOOKING_STATUSES = [
  'pending',
  'accepted',
  'completed',
  'no_show',
  'cancelled',
  'rejected',
] as const;

const LABEL: Record<string, () => string> = {
  accepted: m.sched_status_accepted,
  pending: m.sched_status_pending,
  cancelled: m.sched_status_cancelled,
  rejected: m.sched_status_rejected,
  completed: m.sched_status_completed,
  no_show: m.sched_status_no_show,
};
export const bookingStatusLabel = (status: string): string => LABEL[status]?.() ?? status;
