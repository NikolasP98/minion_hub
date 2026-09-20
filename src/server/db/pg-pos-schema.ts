import {
  pgTable,
  uuid,
  text,
  numeric,
  jsonb,
  timestamp,
  integer,
  boolean,
  date,
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
  /** What this org demands of a ticket before it can be submitted, e.g.
   *  `{ identityDocument: 'required' }` (FACES needs a DNI/RUC per invoice;
   *  other orgs need none). Open map on purpose — `{}` means every
   *  requirement is off. See pos.service `submitTicket` and
   *  supabase/migrations/20260915000000_pos_requirements_pending_scheduling.sql. */
  requirements: jsonb('requirements').notNull().default({}),
  workflow: jsonb('workflow')
    .notNull()
    .default({ postSaleScheduling: 'prompt', appointmentPayment: 'any_time' }),
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
    /** Instalment line — this line pays down `pos_payment_plans.id`. The
     *  ticket still balances exactly; a plan is N fully-paid tickets, never a
     *  partial one. Paid-to-date sums these over non-void tickets. */
    planId: uuid('plan_id'),
    /** This line was paid by a package session — `pos_package_redemptions.id`.
     *  Priced at 0 with the grant's `unitValue` as the visible value. */
    redemptionId: uuid('redemption_id'),
  },
  (t) => ({
    orgTicketIdx: index('pos_ticket_lines_org_ticket_idx').on(t.orgId, t.ticketId),
    orgProductIdx: index('pos_ticket_lines_org_product_idx').on(t.orgId, t.finProductId),
    orgPlanIdx: index('pos_ticket_lines_org_plan_idx')
      .on(t.orgId, t.planId)
      .where(sql.raw('plan_id is not null')),
    orgRedemptionIdx: index('pos_ticket_lines_org_redemption_idx')
      .on(t.orgId, t.redemptionId)
      .where(sql.raw('redemption_id is not null')),
    // "Pending scheduling" (/pos/accounts) is DERIVED from this exact shape:
    // a service line with no booking on a non-void ticket.
    orgPendingSchedIdx: index('pos_ticket_lines_org_pending_scheduling_idx')
      .on(t.orgId, t.ticketId)
      .where(sql.raw(`booking_id is null and kind = 'service'`)),
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

/**
 * Per-client stored value — append-only. Never updated, never deleted: a
 * reversal is a new opposing row, so `balance = sum(amount)` is always the
 * whole truth. `amount` is SIGNED (positive adds credit, negative consumes).
 *
 * Spec 2026-09-13-pos-scheduling-packages-payment-plans-spec.md §2.1.
 * Companion migration supabase/migrations/20260914000000_pos_packages_plans.sql.
 */
export const posClientLedger = pgTable(
  'pos_client_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Shared party spine + CRM facet (soft refs). At least one is non-null. */
    partyId: uuid('party_id'),
    crmContactId: uuid('crm_contact_id'),
    /** topup | deposit | redemption | refund | adjustment */
    kind: text('kind').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PEN'),
    /** Provenance — all soft refs, so history survives whatever it points at. */
    ticketId: uuid('ticket_id'),
    planId: uuid('plan_id'),
    bookingId: uuid('booking_id'),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    orgContactIdx: index('pos_client_ledger_org_contact_idx').on(t.orgId, t.crmContactId),
    orgPartyIdx: index('pos_client_ledger_org_party_idx').on(t.orgId, t.partyId),
  }),
);
export type PosClientLedgerRow = typeof posClientLedger.$inferSelect;

/**
 * One treatment, N payments. Each instalment is its own fully-paid POS ticket
 * carrying a line with `plan_id` — `submitTicket`'s
 * `sum(payments) === total` invariant is untouched.
 *
 * Paid-to-date is DERIVED (sum of those lines over non-void tickets); `status`
 * is service-computed on write, never a stored running total. §2.2.
 */
