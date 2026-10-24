import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import {
  getPosSettings,
  listPeriodLocks,
  listTickets,
  listShifts,
  listPaymentsFor,
  profileNames,
} from '$server/services/pos.service';
import { emissionStatusByTicket } from '$server/services/pos-emission.service';
import { getFinSettings } from '$server/services/finance.service';
import { listResources } from '$server/services/scheduling.service';
import {
  schedulingTimeZone,
  parseCalendarDate,
  todayIn,
} from '$lib/components/scheduling/calendar-window';
import { foldPayments } from './payments-fold';

/** `?view=` on this page — a nested shifts table, or a month calendar reading
 *  of the same payments bucketed by day. A `DataViewKind` pair, not the
 *  scheduling `CalendarView` union — there is no week/day/agenda here. */
export type HistoryView = 'table' | 'calendar';
function parseHistoryView(value: string | null): HistoryView {
  return value === 'calendar' ? 'calendar' : 'table';
}

/** View perm (`pos:view`, the module's default prefix — this page has no
 *  MODULE_SUBRESOURCES row, so it inherits the module's own view gate). */
export const load: PageServerLoad = async ({ locals, depends, url }) => {
  const ctx = await datasetCtx(locals, 'pos');
  if (isDenied(ctx)) return { pos: ctx }; // rendered by DataSource in +page.svelte (spec 039)
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

  const [payments, names, emission, settings, locks, finSettings] = await Promise.all([
    listPaymentsFor(ctx, {
      ticketIds: tickets.map((t) => t.id),
      shiftIds: shifts.map((s) => s.id),
    }),
    profileNames(ctx, [...tickets.map((t) => t.createdBy), ...shifts.map((s) => s.openedBy)]),
    // One SUNAT reading per ticket — the shift row's emitted / failed counts
    // and its "Reintentar" (spec 2026-10-15 T2).
    emissionStatusByTicket(
      ctx,
      tickets.map((t) => t.id),
    ),
    getPosSettings(ctx),
    listPeriodLocks(ctx),
    getFinSettings(ctx),
  ]);
  const { byTicket, methodTotals } = foldPayments(payments);
  return {
    pos: {
      orgTz,
      view,
      day,
      methodTotals,
      emissionMode: settings.emission.mode,
      // Accountant locks (spec 2026-10-15 T4): months in the ACCOUNTING timezone,
      // so the lock icon on a shift row agrees with what the mutators refuse.
      lockedPeriods: locks.map((l) => l.period),
      finTz: finSettings.timezone,
      // The month calendar view folds every row (refund counter-rows
      // included) by its own day — `payments-fold.ts`'s `dayTotals`.
      payments,
      tickets: tickets.map((t) => ({
        ...t,
        cashier: t.createdBy ? (names[t.createdBy] ?? null) : null,
        payments: byTicket.get(t.id) ?? [],
        emission: emission[t.id] ?? null,
      })),
      shifts: shifts.map((s) => ({
        ...s,
        openedByName: s.openedBy ? (names[s.openedBy] ?? null) : null,
      })),
    },
  };
};
