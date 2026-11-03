import { pgTable, text, uuid, timestamp, index } from 'drizzle-orm/pg-core';

/** One row per org at most; no row = Base (spec 043). plan_key is unchecked on purpose. */
export const orgPlans = pgTable('org_plans', {
  orgId: uuid('org_id').primaryKey(),
  planKey: text('plan_key').notNull(),
  setByProfileId: uuid('set_by_profile_id'),
  setNote: text('set_note'),
  setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only audit of plan changes. */
export const orgPlanEvents = pgTable(
  'org_plan_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    fromPlan: text('from_plan'),
    toPlan: text('to_plan').notNull(),
    actorProfileId: uuid('actor_profile_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgCreatedIdx: index('org_plan_events_org_created_idx').on(t.orgId, t.createdAt) }),
);
export type OrgPlanRow = typeof orgPlans.$inferSelect;
export type OrgPlanEventRow = typeof orgPlanEvents.$inferSelect;
