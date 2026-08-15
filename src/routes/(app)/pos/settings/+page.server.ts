import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getPosSettings } from '$server/services/pos.service';
import { listPosSeries } from '$server/services/pos-emission.service';

/** View gate is auto-wired centrally via the `pos.settings` MODULE_SUBRESOURCES
 *  entry (route-access-registry.ts); the write gate lives on the PUT handler
 *  (`/api/pos/settings` → requireOrgCapability(locals, 'pos', 'manage')). */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('pos:settings');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const [settings, series] = await Promise.all([getPosSettings(ctx), listPosSeries(ctx)]);
  return { settings, series };
};
