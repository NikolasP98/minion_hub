import { and, eq, lte, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import {
  membershipPlans,
  memberships,
  membershipCycles,
  type MembershipPlan,
  type Membership,
} from '$server/db/pg-membership-schema';
import { salesOrders } from '$server/db/pg-sales-schema';
import { nextSerialId } from './naming-series';
import type { CoreCtx } from '$server/auth/core-ctx';

export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * Pure, calendar-aware interval add (UTC). Month/year clamp the day so
 * Jan 31 + 1 month = Feb 28/29, not a March overflow.
 */
export function addInterval(from: Date, unit: IntervalUnit, count: number): Date {
  const r = new Date(from.getTime());
  if (unit === 'day') r.setUTCDate(r.getUTCDate() + count);
  else if (unit === 'week') r.setUTCDate(r.getUTCDate() + count * 7);
  else if (unit === 'month' || unit === 'year') {
    const months = unit === 'year' ? count * 12 : count;
    const day = r.getUTCDate();
    r.setUTCDate(1);
    r.setUTCMonth(r.getUTCMonth() + months);
    r.setUTCDate(Math.min(day, daysInMonth(r)));
  }
  return r;
}

// ── Plans (admin) ─────────────────────────────────────────────────────────────
export function listPlans(ctx: CoreCtx): Promise<MembershipPlan[]> {
  return withOrgCore(ctx, (tx) => tx.select().from(membershipPlans).where(eq(membershipPlans.orgId, ctx.tenantId)));
}

export type NewPlanInput = Omit<typeof membershipPlans.$inferInsert, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>;

export async function createPlan(ctx: CoreCtx, input: NewPlanInput): Promise<MembershipPlan> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx.insert(membershipPlans).values({ ...input, orgId: ctx.tenantId }).returning(),
  );
  return row;
}

export async function updatePlan(ctx: CoreCtx, id: string, patch: Partial<NewPlanInput>): Promise<MembershipPlan | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(membershipPlans)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(membershipPlans.id, id), eq(membershipPlans.orgId, ctx.tenantId)))
      .returning(),
  );
  return row ?? null;
}

// ── Memberships ───────────────────────────────────────────────────────────────
export function listMemberships(ctx: CoreCtx): Promise<Membership[]> {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(memberships).where(eq(memberships.orgId, ctx.tenantId)).orderBy(memberships.createdAt),
  );
}

export interface NewMembershipInput {
  planId: string;
  crmContactId?: string | null;
  partyId?: string | null;
  customerName?: string | null;
  startedAt?: Date;
}

/** Start a membership. First cycle spawns on the next tick (next_cycle_date = start). */
export async function createMembership(ctx: CoreCtx, input: NewMembershipInput): Promise<Membership> {
  const started = input.startedAt ?? new Date();
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(memberships)
      .values({
        orgId: ctx.tenantId,
        planId: input.planId,
        crmContactId: input.crmContactId ?? null,
        partyId: input.partyId ?? null,
        customerName: input.customerName ?? null,
        startedAt: started,
        nextCycleDate: started,
      })
      .returning(),
  );
  return row;
}

export async function setMembershipStatus(ctx: CoreCtx, id: string, status: string): Promise<Membership | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .update(memberships)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(memberships.id, id), eq(memberships.orgId, ctx.tenantId)))
      .returning(),
  );
  return row ?? null;
}

// ── Cycle spawning (cron) ─────────────────────────────────────────────────────
export interface CycleRunResult {
  spawned: number;
  skipped: number;
}

/** Orgs with at least one active membership (bypass-RLS read for the cron fan-out). */
export async function listEnabledMembershipOrgs(): Promise<string[]> {
  const rows = await getCoreDb()
    .selectDistinct({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.status, 'active'));
  return rows.map((r) => r.orgId);
}

async function spawnCycle(tx: CoreTx, ctx: CoreCtx, m: Membership, now: Date): Promise<boolean> {
  const [plan] = await tx
    .select()
    .from(membershipPlans)
    .where(and(eq(membershipPlans.id, m.planId), eq(membershipPlans.orgId, ctx.tenantId)));
  if (!plan || !plan.enabled) return false;

  const cycleNo = m.cycleNo + 1;
  const periodStart = m.nextCycleDate;
  const periodEnd = addInterval(periodStart, plan.intervalUnit as IntervalUnit, plan.intervalCount);

  // Claim the cycle first (unique membership_id+cycle_no) — idempotent under
  // concurrent ticks; only the winner creates the billing order.
  const [cyc] = await tx
    .insert(membershipCycles)
    .values({ orgId: ctx.tenantId, membershipId: m.id, cycleNo, periodStart, periodEnd })
    .onConflictDoNothing()
    .returning({ id: membershipCycles.id });

  if (cyc) {
    const humanId = await nextSerialId(tx, ctx.tenantId, 'SO-.YYYY.-', now);
    const [so] = await tx
      .insert(salesOrders)
      .values({
        orgId: ctx.tenantId,
        humanId,
        partyId: m.partyId,
        crmContactId: m.crmContactId,
        customerName: m.customerName,
        description: `${plan.name} — cycle ${cycleNo}`,
        total: plan.price,
        currency: plan.currency,
        status: 'draft',
        metadata: { membershipId: m.id, cycleNo },
      })
      .returning({ id: salesOrders.id });
    await tx.update(membershipCycles).set({ salesOrderId: so.id }).where(eq(membershipCycles.id, cyc.id));
  }

  // Advance the watermark either way (a conflict means the cycle already exists).
  await tx
    .update(memberships)
    .set({ nextCycleDate: periodEnd, cycleNo, updatedAt: now })
    .where(eq(memberships.id, m.id));
  return !!cyc;
}

/** Spawn one due cycle per active membership whose next_cycle_date has passed.
 *  ponytail: advances one cycle per tick — a long-dormant membership catches up
 *  over successive ticks, not all at once. Raise the cadence if that matters. */
export async function processMembershipCycles(ctx: CoreCtx, now: Date): Promise<CycleRunResult> {
  const res: CycleRunResult = { spawned: 0, skipped: 0 };
  const due = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, ctx.tenantId), eq(memberships.status, 'active'), lte(memberships.nextCycleDate, now)))
      .limit(200),
  );
  for (const m of due) {
    const ok = await withOrgCore(ctx, (tx) => spawnCycle(tx, ctx, m, now));
    if (ok) res.spawned++;
    else res.skipped++;
  }
  return res;
}
