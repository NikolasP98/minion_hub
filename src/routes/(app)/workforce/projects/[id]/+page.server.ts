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
  syncAgentParties,
  workforceProjectIdOf,
  type PartyLite,
} from '$server/services/projects.service';
import { workforceServerClient } from '$lib/server/workforce-fetch';
import type { Project, Issue } from '@minion-stack/workforce-client';

export const load: PageServerLoad = async (event) => {
  const { locals, params, depends } = event;
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('projects:detail');

  const project = await getProject(ctx, params.id);
  if (!project) throw error(404, 'Project not found');

  // Mirror workforce agents into the spine so the assignee picker lists them (best-effort).
  await syncAgentParties(ctx, { id: ctx.profileId ?? null, name: locals.user?.displayName ?? null, email: locals.user?.email ?? null });

  const [tasks, progress, timesheets, agents] = await Promise.all([
    listTasks(ctx, { projectId: params.id, includeMilestones: true }),
    getProjectProgress(ctx, params.id),
    listTimesheets(ctx, { projectId: params.id }),
    listAgentParties(ctx),
  ]);

  const selfPartyId = ctx.profileId
    ? await ensureSelfParty(ctx, { id: ctx.profileId, email: locals.user?.email, name: locals.user?.displayName })
    : null;

  const refIds = [
    ...tasks.map((t) => t.assigneePartyId),
    project.customerPartyId,
    project.leadPartyId,
    selfPartyId,
  ].filter((x): x is string => !!x);
  const refs = await partiesByIds(ctx, refIds);
  const partyMap: Record<string, PartyLite> = {};
  for (const p of [...agents, ...refs]) partyMap[p.id] = p;

  // ── Execution layer (paperclip) ─────────────────────────────────────────────
  // When linked, surface the workforce project's workspaces/issues/goals inline.
  // When not linked, offer the org's workforce projects for linking. All best-effort.
  const companyId = locals.workforceIdentity?.companyId ?? null;
  const workforceProjectId = workforceProjectIdOf(project);
  let execution: { project: Project; issues: Issue[]; agentNames: Record<string, string> } | null = null;
  let linkable: Array<{ id: string; name: string }> = [];

  if (companyId) {
    const client = workforceServerClient(event);
    if (workforceProjectId) {
      try {
        const [wfProject, issues, wfAgents] = await Promise.all([
          client.projects.get(workforceProjectId, companyId),
          client.issues.list(companyId, { projectId: workforceProjectId }),
          client.agents.list(companyId),
        ]);
        const agentNames: Record<string, string> = {};
        for (const a of wfAgents) agentNames[a.id] = a.name;
        execution = { project: wfProject, issues, agentNames };
      } catch {
        execution = null; // link points at a gone/unreachable project — show "link broken" affordance
      }
    } else {
      try {
        linkable = (await client.projects.list(companyId)).map((p) => ({ id: p.id, name: p.name }));
      } catch {
        linkable = [];
      }
    }
  }

  return { project, tasks, progress, timesheets, agents, selfPartyId, partyMap, workforceProjectId, execution, linkable };
};
