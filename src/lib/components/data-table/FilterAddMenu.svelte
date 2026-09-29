<script lang="ts">
  import { Button, Popover, Tooltip, iconSizes } from '$lib/components/ui';
  import { ListFilter } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { kindIcon } from './filter-ops';
  import type { FilterColumnMeta } from './filters';

  let {
    columns,
    onPick,
    onAdvanced,
    open = $bindable(false),
  }: {
    columns: FilterColumnMeta[];
    onPick: (key: string) => void;
    /** Hidden when omitted — server-mode tables have no advanced tree yet. */
    onAdvanced?: () => void;
    open?: boolean;
  } = $props();

  let search = $state('');
  let searchEl = $state<HTMLInputElement | null>(null);

  const filtered = $derived(
    search.trim()
      ? columns.filter((c) => c.label.toLowerCase().includes(search.trim().toLowerCase()))
      : columns,
  );

  $effect(() => {
    if (open) searchEl?.focus();
    else search = '';
  });

  function pick(key: string) {
    open = false;
    onPick(key);
  }
  function advanced() {
    open = false;
    onAdvanced?.();
  }
</script>

<Popover bind:open placement="bottom">
  {#snippet trigger()}
    <Tooltip label={m.data_table_filter_add_tooltip()}>
      {#snippet children()}
        <span class="fam-trigger" aria-label={m.data_table_filter_add_tooltip()}>
          <ListFilter size={iconSizes.md} />
        </span>
      {/snippet}
    </Tooltip>
  {/snippet}
  <div class="fam">
    <input
      class="fam-search"
      type="search"
      bind:this={searchEl}
      bind:value={search}
      placeholder={m.data_table_filter_search()}
      aria-label={m.data_table_filter_search()}
    />
    <div class="fam-list" role="listbox">
      {#each filtered as c (c.key)}
        {@const Icon = kindIcon(c.kind)}
        <Button variant="ghost" size="xs" class="fam-row" role="option" onclick={() => pick(c.key)}>
          <Icon size={iconSizes.xs} />
          <span class="fam-lbl">{c.label}</span>
        </Button>
      {/each}
      {#if filtered.length === 0}
        <p class="fam-empty t-caption">{m.data_table_filter_no_columns()}</p>
      {/if}
    </div>
    {#if onAdvanced}
      <div class="fam-footer">
        <Button variant="ghost" size="xs" class="fam-advanced" onclick={advanced}>
          {m.data_table_filter_add_advanced()}
        </Button>
      </div>
    {/if}
  </div>
</Popover>

<style>
  .fam-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-xs);
    height: var(--control-height-xs);
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .fam-trigger:hover {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-text-primary);
  }
  .fam {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 14rem;
  }
  .fam-search {
    height: 1.65rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .fam-search:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .fam-list {
    display: flex;
    flex-direction: column;
    max-height: 16rem;
    overflow: auto;
  }
  .fam :global(.fam-row) {
    display: flex;
    width: 100%;
    height: auto;
    justify-content: flex-start;
    padding: var(--space-1) var(--space-2);
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-body);
    font-weight: 400;
    text-transform: none;
    color: var(--color-text-primary);
    cursor: pointer;
    text-align: left;
  }
  .fam :global(.fam-row > span) {
    width: 100%;
    justify-content: flex-start;
    gap: var(--space-2);
  }
  .fam :global(.fam-row:hover) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .fam-lbl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fam-empty {
    padding: var(--space-2);
    color: var(--color-text-tertiary);
    text-align: center;
  }
  .fam-footer {
    border-top: 1px solid var(--hairline);
    padding-top: var(--space-1);
  }
  .fam :global(.fam-advanced) {
    width: 100%;
    justify-content: flex-start;
    color: var(--color-text-secondary);
  }
</style>
