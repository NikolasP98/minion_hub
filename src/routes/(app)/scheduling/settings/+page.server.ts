import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listEventKinds } from '$server/services/scheduling.service';

/** `/scheduling/settings` — event kinds (calendar categories) management. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('scheduling:data');

  return { kinds: await listEventKinds(ctx) };
};
