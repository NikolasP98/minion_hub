<script lang="ts">
  /** Test host: the state block above the rows, exactly as a collection page composes it. */
  import { Button } from '@minion-stack/ui';
  import CollectionState from '../CollectionState.svelte';
  import { collectionShowsRows, type CollectionState as Kind } from '../data-view';

  let {
    state,
    message,
    onRetry,
    onWrite,
    rows = ['alpha', 'beta'],
  }: {
    state?: Kind;
    message?: string;
    onRetry?: () => Promise<void> | void;
    /** A write callback a state region must never reach. */
    onWrite: () => void;
    rows?: string[];
  } = $props();
</script>

{#if state}
  <CollectionState {state} {message} {onRetry}>
    {#snippet createAction()}
      <Button size="sm" data-testid="create" onclick={onWrite}>New thing</Button>
    {/snippet}
    {#snippet clearFilters()}
      <Button size="sm" data-testid="clear" onclick={onWrite}>Clear filters</Button>
    {/snippet}
  </CollectionState>
{/if}
{#if collectionShowsRows(state)}
  <ul data-testid="rows">
    {#each rows as row (row)}<li>{row}</li>{/each}
  </ul>
{/if}
