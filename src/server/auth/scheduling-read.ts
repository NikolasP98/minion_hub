import { error } from '@sveltejs/kit';
import { getCoreCtx } from './core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireModuleEnabled } from '$server/http/require-module';

/** Scheduling GETs authorize before loading any domain data. Writes keep their own gates. */
export async function requireSchedulingRead(locals: App.Locals) {
  await requireOrgCapability(locals, 'scheduling', 'view');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireModuleEnabled(ctx, 'scheduling');
  return ctx;
}
