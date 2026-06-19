import type { CoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs } from '$lib/server/system-agents/registry';
import {
  overviewDescriptorFor,
  triageDescriptorFor,
  agentVmToArtifactContext,
  mapRecentRows,
  type ArtifactDescriptor,
  type ArtifactContext,
  type TriageArtifactData,
} from '$lib/agents/artifacts';
import * as m from '$lib/paraglide/messages';
import { gatewayCallAsUser } from '$lib/server/gateway-rpc';

/** Built-in artifacts for an agent. Phase 1: every agent gets the Overview. */
export function getArtifactsForAgent(agentId: string): ArtifactDescriptor[] {
  if (agentId === 'alert-watcher')
    return [triageDescriptorFor(agentId, m.artifact_triage_title(), m.artifact_triage_desc())];
  return [overviewDescriptorFor(agentId, m.artifact_overview_title(), m.artifact_overview_desc())];
}

/** Resolve a (agentId, artifactId) instance's data, or null if unknown. */
export async function getArtifactContext(
  ctx: CoreCtx,
  agentId: string,
  artifactId: string,
): Promise<ArtifactContext | null> {
  const vms = await loadSystemAgentVMs(ctx);
  const vm = vms.find((v) => v.id === agentId);
  if (!vm) return null;
  const base = agentVmToArtifactContext(vm);
  if (artifactId === 'overview') return base;
  if (artifactId === 'triage' && agentId === 'alert-watcher') {
    const [summary, recent] = await Promise.all([
      gatewayCallAsUser<{ counts?: TriageArtifactData['counts'] }>(
        'plugins.alerts.summary',
        { since: Date.now() - 30 * 24 * 60 * 60 * 1000 },
        ctx.profileId,
      ).catch(() => null),
      gatewayCallAsUser<{ rows?: Array<Record<string, unknown>> }>(
        'plugins.alerts.recent',
        { limit: 10 },
        ctx.profileId,
      ).catch(() => null),
    ]);
    const counts = summary?.counts ?? { total: 0, high: 0, med: 0, low: 0, notified: 0, responded: 0 };
    return { ...base, data: { counts, recent: mapRecentRows(recent?.rows ?? []) } };
  }
  return null;
}
