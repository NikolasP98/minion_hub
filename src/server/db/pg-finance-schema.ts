import { pgTable, uuid, text, jsonb, numeric, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

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
  }),
);

export const finInvoiceItems = pgTable(
  'fin_invoice_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    invoiceId: uuid('invoice_id').notNull().references(() => finInvoices.id, { onDelete: 'cascade' }),
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
  (t) => ({ invoiceIdx: index('fin_invoice_items_invoice_idx').on(t.invoiceId) }),
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
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    uniq: uniqueIndex('fin_clients_provider_ref_uniq').on(t.orgId, t.provider, t.providerRef),
    dniIdx: index('fin_clients_org_dni_idx').on(t.orgId, t.docNumber),
  }),
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

export type FinInvoice = typeof finInvoices.$inferSelect;
export type FinInvoiceItem = typeof finInvoiceItems.$inferSelect;
export type FinPayment = typeof finPayments.$inferSelect;
export type FinClient = typeof finClients.$inferSelect;
export type FinSource = typeof finSources.$inferSelect;
