import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listEventKinds } from '$server/services/scheduling.service';

/** `/scheduling/settings` — event kinds (calendar categories) management. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'scheduling');
  if (isDenied(ctx)) return { scheduling: ctx }; // rendered by DataSource (spec 039)
  depends('scheduling:data');

  return { scheduling: { kinds: await listEventKinds(ctx) } };
};
