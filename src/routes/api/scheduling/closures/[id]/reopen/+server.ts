import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { reopenClosureResponse } from '../../_handlers';

/** POST /api/scheduling/closures/:id/reopen `{group?}` — spec 147. Central gate: scheduling:create OR pos:create (`apiWriteCapability`). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return reopenClosureResponse(ctx, locals, params.id ?? '', request);
};
