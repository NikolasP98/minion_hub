import { and, desc, eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { salesOrders, type SalesOrder } from '$server/db/pg-sales-schema';
import { schedBookings, schedEventTypes } from '$server/db/pg-scheduling-schema';
import { finProducts } from '$server/db/pg-finance-schema';
import { nextSerialId } from './naming-series';
import { docAuditLog } from '$server/db/pg-activity-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import { StaleWriteError, staleGuard } from './errors';

export type OrderStatus = 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
export const ORDER_STATUSES: OrderStatus[] = ['draft', 'confirmed', 'invoiced', 'cancelled'];
const OPEN_ORDER = sql`status in ('draft','confirmed')`;

/**
 * The concrete document mapper: Booking → Sales Order (ERPNext get_mapped_doc
 * analog). Snapshots the booking's event-type product (price/description) and
 * carries the source_booking_id backref + party/contact links. Idempotent — one
 * order per booking (unique index); a second call returns the existing order.
 *
 * ponytail: a hand-written mapper for the one chain that matters beats a generic
 * mapping DSL. Add the next chain (e.g. Order → SUSII reconcile) as another
 * named function when it's needed.
 */
export async function createOrderFromBooking(ctx: CoreCtx, bookingId: string): Promise<SalesOrder> {
  return withOrgCore(ctx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.orgId, ctx.tenantId), eq(salesOrders.sourceBookingId, bookingId)))
      .limit(1);
    if (existing) return existing;

    const [b] = await tx
      .select()
      .from(schedBookings)
      .where(and(eq(schedBookings.id, bookingId), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1);
    if (!b) throw new Error('booking not found');

    // Resolve the priced line from the event type's product (snapshot).
    const [et] = await tx
      .select({ title: schedEventTypes.title, productId: schedEventTypes.productId })
      .from(schedEventTypes)
      .where(eq(schedEventTypes.id, b.eventTypeId))
      .limit(1);
    const productId = b.productId ?? et?.productId ?? null;
    let unitPrice: string | null = null;
    let description = et?.title ?? b.title ?? 'Appointment';
    if (productId) {
      const [p] = await tx
        .select({ name: finProducts.name, unitPrice: finProducts.unitPrice })
        .from(finProducts)
        .where(and(eq(finProducts.id, productId), eq(finProducts.orgId, ctx.tenantId)))
        .limit(1);
      if (p) {
        unitPrice = p.unitPrice ?? null;
        description = p.name ?? description;
      }
    }

    const humanId = await nextSerialId(tx, ctx.tenantId, 'SO-.YYYY.-', new Date());
    const [order] = await tx
      .insert(salesOrders)
      .values({
        orgId: ctx.tenantId,
        humanId,
        sourceBookingId: b.id,
        partyId: b.partyId ?? null,
        crmContactId: b.crmContactId ?? null,
        customerName: b.attendeeName ?? null,
        eventTypeId: b.eventTypeId,
        productId,
        description,
        quantity: '1',
        unitPrice,
        total: unitPrice, // qty 1 → total = unit price
      })
      .returning();
    return order;
  });
}

export function listOrders(
  ctx: CoreCtx,
  f: { status?: OrderStatus | 'open'; crmContactId?: string; limit?: number; ownerId?: string } = {},
): Promise<SalesOrder[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(salesOrders.orgId, ctx.tenantId)];
    if (f.status === 'open') conds.push(OPEN_ORDER);
    else if (f.status) conds.push(eq(salesOrders.status, f.status));
    if (f.crmContactId) conds.push(eq(salesOrders.crmContactId, f.crmContactId));
    // Record-level (if-owner) scoping: only orders this rep owns.
    if (f.ownerId) conds.push(eq(salesOrders.ownerId, f.ownerId));
    return tx
      .select()
      .from(salesOrders)
      .where(and(...conds))
      .orderBy(desc(salesOrders.createdAt))
      .limit(f.limit ?? 200);
  });
}

/** Single order by id (detail page). A scoped caller only opens orders they own. */
export async function getOrder(ctx: CoreCtx, id: string, ownerId?: string): Promise<SalesOrder | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, id),
          eq(salesOrders.orgId, ctx.tenantId),
          ...(ownerId ? [eq(salesOrders.ownerId, ownerId)] : []),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

/** Open-order count for an entity — powers the Connections panel Sales group. */
export async function orderCountForContact(ctx: CoreCtx, contactId: string): Promise<number> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(salesOrders)
      .where(and(eq(salesOrders.orgId, ctx.tenantId), eq(salesOrders.crmContactId, contactId), OPEN_ORDER)),
  );
  return Number(row?.n ?? 0);
}

/**
 * Status rollup (ERPNext-style): flip open Sales Orders to 'invoiced' when a
 * matching SUSII invoice appears. Matches by the shared party spine (the
 * fin_client → party link the backfill established), an issue date at/after the
 * order, and an amount within tolerance; the earliest unclaimed invoice wins.
 * Idempotent — only touches still-open orders and never reuses an invoice ref.
 *
 * ponytail ceiling: a party+amount+window heuristic, not a line-item
 * reconciliation. SUSII invoices bundle taxes/multiple procedures, so the 5%
 * amount tolerance will miss some — those stay 'confirmed' and can be flipped by
 * hand on /sales. Upgrade path: match on invoice line items once we map
 * event-type products → SUSII product codes.
 */
export async function reconcileOrdersToInvoices(ctx: CoreCtx): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    await tx.execute(sql`
      with match as (
        select distinct on (so.id) so.id as order_id, fi.provider_ref
        from sales_orders so
        join fin_clients fc on fc.org_id = so.org_id and fc.party_id = so.party_id
        join fin_invoices fi on fi.org_id = so.org_id and fi.client_id = fc.id
        where so.org_id = current_setting('app.current_org_id', true)
          and so.status in ('draft','confirmed') and so.party_id is not null
          and fi.provider = 'susii'
          and fi.issued_at >= so.created_at - interval '1 day'
          and fi.issued_at <= so.created_at + interval '60 days'
          and (so.total is null
               or abs(coalesce(fi.total,0) - coalesce(so.total,0)) <= greatest(coalesce(so.total,0) * 0.05, 1))
          and not exists (
            select 1 from sales_orders s2
            where s2.org_id = so.org_id and s2.invoice_provider_ref = fi.provider_ref
          )
        order by so.id, fi.issued_at asc
      )
      update sales_orders so
      set status = 'invoiced', invoice_provider_ref = match.provider_ref, updated_at = now()
      from match
      where so.id = match.order_id
    `);
  });
}

export async function setOrderStatus(
  ctx: CoreCtx,
  id: string,
  status: OrderStatus,
  actor: { id: string | null; name: string | null } = { id: null, name: null },
  expectedUpdatedAt?: Date,
): Promise<SalesOrder | null> {
  return withOrgCore(ctx, async (tx) => {
    const [cur] = await tx
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.orgId, ctx.tenantId)))
      .limit(1);
    if (!cur) return null;
    const [row] = await tx
      .update(salesOrders)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(salesOrders.id, id),
          eq(salesOrders.orgId, ctx.tenantId),
          staleGuard(salesOrders.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning();
    if (!row) {
      if (expectedUpdatedAt) throw new StaleWriteError(cur);
      return null;
    }
    if (cur.status !== status) {
      await tx.insert(docAuditLog).values({
        orgId: ctx.tenantId,
        refType: 'sales_order',
        refId: id,
        op: 'status',
        changes: [{ field: 'status', label: 'Status', old: cur.status, new: status }],
        actorId: actor.id,
        actorName: actor.name,
      });
    }
    return row ?? null;
  });
}
