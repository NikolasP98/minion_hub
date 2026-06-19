import type { CoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import {
  overviewDescriptorFor,
  agentVmToArtifactContext,
  type ArtifactDescriptor,
  type ArtifactContext,
} from '$lib/agents/artifacts';
import * as m from '$lib/paraglide/messages';

/** Built-in artifacts for an agent. Phase 1: every agent gets the Overview. */
export function getArtifactsForAgent(agentId: string): ArtifactDescriptor[] {
  return [overviewDescriptorFor(agentId, m.artifact_overview_title(), m.artifact_overview_desc())];
}

/** Resolve a (agentId, artifactId) instance's data, or null if unknown. */
export async function getArtifactContext(
  ctx: CoreCtx,
  agentId: string,
  artifactId: string,
): Promise<ArtifactContext | null> {
  if (artifactId !== 'overview') return null;
  const vms = await loadSystemAgentVMs(ctx);
  const vm = vms.find((v) => v.id === agentId);
  return vm ? agentVmToArtifactContext(vm) : null;
}
