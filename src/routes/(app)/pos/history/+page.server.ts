import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  listTickets,
  listShifts,
  listPaymentsFor,
  profileNames,
} from '$server/services/pos.service';
import { listResources } from '$server/services/scheduling.service';
import {
  schedulingTimeZone,
  parseCalendarDate,
  todayIn,
} from '$lib/components/scheduling/calendar-window';
import { foldPayments } from './payments-fold';

/** `?view=` on this page — a plain ticket list, or a calendar reading of the
 *  same payments bucketed by day. Not a `CalendarView`: there is no `day`
 *  view here, and `list` has no calendar-window equivalent. */
export type HistoryView = 'list' | 'week' | 'month';
function parseHistoryView(value: string | null): HistoryView {
  return value === 'week' || value === 'month' ? value : 'list';
}

/** View perm (`pos:view`, the module's default prefix — this page has no
 *  MODULE_SUBRESOURCES row, so it inherits the module's own view gate). */
export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:history');

  // The org timezone rides on the resources, exactly like /pos/appointments —
  // the calendar views here must read the same local day as every other
  // calendar in the app.
  const resources = await listResources(ctx);
  const orgTz = schedulingTimeZone(resources);
  const view = parseHistoryView(url.searchParams.get('view'));
  const day = parseCalendarDate(url.searchParams.get('date'), todayIn(orgTz));

  // TODO(handoff): plain limit, newest-first — no server pagination. Fine at
  // today's row counts; revisit with DataTable server mode once an org's
  // ticket history regularly exceeds this window. See meta proposals/
  // 2026-10-10-hub-pos-sell-history-unified.md.
  const [tickets, shifts] = await Promise.all([
    listTickets(ctx, { limit: 500 }),
    listShifts(ctx, { limit: 500 }),
  ]);

  const [payments, names] = await Promise.all([
    listPaymentsFor(ctx, {
      ticketIds: tickets.map((t) => t.id),
      shiftIds: shifts.map((s) => s.id),
    }),
    profileNames(ctx, [...tickets.map((t) => t.createdBy), ...shifts.map((s) => s.openedBy)]),
  ]);
  const { byTicket, methodTotals } = foldPayments(payments);
  return {
    orgTz,
    view,
    day,
    methodTotals,
    // The week/month calendar views fold every row (refund counter-rows
    // included) by its own day — `payments-fold.ts`'s `dayTotals`.
    payments,
    tickets: tickets.map((t) => ({
      ...t,
      cashier: t.createdBy ? (names[t.createdBy] ?? null) : null,
      payments: byTicket.get(t.id) ?? [],
    })),
    shifts: shifts.map((s) => ({
      ...s,
      openedByName: s.openedBy ? (names[s.openedBy] ?? null) : null,
    })),
  };
};