export const posPaymentPlans = pgTable(
  'pos_payment_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    partyId: uuid('party_id'),
    crmContactId: uuid('crm_contact_id'),
    title: text('title').notNull(),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PEN'),
    /** open | settled | cancelled */
    status: text('status').notNull().default('open'),
    /** The treatment sellable (fin_products.id) and the event it funds. */
    productId: uuid('product_id'),
    bookingId: uuid('booking_id'),
    /** Advisory `[{ dueOn, amount }]` — nothing auto-charges (spec §6). */
    dueSchedule: jsonb('due_schedule'),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by'),
  },
  (t) => ({
    orgStatusIdx: index('pos_payment_plans_org_status_idx').on(t.orgId, t.status),
    orgContactIdx: index('pos_payment_plans_org_contact_idx').on(t.orgId, t.crmContactId),
    orgPartyIdx: index('pos_payment_plans_org_party_idx').on(t.orgId, t.partyId),
    orgBookingIdx: index('pos_payment_plans_org_booking_idx').on(t.orgId, t.bookingId),
  }),
);
export type PosPaymentPlan = typeof posPaymentPlans.$inferSelect;

/**
 * One payment, N sessions: a bundle sellable rung up once grants
 * `sessions_total` sessions of one child service, drawn down over weeks.
 *
 * Sessions USED is derived from non-reversed `pos_package_redemptions` rows —
 * there is deliberately no counter column to drift. §2.3.
 */
export const posPackageGrants = pgTable(
  'pos_package_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    partyId: uuid('party_id'),
    crmContactId: uuid('crm_contact_id'),
    sourceTicketId: uuid('source_ticket_id').notNull(),
    sourceLineId: uuid('source_line_id').notNull(),
    /** The bundle sellable and the child service it delivers (fin_products). */
    packageProductId: uuid('package_product_id').notNull(),
    serviceProductId: uuid('service_product_id').notNull(),
    sessionsTotal: integer('sessions_total').notNull(),
    /** Price allocated per session — revenue recognition, and the visible
     *  value of a redeemed line priced at 0. */
    unitValue: numeric('unit_value', { precision: 12, scale: 2 }).notNull().default('0'),
    /** 'YYYY-MM-DD'; null = no expiry. Expired when `expiresAt < today` — a
     *  grant expiring TODAY is still redeemable. */
    expiresAt: date('expires_at'),
    /** active | exhausted | expired | cancelled — the STORED value only ever
     *  holds 'active' or 'cancelled' in this pass; exhaustion/expiry are
     *  derived on read by `grantStatus` (pos-accounts.logic.ts). */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by'),
  },
  (t) => ({
    orgContactIdx: index('pos_package_grants_org_contact_idx').on(t.orgId, t.crmContactId),
    orgPartyIdx: index('pos_package_grants_org_party_idx').on(t.orgId, t.partyId),
    orgTicketIdx: index('pos_package_grants_org_ticket_idx').on(t.orgId, t.sourceTicketId),
  }),
);
export type PosPackageGrant = typeof posPackageGrants.$inferSelect;

/**
 * One row per session drawn from a grant. A reversal sets `reversedAt` — rows
 * are never deleted, so `used = count(*) where reversed_at is null` and a
 * cancelled booking hands the session straight back. §2.3.
 */
export const posPackageRedemptions = pgTable(
  'pos_package_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    grantId: uuid('grant_id').notNull(),
    bookingId: uuid('booking_id'),
    ticketId: uuid('ticket_id'),
    ticketLineId: uuid('ticket_line_id'),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
    redeemedBy: uuid('redeemed_by'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedBy: uuid('reversed_by'),
    reversalReason: text('reversal_reason'),
  },
  (t) => ({
    orgGrantIdx: index('pos_package_redemptions_org_grant_idx').on(t.orgId, t.grantId),
    orgBookingIdx: index('pos_package_redemptions_org_booking_idx').on(t.orgId, t.bookingId),
    orgTicketIdx: index('pos_package_redemptions_org_ticket_idx').on(t.orgId, t.ticketId),
    /** One LIVE redemption per booking — a retry can never drain a second
     *  session. Partial, so reversed rows may pile up for the same booking. */
    liveBookingUniq: uniqueIndex('pos_package_redemptions_live_booking_uniq')
      .on(t.orgId, t.bookingId)
      .where(sql.raw('booking_id is not null and reversed_at is null')),
  }),
);
export type PosPackageRedemption = typeof posPackageRedemptions.$inferSelect;
