import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { listDatasets } from '$server/sandbox/sandbox.service';

/** GET /api/sandbox/datasets — the catalog, filtered to what this role may view. */
export const GET: RequestHandler = async ({ locals }) => {
  requireAuth(locals);
  return json({ datasets: await listDatasets(locals) });
};
