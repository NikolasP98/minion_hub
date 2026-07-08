import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { shouldMaskSensitive } from '$server/services/rbac.service';
import { bothEnabled, isModuleEnabled } from '$server/services/modules.service';
import { listBookings } from '$server/services/scheduling-bookings.service';
import { listResources, listEventTypes } from '$server/services/scheduling.service';
import { accrualSummaryForSources } from '$server/services/stock-accruals.service';

const DAY = 86_400_000;

/** View perm (`pos.appointments:view`) is enforced centrally by the root layout
 *  guard (MODULE_SUBRESOURCES) — this load only fetches the tab's data. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await bothEnabled(ctx, 'pos', 'scheduling'))) throw error(404, 'POS or scheduling module disabled');
  depends('pos:appointments');

  // ponytail: server-local midnight, not per-org timezone — fine for a
  // single-org front-desk view; add per-org tz if a multi-tz org shows up.
  const from = new Date(new Date().setHours(0, 0, 0, 0));
  const to = new Date(from.getTime() + 7 * DAY);

  const maskAttendeePii = await shouldMaskSensitive(locals, 'scheduling');
  const [bookings, resources, eventTypes] = await Promise.all([
    listBookings(ctx, { from, to, limit: 500, maskAttendeePii }),
    listResources(ctx),
    listEventTypes(ctx),
  ]);

  let accrualSummaries: Awaited<ReturnType<typeof accrualSummaryForSources>> = [];
  try {
    accrualSummaries = await accrualSummaryForSources(
      ctx,
      'booking',
      bookings.map((b) => b.id),
    );
  } catch {
    // stock module absent/off — bookings render without chips
  }

  return {
    bookings,
    resources: resources.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name })),
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title, productId: e.productId ?? null })),
    stockEnabled: await isModuleEnabled(ctx, 'stock'),
    accrualSummaries,
  };
};
