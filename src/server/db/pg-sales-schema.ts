import { pgTable, uuid, text, numeric, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Partial-index predicate `source_booking_id is not null` for the booking uniq.
function sqlNotNull(col: string) {
  return sql.raw(`${col} is not null`);
}

/**
 * Hub-native Sales Orders — Minion's port of ERPNext's document chain
 * (Quotation → Sales Order → Invoice). A Sales Order is the COMMITMENT to bill,
 * created from an upstream document (today: a scheduled Booking) via a concrete
 * mapper (sales.service.createOrderFromBooking) that carries a `source_*_id`
 * backref — the universal ERPNext convention that lets the Connections panel
 * light up.
 *
 * IMPORTANT — why an order, not an invoice: SUSII is the financial invoice
 * source of truth (fin_invoices, provider='susii'), and revenue analytics sum
 * fin_invoices.total. Minting a booking→invoice there would DOUBLE-COUNT. The
 * Sales Order is a separate commercial document; it reconciles AGAINST the SUSII
 * invoice later (status 'invoiced' + invoice_provider_ref) — the ERPNext
 * status-rollup pattern — without ever inflating revenue.
 *
 * Tenancy: org_id text + withOrgCore (app_ledger + GUC, forced RLS). Companion
 * migration supabase/migrations/<ts>_sales.sql.
 */
export const salesOrders = pgTable(
  'sales_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Human-readable ID (SO-2026-00001), stamped at create. See naming-series.ts. */
    humanId: text('human_id'),
    /** Backref to the originating document (the ERPNext prevdoc convention). */
    sourceBookingId: uuid('source_booking_id'),
    /** Shared party spine + CRM facet (soft refs). */
    partyId: uuid('party_id'),
    crmContactId: uuid('crm_contact_id'),
    customerName: text('customer_name'),
    /** Snapshot of the priced line at creation time. */
    eventTypeId: uuid('event_type_id'),
    productId: uuid('product_id'),
    description: text('description'),
    quantity: numeric('quantity').notNull().default('1'),
    unitPrice: numeric('unit_price'),
    total: numeric('total'),
    currency: text('currency'),
    /** draft | confirmed | invoiced | cancelled */
    status: text('status').notNull().default('draft'),
    /** Set when reconciled to a SUSII invoice (fin_invoices.provider_ref). */
    invoiceProviderRef: text('invoice_provider_ref'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStatusIdx: index('sales_orders_org_status_idx').on(t.orgId, t.status),
    orgCreatedIdx: index('sales_orders_org_created_idx').on(t.orgId, t.createdAt),
    contactIdx: index('sales_orders_contact_idx').on(t.crmContactId),
    partyIdx: index('sales_orders_party_idx').on(t.partyId),
    // One order per booking — makes createOrderFromBooking idempotent.
    bookingUniq: uniqueIndex('sales_orders_booking_uniq')
      .on(t.orgId, t.sourceBookingId)
      .where(sqlNotNull('source_booking_id')),
  }),
);

export type SalesOrder = typeof salesOrders.$inferSelect;
export type NewSalesOrder = typeof salesOrders.$inferInsert;
