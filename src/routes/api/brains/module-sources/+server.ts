import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listModuleSources } from '$server/services/brains.service';

/** GET /api/brains/module-sources — the "Connect app data" (`module_ref`)
 *  catalog, filtered to entries the caller's org capabilities permit. Same
 *  auth bar as every other /api/brains/* GET (signed-in org member); the
 *  per-module `requiredPerm` gate lives in `listModuleSources` itself. */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ sources: await listModuleSources(ctx) });
};
