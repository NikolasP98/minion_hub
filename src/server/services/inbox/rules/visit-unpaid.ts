import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { schedBookings } from '$server/db/pg-scheduling-schema';
import {
  posTicketLines,
  posTickets,
  posPackageRedemptions,
  posPaymentPlans,
} from '$server/db/pg-pos-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

const STALE_MS = 4 * 60 * 60 * 1000;

/** Pure boundary check: a completed visit is stale once `now` is at least 4h
 *  past its `updatedAt` (3h59 → false, 4h00/4h01 → true). Exported for the test. */
export function isStaleCompleted(updatedAt: Date, now: Date, thresholdMs = STALE_MS): boolean {
  return now.getTime() - updatedAt.getTime() >= thresholdMs;
}

/** A visit counts as funded (not "unpaid") if ANY member has a non-voided
 *  ticket line, a live package redemption, or an active/settled payment plan.
 *  Exported for the test — covers "paid vs plan-funded" combinations. */
export function isVisitFunded(
  hasNonVoidLine: boolean,
  hasLiveRedemption: boolean,
  hasActivePlan: boolean,
): boolean {
  return hasNonVoidLine || hasLiveRedemption || hasActivePlan;
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(): string {
  return 'Visita sin cobrar';
}
function body(when: string): string {
  return `Visita completada sin cobro · ${when}`;
}

/** All booking ids sharing `anchorId`'s `metadata.groupId` (or just `[anchorId]`
 *  when it isn't grouped — an ungrouped booking is its own one-member visit). */
async function expandVisitMembers(
  tx: CoreTx,
  anchorId: string,
  groupId: string | null,
): Promise<string[]> {
  if (!groupId) return [anchorId];
  const rows = await tx
    .select({ id: schedBookings.id })
    .from(schedBookings)
    .where(sql`${schedBookings.metadata} ->> 'groupId' = ${groupId}`);
  return rows.map((r) => r.id);
}

async function isFundedNow(tx: CoreTx, memberIds: string[]): Promise<boolean> {
  const [line] = await tx
    .select({ id: posTicketLines.id })
    .from(posTicketLines)
    .innerJoin(posTickets, eq(posTickets.id, posTicketLines.ticketId))
    .where(and(inArray(posTicketLines.bookingId, memberIds), sql`${posTickets.status} != 'void'`))
    .limit(1);
  const [redemption] = await tx
    .select({ id: posPackageRedemptions.id })
    .from(posPackageRedemptions)
    .where(
      and(
        inArray(posPackageRedemptions.bookingId, memberIds),
        isNull(posPackageRedemptions.reversedAt),
      ),
    )
    .limit(1);
  const [plan] = await tx
    .select({ id: posPaymentPlans.id })
    .from(posPaymentPlans)
    .where(
      and(
        inArray(posPaymentPlans.bookingId, memberIds),
        sql`${posPaymentPlans.status} != 'cancelled'`,
      ),
    )
    .limit(1);
  return isVisitFunded(Boolean(line), Boolean(redemption), Boolean(plan));
}

// TODO(handoff): proven against the pure isStaleCompleted/isVisitFunded unit
// tests and against a live QA stack for appointment.overdue, but NOT yet
// against a seeded stale-completed-unpaid visit fixture — the QA seed matrix
// has no such row today. Add one (scripts/qa/seed/scheduling.ts or pos.ts) to
// close this out; see proposals/2026-10-10-hub-inbox-notifications-reminders.md.
export const visitUnpaidRule: Rule = {
  key: 'visit.unpaid',
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    return withOrgCore(ctx, async (tx) => {
      const candidates = await tx
        .select({
          id: schedBookings.id,
          updatedAt: schedBookings.updatedAt,
          endTime: schedBookings.endTime,
          groupId: sql<string | null>`${schedBookings.metadata} ->> 'groupId'`,
        })
        .from(schedBookings)
        .where(
          and(
            eq(schedBookings.orgId, ctx.tenantId),
            eq(schedBookings.status, 'completed'),
            sql`coalesce(${schedBookings.metadata} ->> 'groupSeq', '0') = '0'`,
            lte(schedBookings.updatedAt, new Date(now.getTime() - STALE_MS)),
          ),
        );

      const upserts: RuleResult['upserts'] = [];
      for (const c of candidates) {
        if (!isStaleCompleted(c.updatedAt, now)) continue;
        const memberIds = await expandVisitMembers(tx, c.id, c.groupId);
        if (await isFundedNow(tx, memberIds)) continue;

        upserts.push({
          scope: 'role',
          orgId: ctx.tenantId,
          capability: 'pos:manage',
          kind: 'visit.unpaid',
          severity: 'warning',
          title: title(),
          body: body(c.endTime.toISOString()),
          // TODO(handoff): see appointment-overdue.ts — same unwired deep-link param.
          href: `/scheduling/calendar?booking=${c.id}`,
          subjectType: 'sched_booking',
          subjectId: c.id,
          dedupeKey: `visit-unpaid:${ctx.tenantId}:${c.id}`,
        });
      }

      // Resolve: a previously-fired visit resolves once it's funded, or no
      // longer completed (e.g. cancelled). Re-check each directly rather than
      // diffing against `upserts` — a visit outside the 4h window (touched
      // recently for an unrelated reason) must still resolve if it's funded.
      const existing = await tx
        .select({
          dedupeKey: appNotifications.dedupeKey,
          subjectId: appNotifications.subjectId,
        })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'visit.unpaid'),
            or(isNull(appNotifications.orgId), eq(appNotifications.orgId, ctx.tenantId)),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };

      const bookingIds = [...new Set(existing.map((r) => r.subjectId).filter(Boolean))] as string[];
      const rows = await tx
        .select({
          id: schedBookings.id,
          status: schedBookings.status,
          groupId: sql<string | null>`${schedBookings.metadata} ->> 'groupId'`,
        })
        .from(schedBookings)
        .where(inArray(schedBookings.id, bookingIds));
      const byId = new Map(rows.map((r) => [r.id, r]));

      const resolve: string[] = [];
      for (const r of existing) {
        if (!r.dedupeKey) continue;
        const booking = r.subjectId ? byId.get(r.subjectId) : undefined;
        if (!booking || booking.status !== 'completed') {
          resolve.push(r.dedupeKey);
          continue;
        }
        const memberIds = await expandVisitMembers(tx, booking.id, booking.groupId);
        if (await isFundedNow(tx, memberIds)) resolve.push(r.dedupeKey);
      }
      return { upserts, resolve };
    });
  },
};
