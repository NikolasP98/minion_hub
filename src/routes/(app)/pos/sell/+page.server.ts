import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listSellables, listTickets, listShifts } from '$server/services/pos.service';

/** View perm (`pos.sell:view`) is enforced centrally by the root layout guard
 *  (MODULE_SUBRESOURCES) — this load only fetches the tab's data. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(404, 'POS module disabled');
  depends('pos:sell');

  const [sellables, recentTickets, shifts] = await Promise.all([
    listSellables(ctx),
    listTickets(ctx, { limit: 10 }),
    listShifts(ctx, { limit: 10 }),
  ]);

  return { sellables, recentTickets, shifts };
};
