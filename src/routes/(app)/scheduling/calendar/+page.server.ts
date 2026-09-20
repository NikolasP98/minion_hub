import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { listResources, listEventKinds } from '$server/services/scheduling.service';
import { listTags } from '$server/services/crm-contacts.service';
import { loadCalendarEvents } from '$server/scheduling/load-calendar-events';
import type { CalendarView } from '$lib/components/scheduling/calendar/types';

const VIEWS: CalendarView[] = ['day', 'week', 'month', 'agenda'];
const DAY_MS = 86_400_000;

/** Monday of the week containing `d` (local). */
function mondayOf(d: Date): Date {
  const diff = (d.getDay() + 6) % 7; // days since Monday (Sun=0 → 6)
  const m = new Date(d);
  m.setDate(d.getDate() - diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

export const load: PageServerLoad = async ({ locals, depends, url, parent }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('scheduling:data');

  // Reuse the (app) layout's already-loaded preferences bundle (no extra query).
  const { preferences } = await parent();
  const calendarPrefs = preferences.preferences.calendar as
    { showInheritedTags?: boolean } | undefined;
  const showInheritedTags = calendarPrefs?.showInheritedTags ?? true;

  // Default "today" in the ORG's timezone (resources carry it; the server runs
  // in UTC, so a bare toISOString() would show tomorrow late at night).
  const resources = await listResources(ctx);
  const orgTz = resources.find((r) => r.active)?.timezone ?? 'America/Lima';
  const todayInTz = new Intl.DateTimeFormat('en-CA', { timeZone: orgTz }).format(new Date()); // YYYY-MM-DD

  const viewParam = url.searchParams.get('view');
  const view: CalendarView = VIEWS.includes(viewParam as CalendarView)
    ? (viewParam as CalendarView)
    : 'day';

  const dateParam = url.searchParams.get('date');
  const day = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInTz;

  const dayStart = new Date(`${day}T00:00:00`);
  let from: Date;
  let to: Date;
  if (view === 'week') {
    const monday = mondayOf(dayStart);
    from = new Date(monday.getTime() - 7 * DAY_MS);
    to = new Date(monday.getTime() + 14 * DAY_MS);
  } else if (view === 'month') {
    const firstOfMonth = new Date(dayStart.getFullYear(), dayStart.getMonth(), 1);
    const monday = mondayOf(firstOfMonth);
    from = new Date(monday.getTime() - 14 * DAY_MS);
    to = new Date(monday.getTime() + 42 * DAY_MS);
  } else if (view === 'agenda') {
    from = dayStart;
    to = new Date(dayStart.getTime() + 30 * DAY_MS);
  } else {
    from = dayStart;
    to = new Date(dayStart.getTime() + DAY_MS);
  }

  const staffParam = url.searchParams.get('staff');
  const staff = staffParam ? staffParam.split(',').filter(Boolean) : [];
  const kindId = url.searchParams.get('kind');

  const [kinds, tags, events] = await Promise.all([
    listEventKinds(ctx),
    listTags(ctx),
    loadCalendarEvents(ctx, {
      from,
      to,
      maskAttendeePii: await shouldMaskSensitive(locals, 'scheduling'),
    }),
  ]);

  return {
    view,
    day,
    staff,
    kindId,
    showInheritedTags,
    resources: resources
      .filter((r) => r.active)
      .map((r) => ({ id: r.id, name: r.name, color: r.color })),
    kinds,
    // Filterable tags = everything an event can show: its own (event scope),
    // the client's (crm) and the service's (catalog). Stock tags never reach an
    // event. Cross-scope rows carry an origin so same-named tags stay tellable.
    tags: (['event', 'crm', 'catalog'] as const).flatMap((scope) =>
      tags
        .filter((t) => t.kind === 'manual' && t.scope === scope)
        .map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          ...(scope === 'crm'
            ? { origin: 'contact' as const }
            : scope === 'catalog'
              ? { origin: 'product' as const }
              : {}),
        })),
    ),
    from: from.toISOString(),
    to: to.toISOString(),
    events,
  };
};
