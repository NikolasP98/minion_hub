import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import { schedBookings } from '$server/db/pg-scheduling-schema';
import { crmContacts } from '$server/db/pg-crm-schema';
import { parties } from '$server/db/pg-party-schema';
import { posPackageRedemptions, posTicketLines, posTickets } from '$server/db/pg-pos-schema';
import { PosError, type SubmitTicketInput } from './pos.service';
import type { PosWorkflow } from '$lib/pos/workflow';
import type { ClientRef } from './pos-accounts.service';

/** The booking row is the mutex shared by charge and booking state changes.
 * Locks are acquired in ID order before inserting a NEW ticket. */
export async function assertBookingChargesInTx(
  tx: CoreTx,
  orgId: string,
  input: SubmitTicketInput,
  workflow: PosWorkflow,
): Promise<ClientRef> {
  const lines = input.lines.filter((line) => line.bookingId);
  if (!lines.length)
    return { partyId: input.partyId ?? null, crmContactId: input.crmContactId ?? null };
  const ids = lines.map((line) => line.bookingId!);
  if (new Set(ids).size !== ids.length)
    throw new PosError('one booking cannot appear twice on a ticket', 'duplicate_booking');
  const bookings = await tx
    .select()
    .from(schedBookings)
    .where(and(eq(schedBookings.orgId, orgId), inArray(schedBookings.id, ids)))
    .orderBy(asc(schedBookings.id))
    .for('update');
  if (bookings.length !== ids.length) throw new PosError('booking not found', 'not_found');
  const contactIds = [
    ...new Set(
      [...bookings.map((b) => b.crmContactId), input.crmContactId].filter((id): id is string =>
        Boolean(id),
      ),
    ),
  ];
  const contacts = contactIds.length
    ? await tx
        .select({ id: crmContacts.id, partyId: crmContacts.partyId })
        .from(crmContacts)
        .where(and(eq(crmContacts.orgId, orgId), inArray(crmContacts.id, contactIds)))
    : [];
  // Stored references are soft pointers too: legacy/edit paths must not turn a
  // foreign or deleted contact into a new ticket customer.
  if (contacts.length !== contactIds.length) throw new PosError('customer not found', 'not_found');
  const partyByContact = new Map(contacts.map((c) => [c.id, c.partyId]));
  if (input.crmContactId) {
    const contact = contacts.find((c) => c.id === input.crmContactId);
    if (!contact) throw new PosError('customer not found', 'not_found');
    if (input.partyId && contact.partyId !== input.partyId)
      throw new PosError('customer references do not agree', 'booking_customer_mismatch');
  }
  const partyIds = new Set(
    [input.partyId, ...bookings.map((b) => b.partyId), ...contacts.map((c) => c.partyId)].filter(
      (id): id is string => Boolean(id),
    ),
  );
  const crmIds = new Set(
    [input.crmContactId, ...bookings.map((b) => b.crmContactId)].filter((id): id is string =>
      Boolean(id),
    ),
  );
  if (partyIds.size > 1 || (partyIds.size === 0 && crmIds.size > 1))
    throw new PosError('appointments belong to different customers', 'booking_customer_mismatch');
  const billingClient: ClientRef = {
    partyId: [...partyIds][0] ?? null,
    crmContactId: input.crmContactId ?? (crmIds.size === 1 ? [...crmIds][0] : null) ?? null,
  };

  for (const line of lines) {
    const booking = bookings.find((b) => b.id === line.bookingId)!;
    if (line.kind !== 'service' || line.qty !== 1 || line.planId)
      throw new PosError('a booking charge must be one service', 'invalid_booking_line');
    if (!['pending', 'accepted', 'completed'].includes(booking.status))
      throw new PosError(
        'booking cannot be charged in its current state',
        'booking_not_chargeable',
      );
    if (workflow.appointmentPayment === 'after_completion' && booking.status !== 'completed')
      throw new PosError(
        'complete the appointment before taking payment',
        'booking_payment_timing',
      );
    if (!booking.productId || booking.productId !== line.finProductId)
      throw new PosError('service does not match booking', 'booking_product_mismatch');
    const partyId =
      booking.partyId ?? (booking.crmContactId ? partyByContact.get(booking.crmContactId) : null);
    if (
      (partyId && billingClient.partyId !== partyId) ||
      (booking.crmContactId && input.crmContactId && input.crmContactId !== booking.crmContactId) ||
      (!partyId && booking.crmContactId && billingClient.crmContactId !== booking.crmContactId)
    )
      throw new PosError('customer does not match booking', 'booking_customer_mismatch');
    if (booking.paymentPlanId)
      throw new PosError('bill this appointment through its payment plan', 'booking_has_plan');
    if (booking.packageGrantId || line.redemptionId) {
      const [redemption] = line.redemptionId
        ? await tx
            .select()
            .from(posPackageRedemptions)
            .where(
              and(
                eq(posPackageRedemptions.orgId, orgId),
                eq(posPackageRedemptions.id, line.redemptionId),
              ),
            )
        : [];
      if (
        !redemption ||
        redemption.bookingId !== booking.id ||
        redemption.grantId !== booking.packageGrantId ||
        redemption.reversedAt
      )
        throw new PosError('package session does not match booking', 'booking_redemption_mismatch');
    }
  }
  if (billingClient.partyId) {
    const [party] = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(and(eq(parties.orgId, orgId), eq(parties.id, billingClient.partyId)))
      .limit(1);
    if (!party) throw new PosError('customer not found', 'not_found');
  }
  // Read after the row locks: a concurrent claimant committed before we acquired
  // its lock is visible under READ COMMITTED. Voids retain history but not coverage.
  const existing = await tx
    .select({ id: posTicketLines.id })
    .from(posTicketLines)
    .innerJoin(
      posTickets,
      and(eq(posTickets.id, posTicketLines.ticketId), eq(posTickets.orgId, orgId)),
    )
    .where(
      and(
        eq(posTicketLines.orgId, orgId),
        inArray(posTicketLines.bookingId, ids),
        notInArray(posTickets.status, ['void', 'voided']),
      ),
    )
    .limit(1);
  if (existing.length)
    throw new PosError('appointment already has a live charge', 'booking_already_billed');
  return billingClient;
}
