import type { PageServerLoad } from './$types';
import { requireAuth } from '$server/auth/authorize';
import { listReleases } from '$server/services/releases/releases.service';

/** GET /changelog — every signed-in user; no org/capability gate (global data,
 *  same convention as /notifications/daily). Newest release first. */
export const load: PageServerLoad = async ({ locals }) => {
  requireAuth(locals);
  const releases = await listReleases();
  return { releases };
};
