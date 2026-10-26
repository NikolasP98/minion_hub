import * as m from '$lib/paraglide/messages';

export type DayGroup = 'today' | 'yesterday' | 'earlier';

interface Dated {
  createdAt: string | Date;
}

/** Local-calendar day bucket of `createdAt` relative to `now`. */
export function dayGroup(createdAt: string | Date, now: Date = new Date()): DayGroup {
  const d = new Date(createdAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return 'today';
  if (t >= startOfToday - 86_400_000) return 'yesterday';
  return 'earlier';
}

/** Items split into today / yesterday / earlier, in that order, keeping the
 *  input order inside each bucket and dropping empty buckets. */
export function groupByDay<T extends Dated>(
  items: readonly T[],
  now: Date = new Date(),
): Array<{ group: DayGroup; items: T[] }> {
  const buckets: Record<DayGroup, T[]> = { today: [], yesterday: [], earlier: [] };
  for (const item of items) buckets[dayGroup(item.createdAt, now)].push(item);
  return (['today', 'yesterday', 'earlier'] as const)
    .filter((g) => buckets[g].length > 0)
    .map((g) => ({ group: g, items: buckets[g] }));
}

export function dayGroupLabel(group: DayGroup): string {
  if (group === 'today') return m.common_today();
  if (group === 'yesterday') return m.common_yesterday();
  return m.inbox_earlier();
}

// Called at render time (never at module scope — SSR would bake one locale).
const KIND_LABELS: Record<string, () => string> = {
  'appointment.overdue': () => m.inboxKind_appointment_overdue(),
  'visit.unpaid': () => m.inboxKind_visit_unpaid(),
  'shift.open_after_hours': () => m.inboxKind_shift_open_after_hours(),
  'stock.low': () => m.inboxKind_stock_low(),
  'service.paid_unscheduled': () => m.inboxKind_service_paid_unscheduled(),
  'package.expiring': () => m.inboxKind_package_expiring(),
  'plan.overdue': () => m.inboxKind_plan_overdue(),
  'finance.sync_failed': () => m.inboxKind_finance_sync_failed(),
  'crm.dni_pending': () => m.inboxKind_crm_dni_pending(),
  'crm.birthday': () => m.inboxKind_crm_birthday(),
  'crm.door_submission': () => m.inboxKind_crm_door_submission(),
  'daily.feed': () => m.inbox_daily_title(),
  'app.update': () => m.changelog_title(),
};

/** Human label for a notification kind; unknown kinds fall back to the raw key. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind]?.() ?? kind;
}

export function timeAgo(ts: number | string | Date, now: number = Date.now()): string {
  const mins = Math.floor((now - new Date(ts).getTime()) / 60_000);
  if (mins < 1) return m.notif_justNow();
  if (mins < 60) return m.notif_minsAgo({ mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return m.notif_hoursAgo({ hours: hrs });
  return m.notif_daysAgo({ days: Math.floor(hrs / 24) });
}
