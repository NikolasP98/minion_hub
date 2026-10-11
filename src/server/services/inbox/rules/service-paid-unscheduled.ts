import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { posTicketLines, posTickets } from '$server/db/pg-pos-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import { listPendingSchedulingLines } from '$server/services/pos-accounts.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

const STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** Pure boundary check: a paid, unscheduled service line is stale once `now`
 *  is at least 3 days past its ticket's `submittedAt`. Exported for the test. */
export function isStaleUnscheduled(submittedAt: Date, now: Date, thresholdMs = STALE_MS): boolean {
  return now.getTime() - submittedAt.getTime() >= thresholdMs;
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(): string {
  return 'Servicio pagado sin agendar';
}
function body(description: string, customer: string | null): string {
  return `${description} · ${customer ?? '—'}`;
}

export const servicePaidUnscheduledRule: Rule = {
  key: 'service.paid_unscheduled',
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    // Reuses the shared `/pos/accounts` + calendar-tray query (spec Slice 4) —
    // its `submittedAt` is already in the return shape, so the 3-day
    // threshold is applied here rather than duplicating the join.
    // shortcut: capped at 500 pending lines per org per tick (vs. the
    // default 200 the tray uses) — an org with more untouched paid lines
    // than that has a bigger problem than this reminder; raise the cap if
    // that's ever observed.
    const pending = await listPendingSchedulingLines(ctx, { limit: 500 });

    return withOrgCore(ctx, async (tx) => {
      const stale = pending.filter((l) => isStaleUnscheduled(l.submittedAt, now));
      const upserts: RuleResult['upserts'] = stale.map((l) => ({
        scope: 'role',
        orgId: ctx.tenantId,
        capability: 'scheduling:manage',
        kind: 'service.paid_unscheduled',
        severity: 'warning',
        title: title(),
        body: body(l.description, l.customerName),
        href: `/pos/appointments?line=${l.lineId}`,
        subjectType: 'pos_ticket_line',
        subjectId: l.lineId,
        dedupeKey: `service-paid-unscheduled:${ctx.tenantId}:${l.lineId}`,
      }));

      // Resolve: a previously-fired line resolves once it's booked, voided,
      // or converted to a plan instalment — re-check directly against the
      // same predicate `listPendingSchedulingLines` uses, not the capped
      // 500-row page (a line can fall off the page while still pending).
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'service.paid_unscheduled'),
            eq(appNotifications.orgId, ctx.tenantId),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };

      const lineIds = [...new Set(existing.map((r) => r.subjectId).filter(Boolean))] as string[];
      const stillPending = await tx
        .select({ id: posTicketLines.id })
        .from(posTicketLines)
        .innerJoin(posTickets, eq(posTickets.id, posTicketLines.ticketId))
        .where(
          and(
            inArray(posTicketLines.id, lineIds),
            eq(posTicketLines.kind, 'service'),
            isNull(posTicketLines.bookingId),
            isNull(posTicketLines.planId),
            notInArray(sql<string>`${posTickets.status}`, ['void', 'voided']),
          ),
        );
      const pendingSet = new Set(stillPending.map((r) => r.id));
      const resolve = existing
        .filter((r) => !r.subjectId || !pendingSet.has(r.subjectId))
        .map((r) => r.dedupeKey)
        .filter((k): k is string => Boolean(k));
      return { upserts, resolve };
    });
  },
};
