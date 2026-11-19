import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listTargetableCustomers, funnelData } from '$server/services/pos/pos-funnel.service';
import { getFinSettings } from '$server/services/finance.service';
import { dateKeyAddDays, instantDateKey } from '$lib/time/zoned';
import { DEFAULT_SCHEDULING_TIME_ZONE } from '$lib/components/scheduling/calendar-window';

/** View perm (`pos:view`, the module default — no MODULE_SUBRESOURCES row, like /pos/history). Read-only. */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
  const ctx = await datasetCtx(locals, 'pos');
  if (isDenied(ctx)) return { pos: ctx }; // rendered by DataSource (spec 039)
  depends('pos:funnel');

  // Timezone is finance data: own handle; denied => default tz.
  const fin = await datasetCtx(locals, 'finance');
  const timeZone = isDenied(fin)
    ? DEFAULT_SCHEDULING_TIME_ZONE
    : (await getFinSettings(fin)).timezone;

  // Default last 30 days; bounds are INCLUSIVE, like /socials.
  const to = url.searchParams.get('to') || instantDateKey(new Date(), timeZone);
  const from = url.searchParams.get('from') || (dateKeyAddDays(to, -30) ?? to);
  const range = { from, to };

  const [customers, funnel] = await Promise.all([
    listTargetableCustomers(ctx, timeZone),
    funnelData(ctx, range, timeZone),
  ]);
  return { pos: { range, timeZone, customers, funnel } };
};
