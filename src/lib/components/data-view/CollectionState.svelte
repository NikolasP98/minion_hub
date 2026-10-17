<script lang="ts" module>
  import type { CollectionState as CollectionStateKind, DataViewKind } from './data-view';
  export type { CollectionStateKind };
</script>

<script lang="ts">
  /**
   * The ONE collection-state presentation (spec 013 FR-005). `DataView` stays
   * headless (feature 012: no new wrapper); a collection page composes this
   * sibling above its renderer — or inside `DataTable`'s `empty` /
   * `errorContent` snippets — and hides the rows per `collectionShowsRows()`.
   * No overlay, no second global spinner: a refresh is a caption with an xs
   * spinner, a first load is Skeleton rows in the renderer's shape, and the
   * terminal states compose `AsyncBoundary`. Retry is read-only: `onRetry`
   * re-reads; it is never a write.
   */
  import type { Snippet } from 'svelte';
  import { Button } from '@minion-stack/ui';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    state: kind,
    message,
    onRetry,
    view = 'table',
    createAction,
    clearFilters,
  }: {
    state: CollectionStateKind;
    /** Per state: `stale` → age, `partial` → what failed, `denied` → what the role can't view, `empty`/`failed` → description. */
    message?: string;
    /** Read-only re-read for stale / partial / failed. Never a write. */
    onRetry?: () => Promise<void> | void;
    /** Shape of the `initial-load` skeleton. */
    view?: DataViewKind;
    /** `empty` only: the collection's create action. */
    createAction?: Snippet;
    /** `no-results` only: the clear-filters action. */
    clearFilters?: Snippet;
  } = $props();

  let retrying = $state(false);
  async function retry() {
    if (!onRetry || retrying) return;
    retrying = true;
    try {
      await onRetry();
    } finally {
      retrying = false;
    }
  }
</script>

{#snippet retryButton()}
  {#if onRetry}
    <Button variant="secondary" size="sm" loading={retrying} onclick={retry}
      >{m.verb_retry()}</Button
    >
  {/if}
{/snippet}

{#if kind === 'initial-load'}
  <div
    class="cs-skeleton"
    data-view={view}
    data-component="collection-state"
    data-state={kind}
    role="status"
    aria-busy="true"
    aria-label={m.common_loading()}
  >
    {#each { length: view === 'calendar' ? 1 : 6 } as _, i (i)}
      <Skeleton
        height={view === 'table'
          ? 'var(--control-height-md)'
          : view === 'calendar'
            ? '20rem'
            : '6rem'}
      />
    {/each}
  </div>
{:else if kind === 'refreshing'}
  <p class="cs-caption" data-component="collection-state" data-state={kind} role="status">
    <Spinner size="xs" label={m.data_view_state_refreshing()} />
    <span>{m.data_view_state_refreshing()}</span>
  </p>
{:else if kind === 'recovered'}
  <p class="cs-caption" data-component="collection-state" data-state={kind} role="status">
    {m.data_view_state_recovered()}
  </p>
{:else if kind === 'stale'}
  <p class="cs-caption" data-component="collection-state" data-state={kind} role="status">
    <span>{message ?? m.data_view_state_stale()}</span>
    {@render retryButton()}
  </p>
{:else if kind === 'partial'}
  <div class="cs-banner" data-component="collection-state" data-state={kind} role="alert">
    <p>{m.data_view_state_partial({ what: message ?? '' })}</p>
    {@render retryButton()}
  </div>
{:else if kind === 'empty'}
  <AsyncBoundary
    compact
    state={{ kind: 'empty', title: m.data_view_state_empty_title(), description: message }}
    emptyAction={createAction}
  />
{:else if kind === 'no-results'}
  <AsyncBoundary
    compact
    state={{ kind: 'empty', title: m.data_view_state_no_results_title() }}
    emptyAction={clearFilters}
  />
{:else if kind === 'denied'}
  <AsyncBoundary
    compact
    state={{
      kind: 'forbidden',
      title: message
        ? m.data_view_state_denied({ subject: message })
        : m.data_view_state_denied_generic(),
    }}
  />
{:else if kind === 'failed'}
  <AsyncBoundary
    compact
    state={{
      kind: 'error',
      title: m.data_view_state_failed_title(),
      description: message,
      retry: onRetry ? retry : undefined,
    }}
  />
{/if}

<style>
  .cs-skeleton {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-card-compact);
  }
  .cs-skeleton[data-view='board'],
  .cs-skeleton[data-view='gallery'] {
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  }
  .cs-caption {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-control-gap);
    padding-inline: var(--space-card-compact);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
  }
  .cs-banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-control-gap);
    padding: var(--space-card-compact);
    color: var(--color-warning-fg);
    background: var(--color-warning-surface);
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-md);
  }
  .cs-banner p {
    flex: 1 1 16rem;
    min-width: 0;
  }
</style>
