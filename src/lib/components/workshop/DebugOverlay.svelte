<script lang="ts">
  import { workshopState } from '$lib/state/workshop.svelte';
  import { agentMemory } from '$lib/state/workshop.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { worldToScreen } from '$lib/workshop/camera';
  import { getAgentState } from '$lib/workshop/agent-fsm';
  import { getQueue_readonly } from '$lib/workshop/agent-queue';

  function resolveAgentName(agentId: string): string {
    const agent = gw.agents.find((a: { id: string }) => a.id === agentId);
    return agent?.name ?? agentId;
  }

  const FSM_COLORS: Record<string, string> = {
    idle:       'text-muted',
    wandering:  'text-blue-400',
    patrolling: 'text-purple-400',
    conversing: 'text-green-400',
    cooldown:   'text-orange-400',
    dragged:    'text-yellow-400',
    heartbeat:  'text-cyan-400',
    reading:    'text-amber-400',
  };

  function actionLabel(a: ReturnType<typeof getQueue_readonly>[0]): string {
    if (a.type === 'readElement') {
      const el = workshopState.elements[a.elementId];
      return `read:${el?.label ?? a.elementId}(${a.priority})`;
    }
    if (a.type === 'seekInfo') {
      const el = workshopState.elements[a.elementId];
      return `seek:${el?.label ?? a.elementId}`;
    }
    if (a.type === 'approachAgent') return `→agent:${a.targetInstanceId.slice(-4)}`;
    return a.type;
  }

  // ---------------------------------------------------------------------------
  // Performance metrics
  // ---------------------------------------------------------------------------

  let fps = $state(0);
  let frameMs = $state(0);
  let heapMB = $state<number | null>(null);

  $effect(() => {
    let rafId: number;
    let frameCount = 0;
    let lastSecond = performance.now();
    let lastFrame = performance.now();

    function tick() {
      const now = performance.now();
      frameMs = Math.round(now - lastFrame);
      lastFrame = now;
      frameCount++;

      if (now - lastSecond >= 1000) {
        fps = Math.round((frameCount * 1000) / (now - lastSecond));
        frameCount = 0;
        lastSecond = now;

        // JS heap (Chrome only)
        const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
        if (perf.memory) {
          heapMB = Math.round(perf.memory.usedJSHeapSize / 1_048_576);
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  });

  function fpsColor(f: number): string {
    if (f >= 50) return 'text-green-400';
    if (f >= 30) return 'text-yellow-400';
    return 'text-red-400';
  }

  let agentCount = $derived(Object.keys(workshopState.agents).length);
  let elementCount = $derived(Object.keys(workshopState.elements).length);
  let activeConvCount = $derived(
    Object.values(workshopState.conversations).filter((c) => c.status === 'active').length
  );
  let totalConvCount = $derived(Object.keys(workshopState.conversations).length);
</script>

<div class="absolute inset-0 pointer-events-none overflow-hidden z-[45]">

  <!-- Performance stats panel (top-right) -->
  <div class="absolute top-10 right-3 pointer-events-none">
    <div class="bg-bg2/90 border border-border/60 rounded text-[8px] font-mono p-1.5 space-y-0.5 backdrop-blur min-w-[110px]">
      <div class="text-[7px] text-muted/60 uppercase tracking-wider mb-1">perf</div>

      <div class="flex justify-between gap-3">
        <span class="text-muted/70">fps</span>
        <span class="{fpsColor(fps)} font-semibold tabular-nums">{fps}</span>
      </div>

      <div class="flex justify-between gap-3">
        <span class="text-muted/70">frame</span>
        <span class="text-foreground/80 tabular-nums">{frameMs}ms</span>
      </div>

      {#if heapMB !== null}
        <div class="flex justify-between gap-3">
          <span class="text-muted/70">heap</span>
          <span class="text-foreground/80 tabular-nums">{heapMB} MB</span>
        </div>
      {/if}

      <div class="border-t border-border/30 mt-1 pt-1 space-y-0.5">
        <div class="text-[7px] text-muted/60 uppercase tracking-wider mb-0.5">scene</div>
        <div class="flex justify-between gap-3">
          <span class="text-muted/70">agents</span>
          <span class="text-foreground/80 tabular-nums">{agentCount}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-muted/70">elements</span>
          <span class="text-foreground/80 tabular-nums">{elementCount}</span>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-muted/70">convs</span>
          <span class="text-foreground/80 tabular-nums">
            <span class="text-green-400">{activeConvCount}</span>/{totalConvCount}
          </span>
        </div>
      </div>
    </div>
  </div>

  <!-- Per-agent debug tags -->
  {#each Object.values(workshopState.agents) as agent (agent.instanceId)}
    {@const pos = worldToScreen(agent.position.x, agent.position.y, workshopState.camera)}
    {@const state = getAgentState(agent.instanceId) ?? 'idle'}
    {@const queue = getQueue_readonly(agent.instanceId)}
    {@const mem = agentMemory[agent.instanceId]}

    <!-- Only show if on screen -->
    {#if pos.x > -20 && pos.x < window.innerWidth + 20 && pos.y > -20 && pos.y < window.innerHeight + 20}
      <div
        class="absolute pointer-events-none"
        style="left: {pos.x + 36}px; top: {pos.y - 50}px; min-width: 130px; max-width: 180px;"
      >
        <div class="bg-bg2/90 border border-border/60 rounded text-[8px] font-mono p-1 space-y-0.5 backdrop-blur">
          <!-- Agent name + FSM state -->
          <div class="flex items-center gap-1">
            <span class="text-muted/80 truncate">{resolveAgentName(agent.agentId)}</span>
            <span class="shrink-0 {FSM_COLORS[state] ?? 'text-foreground'} font-semibold">·{state}</span>
          </div>

          <!-- Action queue -->
          {#if queue.length > 0}
            <div class="border-t border-border/40 pt-0.5">
              <span class="text-muted/60">queue:</span>
              {#each queue as action, i (i)}
                <div class="pl-1 text-[7px] {i === 0 ? 'text-accent' : 'text-muted/70'} truncate">
                  {i + 1}. {actionLabel(action)}
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-[7px] text-muted/40">queue: empty</div>
          {/if}

          <!-- Memory summary -->
          {#if mem?.contextSummary}
            <div class="border-t border-border/40 pt-0.5">
              <span class="text-muted/60">mem:</span>
              <span class="text-muted/70 text-[7px]">{mem.contextSummary.slice(0, 60)}…</span>
            </div>
          {/if}
          {#if mem?.workspaceNotes?.length}
            <div class="text-[7px] text-muted/60">{mem.workspaceNotes.length} note(s)</div>
          {/if}
        </div>
      </div>
    {/if}
  {/each}
</div>
