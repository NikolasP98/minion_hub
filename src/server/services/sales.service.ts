import { and, desc, eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { salesOrders, type SalesOrder } from '$server/db/pg-sales-schema';
import { schedBookings, schedEventTypes } from '$server/db/pg-scheduling-schema';
import { finProducts } from '$server/db/pg-finance-schema';
import type { CoreCtx } from '$server/auth/core-ctx';

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

    const [order] = await tx
      .insert(salesOrders)
      .values({
        orgId: ctx.tenantId,
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
  f: { status?: OrderStatus | 'open'; crmContactId?: string; limit?: number } = {},
): Promise<SalesOrder[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(salesOrders.orgId, ctx.tenantId)];
    if (f.status === 'open') conds.push(OPEN_ORDER);
    else if (f.status) conds.push(eq(salesOrders.status, f.status));
    if (f.crmContactId) conds.push(eq(salesOrders.crmContactId, f.crmContactId));
    return tx
      .select()
      .from(salesOrders)
      .where(and(...conds))
      .orderBy(desc(salesOrders.createdAt))
      .limit(f.limit ?? 200);
  });
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

export async function setOrderStatus(
  ctx: CoreCtx,
  id: string,
  status: OrderStatus,
): Promise<SalesOrder | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(salesOrders)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(salesOrders.id, id), eq(salesOrders.orgId, ctx.tenantId)))
      .returning(),
  );
  return row ?? null;
}
