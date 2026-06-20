import type { CoreCtx } from '$server/auth/core-ctx';
import { loadSystemAgentVMs, getSystemAgentDescriptors } from '$lib/server/system-agents/registry';
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
import { listArtifactRows, getArtifactRow, artifactRowToDescriptor } from '$lib/server/artifacts/store';
import { getMasterFlow, flowExportedSpecs } from '$lib/flows/master-flows';
import { flowVariableSchema } from '$lib/flows/flow-variables';
import { listExportToggles } from '$lib/server/flows/exports-store';

async function withVars(ctx: CoreCtx, agentId: string, context: ArtifactContext): Promise<ArtifactContext> {
  const desc = getSystemAgentDescriptors().find((d) => d.id === agentId);
  if (!desc?.flowId || !desc.resolveVariables) return context;
  const flow = getMasterFlow(desc.flowId);
  if (!flow) return context;
  const specs = flowExportedSpecs(flow);
  if (!specs.length) return context;
  const toggles = await listExportToggles(ctx, desc.flowId).catch(() => ({}));
  const enabled = flowVariableSchema(specs, toggles).map((s) => s.key);
  if (!enabled.length) return context;
  const vars = await desc.resolveVariables(ctx, enabled).catch(() => ({}));
  return { ...context, vars };
}

/** Built-in + DB artifacts for an agent. */
export async function getArtifactsForAgent(ctx: CoreCtx, agentId: string): Promise<ArtifactDescriptor[]> {
  const builtins =
    agentId === 'alert-watcher'
      ? [triageDescriptorFor(agentId, m.artifact_triage_title(), m.artifact_triage_desc())]
      : [overviewDescriptorFor(agentId, m.artifact_overview_title(), m.artifact_overview_desc())];
  const dbRows = await listArtifactRows(ctx, agentId).catch(() => []);
  return [...builtins, ...dbRows.map(artifactRowToDescriptor)];
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
  if (artifactId === 'overview') return withVars(ctx, agentId, base);
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
    return withVars(ctx, agentId, { ...base, data: { counts, recent: mapRecentRows(recent?.rows ?? []) } });
  }
  // DB (dynamic) artifact: base context (per-artifact data providers come with 5b)
  const row = await getArtifactRow(ctx, artifactId).catch(() => null);
  if (row && row.agentId === agentId) return withVars(ctx, agentId, base);
  return null;
}
