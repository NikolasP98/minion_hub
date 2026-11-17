/** Test builder for the versioned booking-detail envelope (spec 126). Defaults: one cash service,
 *  everything admitted and empty; override any facet. */
import type { BasicVisitMember, BookingProductFacets } from '../booking-product-facets';

export const basicMember = (
  id: string,
  seq = 0,
  over: Partial<BasicVisitMember> = {},
): BasicVisitMember => ({
  id,
  seq,
  eventTypeId: 'et1',
  eventTypeTitle: 'Consulta',
  productId: null,
  minutes: 60,
  status: 'accepted',
  canRemoveService: true,
  ...over,
});

export function facetsOf(
  members: BasicVisitMember[],
  over: Partial<BookingProductFacets> = {},
  groupId: string | null = null,
): BookingProductFacets {
  return {
    version: 1,
    basic: { state: 'available', value: { anchorId: members[0]!.id, groupId, members } },
    planned: { state: 'empty' },
    sold: { state: 'empty' },
    payment: {
      state: 'available',
      value: {
        services: members.map((m) => ({
          bookingId: m.id,
          paid: false,
          price: null,
          paidAmount: 0,
          currency: null,
          funding: 'cash' as const,
          ticketIds: [],
        })),
        planned: [],
        soldTotals: [],
        tickets: [],
        bookingInvoiceId: null,
        grant: null,
        plan: null,
        accrualCost: { state: 'empty' },
      },
    },
    stock: { state: 'available', value: { anchorAccrual: null, recovery: { state: 'empty' } } },
    ...over,
  };
}

export function wireDetail(
  id: string,
  attendeeName: string,
  facets?: BookingProductFacets,
  booking: Record<string, unknown> = {},
) {
  return {
    booking: {
      id,
      status: 'accepted',
      title: null,
      eventTypeId: 'et1',
      resourceId: 'r1',
      productId: null,
      partyId: null,
      startTime: '2026-10-07T14:00:00.000Z',
      endTime: '2026-10-07T15:00:00.000Z',
      attendeeName,
      attendeeEmail: null,
      attendeePhone: null,
      crmContactId: null,
      notes: `${attendeeName} note`,
      clientNote: null,
      updatedAt: '2026-10-07T00:00:00.000Z',
      ...booking,
    },
    eventType: { id: 'et1', title: 'Consulta' },
    resource: { id: 'r1', name: 'Leiva', profileId: null },
    contact: null,
    statusHistory: [],
    series: null,
    tags: { own: [], contact: [], service: [] },
    productFacets: facets ?? facetsOf([basicMember(id)]),
  };
}
