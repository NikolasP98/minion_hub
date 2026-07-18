import type { PageServerLoad } from './$types';
import { requireAuth } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getSettings } from '$server/services/pulse.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  requireAuth(locals);
  const ctx = await requireCoreCtx(locals);
  await requireOrgCapability(locals, 'pulse', 'view');
  depends('settings:pulse');
  return { settings: await getSettings(ctx) };
};
