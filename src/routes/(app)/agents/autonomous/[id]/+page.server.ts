import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import { getArtifactsForAgent } from '$lib/server/artifacts/registry';
import { listExportToggles } from '$lib/server/flows/exports-store';

export const load: PageServerLoad = async ({ locals, params }) => {
  const ctx = await requireCoreCtx(locals);
  const isAdmin = locals.user?.role === 'admin';
  const vms = await loadSystemAgentVMs(ctx).catch(() => []);
  const agent = vms.find((v) => v.id === params.id);
  if (!agent) throw error(404, 'Agent not found');
  // Keyed by flowId so AgentWindowLayer can look up by w.flowId.
  const flowTogglesByFlow: Record<string, Record<string, boolean>> = {};
  if (agent.flowId) {
    flowTogglesByFlow[agent.flowId] = await listExportToggles(ctx, agent.flowId).catch(() => ({}));
  }
  return { agent, artifacts: await getArtifactsForAgent(ctx, agent.id), isAdmin, flowTogglesByFlow };
};
