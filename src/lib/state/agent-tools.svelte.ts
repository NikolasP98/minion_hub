import { sendRequest } from '$lib/services/gateway.svelte';
import type { ToolStatusEntry, ToolsStatusReport } from '$lib/types/tools';

export const agentToolsState = $state({
  tools: [] as ToolStatusEntry[],
  groups: {} as Record<string, string[]>,
  profile: 'full' as string,
  loading: false,
  error: null as string | null,
});

export async function loadAgentTools(agentId: string): Promise<void> {
  agentToolsState.loading = true;
  agentToolsState.error = null;
  try {
    const report = (await sendRequest('tools.status', { agentId })) as ToolsStatusReport;
    agentToolsState.tools = report.tools;
    agentToolsState.groups = report.groups;
    agentToolsState.profile = report.profile;
  } catch (e) {
    agentToolsState.error = String(e);
  } finally {
    agentToolsState.loading = false;
  }
}

export async function toggleTool(agentId: string, toolId: string, enabled: boolean): Promise<void> {
  agentToolsState.error = null;
  try {
    await sendRequest('tools.update', { agentId, toolId, enabled });
    const tool = agentToolsState.tools.find((t) => t.id === toolId);
    if (tool) tool.enabled = enabled;
  } catch (e) {
    agentToolsState.error = String(e);
  }
}
