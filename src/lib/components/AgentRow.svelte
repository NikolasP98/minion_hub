<script lang="ts">
  import Sparkline from './Sparkline.svelte';
  import { agentActivity, agentChat } from '$lib/state/chat.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import type { Agent } from '$lib/types/gateway';

  let { agent, selected, accentColor, onclick }: {
    agent: Agent;
    selected: boolean;
    accentColor: string;
    onclick: () => void;
  } = $props();

  const act = $derived(agentActivity[agent.id]);
  const chat = $derived(agentChat[agent.id]);

  const activeSessions = $derived(
    gw.sessions.filter((s) => {
      const sk = (s as { sessionKey?: string }).sessionKey ?? '';
      const status = ui.sessionStatus[sk];
      return sk.includes(`agent:${agent.id}:`) && (status === 'running' || status === 'thinking');
    })
  );

  const statusText = $derived.by(() => {
    if (act?.working) return 'Working...';
    if (activeSessions.length > 0) return `${activeSessions.length} active`;
    if (chat?.loading) return 'Loading...';
    return 'Idle';
  });

  const hasActive = $derived(act?.working || activeSessions.length > 0);
</script>

<div
  class="flex flex-col px-3.5 py-2.5 border-l-3 border-b border-b-[rgba(42,53,72,0.5)] cursor-pointer transition-[background] duration-[120ms] hover:bg-white/[0.03] {selected ? 'bg-bg3' : 'border-l-transparent'}"
  style:border-left-color={selected ? accentColor : undefined}
  role="button"
  tabindex="0"
  {onclick}
  onkeydown={(e) => e.key === 'Enter' && onclick()}
>
  <div class="flex items-center gap-1.5">
    <span class="text-[13px] font-semibold text-foreground">{agent.emoji ?? '🤖'} {agent.name ?? agent.id}</span>
  </div>
  <div class="text-[11px] mt-0.5 {hasActive ? 'text-status-running' : 'text-muted-foreground'}">
    {statusText}
  </div>
  <div class="mt-1.5 h-7">
    <Sparkline bins={act?.sparkBins ?? new Array(30).fill(0)} color={accentColor} />
  </div>
</div>
