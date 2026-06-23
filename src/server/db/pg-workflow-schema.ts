import { pgTable, uuid, text, jsonb, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Workflow definitions (ERPNext Workflow port). A per-doc_type state machine
 * layered over the doc's existing `status` column — `states` is the allowed set,
 * `transitions` the role-gated edges. One enabled def per (org, doc_type).
 * Transitions are recorded in doc_audit_log (op='workflow'). No separate state
 * column: the doc's own status IS the workflow state.
 *
 * Companion migration: supabase/migrations/<ts>_workflow.sql.
 */
export const workflowDefs = pgTable(
  'workflow_defs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** support_issue | sales_order (status-bearing docs only). */
    docType: text('doc_type').notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** string[] — the legal states. */
    states: jsonb('states').notNull().default([]),
    /** {action,from,to,role?,allowSelfApprove?}[] */
    transitions: jsonb('transitions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgDocTypeUniq: uniqueIndex('workflow_defs_org_doctype_uniq').on(t.orgId, t.docType),
  }),
);

export type WorkflowDef = typeof workflowDefs.$inferSelect;
export type NewWorkflowDef = typeof workflowDefs.$inferInsert;
