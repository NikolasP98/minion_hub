import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import { getArtifactsForAgent } from '$lib/server/artifacts/registry';

export const load: PageServerLoad = async ({ locals, params }) => {
  const ctx = await requireCoreCtx(locals);
  const vms = await loadSystemAgentVMs(ctx).catch(() => []);
  const agent = vms.find((v) => v.id === params.id);
  if (!agent) throw error(404, 'Agent not found');
  return { agent, artifacts: getArtifactsForAgent(agent.id) };
};
