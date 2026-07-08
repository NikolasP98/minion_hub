import { pgTable, uuid, text, numeric, jsonb, timestamp, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * POS front-desk module — cash shifts, tickets (the terminal sale document),
 * lines, split-tender payments, and per-org settings.
 *
 * IMPORTANT — why a ticket, not an invoice: SUSII is the fiscal invoice source
 * of truth (fin_invoices, provider='susii') and revenue analytics sum
 * fin_invoices. A POS ticket is the ERPNext "POS Invoice" analog: it records
 * the sale + tender + drives stock, and reconciles AGAINST the SUSII invoice
 * later (invoice_provider_ref) without inflating revenue.
 *
 * Tenancy: org_id text + withOrgCore (app_ledger + GUC, forced RLS). Companion
 * migration supabase/migrations/20260707120000_pos.sql.
 */
export const posSettings = pgTable('pos_settings', {
  orgId: text('org_id').primaryKey(),
  methods: jsonb('methods').notNull().default(['cash', 'card', 'yape', 'plin', 'transfer']),
  currency: text('currency').notNull().default('PEN'),
  requireCustomer: boolean('require_customer').notNull().default(false),
  allowPriceOverride: boolean('allow_price_override').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type PosSettingsRow = typeof posSettings.$inferSelect;

export const posShifts = pgTable(
  'pos_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    status: text('status').notNull().default('open'),
    openedBy: uuid('opened_by'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    openingFloat: jsonb('opening_float').notNull().default({}),
    closedBy: uuid('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    expected: jsonb('expected'),
    counted: jsonb('counted'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    oneOpen: uniqueIndex('pos_shifts_one_open_per_org').on(t.orgId).where(sql.raw(`status = 'open'`)),
  }),
);
export type PosShift = typeof posShifts.$inferSelect;

export const posTickets = pgTable(
  'pos_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Human-readable ID, stamped at submit. See naming-series.ts. */
    humanId: text('human_id'),
    shiftId: uuid('shift_id').notNull(),
    /** Shared party spine + CRM facet (soft refs). */
    partyId: uuid('party_id'),
    crmContactId: uuid('crm_contact_id'),
    customerName: text('customer_name'),
    /** submitted | voided */
    status: text('status').notNull().default('submitted'),
    subtotal: numeric('subtotal').notNull(),
    discount: numeric('discount').notNull().default('0'),
    total: numeric('total').notNull(),
    currency: text('currency').notNull().default('PEN'),
    note: text('note'),
    stockEntryId: uuid('stock_entry_id'),
    stockWarning: jsonb('stock_warning'),
    /** Set when reconciled to a SUSII invoice (fin_invoices.provider_ref). */
    invoiceProviderRef: text('invoice_provider_ref'),
    createdBy: uuid('created_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    orgSubmittedIdx: index('pos_tickets_org_submitted_idx').on(t.orgId, t.submittedAt),
    orgShiftIdx: index('pos_tickets_org_shift_idx').on(t.orgId, t.shiftId),
    orgPartyIdx: index('pos_tickets_org_party_idx').on(t.orgId, t.partyId),
  }),
);
export type PosTicket = typeof posTickets.$inferSelect;

export const posTicketLines = pgTable(
  'pos_ticket_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    /** product | booking | custom */
    kind: text('kind').notNull(),
    finProductId: uuid('fin_product_id'),
    bookingId: uuid('booking_id'),
    description: text('description').notNull(),
    qty: numeric('qty').notNull(),
    unitPrice: numeric('unit_price').notNull(),
    discount: numeric('discount').notNull().default('0'),
    total: numeric('total').notNull(),
    lineNo: integer('line_no').notNull().default(0),
  },
  (t) => ({
    orgTicketIdx: index('pos_ticket_lines_org_ticket_idx').on(t.orgId, t.ticketId),
    orgProductIdx: index('pos_ticket_lines_org_product_idx').on(t.orgId, t.finProductId),
  }),
);
export type PosTicketLine = typeof posTicketLines.$inferSelect;

export const posPayments = pgTable(
  'pos_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    method: text('method').notNull(),
    amount: numeric('amount').notNull(),
    tendered: numeric('tendered'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    orgShiftIdx: index('pos_payments_org_shift_idx').on(t.orgId, t.shiftId),
    ticketIdx: index('pos_payments_ticket_idx').on(t.ticketId),
  }),
);
export type PosPayment = typeof posPayments.$inferSelect;
