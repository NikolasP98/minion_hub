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

/** Layer 1 of deletion: a hidden link keeps its identity here for the retention
 * window so restore is a move back. Rows are dropped when the file is claimed. */
export const attachmentTrash = pgTable(
  'attachment_trash',
  {
    orgId: text('org_id').notNull(),
    fileId: text('file_id').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    linkedBy: uuid('linked_by'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull(),
    /** profiles.id; null = hidden by the system (record deletion). */
    hiddenBy: uuid('hidden_by'),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.objectType, t.objectId, t.fileId] }),
    objectIdx: index('attachment_trash_org_object_idx').on(t.orgId, t.objectType, t.objectId),
    fileIdx: index('attachment_trash_org_file_hidden_idx').on(t.orgId, t.fileId, t.hiddenAt),
  }),
);
export type AttachmentTrashRow = typeof attachmentTrash.$inferSelect;

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
