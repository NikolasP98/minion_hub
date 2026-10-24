import type { LayoutServerLoad } from './$types';
import { datasetCtx } from '$server/auth/dataset-ctx';

/** Auth guard for the whole /scheduling subtree. The module-toggle/kind 404
 *  is enforced centrally by the (app) route hook guard now (routing-
 *  simplification spec S2, hooks.server.ts's finishApp) — kept as an empty
 *  layout load only for the shared 401. */
export const load: LayoutServerLoad = async ({ locals }) => {
  // 401 without a tenant; a denied role is rendered per page by DataSource (spec 039), not here.
  await datasetCtx(locals, 'scheduling');
  return {};
};
