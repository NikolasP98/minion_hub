import { pgTable, uuid, text, jsonb, numeric, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Hub-native Finances — canonical, provider-agnostic schema. CORE columns are
 * common to any billing system; provider-specific extras live in `metadata`.
 * Tenancy: `org_id text` (== messages.org_id / crm_*), enforced by withOrgCore
 * (role app_ledger + app.current_org_id GUC). Policies/grants in the companion
 * migration <stamp>_finance.sql (meta-repo root). Money is `numeric` (string in JS).
 */
export const finInvoices = pgTable(
  'fin_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),           // e.g. 'susii'
    providerRef: text('provider_ref').notNull(),    // external sale id
    number: text('number'),                         // human sale number
    documentId: text('document_id'),                // e.g. 'BE01-2164'
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    clientId: uuid('client_id').references(() => finClients.id, { onDelete: 'set null' }),
    clientName: text('client_name'),
    clientDocType: text('client_doc_type'),
    clientDocNumber: text('client_doc_number'),     // RUC/DNI — the CRM link key
    clientEmail: text('client_email'),
    currency: text('currency'),
    subtotal: numeric('subtotal'),
    tax: numeric('tax'),
    discount: numeric('discount'),
    total: numeric('total'),
    status: text('status'),                         // 'paid'|'partial'|'pending'|'void'
    seller: text('seller'),
    note: text('note'),
    metadata: jsonb('metadata').notNull().default({}),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('fin_invoices_provider_ref_uniq').on(t.orgId, t.provider, t.providerRef),
    dniIdx: index('fin_invoices_org_dni_idx').on(t.orgId, t.clientDocNumber),
    issuedIdx: index('fin_invoices_org_issued_idx').on(t.orgId, t.issuedAt),
    clientIdx: index('fin_invoices_client_idx').on(t.clientId),
  }),
);

export const finInvoiceItems = pgTable(
  'fin_invoice_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    invoiceId: uuid('invoice_id').notNull().references(() => finInvoices.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => finProducts.id, { onDelete: 'set null' }),
    code: text('code'),
    description: text('description'),
    category: text('category'),
    quantity: numeric('quantity'),
    unitPrice: numeric('unit_price'),
    discount: numeric('discount'),
    tax: numeric('tax'),
    total: numeric('total'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    invoiceIdx: index('fin_invoice_items_invoice_idx').on(t.invoiceId),
    productIdx: index('fin_invoice_items_product_idx').on(t.productId),
  }),
);

export const finPayments = pgTable(
  'fin_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    invoiceId: uuid('invoice_id').notNull().references(() => finInvoices.id, { onDelete: 'cascade' }),
    providerRef: text('provider_ref'),
    method: text('method'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    amount: numeric('amount'),
    status: text('status'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    invoiceIdx: index('fin_payments_invoice_idx').on(t.invoiceId),
    paidIdx: index('fin_payments_org_paid_idx').on(t.orgId, t.paidAt),
  }),
);

export const finClients = pgTable(
  'fin_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref').notNull(),
    name: text('name'),
    docType: text('doc_type'),
    docNumber: text('doc_number'),
    email: text('email'),
    phone: text('phone'),
    /** Soft bridge to the shared party spine (parties.id). See pg-party-schema.ts. */
    partyId: uuid('party_id'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    uniq: uniqueIndex('fin_clients_provider_ref_uniq').on(t.orgId, t.provider, t.providerRef),
    dniIdx: index('fin_clients_org_dni_idx').on(t.orgId, t.docNumber),
    partyIdx: index('fin_clients_party_idx').on(t.partyId),
  }),
);

export const finProducts = pgTable(
  'fin_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    unitPrice: numeric('unit_price'),
    active: boolean('active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex('fin_products_org_code_uniq').on(t.orgId, t.code) }),
);

/** Per-org billing connector config + sync watermark. */
export const finSources = pgTable(
  'fin_sources',
  {
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),
    config: jsonb('config').notNull().default({}),       // e.g. { businessId: 5922 }
    secretRefs: jsonb('secret_refs').notNull().default({}), // { username: 'SUSII_USERNAME', ... }
    enabled: boolean('enabled').notNull().default(true),
    watermark: text('watermark'),                        // last modified_after ISO
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex('fin_sources_org_provider_uniq').on(t.orgId, t.provider) }),
);

/** Durable, resumable background sync job — one row per sync run. */
export const finSyncJobs = pgTable(
  'fin_sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('queued'), // queued|running|succeeded|failed|cancelled
    total: integer('total'),                              // DRF count baseline (null until known)
    processed: integer('processed').notNull().default(0),
    pageCursor: text('page_cursor'),                      // DRF `next` URL to resume from
    error: text('error'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeUq: uniqueIndex('fin_sync_jobs_active_uq')
      .on(t.orgId, t.provider)
      .where(sql`status in ('queued','running')`),
    latestIdx: index('fin_sync_jobs_org_provider_created_idx').on(t.orgId, t.provider, t.createdAt),
    resumeIdx: index('fin_sync_jobs_status_heartbeat_idx').on(t.status, t.heartbeatAt),
  }),
);

/** Per-org finance settings: display currency, IGV tax rate, USD↔PEN exchange
 *  rate (auto-fetched default + manual override). One row per org (orgId pk). */
export const finSettings = pgTable('fin_settings', {
  orgId: text('org_id').primaryKey(),
  currency: text('currency').notNull().default('PEN'),
  taxRate: numeric('tax_rate').notNull().default('0.18'), // IGV as a fraction (0.18 = 18%)
  // Business timezone. A calendar "day" is local: comparing a Lima (UTC-5) shop
  // against UTC days cuts its day at 19:00 and rolls evening sales into tomorrow.
  timezone: text('timezone').notNull().default('America/Lima'),
  fxBase: text('fx_base').notNull().default('USD'),
  fxQuote: text('fx_quote').notNull().default('PEN'),
  fxMode: text('fx_mode').notNull().default('auto'),      // 'auto' | 'manual'
  fxManualRate: numeric('fx_manual_rate'),                // override value (quote per 1 base)
  fxAutoRate: numeric('fx_auto_rate'),                    // last online-fetched value
  fxSource: text('fx_source'),                            // e.g. 'open.er-api.com'
  fxUpdatedAt: timestamp('fx_updated_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type FinInvoice = typeof finInvoices.$inferSelect;
export type FinInvoiceItem = typeof finInvoiceItems.$inferSelect;
export type FinPayment = typeof finPayments.$inferSelect;
export type FinClient = typeof finClients.$inferSelect;
export type FinProduct = typeof finProducts.$inferSelect;
export type FinSource = typeof finSources.$inferSelect;
export type FinSyncJob = typeof finSyncJobs.$inferSelect;
export type FinSettingsRow = typeof finSettings.$inferSelect;
