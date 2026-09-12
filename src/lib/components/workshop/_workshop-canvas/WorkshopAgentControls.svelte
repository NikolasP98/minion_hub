<script lang="ts">
  import { Button } from '@minion-stack/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    agents,
    selectedId,
    connected,
    onselect,
    onassign,
  }: {
    agents: readonly { id: string; name: string }[];
    selectedId: string | null;
    connected: boolean;
    onselect: (id: string) => void;
    onassign: (id: string) => void;
  } = $props();
</script>

{#if agents.length > 0}
  <details class="agent-controls">
    <summary class="t-label">{m.nav_agents()} ({agents.length})</summary>
    <ul aria-label={m.nav_agents()}>
      {#each agents as agent (agent.id)}
        <li>
          <Button
            variant="ghost"
            aria-pressed={selectedId === agent.id}
            onclick={() => onselect(agent.id)}>{agent.name}</Button
          >
          <Button
            variant="ghost"
            disabled={!connected}
            aria-label={`${m.workshop_assignTask()}: ${agent.name}`}
            onclick={() => onassign(agent.id)}>{m.workshop_assignTask()}</Button
          >
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .agent-controls {
    position: absolute;
    top: var(--space-8);
    right: var(--space-2);
    z-index: var(--layer-dropdown);
    max-width: calc(100% - var(--space-4));
    max-height: calc(100% - var(--space-12));
    overflow: auto;
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius-md);
  }
  summary {
    min-height: var(--control-height-touch);
    display: list-item;
    align-content: center;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
  }
  ul {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-control-gap);
  }
  .agent-controls :global(button) {
    min-height: var(--control-height-touch);
    max-width: 100%;
  }
  .agent-controls :global(button > span) {
    white-space: normal;
    overflow-wrap: anywhere;
  }
</style>
