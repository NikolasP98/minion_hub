import { pgTable, uuid, text, integer, jsonb, boolean, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Assignment rules (ERPNext Assignment Rule port). A rule auto-picks an assignee
 * for incoming docs of one `doc_type` and stamps that doc's own `owner_id` — the
 * owner column IS the assignment, so there's no separate work_items table to keep
 * in sync. `strategy` is round_robin (uses `cursor`) or least_open (fewest open
 * docs wins). `condition` reuses the notif Filter[] evaluator.
 *
 * Companion migration: supabase/migrations/<ts>_assignment.sql.
 */
export const assignmentRules = pgTable(
  'assignment_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** support_issue | crm_contact | sales_order */
    docType: text('doc_type').notNull(),
    /** round_robin | least_open */
    strategy: text('strategy').notNull().default('round_robin'),
    /** profile uuid[] eligible to receive work. */
    assignees: jsonb('assignees').notNull().default([]),
    /** Filter[] — same shape the notif engine evaluates. Empty = always match. */
    condition: jsonb('condition').notNull().default([]),
    /** Round-robin pointer, advanced after each assignment. */
    cursor: integer('cursor').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('assignment_rules_org_idx').on(t.orgId, t.docType, t.enabled),
  }),
);

export type AssignmentRule = typeof assignmentRules.$inferSelect;
export type NewAssignmentRule = typeof assignmentRules.$inferInsert;
