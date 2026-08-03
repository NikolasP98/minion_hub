import {
  pgTable,
  uuid,
  text,
  jsonb,
  numeric,
  timestamp,
  boolean,
  integer,
  date,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
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
    provider: text('provider').notNull(), // e.g. 'susii'
    providerRef: text('provider_ref').notNull(), // external sale id
    number: text('number'), // human sale number
    documentId: text('document_id'), // e.g. 'BE01-2164'
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    clientId: uuid('client_id').references(() => finClients.id, { onDelete: 'set null' }),
    clientName: text('client_name'),
    clientDocType: text('client_doc_type'),
    clientDocNumber: text('client_doc_number'), // RUC/DNI — the CRM link key
    clientEmail: text('client_email'),
    currency: text('currency'),
    subtotal: numeric('subtotal'),
    tax: numeric('tax'),
    discount: numeric('discount'),
    total: numeric('total'),
    status: text('status'), // 'paid'|'partial'|'pending'|'void'
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
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => finInvoices.id, { onDelete: 'cascade' }),
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
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => finInvoices.id, { onDelete: 'cascade' }),
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
    /**
     * MASTER product identity — see 20260725120000_product_sku_and_aliases.sql.
     * `id` is ROW identity (8 tables reference it); `sku` is LOGICAL product
     * identity and may be reassigned so a merge can consolidate rows onto one
     * surviving product without rewriting any foreign key. Deliberately NOT
     * unique for that reason.
     */
    sku: uuid('sku').notNull().defaultRandom(),
    /** Short human/import REFERENCE (2-4 alnum). Retired codes live on in
     *  `metadata.aliases` so the invoice sync keeps resolving them. */
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

/**
 * Product bundles: product → product composition, the layer above services.
 *
 * Companion migration: supabase/migrations/20260725030000_fin_product_components.sql.
 * Sibling of stk_item_components (which composes MATERIALS in stock UOM); this
 * composes SELLABLES in whole units, so a pure service can be bundled without
 * first being forced into stk_items.
 */
export const finProductComponents = pgTable(
  'fin_product_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    bundleProductId: uuid('bundle_product_id')
      .notNull()
      .references(() => finProducts.id, { onDelete: 'cascade' }),
    /** restrict: a service a bundle still sells must not vanish silently. */
    childProductId: uuid('child_product_id')
      .notNull()
      .references(() => finProducts.id, { onDelete: 'restrict' }),
    qty: numeric('qty').notNull().default('1'),
    lineNo: integer('line_no').notNull().default(0),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fin_product_components_org_id_bundle_product_id_child_product_id_key').on(
      t.orgId,
      t.bundleProductId,
      t.childProductId,
    ),
    index('fin_product_components_org_bundle_idx').on(t.orgId, t.bundleProductId),
    index('fin_product_components_org_child_idx').on(t.orgId, t.childProductId),
  ],
);
export type FinProductComponent = typeof finProductComponents.$inferSelect;

/** Per-org billing connector config + sync watermark. */
export const finSources = pgTable(
  'fin_sources',
  {
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),
    config: jsonb('config').notNull().default({}), // e.g. { businessId: 5922 }
    secretRefs: jsonb('secret_refs').notNull().default({}), // { username: 'SUSII_USERNAME', ... }
    enabled: boolean('enabled').notNull().default(true),
    watermark: text('watermark'), // last modified_after ISO
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
    total: integer('total'), // DRF count baseline (null until known)
    processed: integer('processed').notNull().default(0),
    pageCursor: text('page_cursor'), // DRF `next` URL to resume from
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
  fxMode: text('fx_mode').notNull().default('auto'), // 'auto' | 'manual'
  fxManualRate: numeric('fx_manual_rate'), // override value (quote per 1 base)
  fxAutoRate: numeric('fx_auto_rate'), // last online-fetched value
  fxSource: text('fx_source'), // e.g. 'open.er-api.com'
  fxUpdatedAt: timestamp('fx_updated_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Personal-finance statement imports (WP4, R4/R5 of the personal-org spec).
 * NEW tables — deliberately separate from fin_invoices (a sales document, not
 * a bank-statement transaction). One row per uploaded/pasted statement.
 * Idempotency: UNIQUE(org_id, content_sha256) — re-submitting identical bytes
 * returns the existing import instead of duplicating. `next_chunk` is the
 * resumable cursor the `statement_ingest` bg-runtime handler advances.
 */
export const finStatementImports = pgTable(
  'fin_statement_imports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    fileId: text('file_id'), // bridges to files.id (cuid2 text, not uuid)
    sourceKind: text('source_kind').notNull(), // 'csv' | 'text'
    contentSha256: text('content_sha256').notNull(),
    parserVersion: integer('parser_version').notNull(),
    status: text('status').notNull().default('queued'), // queued|parsing|done|failed|undone
    nextChunk: integer('next_chunk').notNull().default(0),
    rowCount: integer('row_count'),
    insertedCount: integer('inserted_count'),
    rejectedCount: integer('rejected_count'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    uniq: uniqueIndex('fin_statement_imports_org_sha_uniq').on(t.orgId, t.contentSha256),
    orgIdx: index('fin_statement_imports_org_idx').on(t.orgId, t.createdAt),
    // Composite FK target: lets fin_transactions enforce same-org parentage.
    orgIdUniq: uniqueIndex('fin_statement_imports_org_id_uniq').on(t.orgId, t.id),
  }),
);

/**
 * Parsed bank-statement rows. `signedAmount` carries direction via sign (no
 * separate direction column). `partyId` is a soft bridge to the party spine
 * (no FK — same pattern as fin_clients.partyId), populated later by CRM
 * cashflow matching (out of scope for this wave).
 */
export const finTransactions = pgTable(
  'fin_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    importId: uuid('import_id').notNull(),
    sourceRow: integer('source_row').notNull(),
    postedOn: date('posted_on').notNull(),
    description: text('description').notNull(),
    signedAmount: numeric('signed_amount', { precision: 18, scale: 2 }).notNull(),
    currency: text('currency'),
    counterparty: text('counterparty'),
    category: text('category'),
    reference: text('reference'),
    partyId: uuid('party_id'),
    confidence: numeric('confidence'),
    warnings: jsonb('warnings').notNull().default([]),
    raw: jsonb('raw').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('fin_transactions_import_row_uniq').on(t.importId, t.sourceRow),
    orgPostedIdx: index('fin_transactions_org_posted_idx').on(t.orgId, t.postedOn),
    partyIdx: index('fin_transactions_party_idx').on(t.partyId),
    // (org_id, import_id) → (org_id, id): a transaction cannot reference
    // another org's import (RLS alone only checks the transaction's org_id).
    orgImportFk: foreignKey({
      name: 'fin_transactions_org_import_fk',
      columns: [t.orgId, t.importId],
      foreignColumns: [finStatementImports.orgId, finStatementImports.id],
    }).onDelete('cascade'),
  }),
);

export type FinInvoice = typeof finInvoices.$inferSelect;
export type FinInvoiceItem = typeof finInvoiceItems.$inferSelect;
export type FinPayment = typeof finPayments.$inferSelect;
export type FinClient = typeof finClients.$inferSelect;
export type FinProduct = typeof finProducts.$inferSelect;
export type FinSource = typeof finSources.$inferSelect;
export type FinSyncJob = typeof finSyncJobs.$inferSelect;
export type FinSettingsRow = typeof finSettings.$inferSelect;
export type FinStatementImport = typeof finStatementImports.$inferSelect;
export type FinTransaction = typeof finTransactions.$inferSelect;
