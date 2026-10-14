import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { schedBookings, schedResources } from '$server/db/pg-scheduling-schema';
import { posShifts, posTickets, posTicketLines } from '$server/db/pg-pos-schema';
import { appNotifications } from '$server/db/pg-inbox-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getUserNames } from '$server/services/user.service';

/** POS stores money as numeric(…,2). */
const MONEY_DECIMALS = 2;

// TODO(handoff): no org business-hours/timezone table exists yet (AS-IS). Use
// the org's first active staff resource's timezone, falling back to the
// hub-wide default — upgrade to a real org timezone column when one lands
// (Slice 2's `daily.feed` rule needs the same resolution and should replace
// this). See proposals/2026-10-10-hub-inbox-notifications-reminders.md.
const DEFAULT_TIMEZONE = 'America/Lima';

export async function resolveOrgTimezone(ctx: CoreCtx): Promise<string> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select({ timezone: schedResources.timezone })
      .from(schedResources)
      .where(and(eq(schedResources.orgId, ctx.tenantId), eq(schedResources.active, true)))
      .limit(1);
    return row?.timezone ?? DEFAULT_TIMEZONE;
  });
}

/** `YYYY-MM-DD` for `at` (default now) in the given IANA timezone. */
export function orgLocalDateString(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** UTC instants bracketing `[dateStr 00:00, dateStr+1 00:00)` in `tz`. Walks the
 *  UTC offset at local midnight — correct across DST since `orgLocalDateString`
 *  re-checks the resulting instant lands on the right local day. */
function localDayRange(tz: string, dateStr: string): { start: Date; end: Date } {
  const naiveStart = new Date(`${dateStr}T00:00:00Z`);
  const offsetMs =
    naiveStart.getTime() - new Date(naiveStart.toLocaleString('en-US', { timeZone: tz })).getTime();
  const start = new Date(naiveStart.getTime() + offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** POST /api/inbox/daily: create ONE scope:user "Tu día" notification for the
 *  caller, idempotent per org-local day (dedupe_key carries the date). */
export async function requestDailyKnock(
  ctx: CoreCtx,
  titleKey: string,
): Promise<{ created: boolean }> {
  if (!ctx.profileId) throw new Error('requestDailyKnock requires an authenticated profile');
  const tz = await resolveOrgTimezone(ctx);
  const date = orgLocalDateString(tz);
  const dedupeKey = `daily:${ctx.tenantId}:${ctx.profileId}:${date}`;
  const { end } = localDayRange(tz, date);
  return withOrgCore(ctx, async (tx) => {
    const [inserted] = await tx
      .insert(appNotifications)
      .values({
        scope: 'user',
        orgId: ctx.tenantId,
        profileId: ctx.profileId,
        kind: 'daily.feed',
        severity: 'info',
        title: titleKey,
        href: `/notifications/daily?date=${date}`,
        dedupeKey,
        expiresAt: end,
      })
      // partial unique index (`where dedupe_key is not null`) — see
      // inbox.service.ts upsertNotification for why the `where` is required.
      .onConflictDoNothing({
        target: appNotifications.dedupeKey,
        where: sql`${appNotifications.dedupeKey} is not null`,
      })
      .returning({ id: appNotifications.id });
    return { created: Boolean(inserted) };
  });
}

export interface DailyFeedView {
  date: string;
  appointmentsByStaff: Array<{
    staffId: string | null;
    staffName: string;
    appointments: Array<{
      id: string;
      title: string | null;
      startTime: string;
      endTime: string;
      status: string;
    }>;
  }>;
  yesterdaySales: {
    total: string;
    count: number;
    /** The currency every counted ticket shares, or `null` when they disagree —
     *  a sum across currencies is not an amount, so the page shows the count
     *  alone rather than labelling the total with a guessed symbol. */
    currency: string | null;
  };
  pending: {
    unscheduledPaidServices: Array<{ ticketId: string; lineId: string; description: string }>;
    /** `title`/`attendeeName` so the row names a visit instead of a bare time. */
    completedUnpaidVisits: Array<{
      bookingId: string;
      endTime: string;
      title: string | null;
      attendeeName: string | null;
    }>;
    openShifts: Array<{
      shiftId: string;
      openedBy: string | null;
      openedByName: string | null;
      openedAt: string;
    }>;
  };
}

/** The always-available daily feed, computed on demand (not stored — out of
 *  scope per spec). `dateStr` defaults to the org-local "today". */
export async function getDailyFeedView(ctx: CoreCtx, dateStr?: string): Promise<DailyFeedView> {
  const tz = await resolveOrgTimezone(ctx);
  const date = dateStr ?? orgLocalDateString(tz);
  const yesterday = addDaysToDateString(date, -1);
  const today = localDayRange(tz, date);
  const yday = localDayRange(tz, yesterday);

  return withOrgCore(ctx, async (tx) => {
    const bookings = await tx
      .select({
        id: schedBookings.id,
        title: schedBookings.title,
        startTime: schedBookings.startTime,
        endTime: schedBookings.endTime,
        status: schedBookings.status,
        resourceId: schedBookings.resourceId,
        staffName: schedResources.name,
      })
      .from(schedBookings)
      .leftJoin(schedResources, eq(schedResources.id, schedBookings.resourceId))
      .where(
        and(
          eq(schedBookings.orgId, ctx.tenantId),
          gte(schedBookings.startTime, today.start),
          lt(schedBookings.startTime, today.end),
          inArray(schedBookings.status, ['accepted', 'pending', 'completed', 'no_show']),
        ),
      );

    const byStaff = new Map<string, DailyFeedView['appointmentsByStaff'][number]>();
    for (const b of bookings) {
      const key = b.resourceId;
      if (!byStaff.has(key)) {
        byStaff.set(key, {
          staffId: b.resourceId,
          staffName: b.staffName ?? '—',
          appointments: [],
        });
      }
      byStaff.get(key)!.appointments.push({
        id: b.id,
        title: b.title,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        status: b.status,
      });
    }

    // Grouped by currency so a mixed day is visible as such instead of being
    // summed into a meaningless number (money rule: currency is data).
    const salesRows = await tx
      .select({
        currency: posTickets.currency,
        total: sql<string>`coalesce(sum(${posTickets.total}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(posTickets)
      .where(
        and(
          eq(posTickets.orgId, ctx.tenantId),
          sql`${posTickets.status} != 'void'`,
          gte(posTickets.submittedAt, yday.start),
          lt(posTickets.submittedAt, yday.end),
        ),
      )
      .groupBy(posTickets.currency);

    const unscheduled = await tx
      .select({
        ticketId: posTicketLines.ticketId,
        lineId: posTicketLines.id,
        description: posTicketLines.description,
      })
      .from(posTicketLines)
      .innerJoin(posTickets, eq(posTickets.id, posTicketLines.ticketId))
      .where(
        and(
          eq(posTicketLines.orgId, ctx.tenantId),
          eq(posTicketLines.kind, 'service'),
          isNull(posTicketLines.bookingId),
          sql`${posTickets.status} != 'void'`,
        ),
      )
      .limit(50);

    // TODO(handoff): per-booking check, not the groupId-merged "visit" the
    // spec's Slice 2 `visit.unpaid` rule uses — fine for a read-only glance;
    // upgrade if this page needs to match that rule's exact dedupe unit.
    const completedUnpaid = await tx
      .select({
        id: schedBookings.id,
        endTime: schedBookings.endTime,
        title: schedBookings.title,
        attendeeName: schedBookings.attendeeName,
      })
      .from(schedBookings)
      .where(
        and(
          eq(schedBookings.orgId, ctx.tenantId),
          eq(schedBookings.status, 'completed'),
          sql`not exists (
            select 1 from pos_ticket_lines l
            join pos_tickets t on t.id = l.ticket_id
            where l.booking_id = ${schedBookings.id} and t.status != 'void'
          )`,
        ),
      )
      .limit(50);

    const openShifts = await tx
      .select({ id: posShifts.id, openedBy: posShifts.openedBy, openedAt: posShifts.openedAt })
      .from(posShifts)
      .where(and(eq(posShifts.orgId, ctx.tenantId), eq(posShifts.status, 'open')));

    const shiftNames = await getUserNames(openShifts.map((s) => s.openedBy)).catch(
      () => new Map<string, string>(),
    );

    return {
      date,
      appointmentsByStaff: Array.from(byStaff.values()),
      yesterdaySales: {
        total: String(
          salesRows.reduce((sum, r) => sum + Number(r.total ?? 0), 0).toFixed(MONEY_DECIMALS),
        ),
        count: salesRows.reduce((sum, r) => sum + Number(r.count ?? 0), 0),
        currency: salesRows.length === 1 ? (salesRows[0].currency ?? null) : null,
      },
      pending: {
        unscheduledPaidServices: unscheduled,
        completedUnpaidVisits: completedUnpaid.map((b) => ({
          bookingId: b.id,
          endTime: b.endTime.toISOString(),
          title: b.title,
          attendeeName: b.attendeeName,
        })),
        openShifts: openShifts.map((s) => ({
          shiftId: s.id,
          openedBy: s.openedBy,
          openedByName: (s.openedBy && shiftNames.get(s.openedBy)) || null,
          openedAt: s.openedAt.toISOString(),
        })),
      },
    };
  });
}
