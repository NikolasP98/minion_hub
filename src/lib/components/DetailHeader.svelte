<script lang="ts">
  import { gw } from '$lib/state/gateway-data.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { Agent } from '$lib/types/gateway';

  let { agentId, agent }: { agentId: string; agent: Agent } = $props();

  const agentSessions = $derived(
    gw.sessions.filter((s) => {
      const sk = (s as { sessionKey?: string }).sessionKey ?? '';
      return sk.includes(`agent:${agentId}:`);
    })
  );

  const runningCount = $derived(
    agentSessions.filter((s) => {
      const sk = (s as { sessionKey?: string }).sessionKey ?? '';
      return ui.sessionStatus[sk] === 'running';
    }).length
  );

  const thinkingCount = $derived(
    agentSessions.filter((s) => {
      const sk = (s as { sessionKey?: string }).sessionKey ?? '';
      return ui.sessionStatus[sk] === 'thinking';
    }).length
  );
</script>

<div class="detail-header">
  <span class="agent-name">{agent.emoji ?? '🤖'} {agent.name ?? agentId}</span>
  <div class="status-summary">
    {#if runningCount > 0}
      <span class="badge badge-running">{runningCount} running</span>
    {/if}
    {#if thinkingCount > 0}
      <span class="badge badge-thinking">{thinkingCount} thinking</span>
    {/if}
    {#if runningCount === 0 && thinkingCount === 0}
      <span class="badge badge-idle">idle</span>
    {/if}
  </div>
</div>

<style>
  .detail-header {
    flex-shrink: 0;
    padding: 13px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .agent-name { font-size: 17px; font-weight: 700; color: var(--text); }
  .status-summary { display: flex; gap: 6px; align-items: center; margin-left: auto; }
  .badge {
    padding: 2px 9px; border-radius: 12px;
    font-size: 11px; font-weight: 600;
  }
  .badge-running {
    background: rgba(34,197,94,0.12); color: var(--status-running);
    border: 1px solid rgba(34,197,94,0.25);
  }
  .badge-thinking {
    background: rgba(168,85,247,0.12); color: var(--status-thinking);
    border: 1px solid rgba(168,85,247,0.25);
  }
  .badge-idle {
    background: var(--bg3); color: var(--text3);
    border: 1px solid var(--border);
  }
</style>
