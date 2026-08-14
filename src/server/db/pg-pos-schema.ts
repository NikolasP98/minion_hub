import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  integer,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
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
  /** Per-payment-method surcharge config, e.g.
   *  `{ card: { type: 'percent'|'fixed', amount: 3.5, label: '…' } }`.
   *  Replaces the old "Ajuste por Método de Pago" catalog product — a fee is
   *  configuration, not something sold. */
  surcharges: jsonb('surcharges').notNull().default({}),
  requireCustomer: boolean('require_customer').notNull().default(false),
  allowPriceOverride: boolean('allow_price_override').notNull().default(true),
  /** `{ mode: 'off'|'shadow', docTypeDefault: '03'|'01' }` — see
   *  pos-emission.service.ts and spec 2026-08-14-pos-shadow-emission-spec.md.
   *  `'prod'` is REJECTED by pos.service validation — it doesn't exist yet. */
  emission: jsonb('emission').notNull().default({ mode: 'off', docTypeDefault: '03' }),
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
    oneOpen: uniqueIndex('pos_shifts_one_open_per_org')
      .on(t.orgId)
      .where(sql.raw(`status = 'open'`)),
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
    /** Order-line CONFIGURATION (#9): what the customer chose for this line —
     *  [{action:'exclude'|'add', itemId, qty?}]. `add.qty` is in the added
     *  item's stock UOM per sold unit. Deliberately not composition;
     *  see supabase/migrations/20260720030000_pos_line_modifiers.sql. */
    modifiers: jsonb('modifiers').notNull().default([]),
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

/**
 * SUNAT document number allocator — one active serie per (org, doc_type,
 * environment), enforced by a partial unique index. `next_number` is bumped by
 * a single atomic `UPDATE … RETURNING` (pos-emission.service.ts
 * `allocateNumber`), never read-then-written, so two concurrent allocations
 * can never hand out the same correlativo. Spec
 * 2026-08-14-pos-shadow-emission-spec.md §1/§2. Companion migration
 * supabase/migrations/20260814040000_pos_shadow_emission.sql.
 */
export const posSeries = pgTable(
  'pos_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** '01' factura | '03' boleta. */
    docType: text('doc_type').notNull(),
    /** 4-char SUNAT series, e.g. 'B999' (shadow) or 'B101' (prod, future). */
    serie: text('serie').notNull(),
    nextNumber: integer('next_number').notNull().default(1),
    /** 'beta' | 'prod' — a prod serie must never be consumed by shadow. */
    environment: text('environment').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgDocSerieUniq: uniqueIndex('pos_series_org_doc_serie_uniq').on(t.orgId, t.docType, t.serie),
    oneActivePerEnv: uniqueIndex('pos_series_one_active_per_env')
      .on(t.orgId, t.docType, t.environment)
      .where(sql.raw(`active`)),
  }),
);
export type PosSeries = typeof posSeries.$inferSelect;

/**
 * One row per emission attempt (shadow now; prod later — out of scope this
 * slice). `xmlHash` is a sha256 audit trail; the signed XML itself is never
 * persisted. Spec 2026-08-14-pos-shadow-emission-spec.md §1/§4.
 */
export const posEmissions = pgTable(
  'pos_emissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    docType: text('doc_type').notNull(),
    serie: text('serie').notNull(),
    correlativo: integer('correlativo').notNull(),
    /** 'beta' | 'prod'. */
    environment: text('environment').notNull(),
    /** 'pending' -> 'accepted' | 'rejected' | 'error'. */
    status: text('status').notNull().default('pending'),
    responseCode: text('response_code'),
    responseDescription: text('response_description'),
    xmlHash: text('xml_hash'),
    total: numeric('total'),
    clientDocType: text('client_doc_type'),
    clientDocNumber: text('client_doc_number'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgDocSerieCorrelativoUniq: uniqueIndex('pos_emissions_org_doc_serie_correlativo_uniq').on(
      t.orgId,
      t.docType,
      t.serie,
      t.correlativo,
    ),
    orgTicketIdx: index('pos_emissions_org_ticket_idx').on(t.orgId, t.ticketId),
  }),
);
export type PosEmission = typeof posEmissions.$inferSelect;
