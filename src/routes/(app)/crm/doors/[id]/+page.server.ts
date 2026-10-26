import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getDoor } from '$server/services/doors.service';
import { uuidParamOr404 } from '$server/utils/uuid-param';

/** One door's editor (spec 041 US7). View access via the `crm.doors` sub-resource. */
export const load: PageServerLoad = async ({ locals, params, url, depends }) => {
  const id = uuidParamOr404(params.id);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:doors');
  const door = await getDoor(ctx, id);
  if (!door) throw error(404, 'Not found');
  return { door, origin: url.origin };
};
