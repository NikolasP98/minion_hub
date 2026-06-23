import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listProjects, listTemplates } from '$server/services/projects.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'projects'))) throw error(404, 'Projects module disabled');
  depends('projects:list');
  const [projects, templates] = await Promise.all([listProjects(ctx, {}), listTemplates(ctx)]);
  const byStatus = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  return { projects, templates, stats: { total: projects.length, active: byStatus.active ?? 0, open: byStatus.open ?? 0 } };
};
