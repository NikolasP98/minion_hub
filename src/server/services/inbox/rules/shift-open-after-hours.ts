import { and, eq, inArray, isNull, max, or, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { posShifts, posTickets, posPayments } from '$server/db/pg-pos-schema';
import { schedResources, schedSchedules, schedAvailability } from '$server/db/pg-scheduling-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import { resolveOrgTimezone } from '$server/services/inbox/daily-feed.service';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Rule, RuleResult } from './types';

const IDLE_MS = 3 * 60 * 60 * 1000;

/** Pure boundary check: idle long enough once `now - lastActivity >= 3h`
 *  (2h59 → false, 3h00/3h01 → true). Exported for the test. */
export function isIdleLongEnough(lastActivity: Date, now: Date, thresholdMs = IDLE_MS): boolean {
  return now.getTime() - lastActivity.getTime() >= thresholdMs;
}

/** Pure boundary check: `nowHHMM` is outside the half-open `[start, end)`
 *  window. 'HH:MM' strings compare correctly lexically. Exported for the test. */
export function isAfterHours(nowHHMM: string, windowStart: string, windowEnd: string): boolean {
  return nowHHMM < windowStart || nowHHMM >= windowEnd;
}

// shortcut: see appointment-overdue.ts — fixed Spanish strings, no per-viewer locale.
function title(): string {
  return 'Caja abierta fuera de horario';
}
function body(openedAt: string): string {
  return `Turno abierto desde ${openedAt} sin actividad reciente`;
}

function localHHMM(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function localWeekday(tz: string, at: Date): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(at);
  return WEEKDAYS.indexOf(short);
}

interface Window {
  start: string;
  end: string;
}

/** Earliest start / latest end among weekly availability rows covering
 *  `weekday`, across every default schedule attached to `resourceIds`. */
async function aggregateWindow(tx: CoreTx, resourceIds: string[], weekday: number): Promise<Window | null> {
  if (resourceIds.length === 0) return null;
  const rows = await tx
    .select({ startTime: schedAvailability.startTime, endTime: schedAvailability.endTime })
    .from(schedAvailability)
    .innerJoin(schedSchedules, eq(schedSchedules.id, schedAvailability.scheduleId))
    .where(
      and(
        inArray(schedSchedules.resourceId, resourceIds),
        eq(schedSchedules.isDefault, true),
        isNull(schedAvailability.date),
        sql`${weekday} = any(${schedAvailability.days})`,
      ),
    );
  if (rows.length === 0) return null;
  const start = rows.map((r) => r.startTime).sort()[0];
  const end = rows.map((r) => r.endTime).sort().at(-1)!;
  return { start, end };
}

/** The open shift owner's window today, falling back to the org aggregate
 *  (min start, max end over every active resource) when the owner has no
 *  linked resource or no availability row for today. */
async function resolveWindow(
  tx: CoreTx,
  orgId: string,
  ownerId: string | null,
  weekday: number,
): Promise<Window | null> {
  if (ownerId) {
    const [resource] = await tx
      .select({ id: schedResources.id })
      .from(schedResources)
      .where(and(eq(schedResources.orgId, orgId), eq(schedResources.profileId, ownerId), eq(schedResources.active, true)))
      .limit(1);
    if (resource) {
      const own = await aggregateWindow(tx, [resource.id], weekday);
      if (own) return own;
    }
  }
  const activeResources = await tx
    .select({ id: schedResources.id })
    .from(schedResources)
    .where(and(eq(schedResources.orgId, orgId), eq(schedResources.active, true)));
  return aggregateWindow(tx, activeResources.map((r) => r.id), weekday);
}

async function lastActivity(tx: CoreTx, shift: { id: string; updatedAt: Date }): Promise<Date> {
  const [ticketRow] = await tx
    .select({ max: max(posTickets.submittedAt) })
    .from(posTickets)
    .where(eq(posTickets.shiftId, shift.id));
  const [paymentRow] = await tx
    .select({ max: max(posPayments.paidAt) })
    .from(posPayments)
    .where(eq(posPayments.shiftId, shift.id));
  // shortcut: pos_ticket_lines carries no timestamp of its own — its ticket's
  // submittedAt already covers it. Upgrade only if lines can be edited after
  // ticket submission without bumping the ticket.
  const candidates = [shift.updatedAt, ticketRow?.max, paymentRow?.max].filter(
    (d): d is Date => d instanceof Date,
  );
  return candidates.reduce((a, b) => (b > a ? b : a), shift.updatedAt);
}

export const shiftOpenAfterHoursRule: Rule = {
  key: 'shift.open_after_hours',
  async evaluate(ctx: CoreCtx, now: Date): Promise<RuleResult> {
    const tz = await resolveOrgTimezone(ctx);
    const weekday = localWeekday(tz, now);
    const nowHHMM = localHHMM(tz, now);

    return withOrgCore(ctx, async (tx) => {
      const open = await tx
        .select({ id: posShifts.id, openedBy: posShifts.openedBy, openedAt: posShifts.openedAt, updatedAt: posShifts.updatedAt })
        .from(posShifts)
        .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')));

      const upserts: RuleResult['upserts'] = [];
      for (const shift of open) {
        const window = await resolveWindow(tx, ctx.tenantId, shift.openedBy, weekday);
        if (!window || !isAfterHours(nowHHMM, window.start, window.end)) continue;
        const activity = await lastActivity(tx, shift);
        if (!isIdleLongEnough(activity, now)) continue;

        const dedupeKey = `shift-open-after-hours:${ctx.tenantId}:${shift.id}`;
        const common = {
          kind: 'shift.open_after_hours' as const,
          severity: 'critical' as const,
          title: title(),
          body: body(shift.openedAt.toISOString()),
          href: `/pos/shifts?shift=${shift.id}`,
          subjectType: 'pos_shift',
          subjectId: shift.id,
        };
        upserts.push({
          ...common,
          scope: 'role',
          orgId: ctx.tenantId,
          capability: 'pos:manage',
          dedupeKey: `${dedupeKey}:role`,
        });
        if (shift.openedBy) {
          upserts.push({
            ...common,
            scope: 'user',
            orgId: ctx.tenantId,
            profileId: shift.openedBy,
            dedupeKey: `${dedupeKey}:user:${shift.openedBy}`,
          });
        }
      }

      // Resolve: ONLY when the shift closes (spec §Slice 2.4) — flickering
      // in/out of after-hours or recent activity does not clear the row.
      const existing = await tx
        .select({ dedupeKey: appNotifications.dedupeKey, subjectId: appNotifications.subjectId })
        .from(appNotifications)
        .where(
          and(
            eq(appNotifications.kind, 'shift.open_after_hours'),
            or(isNull(appNotifications.orgId), eq(appNotifications.orgId, ctx.tenantId)),
            isNull(appNotifications.resolvedAt),
          ),
        );
      if (existing.length === 0) return { upserts, resolve: [] };
      const shiftIds = [...new Set(existing.map((r) => r.subjectId).filter(Boolean))] as string[];
      const stillOpen = await tx
        .select({ id: posShifts.id })
        .from(posShifts)
        .where(and(inArray(posShifts.id, shiftIds), eq(posShifts.status, 'open')));
      const openSet = new Set(stillOpen.map((r) => r.id));
      const resolve = existing
        .filter((r) => !r.subjectId || !openSet.has(r.subjectId))
        .map((r) => r.dedupeKey)
        .filter((k): k is string => Boolean(k));
      return { upserts, resolve };
    });
  },
};
