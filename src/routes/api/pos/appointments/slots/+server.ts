import { error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { staffSlotsResponse } from '../../../scheduling/slots/_response';

/** Slot discovery for the POS booking forms; no scheduling capability is implied. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const caps = await requireOrgCapability(locals, 'pos', 'view');
  // A single resolver result avoids independent capability snapshots for the OR.
  // Null is the canonical platform-admin bypass, not an absent principal.
  if (caps && !caps.can('pos', 'create') && !caps.can('pos', 'edit'))
    throw error(403, 'pos: create or edit required');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'pos'))) throw error(403, 'pos module disabled');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return staffSlotsResponse(ctx, url);
};
