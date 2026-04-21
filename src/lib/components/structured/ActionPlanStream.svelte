<script lang="ts">
  import type { ActionPlan } from '$lib/schemas/structured-response';
  import PartialField from './PartialField.svelte';

  let {
    partial,
    done = false,
    error = null,
  }: {
    partial: Partial<ActionPlan> | null;
    done?: boolean;
    error?: string | null;
  } = $props();
</script>

<div class="structured-card">
  {#if error}
    <div class="error-banner">
      <span class="error-icon">⚠</span>
      <span>{error}</span>
      {#if partial}
        <span class="error-hint">Partial result shown below</span>
      {/if}
    </div>
  {/if}

  <div class="card-header">
    <span class="card-label">Action Plan</span>
    {#if !done}
      <span class="generating-badge">generating…</span>
    {/if}
  </div>

  <div class="goal-row">
    <span class="field-label">Goal</span>
    <PartialField
      value={partial?.goal}
      class="goal-text"
      skeletonClass="w-48 h-3"
    />
  </div>

  {#if partial?.steps?.length}
    <ol class="steps-list">
      {#each partial.steps as step (step.id ?? step.action)}
        <li class="step-item step-{step.status ?? 'pending'}">
          <span class="step-number">{step.id ?? '?'}</span>
          <div class="step-body">
            <PartialField
              value={step.action}
              class="step-action"
              skeletonClass="w-40 h-3"
            />
            {#if step.rationale}
              <PartialField
                value={step.rationale}
                class="step-rationale"
                skeletonClass="w-32 h-2.5"
              />
            {/if}
          </div>
          <span class="step-badge step-badge-{step.status ?? 'pending'}">
            {step.status ?? 'pending'}
          </span>
        </li>
      {/each}
    </ol>
  {:else if !done}
    <div class="steps-placeholder" aria-label="Loading steps">
      {#each { length: 3 } as _, i (i)}
        <div class="step-skeleton">
          <span class="step-num-skeleton"></span>
          <span class="step-text-skeleton" style="width: {60 + i * 15}px"></span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .structured-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-card);
    padding: 12px 14px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: var(--color-foreground);
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
    color: var(--color-destructive);
    font-size: 11px;
  }

  .error-icon {
    flex-shrink: 0;
  }

  .error-hint {
    margin-left: auto;
    color: var(--color-muted);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .card-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-muted);
  }

  .generating-badge {
    font-size: 10px;
    color: var(--color-status-thinking);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .goal-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .field-label {
    font-size: 10px;
    color: var(--color-muted);
    min-width: 32px;
    flex-shrink: 0;
  }

  :global(.goal-text) {
    font-weight: 500;
    color: var(--color-foreground);
  }

  .steps-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .step-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: var(--color-bg2);
    border: 1px solid transparent;
    transition: border-color 0.15s;
  }

  .step-item.step-active {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg2));
  }

  .step-item.step-done {
    opacity: 0.65;
  }

  .step-number {
    font-size: 10px;
    font-weight: 700;
    color: var(--color-muted);
    min-width: 14px;
    flex-shrink: 0;
    padding-top: 1px;
  }

  .step-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  :global(.step-action) {
    font-weight: 500;
    font-size: 12px;
  }

  :global(.step-rationale) {
    font-size: 10px;
    color: var(--color-muted);
  }

  .step-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 100px;
    flex-shrink: 0;
    margin-top: 1px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .step-badge-pending { background: var(--color-bg3); color: var(--color-muted); }
  .step-badge-active { background: color-mix(in srgb, var(--color-accent) 20%, transparent); color: var(--color-accent); }
  .step-badge-done { background: color-mix(in srgb, var(--color-success) 20%, transparent); color: var(--color-success); }

  .steps-placeholder {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .step-skeleton {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: var(--color-bg2);
  }

  .step-num-skeleton {
    width: 14px;
    height: 12px;
    border-radius: 2px;
    background: var(--color-border);
    animation: shimmer 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }

  .step-text-skeleton {
    height: 10px;
    border-radius: 3px;
    background: var(--color-border);
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
</style>
