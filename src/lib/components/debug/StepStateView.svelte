<script lang="ts">
  import { GATE_LABEL, type DebugStepEvent } from '$lib/state/debug';

  let {
    event,
  }: {
    event: DebugStepEvent | null;
  } = $props();

  const formatted = $derived.by(() => {
    if (!event) return '';
    return JSON.stringify(event.state, null, 2);
  });
</script>

<div class="state-view">
  <h3>Step state</h3>
  {#if event}
    <div class="meta">
      <div><strong>Gate:</strong> {GATE_LABEL[event.step]}</div>
      <div><strong>Session:</strong> <code>{event.sessionKey}</code></div>
      {#if event.agentId}
        <div><strong>Agent:</strong> <code>{event.agentId}</code></div>
      {/if}
      <div>
        <strong>Time:</strong>
        {new Date(event.ts).toLocaleTimeString()}
      </div>
    </div>
    <pre>{formatted}</pre>
  {:else}
    <p class="empty">Select a gate from the pipeline to inspect its state.</p>
  {/if}
</div>

<style>
  .state-view {
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 1rem;
    background: var(--color-surface-2);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  h3 {
    margin: 0;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-tertiary);
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: var(--color-text-tertiary);
  }

  code {
    font-family: var(--font-mono, monospace);
    font-size: 0.8rem;
    color: var(--color-text-primary);
  }

  pre {
    margin: 0;
    padding: 0.75rem;
    background: var(--color-canvas);
    border-radius: 4px;
    font-family: var(--font-mono, monospace);
    font-size: 0.8rem;
    color: var(--color-text-primary);
    overflow-x: auto;
    max-height: 400px;
    overflow-y: auto;
  }

  .empty {
    color: var(--color-text-disabled);
    font-style: italic;
    margin: 0;
  }
</style>
