import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getPosSettings } from '$server/services/pos.service';
import { listPosSeries } from '$server/services/pos-emission.service';

/** View gate is auto-wired centrally via the `pos.settings` MODULE_SUBRESOURCES
 *  entry (route-access-registry.ts); the write gate lives on the PUT handler
 *  (`/api/pos/settings` → requireOrgCapability(locals, 'pos', 'manage')). */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('pos:settings');
  const ctx = await datasetCtx(locals, 'pos');
  if (isDenied(ctx)) return { pos: ctx }; // rendered by DataSource in +page.svelte (spec 039)
  const [settings, series] = await Promise.all([getPosSettings(ctx), listPosSeries(ctx)]);
  return { pos: { settings, series } };
};
