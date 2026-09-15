/**
 * What "pending scheduling" means for one ticket line.
 *
 * ONE definition, shared by the post-sale schedule step and (in SQL) the
 * `/pos/accounts` derivation, so the till and the account list can never
 * disagree about which lines still owe an appointment.
 */
export interface SchedulableLine {
  kind: string;
  bookingId: string | null;
  /** Set when the line is an INSTALMENT against a payment plan, not a sale. */
  planId?: string | null;
}

/**
 * An instalment is money against a plan, not a service to be performed. It is
 * carried as `kind: 'service'` with a null `finProductId` so the money path
 * treats it like any other line, which means the naive
 * "service line with no booking" rule would offer it for scheduling and invite
 * the front desk to book an appointment against a payment. `plan_id` is the
 * discriminator, and it is the only one: a real service line never carries it.
 */
export function isPendingScheduling(line: SchedulableLine): boolean {
  return line.kind === 'service' && !line.bookingId && !line.planId;
}

/** Already booked. Instalments are excluded here too — they are never bookable. */
export function isScheduled(line: SchedulableLine): boolean {
  return line.kind === 'service' && Boolean(line.bookingId) && !line.planId;
}
