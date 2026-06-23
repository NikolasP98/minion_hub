import { pgTable, uuid, text, integer, numeric, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Memberships / recurring (ERPNext Subscription + Membership port). A plan is a
 * recurring interval + price; a membership ties a contact to a plan and carries
 * a next_cycle_date watermark; the cron tick spawns a membership_cycle (+ a draft
 * sales order for billing — never a fin_invoice, so SUSII stays the revenue
 * source of truth) whenever a membership comes due. The cycle unique key
 * (membership_id, cycle_no) makes the tick idempotent.
 *
 * Companion migration: supabase/migrations/<ts>_membership.sql.
 */
export const membershipPlans = pgTable(
  'membership_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    price: numeric('price'),
    currency: text('currency'),
    /** day | week | month | year */
    intervalUnit: text('interval_unit').notNull().default('month'),
    intervalCount: integer('interval_count').notNull().default(1),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ orgIdx: index('membership_plans_org_idx').on(t.orgId, t.enabled) }),
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    planId: uuid('plan_id').notNull(),
    crmContactId: uuid('crm_contact_id'),
    partyId: uuid('party_id'),
    customerName: text('customer_name'),
    /** active | paused | cancelled */
    status: text('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    nextCycleDate: timestamp('next_cycle_date', { withTimezone: true }).notNull(),
    cycleNo: integer('cycle_no').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStatusIdx: index('memberships_org_status_idx').on(t.orgId, t.status, t.nextCycleDate),
    contactIdx: index('memberships_contact_idx').on(t.crmContactId),
  }),
);

export const membershipCycles = pgTable(
  'membership_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    cycleNo: integer('cycle_no').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    salesOrderId: uuid('sales_order_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('membership_cycles_uniq').on(t.membershipId, t.cycleNo),
    orgIdx: index('membership_cycles_org_idx').on(t.orgId, t.createdAt),
  }),
);

export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MembershipCycle = typeof membershipCycles.$inferSelect;
