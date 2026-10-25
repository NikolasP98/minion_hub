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

/** Which of `modules` the caller's role can view (one datasetCtx each) — for services that count foreign datasets. */
export async function viewableModules(
  locals: App.Locals,
  modules: readonly Module[],
): Promise<Set<Module>> {
  const out = new Set<Module>();
  for (const m of modules) if (!isDenied(await datasetCtx(locals, m))) out.add(m);
  return out;
}

/**
 * `datasetCtx` for loads that cannot render a marker (settings/admin pages behind a capability gate,
 * layouts whose shape every page depends on): a denied dataset becomes a K3-shaped 403
 * (`<module>: view required`), exactly what the route guard already answers for these paths.
 * TODO(handoff): spec 039 — these remaining loads still hard-403 instead of rendering `DataSource`;
 * convert them (page body -> PageBody.svelte + marker slot) if page roles ever expose them to roles
 * without the module's view. Tracked in the S5 PR body / meta proposal.
 */
export async function requireDataset(locals: App.Locals, module: Module): Promise<CoreCtx> {
  const c = await datasetCtx(locals, module);
  if (isDenied(c)) throw error(403, `${module}: view required`);
  return c;
}

/**
 * Org shell reads that belong to no dataset (the org's table config, the user's own personal
 * agent): every page depends on them, so no module's view may hide them. Not for business data.
 */
export function shellCtx(locals: App.Locals): Promise<CoreCtx | null> {
  return getCoreCtx(locals);
}
