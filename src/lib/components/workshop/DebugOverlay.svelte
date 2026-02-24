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
</script>

<div class="absolute inset-0 pointer-events-none overflow-hidden z-[200]">
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
