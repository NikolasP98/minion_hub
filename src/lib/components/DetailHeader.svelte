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

<div class="shrink-0 px-5 py-3.5 border-b border-border bg-bg2 flex items-center gap-3 flex-wrap">
  <span class="text-[17px] font-bold text-foreground">{agent.emoji ?? '🤖'} {agent.name ?? agentId}</span>
  <div class="flex gap-1.5 items-center ml-auto">
    {#if runningCount > 0}
      <span class="px-2.5 py-0.5 rounded-xl text-[11px] font-semibold bg-success/12 text-status-running border border-success/25">
        {runningCount} running
      </span>
    {/if}
    {#if thinkingCount > 0}
      <span class="px-2.5 py-0.5 rounded-xl text-[11px] font-semibold bg-purple/12 text-status-thinking border border-purple/25">
        {thinkingCount} thinking
      </span>
    {/if}
    {#if runningCount === 0 && thinkingCount === 0}
      <span class="px-2.5 py-0.5 rounded-xl text-[11px] font-semibold bg-bg3 text-muted-foreground border border-border">
        idle
      </span>
    {/if}
  </div>
</div>
