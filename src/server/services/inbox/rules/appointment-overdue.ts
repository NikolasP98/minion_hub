import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
// drizzle note: `sql` below produces a raw boolean expression for the jsonb
// groupSeq anchor check — isNull() only accepts Column/SQL.Aliased, so the
// "no groupSeq" branch is expressed as a raw predicate instead.
import { withOrgCore } from '$server/db/with-org-core';
import { schedBookings, schedResources } from '$server/db/pg-scheduling-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

/** Booking statuses the spec treats as still "open" (AS-IS: pending|accepted = active). */
const ACTIVE_STATUSES = ['accepted', 'pending'] as const;
const GRACE_MS = 30 * 60 * 1000;

/** Pure boundary check: an ACTIVE booking is overdue once `now` is more than
 *  the 30-minute grace period past its `endTime`. Exported for the unit test. */
export function isOverdue(endTime: Date, now: Date, graceMs = GRACE_MS): boolean {
  return now.getTime() - endTime.getTime() > graceMs;
}

// shortcut: title/body are fixed Spanish strings, not resolved per-viewer —
// @inlang/paraglide-sveltekit 0.16 has no per-call locale override and a cron
// tick has no request locale to inherit. Upgrade once the inbox UI renders
// from a stored message key + params instead of literal text.
function title(): string {
  return 'Cita sin cerrar';
}
function body(client: string, when: string): string {
  return `${client} · ${when}`;
}

export const appointmentOverdueRule: Rule = {
  key: 'appointment.overdue',
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    return withOrgCore(ctx, async (tx) => {
      // Visit anchors only (groupSeq null/0) — a grouped visit gets ONE
      // notification, not one per member.
      const overdue = await tx
        .select({
          id: schedBookings.id,
          endTime: schedBookings.endTime,
          startTime: schedBookings.startTime,
          attendeeName: schedBookings.attendeeName,
          title: schedBookings.title,
          resourceId: schedBookings.resourceId,
          profileId: schedResources.profileId,
        })
        .from(schedBookings)
        .leftJoin(schedResources, eq(schedResources.id, schedBookings.resourceId))
        .where(
          and(
            eq(schedBookings.orgId, ctx.tenantId),
            inArray(schedBookings.status, [...ACTIVE_STATUSES]),
            lt(schedBookings.endTime, new Date(now.getTime() - GRACE_MS)),
            sql`coalesce(${schedBookings.metadata} ->> 'groupSeq', '0') = '0'`,
          ),
        );

      const upserts = overdue.flatMap((b) => {
        if (!isOverdue(b.endTime, now)) return [];
        const dedupeKey = `appt-overdue:${ctx.tenantId}:${b.id}`;
        const when = b.startTime.toISOString();
        const client = b.attendeeName ?? b.title ?? '—';
        const href = `/scheduling/calendar?booking=${b.id}`;
        const common = {
          kind: 'appointment.overdue' as const,
          severity: 'warning' as const,
          title: title(),
          body: body(client, when),
          href,
          subjectType: 'sched_booking',
          subjectId: b.id,
        };
        const drafts: RuleResult['upserts'] = [
          {
            ...common,
            scope: 'role',
            orgId: ctx.tenantId,
            capability: 'scheduling:manage',
            dedupeKey: `${dedupeKey}:role`,
          },
        ];
        if (b.profileId) {
          drafts.push({
            ...common,
            scope: 'user',
            orgId: ctx.tenantId,
            profileId: b.profileId,
            dedupeKey: `${dedupeKey}:user:${b.profileId}`,
          });
        }
        return drafts;
      });

      // Resolve: any unresolved row for this org/kind whose booking is no
      // longer ACTIVE (closed, cancelled, rejected, no-show, or deleted).
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'appointment.overdue'),
            or(isNull(appNotifications.orgId), eq(appNotifications.orgId, ctx.tenantId)),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };
      const bookingIds = [...new Set(existing.map((r) => r.subjectId).filter(Boolean))] as string[];
      const stillActive = await tx
        .select({ id: schedBookings.id })
        .from(schedBookings)
        .where(
          and(
            inArray(schedBookings.id, bookingIds),
            inArray(schedBookings.status, [...ACTIVE_STATUSES]),
          ),
        );
      const activeSet = new Set(stillActive.map((r) => r.id));
      const resolve = existing
        .filter((r) => !r.subjectId || !activeSet.has(r.subjectId))
        .map((r) => r.dedupeKey)
        .filter((k): k is string => Boolean(k));
      return { upserts, resolve };
    });
  },
};
