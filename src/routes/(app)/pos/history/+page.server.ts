import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  listTickets,
  listShifts,
  listPaymentsFor,
  profileNames,
} from '$server/services/pos.service';
import { foldPayments } from './payments-fold';

/** View perm (`pos:view`, the module's default prefix — this page has no
 *  MODULE_SUBRESOURCES row, so it inherits the module's own view gate). */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('pos:history');

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
    methodTotals,
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
