import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import { getArtifactsForAgent } from '$lib/server/artifacts/registry';
import { listExportToggles } from '$lib/server/flows/exports-store';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireCoreCtx(locals); // throws 401 if unauthenticated
  depends('agents:autonomous');
  const systemAgents = await loadSystemAgentVMs(ctx).catch(() => []);
  const isAdmin = locals.user?.role === 'admin';
  const artifactsByAgent = Object.fromEntries(
    await Promise.all(systemAgents.map(async (agent) => [agent.id, await getArtifactsForAgent(ctx, agent.id)] as const)),
  );
  // Keyed by flowId so the flow window can look up toggles by w.flowId.
  const flowTogglesByFlow = Object.fromEntries(
    await Promise.all(
      systemAgents
        .filter((a) => a.flowId != null)
        .map(async (a) => [a.flowId!, await listExportToggles(ctx, a.flowId!).catch(() => ({}))] as const),
    ),
  );
  return { systemAgents, isAdmin, artifactsByAgent, flowTogglesByFlow };
};
