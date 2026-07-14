<script lang="ts">
  import { Button } from '$lib/components/ui';
  import {
    ALL_GATES,
    GATE_LABEL,
    type DebugStepName,
    type DebugStepEvent,
  } from '$lib/state/debug';

  let {
    events,
    pausedStep,
    onContinue,
    onSelect,
  }: {
    events: DebugStepEvent[];
    pausedStep: DebugStepName | null;
    onContinue: (step: DebugStepName) => void;
    onSelect: (step: DebugStepName) => void;
  } = $props();

  /** Map gate → most-recent event (for status icon + selection). */
  const eventsByStep = $derived.by(() => {
    const map = new Map<DebugStepName, DebugStepEvent>();
    for (const e of events) map.set(e.step, e);
    return map;
  });

  function statusFor(step: DebugStepName): 'paused' | 'fired' | 'pending' {
    if (pausedStep === step) return 'paused';
    if (eventsByStep.has(step)) return 'fired';
    return 'pending';
  }

  function statusIcon(status: 'paused' | 'fired' | 'pending'): string {
    if (status === 'paused') return '⏸';
    if (status === 'fired') return '✓';
    return '○';
  }
</script>

<div class="step-view">
  <h3>Pipeline gates</h3>
  <ul>
    {#each ALL_GATES as gate (gate)}
      {@const status = statusFor(gate)}
      {@const evt = eventsByStep.get(gate)}
      <li class="row" class:paused={status === 'paused'} class:fired={status === 'fired'}>
        <Button variant="ghost" size="xs" class="gate-btn" type="button" onclick={() => onSelect(gate)}>
          <span class="icon">{statusIcon(status)}</span>
          <span class="label">{GATE_LABEL[gate]}</span>
          {#if evt}
            <span class="ts">{new Date(evt.ts).toLocaleTimeString()}</span>
          {/if}
        </Button>
        {#if status === 'paused'}
          <Button variant="primary" size="sm" class="continue-btn" type="button" onclick={() => onContinue(gate)}>
            ▶ Continue
          </Button>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .step-view {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    background: var(--color-surface-2);
  }

  h3 {
    margin: 0 0 0.75rem;
    font-size: var(--font-size-body);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-tertiary);
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .gate-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    height: auto;
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-tertiary);
    cursor: pointer;
    text-align: left;
    font: inherit;
  }

  .gate-btn:hover {
    background: var(--color-surface-3);
  }

  :global(.gate-btn > span) {
    width: 100%;
    justify-content: flex-start;
  }

  .row.fired .gate-btn {
    color: var(--color-text-primary);
  }

  .row.paused .gate-btn {
    color: var(--color-warning-fg);
    background: var(--color-warning-surface);
    border-color: var(--color-warning-border);
  }

  .icon {
    font-family: var(--font-mono, monospace);
    width: 1em;
    text-align: center;
  }

  .label {
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-body);
  }

  .ts {
    margin-left: auto;
    font-size: var(--font-size-label);
    color: var(--color-text-disabled);
  }

  .continue-btn {
    background: var(--color-accent);
    color: var(--color-on-accent);
    border: none;
    border-radius: var(--radius-sm);
    height: auto;
    padding: var(--space-2) var(--space-3);
    font-weight: 600;
    cursor: pointer;
    font-size: var(--font-size-body);
  }

  .continue-btn:hover {
    filter: brightness(1.15);
  }
</style>
