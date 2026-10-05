<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { CollectionIssue } from './collection-mutations.svelte';

  let {
    issue,
    busy,
    canRefresh,
    canDiscard = false,
    onrefresh,
    ondiscard,
  }: {
    issue: CollectionIssue | null;
    busy: boolean;
    canRefresh: boolean;
    canDiscard?: boolean;
    onrefresh: () => void;
    ondiscard?: () => void;
  } = $props();
</script>

{#if issue}
  <div role="alert" class="mutation-notice" aria-busy={busy}>
    <p class="t-body">
      {issue === 'committed-refreshing'
        ? m.asyncAction_refreshing()
        : issue === 'unknown'
          ? m.sched_mutation_unknown()
          : issue === 'unconfirmed'
            ? m.sched_mutation_present()
            : m.sched_mutation_rejected()}
    </p>
    {#if canRefresh}
      <Button variant="outline" size="sm" disabled={busy} onclick={onrefresh}>
        {m.asyncAction_reload()}
      </Button>
    {/if}
    {#if canDiscard}
      <Button variant="ghost" size="sm" disabled={busy} onclick={ondiscard}>
        {m.sched_mutation_new_draft()}
      </Button>
    {/if}
  </div>
{/if}

<style>
  .mutation-notice {
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
  p {
    flex-basis: 100%;
  }
</style>
