import { error } from '@sveltejs/kit';
import { getCoreCtx, type CoreCtx } from './core-ctx';
import { resolveCapabilities, type Module } from '$server/services/rbac.service';
import { isDenied, type DatasetDenied } from '$lib/permissions';

export { isDenied, type DatasetDenied };

/**
 * The ONE tenant-read boundary for (app) page/layout loads (spec 039, J1/J2): replaces
 * `getCoreCtx(locals)`. Returns the tenant handle when the caller's role can `view` the dataset
 * (= module), otherwise a `DatasetDenied` VALUE the page renders via `DataSource` — never a throw,
 * so one denied dataset does not take the whole page down. 401 without a tenant, like requireCoreCtx.
 * A ratchet (`dataset-read.ratchet.test.ts`) forbids new bare handles in loads.
 */
export async function datasetCtx(
  locals: App.Locals,
  module: Module,
): Promise<CoreCtx | DatasetDenied> {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (locals.user?.role === 'admin') return ctx;
  const profileId = locals.user?.supabaseId;
  if (!profileId) return { denied: module, verb: 'view' };
  const caps = await resolveCapabilities(ctx.tenantId, profileId);
  return caps.can(module, 'view') ? ctx : { denied: module, verb: 'view' };
}

/** datasetCtx + run `fn` only when allowed. */
export async function readDataset<T>(
  locals: App.Locals,
  module: Module,
  fn: (ctx: CoreCtx) => Promise<T>,
): Promise<T | DatasetDenied> {
  const c = await datasetCtx(locals, module);
  return isDenied(c) ? c : fn(c);
}
