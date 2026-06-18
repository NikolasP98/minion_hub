import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listResources, getResourceSchedule } from '$server/services/scheduling.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');
  const resources = await listResources(ctx);
  const schedules = Object.fromEntries(
    await Promise.all(resources.map(async (r) => [r.id, await getResourceSchedule(ctx, r.id)] as const)),
  );
  return { resources, schedules };
};
