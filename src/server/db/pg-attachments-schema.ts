import { pgTable, text, uuid, timestamp, index, primaryKey } from 'drizzle-orm/pg-core';

/**
 * Attachments — polymorphic "document ↔ object" link table (spec
 * 2026-09-12-erp-core-modules-attachments-spec §D). The document itself is a
 * row in `public.files` (`@minion-stack/db/pg`, `id` text, `tenant_id` uuid);
 * this table is the many-to-many join so one file can attach to a CRM
 * contact, a booking and an invoice at once. `file_id` is a soft ref (no FK —
 * `files` is owned by the meta package, precedent: `meta_post_media.file_id`).
 * `org_id text` matches the ERP tables, not `files.tenant_id` (uuid).
 */
export const ATTACHMENT_OBJECT_TYPES = [
  'crm_contact',
  'booking',
  'event_type',
  'product',
  'stk_item',
  'fin_invoice',
  'stk_entry',
  'pos_ticket',
] as const;
export type AttachmentObjectType = (typeof ATTACHMENT_OBJECT_TYPES)[number];

export const attachmentLinks = pgTable(
  'attachment_links',
  {
    orgId: text('org_id').notNull(),
    fileId: text('file_id').notNull(),
    /** One of ATTACHMENT_OBJECT_TYPES. */
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    /** profiles.id; null = applied by the system. */
    linkedBy: uuid('linked_by'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.objectType, t.objectId, t.fileId] }),
    fileIdx: index('attachment_links_org_file_idx').on(t.orgId, t.fileId),
    objectIdx: index('attachment_links_org_object_idx').on(t.orgId, t.objectType, t.objectId),
  }),
);

export type AttachmentLink = typeof attachmentLinks.$inferSelect;

/** Registration survives the last unlink. A committed deleting state is a
 * tombstone: no caller may relink or issue a new download while storage retries. */
export const attachmentFileState = pgTable('attachment_file_state', {
  fileId: text('file_id').primaryKey(),
  orgId: text('org_id').notNull(),
  fileKey: text('file_key').notNull(),
  accessModules: text('access_modules').array().notNull().default([]),
  uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }),
  deleteReconciledAt: timestamp('delete_reconciled_at', { withTimezone: true }),
  deleteAttemptedAt: timestamp('delete_attempted_at', { withTimezone: true }),
  state: text('state').$type<'active' | 'deleting'>().notNull().default('active'),
  deleteRequestedBy: uuid('delete_requested_by'),
  deleteRequestedAt: timestamp('delete_requested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
