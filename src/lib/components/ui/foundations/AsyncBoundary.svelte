<script lang="ts" module>
  export type AsyncBoundaryState =
    | { kind: 'loading'; label?: string }
    | { kind: 'ready' }
    | { kind: 'empty'; title: string; description?: string }
    | { kind: 'error'; title?: string; description?: string; retry?: () => void }
    | { kind: 'forbidden'; title?: string; description?: string }
    | { kind: 'unavailable'; title: string; description?: string; retry?: () => void };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { AlertTriangle, Inbox, LockKeyhole, WifiOff } from 'lucide-svelte';
  import { Button } from '@minion-stack/ui';
  import * as m from '$lib/paraglide/messages';
  import Spinner from '../Spinner.svelte';

  interface Props {
    state: AsyncBoundaryState;
    children?: Snippet;
    loading?: Snippet;
    emptyAction?: Snippet;
    forbiddenAction?: Snippet;
    unavailableAction?: Snippet;
    compact?: boolean;
    class?: string;
  }

  let {
    state,
    children,
    loading,
    emptyAction,
    forbiddenAction,
    unavailableAction,
    compact = false,
    class: cls = '',
  }: Props = $props();
</script>

<section
  data-component="async-boundary"
  data-state={state.kind}
  data-compact={compact ? 'true' : undefined}
  aria-busy={state.kind === 'loading' ? 'true' : undefined}
  class={cls}
>
  {#if state.kind === 'ready'}
    {#if children}{@render children()}{/if}
  {:else if state.kind === 'loading'}
    {#if loading}
      {@render loading()}
    {:else}
      <div class="async-state loading-state" role="status">
        <Spinner label={state.label ?? m.common_loading()} />
        <span>{state.label ?? m.common_loading()}</span>
      </div>
    {/if}
  {:else if state.kind === 'empty'}
    <div class="async-state" role="status">
      <span class="state-icon" aria-hidden="true"><Inbox size={20} /></span>
      <h3>{state.title}</h3>
      {#if state.description}<p>{state.description}</p>{/if}
      {#if emptyAction}<div class="state-action">{@render emptyAction()}</div>{/if}
    </div>
  {:else if state.kind === 'error'}
    <div class="async-state" role="alert">
      <span class="state-icon" aria-hidden="true"><AlertTriangle size={20} /></span>
      <h3>{state.title ?? m.common_error()}</h3>
      {#if state.description}<p>{state.description}</p>{/if}
      {#if state.retry}
        <div class="state-action">
          <Button variant="secondary" size="sm" onclick={state.retry}>{m.common_retry()}</Button>
        </div>
      {/if}
    </div>
  {:else if state.kind === 'forbidden'}
    <div class="async-state" role="region" aria-label={state.title ?? m.no_permission()}>
      <span class="state-icon" aria-hidden="true"><LockKeyhole size={20} /></span>
      <h3>{state.title ?? m.no_permission()}</h3>
      {#if state.description}<p>{state.description}</p>{/if}
      {#if forbiddenAction}<div class="state-action">{@render forbiddenAction()}</div>{/if}
    </div>
  {:else}
    <div class="async-state" role="alert">
      <span class="state-icon" aria-hidden="true"><WifiOff size={20} /></span>
      <h3>{state.title}</h3>
      {#if state.description}<p>{state.description}</p>{/if}
      {#if state.retry}
        <div class="state-action">
          <Button variant="secondary" size="sm" onclick={state.retry}>{m.common_retry()}</Button>
        </div>
      {:else if unavailableAction}
        <div class="state-action">{@render unavailableAction()}</div>
      {/if}
    </div>
  {/if}
</section>

<style>
  [data-component='async-boundary'] {
    min-width: 0;
  }
  .async-state {
    display: flex;
    width: min(100%, 28rem);
    min-height: 14rem;
    margin-inline: auto;
    padding: var(--space-section, 24px);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2, 8px);
    text-align: center;
  }
  [data-compact='true'] .async-state {
    min-height: 8rem;
    padding: var(--space-card, 16px);
  }
  .state-icon {
    display: inline-flex;
    width: var(--control-height-touch, 44px);
    height: var(--control-height-touch, 44px);
    margin-bottom: var(--space-1, 4px);
    align-items: center;
    justify-content: center;
    border: 1px solid var(--color-border-default, var(--hairline));
    border-radius: var(--radius-full, 9999px);
    color: var(--color-text-secondary, var(--color-muted));
    background: var(--color-surface-2, var(--elevation-2-bg));
  }
  [data-state='error'] .state-icon {
    border-color: var(--color-danger-border, var(--color-destructive));
    color: var(--color-danger-fg, var(--color-destructive));
    background: var(--color-danger-surface, transparent);
  }
  [data-state='forbidden'] .state-icon {
    border-color: var(--color-warning-border, var(--color-warning));
    color: var(--color-warning-fg, var(--color-warning));
    background: var(--color-warning-surface, transparent);
  }
  [data-state='unavailable'] .state-icon {
    border-color: var(--color-info-border, var(--color-info));
    color: var(--color-info-fg, var(--color-info));
    background: var(--color-info-surface, transparent);
  }
  .async-state h3 {
    color: var(--color-text-primary, var(--color-foreground));
    font-size: var(--font-size-section-title, 14px);
    line-height: var(--line-height-heading, 20px);
    font-weight: var(--font-weight-semibold, 600);
  }
  .async-state p,
  .loading-state span {
    max-width: 36ch;
    color: var(--color-text-secondary, var(--color-muted));
    font-size: var(--font-size-body, 14px);
    line-height: var(--line-height-body, 20px);
  }
  .loading-state {
    flex-direction: row;
    min-height: 8rem;
  }
  .state-action {
    margin-top: var(--space-2, 8px);
  }
</style>
