import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getDoor } from '$server/services/doors.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

/** One door's editor (spec 041 US7). View access via the `crm.doors` sub-resource. */
export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
  const id = uuidParamOr404(params.id);
  const ctx = await datasetCtx(locals, 'crm');
  if (isDenied(ctx)) return { crm: ctx }; // rendered by DataSource in +page.svelte (spec 039)
  depends('crm:doors');
  const door = await getDoor(ctx, id);
  if (!door) throw error(404, 'Not found');
  return { crm: { door, origin: url.origin } };
};
