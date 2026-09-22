<script lang="ts">
  import ProgressBar from '$lib/components/ui/ProgressBar.svelte';
  import Popover from '$lib/components/ui/Popover.svelte';
  import { Button } from '@minion-stack/ui';
  import * as m from '$lib/paraglide/messages';
  import type { ActionRuntime, ActionRecord } from '$lib/services/actions/runtime.svelte';

  let { actions, connecting = false }: { actions: ActionRuntime; connecting?: boolean } = $props();
  const visible = $derived(actions.indicatorVisible || connecting);
  let open = $state(false);
  function label(action: ActionRecord) {
    if (action.definitionId.startsWith('table.')) return m.asyncAction_table();
    if (action.definitionId.startsWith('finance.')) return m.asyncAction_finance();
    return m.asyncAction_command();
  }
  function explanation(action: ActionRecord) {
    switch (action.status) {
      case 'unknown':
        return m.asyncAction_unknown();
      case 'committed-refreshing':
        return m.asyncAction_refreshing();
      case 'conflict':
        return m.asyncAction_conflict();
      case 'partial':
        return m.asyncAction_partial();
      default:
        return m.asyncAction_failure();
    }
  }
</script>

<div class="sr-only" role="status">{visible ? m.common_loading() : ''}</div>
{#if visible}
  <div class="global-activity" aria-hidden="true"><ProgressBar value={null} size="sm" /></div>
{/if}

<div class="sr-only" role="status">
  {actions.backgroundJobs ? m.asyncAction_jobs({ count: String(actions.backgroundJobs) }) : ''}
  {actions.attentionRequired
    ? m.asyncAction_attention({ count: String(actions.attentionRequired) })
    : ''}
</div>
{#if actions.backgroundJobs || actions.attentionRequired}
  <div class="activity-summary">
    <Popover placement="top" bind:open>
      {#snippet trigger()}
        <span class="summary-label t-caption">
          {#if actions.backgroundJobs}<span
              >{m.asyncAction_jobs({ count: String(actions.backgroundJobs) })}</span
            >{/if}
          {#if actions.attentionRequired}<span class="attention"
              >{m.asyncAction_attention({ count: String(actions.attentionRequired) })}</span
            >{/if}
        </span>
      {/snippet}
      <div class="activity-details">
        <h2 class="t-title">{m.asyncAction_activity()}</h2>
        {#each actions.jobs as action (action.id)}
          <div class="activity-row">
            <strong class="t-label">{label(action)}</strong>
            <span class="t-caption">{m.asyncAction_jobRunning()}</span>
            <ProgressBar
              value={action.progress?.completed ?? null}
              max={action.progress?.total ?? 100}
              size="sm"
            />
          </div>
        {/each}
        {#each actions.attention as action (action.id)}
          <div class="activity-row">
            <strong class="t-label">{label(action)}</strong>
            <span class="t-caption">{explanation(action)}</span>
            {#if ['failed', 'conflict', 'partial'].includes(action.status)}
              <Button variant="ghost" size="sm" onclick={() => actions.dismiss(action.id)}
                >{m.asyncAction_dismiss()}</Button
              >
            {/if}
          </div>
        {/each}
        <p class="t-caption">{m.asyncAction_recoveryHint()}</p>
      </div>
    </Popover>
  </div>
{/if}

<style>
  .global-activity {
    position: fixed;
    inset: 0 0 auto;
    z-index: var(--layer-toast);
    pointer-events: none;
  }
  .activity-summary {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    z-index: var(--layer-toast);
    max-width: calc(100vw - var(--space-8));
  }
  .summary-label {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
  }
  .attention {
    color: var(--color-warning-fg);
  }
  .activity-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    width: min(20rem, calc(100vw - var(--space-8)));
    max-height: 60vh;
    overflow: auto;
    overflow-wrap: anywhere;
  }
  .activity-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-block: var(--space-2);
    border-bottom: 1px solid var(--color-border-default);
  }
  .activity-details p {
    margin: 0;
    color: var(--color-text-secondary);
  }
</style>
