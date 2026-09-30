<script lang="ts">
  /**
   * Notion-style option list for a custom `select`/`multi_select` column cell
   * — the same search + checklist body as tags' `TagOptionList`, minus
   * rename/recolour/delete (custom-property options are managed on the
   * column definition, not from a value cell) and minus create-on-the-spot.
   * TODO(handoff): no option-creation API exists for custom properties (only
   * `CustomPropertyValueActions.save`/`read`), so this always shows a plain
   * "Search…" placeholder and never a "create" row — unlike tags. If the
   * owner wants inline "type a new option" from the cell, add a definition
   * flag + an option-create endpoint and thread `allowCreate` through here;
   * see proposal 2026-09-30-hub-custom-property-select-picker.md.
   * A quiet "Clear value" row sits below the list.
   */
  import { Check } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import TagChip from '$lib/components/tags/TagChip.svelte';
  import type { CustomPropertyOption } from '$lib/tables/custom-properties';

  let {
    options,
    selected,
    multi,
    disabled = false,
    ontoggle,
    onclear,
  }: {
    options: CustomPropertyOption[];
    selected: Set<string>;
    multi: boolean;
    disabled?: boolean;
    ontoggle: (id: string) => void;
    onclear: () => void;
  } = $props();

  let query = $state('');
  const q = $derived(query.trim().toLowerCase());
  const filtered = $derived(
    q ? options.filter((option) => option.label.toLowerCase().includes(q)) : options,
  );
</script>

<div
  class="sol"
  role="listbox"
  aria-multiselectable={multi}
  aria-label={m.custom_columns_options()}
>
  <!-- svelte-ignore a11y_autofocus -- the popover just opened on the user's click -->
  <input
    class="search"
    autofocus
    bind:value={query}
    placeholder={m.custom_columns_search_placeholder()}
    {disabled}
  />
  <div class="rows">
    {#each filtered as option (option.id)}
      {@const isSelected = selected.has(option.id)}
      <Button
        variant="ghost"
        size="xs"
        class="row"
        role="option"
        aria-selected={isSelected}
        disabled={disabled || (!!option.archivedAt && !isSelected)}
        onclick={() => ontoggle(option.id)}
      >
        <span class="box" class:on={isSelected}>
          {#if isSelected}<Check size={iconSizes.xs} />{/if}
        </span>
        <TagChip size="sm" name={option.label} color={option.color} dashed={!!option.archivedAt} />
      </Button>
    {:else}
      <p class="t-caption empty">{m.custom_columns_no_match()}</p>
    {/each}
  </div>
  <Button variant="ghost" size="xs" class="clear" {disabled} onclick={onclear}>
    {m.custom_columns_clear_value()}
  </Button>
</div>

<style>
  .sol {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: calc(100vw - var(--space-8));
    min-width: 0;
    max-width: 20rem;
    white-space: normal;
  }
  .search {
    height: var(--control-height-sm);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-2);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-caption);
    width: 100%;
  }
  .search:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
  .rows {
    display: flex;
    flex-direction: column;
    max-height: 50vh;
    overflow-y: auto;
  }
  .sol :global(.row) {
    flex: 1;
    justify-content: flex-start;
    min-width: 0;
  }
  .sol :global(.row > span) {
    gap: var(--space-2);
    justify-content: flex-start;
    width: 100%;
  }
  .box {
    display: inline-grid;
    place-items: center;
    width: 1rem;
    height: 1rem;
    box-sizing: border-box;
    border-radius: var(--radius-xs);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-2);
    color: var(--color-on-accent);
    flex-shrink: 0;
  }
  .box.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .empty {
    color: var(--color-text-secondary);
    padding: var(--space-1) var(--space-1) 0;
    overflow-wrap: anywhere;
  }
  .sol :global(.clear) {
    justify-content: flex-start;
    color: var(--color-text-secondary);
  }
</style>
