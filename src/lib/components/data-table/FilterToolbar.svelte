<script lang="ts">
  /**
   * The table's filter controls for a view that is NOT a `DataTable`: the
   * "+ Filter" menu, one chip per live (or just-picked) filter, the
   * advanced-rules chip and Clear all — the same components `DataTable`
   * renders, over the same `filters` / `advanced` objects, so a page can put
   * its calendar or board under the identical filter bar and `applyFilters`
   * selects exactly the rows the table would show.
   *
   * State lives in the CALLER (bindable), which is what lets one filter
   * survive a view switch; everything transient (which chips are popped open)
   * is local.
   */
  import { Button, Popover, iconSizes } from '$lib/components/ui';
  import { ListFilter } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import FilterAddMenu from './FilterAddMenu.svelte';
  import FilterChip from './FilterChip.svelte';
  import AdvancedFilterBuilder from './AdvancedFilterBuilder.svelte';
  import {
    emptyFilter,
    emptyRule,
    isFilterActive,
    newId,
    type FilterColumnMeta,
    type FilterGroup,
    type FilterValue,
  } from './filters';

  let {
    columns,
    filters = $bindable({}),
    advanced = $bindable(null),
  }: {
    /** Same metadata the table's menu lists — build it with `filterColumnMetas`. */
    columns: FilterColumnMeta[];
    filters?: Record<string, FilterValue>;
    advanced?: FilterGroup | null;
  } = $props();

  /** Chip keys shown even while inert (just picked from the menu, operand not
   *  entered yet) — normal chip visibility is `isFilterActive`. */
  let openChips = $state<string[]>([]);
  let chipOpenState = $state<Record<string, boolean>>({});
  let advancedOpen = $state(false);

  function setFilterValue(key: string, value: FilterValue | null) {
    const next = { ...filters };
    if (!value || !isFilterActive(value)) delete next[key];
    else next[key] = value;
    filters = next;
  }
  function pickFilter(key: string) {
    if (!openChips.includes(key)) openChips = [...openChips, key];
    chipOpenState = { ...chipOpenState, [key]: true };
  }
  function removeChip(key: string) {
    setFilterValue(key, null);
    openChips = openChips.filter((k) => k !== key);
    if (key in chipOpenState) {
      const next = { ...chipOpenState };
      delete next[key];
      chipOpenState = next;
    }
  }
  function openAdvanced() {
    const first = columns[0];
    if (!first) return;
    advanced = { id: newId(), logic: 'and', items: [emptyRule(first.key, first.kind)] };
    advancedOpen = true;
  }
  function clearFilters() {
    filters = {};
    advanced = null;
    openChips = [];
    chipOpenState = {};
  }
  const advancedActive = $derived(!!advanced && advanced.items.length > 0);
  const anyFilter = $derived(columns.some((c) => isFilterActive(filters[c.key])) || advancedActive);
  const chipList = $derived(
    columns.filter((c) => isFilterActive(filters[c.key]) || openChips.includes(c.key)),
  );
</script>

<div class="dt-filter-row" data-component="filter-toolbar">
  <div class="dt-view-tools">
    <FilterAddMenu {columns} onPick={pickFilter} onAdvanced={openAdvanced} active={anyFilter} />
  </div>
  {#each chipList as col (col.key)}
    <FilterChip
      label={col.label}
      kind={col.kind}
      options={col.options ?? []}
      value={filters[col.key] ?? emptyFilter(col.kind)}
      onValue={(v) => setFilterValue(col.key, v)}
      onRemove={() => removeChip(col.key)}
      open={chipOpenState[col.key] ?? false}
    />
  {/each}
  {#if advanced && advancedActive}
    {@const advGroup = advanced}
    <div class="dt-adv-chip">
      <Popover bind:open={advancedOpen} placement="bottom">
        {#snippet trigger()}
          <span class="dt-adv-trigger">
            <ListFilter size={iconSizes.xs} />
            <span
              >{advGroup.items.length === 1
                ? m.data_table_filter_rule_one()
                : m.data_table_filter_rules({ n: advGroup.items.length })}</span
            >
          </span>
        {/snippet}
        <AdvancedFilterBuilder
          group={advGroup}
          {columns}
          onChange={(next) => (advanced = next)}
          onDelete={() => {
            advanced = null;
            advancedOpen = false;
          }}
        />
      </Popover>
    </div>
  {/if}
  {#if chipList.length > 0 || advancedActive}
    <Button variant="ghost" size="xs" class="dt-chip-clear" onclick={clearFilters}>
      {m.data_table_filters_clear_all()}
    </Button>
  {/if}
</div>
