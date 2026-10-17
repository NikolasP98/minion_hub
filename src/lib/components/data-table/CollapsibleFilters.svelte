<script lang="ts">
  /**
   * A collection's filter bar that collapses by purpose (spec 013, FR-006):
   * inline at ≥768px, and below that ONE "Filters" button that opens the same
   * controls in the shared `Sheet`. The controls are rendered once, in whichever
   * region is active, so every filter stays reachable at 390/320px without the
   * toolbar overflowing. Filter state lives in the caller (bindable), as with
   * `FilterToolbar`.
   */
  import { onMount, type Snippet } from 'svelte';
  import { ListFilter } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import { Sheet } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';

  let {
    children,
    activeCount = 0,
  }: {
    children: Snippet;
    /** Live filters, shown on the collapsed trigger so a hidden filter is never silent. */
    activeCount?: number;
  } = $props();

  let narrow = $state(false);
  let open = $state(false);

  onMount(() => {
    const media = window.matchMedia('(max-width: 767.98px)');
    const update = () => (narrow = media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  });
</script>

{#if narrow}
  <Button
    variant="outline"
    size="sm"
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open = true)}
  >
    <ListFilter size={iconSizes.sm} />
    {m.filters_label()}
    {#if activeCount > 0}<span class="count">{activeCount}</span>{/if}
  </Button>
  <Sheet bind:open title={m.filters_label()} placement="bottom" size="md">
    <div class="sheet-filters" data-component="collapsible-filters" data-action-scope="collection">
      {@render children()}
    </div>
  </Sheet>
{:else}
  <div class="inline-filters" data-component="collapsible-filters" data-action-scope="collection">
    {@render children()}
  </div>
{/if}

<style>
  .inline-filters,
  .sheet-filters {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .sheet-filters {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3, 12px);
  }
  .count {
    display: inline-flex;
    min-width: var(--control-height-xs);
    height: var(--control-height-xs);
    align-items: center;
    justify-content: center;
    padding-inline: var(--space-1, 4px);
    border-radius: var(--radius-full);
    background: var(--color-accent);
    color: var(--color-on-accent, var(--color-accent-foreground));
    font-size: var(--font-size-caption, 12px);
    font-variant-numeric: tabular-nums;
  }
</style>
