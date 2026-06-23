import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  getProject,
  listTasks,
  getProjectProgress,
  listTimesheets,
  listAgentParties,
  partiesByIds,
  ensureSelfParty,
  type PartyLite,
} from '$server/services/projects.service';

export const load: PageServerLoad = async ({ locals, params, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('projects:detail');

  const project = await getProject(ctx, params.id);
  if (!project) throw error(404, 'Project not found');

  const [tasks, progress, timesheets, agents] = await Promise.all([
    listTasks(ctx, { projectId: params.id, includeMilestones: true }),
    getProjectProgress(ctx, params.id),
    listTimesheets(ctx, { projectId: params.id }),
    listAgentParties(ctx),
  ]);

  const selfPartyId = ctx.profileId
    ? await ensureSelfParty(ctx, { id: ctx.profileId, email: locals.user?.email, name: locals.user?.displayName })
    : null;

  // Resolve names for everyone referenced (assignees + customer + lead).
  const refIds = [
    ...tasks.map((t) => t.assigneePartyId),
    project.customerPartyId,
    project.leadPartyId,
    selfPartyId,
  ].filter((x): x is string => !!x);
  const refs = await partiesByIds(ctx, refIds);
  const partyMap: Record<string, PartyLite> = {};
  for (const p of [...agents, ...refs]) partyMap[p.id] = p;

  return { project, tasks, progress, timesheets, agents, selfPartyId, partyMap };
};
