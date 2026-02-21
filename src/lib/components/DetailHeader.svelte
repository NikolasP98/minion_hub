<script lang="ts">
  import { gw } from '$lib/state/gateway-data.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import HudBorder from '$lib/components/decorations/HudBorder.svelte';
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

<HudBorder class="shrink-0 px-5 py-3.5 border-b border-border bg-bg2 flex items-center gap-3 flex-wrap">
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
    <button
      class="ml-1 p-1 rounded-md border border-border bg-transparent text-muted-foreground text-sm leading-none cursor-pointer transition-all duration-150 hover:text-foreground hover:border-muted hover:bg-bg3"
      title="Agent settings"
      onclick={() => { ui.agentSettingsOpen = !ui.agentSettingsOpen; }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  </div>
</HudBorder>
