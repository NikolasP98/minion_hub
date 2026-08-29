import type { PageServerLoad } from './$types';
import { loadBookingsView } from '$server/scheduling/load-bookings-view';

/** View perm (`pos.appointments:view`) is enforced centrally by the root layout
 *  guard (MODULE_SUBRESOURCES). The pos+scheduling composite module-toggle 404
 *  is enforced centrally by the (app) route hook guard now (routing-
 *  simplification spec S2 — `/pos/appointments` maps to the `posAppointments`
 *  composite manifest entry) — this load only fetches the tab's data. */
export const load: PageServerLoad = async ({ locals, depends, url }) =>
  loadBookingsView(
    { locals, depends, url },
    {
      dependsKey: 'pos:appointments',
      // Front-desk day book: today (server-local midnight) through the week.
      window: { anchor: 'today', afterDays: 7 },
      limit: 500,
      // The staff picker must not offer retired resources.
      activeResourcesOnly: true,
      // Raw toggle, accrual read always attempted — the fork's shipped drift,
      // pinned by the characterization suite. See `BookingsStockGate`.
      stockGate: 'module-state',
    },
  );
