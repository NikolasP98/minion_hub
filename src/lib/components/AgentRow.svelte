<script lang="ts">
  import { Spring, spring } from 'svelte/motion';
  import Sparkline from './Sparkline.svelte';
  import StatusDot from '$lib/components/decorations/StatusDot.svelte';
  import { agentActivity, agentChat } from '$lib/state/chat.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import type { Agent } from '$lib/types/gateway';
  import * as m from '$lib/paraglide/messages';

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
    if (act?.working) return m.agent_statusWorking();
    if (activeSessions.length > 0) return m.agent_statusActive({ count: activeSessions.length });
    if (chat?.loading) return m.agent_statusLoading();
    return m.agent_statusIdle();
  });

  const hasActive = $derived(act?.working || activeSessions.length > 0);

  // Spring for scale pop-in/out when hasActive changes
  const hammerScale = new Spring(0, { stiffness: 0.6, damping: 0.4 });
  $effect(() => {
    hammerScale.target = hasActive ? 1 : 0;
  });

  // Store-based spring for looping rotation — .set() returns a Promise
  // so we can await settle then reverse direction indefinitely
  const rot = spring(0, { stiffness: 0.06, damping: 0.3 });

  $effect(() => {
    if (!hasActive) {
      rot.set(0, { hard: true });
      return;
    }

    let cancelled = false;

    async function loop() {
      while (!cancelled) {
        await rot.set(25);
        if (cancelled) break;
        await rot.set(0);
      }
    }

    loop();

    return () => {
      cancelled = true;
      rot.set(0, { hard: true });
    };
  });
</script>

<div
  class="flex flex-col px-2.5 py-1.5 gap-1 border-l-3 border-b border-b-[rgba(42,53,72,0.5)] cursor-pointer transition-[background] duration-[120ms] hover:bg-white/[0.03] {selected ? 'bg-bg3' : 'border-l-transparent'}"
  style:border-left-color={selected ? accentColor : undefined}
  title={statusText}
  role="button"
  tabindex="0"
  {onclick}
  onkeydown={(e) => e.key === 'Enter' && onclick()}
>
  <!-- Row 1: status indicator + agent name -->
  <div class="flex items-center gap-2">
    {#if hasActive}
      <!-- Single span: scale from hammerScale spring, rotate from rot spring -->
      <span
        class="text-[11px] leading-none shrink-0 inline-block"
        style:transform="scale({hammerScale.current}) rotate({$rot}deg)"
        style:transform-origin="bottom right"
      >🔨</span>
    {:else}
      <StatusDot status="idle" size="sm" />
    {/if}

    <!-- Agent name -->
    <span class="text-[13px] font-semibold text-foreground whitespace-nowrap shrink-0">{agent.emoji ?? '🤖'} {agent.name ?? agent.id}</span>
  </div>

  <!-- Row 2: sparkline full width -->
  <div class="w-full h-[20px]">
    <Sparkline bins={act?.sparkBins ?? new Array(30).fill(0)} color={accentColor} glow={hasActive} />
  </div>
</div>
