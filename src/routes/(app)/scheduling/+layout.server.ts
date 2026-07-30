import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';

/** Auth guard for the whole /scheduling subtree. The module-toggle/kind 404
 *  is enforced centrally by the (app) route hook guard now (routing-
 *  simplification spec S2, hooks.server.ts's finishApp) — kept as an empty
 *  layout load only for the shared 401. */
export const load: LayoutServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  return {};
};
