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
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    background: var(--color-surface-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  h3 {
    margin: 0;
    font-size: var(--font-size-body);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-tertiary);
  }

  .meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-body);
    color: var(--color-text-tertiary);
  }

  code {
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
  }

  pre {
    margin: 0;
    padding: var(--space-3);
    background: var(--color-canvas);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-body);
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
