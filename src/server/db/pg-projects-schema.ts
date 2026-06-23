import { pgTable, uuid, text, integer, boolean, jsonb, date, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Partial-index predicate helper (mirrors pg-sales-schema.ts).
function sqlNotNull(col: string) {
  return sql.raw(`${col} is not null`);
}

/**
 * Projects module — Minion's hub-native port of ERPNext Projects, hung off the
 * party spine so HUMANS and AI AGENTS participate as one. A project's customer
 * is a party; a task's assignee is a party (person OR agent). Agent execution is
 * dispatched to the gateway/workforce runtime over the existing bridge — the
 * tables here are the system of record, not an execution engine.
 *
 * Why PG core (not the Turso missions/tasks): those are sqlite, tenant-scoped,
 * and FK'd to gateway sessions — a different database that can't reach `parties`.
 * The module MUST live where the spine lives.
 *
 * Tenancy: org_id text + withOrgCore (app_ledger + GUC, forced RLS). Companion
 * migration supabase/migrations/20260622270000_projects.sql.
 */
export const projProjects = pgTable(
  'proj_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** PRJ-2026-00001, stamped at create. See naming-series.ts. */
    humanId: text('human_id'),
    name: text('name').notNull(),
    description: text('description'),
    /** open | active | on_hold | completed | cancelled */
    status: text('status').notNull().default('open'),
    /** The client (parties.id). Role "customer" is emergent from this link. */
    customerPartyId: uuid('customer_party_id'),
    /** Project lead (parties.id) — person or agent. */
    leadPartyId: uuid('lead_party_id'),
    color: text('color'),
    icon: text('icon'),
    targetDate: date('target_date'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStatusIdx: index('proj_projects_org_status_idx').on(t.orgId, t.status),
    orgCreatedIdx: index('proj_projects_org_created_idx').on(t.orgId, t.createdAt),
    customerIdx: index('proj_projects_customer_idx').on(t.customerPartyId),
    leadIdx: index('proj_projects_lead_idx').on(t.leadPartyId),
    humanUniq: uniqueIndex('proj_projects_org_human_uniq').on(t.orgId, t.humanId).where(sqlNotNull('human_id')),
  }),
);

/**
 * proj_tasks — the work unit. A MILESTONE is a task with is_milestone=true
 * (ERPNext's actual model); child tasks group under it via milestone_id.
 * parent_id is the orthogonal subtask hierarchy.
 */
export const projTasks = pgTable(
  'proj_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    /** Subtask-of-a-task hierarchy. */
    parentId: uuid('parent_id'),
    /** → proj_tasks.id where is_milestone. */
    milestoneId: uuid('milestone_id'),
    isMilestone: boolean('is_milestone').notNull().default(false),
    /** TASK-2026-00001, stamped at create. */
    humanId: text('human_id'),
    title: text('title').notNull(),
    description: text('description'),
    /** backlog | todo | in_progress | in_review | done | blocked | cancelled */
    status: text('status').notNull().default('backlog'),
    /** low | medium | high | urgent */
    priority: text('priority').notNull().default('medium'),
    /** parties.id — person OR agent. */
    assigneePartyId: uuid('assignee_party_id'),
    /** Estimate in minutes; actuals roll up from proj_timesheets. */
    estMinutes: integer('est_minutes'),
    sortOrder: integer('sort_order').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgProjectStatusIdx: index('proj_tasks_org_project_status_idx').on(t.orgId, t.projectId, t.status),
    orgAssigneeStatusIdx: index('proj_tasks_org_assignee_status_idx').on(t.orgId, t.assigneePartyId, t.status),
    orgParentIdx: index('proj_tasks_org_parent_idx').on(t.orgId, t.parentId),
    orgMilestoneIdx: index('proj_tasks_org_milestone_idx').on(t.orgId, t.milestoneId),
    humanUniq: uniqueIndex('proj_tasks_org_human_uniq').on(t.orgId, t.humanId).where(sqlNotNull('human_id')),
  }),
);

/**
 * proj_timesheets — manual effort logging (ERPNext Timesheet). minutes stored as
 * INT to keep the billable money path (rate × minutes/60) off floats. Distinct
 * from gateway token-cost: this is human/agent HOURS.
 */
export const projTimesheets = pgTable(
  'proj_timesheets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    projectId: uuid('project_id'),
    taskId: uuid('task_id'),
    /** Who logged the time (parties.id) — person or agent. */
    partyId: uuid('party_id').notNull(),
    spentDate: date('spent_date').notNull(),
    minutes: integer('minutes').notNull(),
    description: text('description'),
    billable: boolean('billable').notNull().default(false),
    /** Per hour, applied when billable. */
    billingRateCents: integer('billing_rate_cents'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgProjectIdx: index('proj_timesheets_org_project_idx').on(t.orgId, t.projectId),
    orgTaskIdx: index('proj_timesheets_org_task_idx').on(t.orgId, t.taskId),
    orgSpentIdx: index('proj_timesheets_org_spent_idx').on(t.orgId, t.spentDate),
    orgPartyIdx: index('proj_timesheets_org_party_idx').on(t.orgId, t.partyId),
  }),
);

/** Shape of a project template's `spec` (instantiated into project+tasks). */
export interface ProjectTemplateSpec {
  /** Defaults for the created project (name overridable at instantiate). */
  project?: { name?: string; description?: string | null; status?: string };
  /** Milestone tasks (is_milestone=true). `key` is referenced by tasks.milestoneKey. */
  milestones?: Array<{ key: string; name: string; description?: string | null; offsetDays?: number | null }>;
  /** Work tasks. `ref` lets another task name it as parentRef for hierarchy. */
  tasks?: Array<{
    ref?: string;
    title: string;
    description?: string | null;
    priority?: string;
    milestoneKey?: string | null;
    parentRef?: string | null;
    estMinutes?: number | null;
    offsetDays?: number | null;
  }>;
}

export const projTemplates = pgTable(
  'proj_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    spec: jsonb('spec').$type<ProjectTemplateSpec>().notNull().default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('proj_templates_org_idx').on(t.orgId),
  }),
);

export type ProjProject = typeof projProjects.$inferSelect;
export type NewProjProject = typeof projProjects.$inferInsert;
export type ProjTask = typeof projTasks.$inferSelect;
export type NewProjTask = typeof projTasks.$inferInsert;
export type ProjTimesheet = typeof projTimesheets.$inferSelect;
export type NewProjTimesheet = typeof projTimesheets.$inferInsert;
export type ProjTemplate = typeof projTemplates.$inferSelect;
export type NewProjTemplate = typeof projTemplates.$inferInsert;
