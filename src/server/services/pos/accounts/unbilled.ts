import { sql } from 'drizzle-orm';

/**
 * Scheduled, not invoiced — the SQL form of `chargeableRows`
 * (`$lib/components/scheduling/visit.ts`), which is the ONE rule behind the
 * appointment drawer's Charge button and the calendar's "Cobrar" context item:
 * a service still owes money when it is not closed (`isInactiveMemberStatus`),
 * is settled at the till rather than by a grant or an instalment plan
 * (`funding === 'cash'`, i.e. the booking carries neither link) and no non-void
 * POS ticket line has charged it yet (`paid`, as `visitForBooking` derives it —
 * legacy `'voided'` included, same as every other paid-to-date read).
 *
 * A service whose resolved price is exactly 0 is never owed (`r.price !== 0`):
 * price resolves as the client does — `coalesce(booking product, event type
 * product)` → ACTIVE `fin_products.unit_price`. No product / inactive product
 * is price null, which stays owed.
 *
 * `invoice_id is null` is the one condition `chargeableRows` has no access to:
 * the till only knows ticket lines, while a booking invoiced through the
 * fin_invoices bridge (`linkInvoiceToBookings`) is invoiced by definition and
 * must not read as pending.
 *
 * Expects the bookings table aliased `b`; the caller adds org scope and
 * whatever client condition its own projection needs.
 */
export const UNBILLED_BOOKING_WHERE = sql`
  b.status not in ('cancelled', 'rejected', 'no_show')
  and b.package_grant_id is null
  and b.payment_plan_id is null
  and b.invoice_id is null
  and not exists (
    select 1 from public.fin_products p
    where p.org_id = b.org_id and p.active and p.unit_price = 0
      and p.id = coalesce(b.product_id,
        (select et.product_id from public.sched_event_types et
         where et.org_id = b.org_id and et.id = b.event_type_id))
  )
  and not exists (
    select 1
    from public.pos_ticket_lines tl
    join public.pos_tickets t on t.id = tl.ticket_id and t.org_id = tl.org_id
    where tl.org_id = b.org_id and tl.booking_id = b.id
      and t.status not in ('void', 'voided')
  )`;

// TODO(handoff): the anti-join has no index to lean on — `pos_ticket_lines`
// is indexed by ticket/product/plan/redemption but not by `booking_id`, so
// both readers (the /pos/accounts projection and the /pos side-menu badge,
// which runs on every POS page load) pay a hash anti-join over the org's
// ticket lines. Add `pos_ticket_lines (org_id, booking_id) where booking_id
// is not null` if it shows up in slow queries; no migration ships with this
// change (a schema change here would also owe a QA seed, see CLAUDE.md).
