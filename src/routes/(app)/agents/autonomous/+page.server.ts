import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import { loadWorkforceAgentVMs } from '$lib/server/system-agents/workforce-agents';
import { getArtifactsForAgent } from '$lib/server/artifacts/registry';
import { listExportToggles } from '$lib/server/flows/exports-store';

export const load: PageServerLoad = async (event) => {
  const { locals, depends } = event;
  const ctx = await requireCoreCtx(locals); // throws 401 if unauthenticated
  depends('agents:autonomous');
  const [allSystemAgents, workforceAgents] = await Promise.all([
    loadSystemAgentVMs(ctx).catch(() => []),
    loadWorkforceAgentVMs(event).catch(() => []),
  ]);
  const isAdmin = locals.user?.role === 'admin';
  const visibleAgents = allSystemAgents.filter((a) => !a.adminOnly || isAdmin);
  const artifactsByAgent = Object.fromEntries(
    await Promise.all(visibleAgents.map(async (agent) => [agent.id, await getArtifactsForAgent(ctx, agent.id)] as const)),
  );
  // Keyed by flowId so the flow window can look up toggles by w.flowId.
  const flowTogglesByFlow = Object.fromEntries(
    await Promise.all(
      visibleAgents
        .filter((a) => a.flowId != null)
        .map(async (a) => [a.flowId!, await listExportToggles(ctx, a.flowId!).catch(() => ({}))] as const),
    ),
  );
  return { systemAgents: visibleAgents, workforceAgents, isAdmin, artifactsByAgent, flowTogglesByFlow };
};
