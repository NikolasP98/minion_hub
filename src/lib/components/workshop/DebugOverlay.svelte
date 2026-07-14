<script lang="ts">
  import { workshopState } from '$lib/state/workshop/workshop.svelte';
  import { agentMemory } from '$lib/state/workshop/workshop.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { getAgentState } from '$lib/workshop/agent-fsm';
  import { getQueue_readonly } from '$lib/workshop/agent-queue';
  import { agentDisplayName } from '$lib/utils/agent-display';

  /** Parent provides a view-mode-aware world→screen converter */
  let { worldToScreenFn }: { worldToScreenFn: (x: number, y: number) => { x: number; y: number } } =
    $props();

  function resolveAgentName(agentId: string): string {
    const agent = gw.agents.find((a: { id: string }) => a.id === agentId);
    return agent ? agentDisplayName(agent) : agentId;
  }

  const FSM_COLORS: Record<string, string> = {
    idle: 'text-muted',
    wandering: 'text-info',
    patrolling: 'text-[var(--color-purple)]',
    conversing: 'text-success',
    cooldown: 'text-warning',
    dragged: 'text-warning',
    heartbeat: 'text-[var(--color-cyan)]',
    reading: 'text-warning',
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

<div class="absolute inset-0 pointer-events-none overflow-hidden z-[var(--layer-debug)]">
  {#each Object.values(workshopState.agents) as agent (agent.instanceId)}
    {@const pos = worldToScreenFn(agent.position.x, agent.position.y)}
    {@const state = getAgentState(agent.instanceId) ?? 'idle'}
    {@const queue = getQueue_readonly(agent.instanceId)}
    {@const mem = agentMemory[agent.instanceId]}

    {#if pos.x > -20 && pos.x < window.innerWidth + 20 && pos.y > -20 && pos.y < window.innerHeight + 20}
      <div
        class="absolute pointer-events-none"
        style="left: {pos.x + 36}px; top: {pos.y - 50}px; min-width: 130px; max-width: 180px;"
      >
        <div
          class="bg-bg2/90 border border-border/60 rounded text-xs font-mono p-1 space-y-0.5 backdrop-blur"
        >
          <div class="flex items-center gap-1">
            <span class="text-muted/80 truncate">{resolveAgentName(agent.agentId)}</span>
            <span class="shrink-0 {FSM_COLORS[state] ?? 'text-foreground'} font-semibold"
              >·{state}</span
            >
          </div>

          {#if queue.length > 0}
            <div class="border-t border-border/40 pt-0.5">
              <span class="text-muted-strong">queue:</span>
              {#each queue as action, i (i)}
                <div class="pl-1 text-xs {i === 0 ? 'text-accent' : 'text-muted-strong'} truncate">
                  {i + 1}. {actionLabel(action)}
                </div>
              {/each}
            </div>
          {:else}
            <div class="text-xs text-muted-strong">queue: empty</div>
          {/if}

          {#if mem?.contextSummary}
            <div class="border-t border-border/40 pt-0.5">
              <span class="text-muted-strong">mem:</span>
              <span class="text-muted-strong text-xs">{mem.contextSummary.slice(0, 60)}…</span>
            </div>
          {/if}
          {#if mem?.workspaceNotes?.length}
            <div class="text-xs text-muted-strong">{mem.workspaceNotes.length} note(s)</div>
          {/if}
        </div>
      </div>
    {/if}
  {/each}
</div>
