import { pgTable, uuid, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Generic per-record activity — Minion's port of ERPNext's Comment + Version,
 * polymorphic over any entity via (ref_type, ref_id) (their reference_doctype /
 * reference_name). Splits ERPNext's overloaded `tabComment` into two clean
 * tables: human comments (threaded) and machine audit (field diffs). One
 * `<DocTimeline>` component renders both for any module.
 *
 * Generalizes the contact-only `crm_activities`; CRM keeps its message-ledger
 * journey, support tickets get a conversation thread, every record gets an audit
 * trail. org-scoped via withOrgCore (app_ledger + GUC, forced RLS).
 */
export const docComments = pgTable(
  'doc_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** Polymorphic ref: 'support_issue' | 'sales_order' | 'crm_contact' | … */
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    /** 'comment' (human) | system kinds carried for a unified feed. */
    kind: text('kind').notNull().default('comment'),
    body: text('body'),
    /** profiles.id of the author; null = system/agent. */
    actorId: uuid('actor_id'),
    /** Denormalized author name for render without a user join. */
    actorName: text('actor_name'),
    /** Reply threading (email-thread style). */
    parentId: uuid('parent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    refIdx: index('doc_comments_ref_idx').on(t.orgId, t.refType, t.refId, t.createdAt),
  }),
);

/** Field-level change history (ERPNext Version). `changes` = [{field,label,old,new}]. */
export const docAuditLog = pgTable(
  'doc_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    refType: text('ref_type').notNull(),
    refId: uuid('ref_id').notNull(),
    actorId: uuid('actor_id'),
    actorName: text('actor_name'),
    /** 'create' | 'update' | 'status' | 'assign' | … */
    op: text('op').notNull().default('update'),
    changes: jsonb('changes').notNull().default([]),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    refIdx: index('doc_audit_log_ref_idx').on(t.orgId, t.refType, t.refId, t.occurredAt),
  }),
);

export type DocComment = typeof docComments.$inferSelect;
export type DocAuditEntry = typeof docAuditLog.$inferSelect;
