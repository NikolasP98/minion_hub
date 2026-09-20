import { describe, expect, it } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import type { CoreTx } from '$server/db/with-org-core';
import { assertBookingChargesInTx } from './pos-booking-charge';
import type { SubmitTicketInput } from './pos.service';
import { DEFAULT_POS_WORKFLOW } from '$lib/pos/workflow';

const booking = {
  id: 'booking',
  status: 'accepted',
  productId: 'service',
  partyId: 'customer',
  crmContactId: null,
};
const input: SubmitTicketInput = {
  partyId: 'customer',
  actor: { id: null, name: null },
  lines: [
    {
      bookingId: 'booking',
      finProductId: 'service',
      kind: 'service',
      qty: 1,
      unitPrice: 80,
      description: 'Treatment',
    },
  ],
  payments: [{ method: 'cash', amount: 80 }],
};
function run(rows: unknown[][], request = input, workflow = DEFAULT_POS_WORKFLOW) {
  const { db, resolveSequence } = createMockDb();
  resolveSequence(rows);
  return assertBookingChargesInTx(db as unknown as CoreTx, 'org', request, workflow);
}
describe('ordinary appointment billing boundary', () => {
  it('rejects a foreign or missing canonical booking party', async () => {
    await expect(run([[booking], []])).rejects.toMatchObject({ code: 'not_found' });
  });
  it('rejects a foreign or missing canonical booking contact', async () => {
    await expect(run([[{ ...booking, crmContactId: 'foreign' }], []])).rejects.toMatchObject({
      code: 'not_found',
    });
  });
  it('accepts an unbilled matching appointment', async () => {
    await expect(run([[booking], [{ id: 'customer' }], []])).resolves.toEqual({
      partyId: 'customer',
      crmContactId: null,
    });
  });
  it('rejects already billed appointments', async () => {
    await expect(
      run([[booking], [{ id: 'customer' }], [{ id: 'paid-line' }]]),
    ).rejects.toMatchObject({ code: 'booking_already_billed' });
  });
  it('does not reveal foreign or missing bookings', async () => {
    await expect(run([[]])).rejects.toMatchObject({ code: 'not_found' });
  });
  it('rejects duplicate references in one cart', async () => {
    await expect(
      run([], { ...input, lines: [...input.lines, ...input.lines] }),
    ).rejects.toMatchObject({ code: 'duplicate_booking' });
  });
  it.each(['cancelled', 'rejected', 'no_show'])('rejects %s booking', async (status) => {
    await expect(run([[{ ...booking, status }]])).rejects.toMatchObject({
      code: 'booking_not_chargeable',
    });
  });
  it('rejects a different customer', async () => {
    await expect(
      run([[booking], [{ id: 'other' }]], { ...input, partyId: 'other' }),
    ).rejects.toMatchObject({ code: 'booking_customer_mismatch' });
  });
  it('rejects a different service', async () => {
    await expect(run([[{ ...booking, productId: 'other' }]])).rejects.toMatchObject({
      code: 'booking_product_mismatch',
    });
  });
  it('rejects foreign CRM identity even for a bare-party booking', async () => {
    await expect(run([[booking], []], { ...input, crmContactId: 'foreign' })).rejects.toMatchObject(
      { code: 'not_found' },
    );
  });
  it('rejects mismatched customer facets', async () => {
    await expect(
      run([[booking], [{ id: 'contact', partyId: 'other' }]], {
        ...input,
        crmContactId: 'contact',
      }),
    ).rejects.toMatchObject({ code: 'booking_customer_mismatch' });
  });
  it('enforces completion-only policy but permits payment after completion', async () => {
    const policy = { ...DEFAULT_POS_WORKFLOW, appointmentPayment: 'after_completion' as const };
    await expect(run([[booking]], input, policy)).rejects.toMatchObject({
      code: 'booking_payment_timing',
    });
    await expect(
      run([[{ ...booking, status: 'completed' }], [{ id: 'customer' }], []], input, policy),
    ).resolves.toEqual({ partyId: 'customer', crmContactId: null });
  });
  it('rejects package bypass without its redemption', async () => {
    await expect(run([[{ ...booking, packageGrantId: 'grant' }]])).rejects.toMatchObject({
      code: 'booking_redemption_mismatch',
    });
  });
  it('derives contact-only identity from the authoritative booking', async () => {
    await expect(
      run(
        [
          [{ ...booking, partyId: null, crmContactId: 'contact' }],
          [{ id: 'contact', partyId: null }],
          [],
        ],
        { ...input, partyId: null },
      ),
    ).resolves.toEqual({ partyId: null, crmContactId: 'contact' });
  });
});
