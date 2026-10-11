import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listSellables, listTickets, listShifts } from '$server/services/pos.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { getUserNames } from '$server/services/user.service';
import { schedulingTimeZone, todayIn } from '$lib/components/scheduling/calendar-window';
import { zonedDayWindow } from '$lib/components/dashboard/date-range/url';

/** View perm (`pos.sell:view`) is enforced centrally by the root layout guard
 *  (MODULE_SUBRESOURCES) — this load only fetches the tab's data.
 *
 *  Event types + resources feed the `?step=schedule` third step (the same two
 *  reads `/pos/appointments/new` does). Skipped entirely when the scheduling
 *  module is off: that step then never renders, so fetching for it is waste. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:sell');

  const schedulingEnabled = locals.moduleStates?.scheduling ?? true;
  const [sellables, resources, eventTypes] = await Promise.all([
    listSellables(ctx),
    schedulingEnabled ? listResources(ctx) : Promise.resolve([]),
    schedulingEnabled ? listEventTypes(ctx) : Promise.resolve([]),
  ]);

  // Today's activity popover (unified recent-sales + shift-history) is scoped
  // to the ORG's calendar day, not the browser's — a shift opened at 11pm org
  // time must not spill into "today" for a server in a different zone.
  const orgTz = schedulingTimeZone(resources);
  const today = todayIn(orgTz);
  const todayStart = zonedDayWindow(today, today, orgTz).from ?? undefined;
  const [todayTickets, shifts] = await Promise.all([
    listTickets(ctx, { from: todayStart, limit: 200 }),
    listShifts(ctx, { from: todayStart, limit: 50 }),
  ]);
  // Shifts are per user now, so the activity list names whose register each
  // row was — one batched profile lookup for the whole list.
  const openerNames = await getUserNames(shifts.map((s) => s.openedBy)).catch(
    () => new Map<string, string>(),
  );

  return {
    sellables,
    todayTickets,
    todayShifts: shifts.map((s) => ({
      ...s,
      openedByName: (s.openedBy && openerNames.get(s.openedBy)) || null,
    })),
    schedulingEnabled,
    orgTz,
    stockEnabled: locals.moduleStates?.stock ?? true,
    resources: resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({
      id: e.id,
      title: e.title,
      productId: e.productId ?? null,
    })),
  };
};
