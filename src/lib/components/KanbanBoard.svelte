<script lang="ts">
  import KanbanCol from './KanbanCol.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { ui } from '$lib/state/ui.svelte';

  let { agentId }: { agentId: string } = $props();

  const agentSessions = $derived(
    gw.sessions.filter((s) => {
      const sk = (s as { sessionKey?: string }).sessionKey ?? '';
      return sk.includes(`agent:${agentId}:`);
    })
  );

  function sessionsWithStatus(status: string) {
    return agentSessions.filter((s) => {
      const sk = (s as { sessionKey?: string }).sessionKey ?? '';
      return (ui.sessionStatus[sk] ?? 'idle') === status;
    });
  }

  const cols = [
    { key: 'running', label: 'Running' },
    { key: 'thinking', label: 'Thinking' },
    { key: 'idle', label: 'Idle' },
    { key: 'aborted', label: 'Aborted' },
  ] as const;
</script>

<div class="kanban">
  {#each cols as col}
    <KanbanCol
      status={col.key}
      label={col.label}
      sessions={sessionsWithStatus(col.key)}
    />
  {/each}
</div>

<style>
  .kanban {
    flex-shrink: 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid var(--border);
  }
</style>
