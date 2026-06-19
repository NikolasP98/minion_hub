import type { PageServerLoad } from './$types';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import { getArtifactsForAgent } from '$lib/server/artifacts/registry';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireCoreCtx(locals); // throws 401 if unauthenticated
  depends('agents:autonomous');
  const systemAgents = await loadSystemAgentVMs(ctx).catch(() => []);
  const isAdmin = locals.user?.role === 'admin';
  const artifactsByAgent = Object.fromEntries(
    systemAgents.map((agent) => [agent.id, getArtifactsForAgent(agent.id)]),
  );
  return { systemAgents, isAdmin, artifactsByAgent };
};
