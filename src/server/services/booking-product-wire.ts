/**
 * Spec 126: the ONE serializer of `GET …/bookings/[id]` — turns the assembled `BookingDetail` into the
 * versioned `productFacets` envelope. Everything money-bearing (service rows, planned prices, tickets,
 * grant, plan, invoice id, sold totals, stock cost state) lives only inside `payment`, and `payment` is
 * `denied` unless POS AND the finance field tier were admitted — so a restricted viewer never receives a
 * legacy top-level money field to hand to an old helper.
 */
import type { BookingDetail } from './scheduling-bookings.service';
import type {
  BasicVisitMember,
  BookingFinancialProjection,
  BookingProductFacets,
  BookingStockCostFacet,
  ServiceFinancialRow,
} from '$lib/components/scheduling/booking-product-facets';

export interface DetailAdmission {
  pos: boolean;
  stock: boolean;
  /** POS admitted AND `finance:view` + the finance field tier. */
  money: boolean;
}

function costFacet(d: BookingDetail, adm: DetailAdmission): BookingStockCostFacet {
  if (!adm.stock || d.stockAnchor.state === 'denied') return { state: 'denied' };
  if (d.stockAnchor.state !== 'available') return { state: 'unavailable', reason: 'read_failed' };
  const a = d.stockAnchor.value.accrual;
  // Accrual cost scalars have no recorded valuation currency: never serialized, never relabelled.
  return !a || a.open + a.realized + a.released === 0
    ? { state: 'empty' }
    : { state: 'unavailable', reason: 'valuation_currency_unverified' };
}

export function buildBookingProductFacets(
  d: BookingDetail,
  adm: DetailAdmission,
): BookingProductFacets {
  const { booking, eventType } = d;
  const removalKnown = adm.pos && adm.stock;
  const members: BasicVisitMember[] = d.visit
    ? d.visit.members.map((m) => ({
        id: m.id,
        seq: m.seq,
        eventTypeId: m.eventTypeId,
        eventTypeTitle: m.eventTypeTitle,
        productId: m.productId,
        minutes: m.minutes,
        status: m.status,
        canRemoveService: removalKnown ? m.referenced.length === 0 : null,
      }))
    : [
        {
          id: booking.id,
          seq: 0,
          eventTypeId: booking.eventTypeId,
          eventTypeTitle: eventType?.title ?? booking.title ?? '',
          productId: booking.productId ?? eventType?.productId ?? null,
          minutes: Math.round((booking.endTime.getTime() - booking.startTime.getTime()) / 60_000),
          status: booking.status,
          canRemoveService: removalKnown ? true : null,
        },
      ];

  let payment: BookingProductFacets['payment'] = { state: 'denied' };
  if (adm.money) {
    // Ungrouped: the booking stands in as its own only service (the drawer's old fallback, now server side).
    const services: ServiceFinancialRow[] = d.visit
      ? d.visit.members.map((m) => ({
          bookingId: m.id,
          paid: m.paid,
          price: m.price,
          paidAmount: m.paidAmount,
          currency: m.currency,
          funding: m.funding,
          ticketIds: m.ticketIds,
        }))
      : [
          {
            bookingId: booking.id,
            paid: d.tickets.length > 0,
            price: d.unitPrice ?? null,
            paidAmount: d.tickets.reduce((sum, t) => sum + (Number(t.lineTotal) || 0), 0),
            currency: d.tickets[0]?.currency ?? null,
            funding: d.grant ? 'grant' : d.plan ? 'plan' : 'cash',
            ticketIds: d.tickets.map((t) => t.ticketId),
          },
        ];
    const value: BookingFinancialProjection = {
      services,
      planned: d.products,
      soldTotals: d.soldTotals,
      tickets: d.tickets.map((t) => ({
        ...t,
        submittedAt: t.submittedAt ? t.submittedAt.toISOString() : null,
      })),
      bookingInvoiceId: booking.invoiceId ?? null,
      grant: d.grant as unknown as BookingFinancialProjection['grant'],
      plan: d.plan as unknown as BookingFinancialProjection['plan'],
      accrualCost: costFacet(d, adm),
    };
    payment = { state: 'available', value };
  }

  return {
    version: 1,
    basic: {
      state: 'available',
      value: { anchorId: members[0]!.id, groupId: d.visit?.groupId ?? null, members },
    },
    planned: d.products.length
      ? {
          state: 'available',
          value: {
            rows: d.products.map((p) => ({ productId: p.productId, name: p.name, qty: p.qty })),
          },
        }
      : { state: 'empty' },
    sold: d.sold,
    payment,
    stock:
      !adm.stock || d.stockAnchor.state === 'denied'
        ? { state: 'denied' }
        : d.stockAnchor.state === 'available'
          ? {
              state: 'available',
              value: { anchorAccrual: d.stockAnchor.value.accrual, recovery: d.stockRecovery },
            }
          : d.stockAnchor,
  };
}

/** The detail body: structural fields + `productFacets`; no top-level visit/products/tickets/grant/plan/accrual/price. */
export function bookingDetailBody(d: BookingDetail, adm: DetailAdmission) {
  const { invoiceId: _i, packageGrantId: _g, paymentPlanId: _p, ...booking } = d.booking;
  void _i;
  void _g;
  void _p;
  return {
    booking,
    eventType: d.eventType,
    resource: d.resource,
    contact: d.contact,
    tags: d.tags,
    statusHistory: d.statusHistory,
    series: d.series,
    productFacets: buildBookingProductFacets(d, adm),
  };
}
