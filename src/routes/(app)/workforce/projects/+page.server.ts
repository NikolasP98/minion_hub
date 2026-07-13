import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import {
  listProjects,
  listTemplates,
  syncAgentParties,
  workforceProjectIdOf,
} from '$server/services/projects.service';
import { workforceServerClient } from '$lib/server/workforce-fetch';
import {
  groupProjectsByMetadata,
  type ProjectMetadataCarrier,
} from '$lib/workforce/project-groups';

type WorkforceProjectListItem = {
  id: string;
  name: string;
  status: string;
  targetDate: string | null;
  color: string | null;
  metadata: unknown;
};

/**
 * Unified Projects module. Party-spine (proj_*) is the system of record — the
 * writable business layer (CRM customer/lead, milestones, timesheets, templates,
 * dispatch). Paperclip projects (the execution layer: workspaces/issues/goals)
 * are surfaced alongside: any not yet linked to a native project are offered for
 * one-click import. The /workforce layout already gated the company id.
 */
export const load: PageServerLoad = async (event) => {
  const { locals, depends } = event;
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'projects'))) throw error(404, 'Projects module disabled');
  depends('projects:list');
  const { companyId, workforceAvailable } = await event.parent();

  // Mirror workforce agents into the spine so the Lead/assignee pickers list them (best-effort).
  await syncAgentParties(ctx, {
    id: ctx.profileId ?? null,
    name: locals.user?.displayName ?? null,
    email: locals.user?.email ?? null,
  });

  const [projects, templates] = await Promise.all([listProjects(ctx, {}), listTemplates(ctx)]);

  // Paperclip projects (best-effort — the page must render if the backend is down).
  let workforceGroups = groupProjectsByMetadata<WorkforceProjectListItem>([]);
  if (companyId && workforceAvailable) {
    try {
      const wf = await workforceServerClient(event).projects.list(companyId);
      const linked = new Set(
        projects.map((p) => workforceProjectIdOf(p)).filter(Boolean) as string[],
      );
      const workforce = wf
        .filter((p) => !linked.has(p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          targetDate: p.targetDate ?? null,
          color: p.color ?? null,
          // workforce-client 0.3.0 predates the stable metadata contract. The
          // published successor includes this field; keep the compatibility
          // assertion narrow and remove it after the dependency bump.
          metadata: (p as typeof p & ProjectMetadataCarrier).metadata ?? null,
        }));
      workforceGroups = groupProjectsByMetadata(workforce);
    } catch {
      workforceGroups = [];
    }
  }

  const byStatus = projects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    projects,
    templates,
    workforceGroups,
    workforceAvailable,
    stats: { total: projects.length, active: byStatus.active ?? 0, open: byStatus.open ?? 0 },
  };
};
