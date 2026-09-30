<script lang="ts">
  import { Button, Dropdown, Popover, iconSizes } from '$lib/components/ui';
  import { ChevronDown, MoreHorizontal, Trash2, X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import type { Snippet } from 'svelte';
  import { isFilterActive, type FilterKind, type FilterValue } from './filters';
  import { summary } from './filter-ops';
  import FilterRuleEditor from './FilterRuleEditor.svelte';

  type Option = { value: string; label: string };

  let {
    label,
    kind,
    options = [],
    value,
    onValue,
    onRemove,
    optionIcon,
    open = $bindable(false),
  }: {
    label: string;
    kind: FilterKind;
    options?: Option[];
    value: FilterValue;
    onValue: (v: FilterValue) => void;
    onRemove: () => void;
    optionIcon?: Snippet<[string]>;
    open?: boolean;
  } = $props();

  const active = $derived(isFilterActive(value));

  const menuItems = [
    { value: 'delete', label: m.data_table_filter_delete(), icon: Trash2, danger: true },
  ];

  function onMenuSelect(v: string) {
    if (v === 'delete') {
      open = false;
      onRemove();
    }
  }
</script>

<div class="fchip chip chip-removable" class:active>
  <Popover bind:open placement="bottom">
    {#snippet trigger()}
      <span class="fchip-trigger chip-label">
        <span class="fchip-label">{label}:</span>
        <span class="fchip-summary">{summary(kind, value, options)}</span>
        <ChevronDown size={iconSizes.xs} class="fchip-chev {open ? 'flip' : ''}" />
      </span>
    {/snippet}
    <div class="fchip-panel">
      <div class="fchip-panel-head">
        <span class="t-label">{label}</span>
        <Dropdown items={menuItems} onSelect={onMenuSelect}>
          {#snippet trigger()}
            <span class="fchip-kebab" aria-label={m.data_table_filter_menu()}>
              <MoreHorizontal size={iconSizes.xs} />
            </span>
          {/snippet}
        </Dropdown>
      </div>
      <FilterRuleEditor {kind} {options} {value} {onValue} {optionIcon} />
    </div>
  </Popover>
  <Button
    variant="ghost"
    size="xs"
    class="fchip-x chip-x"
    aria-label={m.data_table_filter_remove()}
    onclick={onRemove}
  >
    <X size={iconSizes.xs} />
  </Button>
</div>

<style>
  /* Pill shape + × mechanics are the shared `.chip`/`.chip-removable`/
     `.chip-label`/`.chip-x` contract in app.css
     ("Chip contract", 2026-09-29) — this file keeps only FilterChip-specific
     bits (trigger/kebab/panel). */
  .fchip-trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-label);
    color: var(--color-text-primary);
    cursor: pointer;
  }
  .fchip.active .fchip-label {
    color: var(--color-accent);
  }
  .fchip-summary {
    color: var(--color-text-secondary);
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.fchip-chev) {
    opacity: 0.6;
    transition: transform var(--duration-fast);
  }
  :global(.fchip-chev.flip) {
    transform: rotate(180deg);
  }
  .fchip-kebab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-0-5);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .fchip-kebab:hover {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-text-primary);
  }
  .fchip-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 14rem;
  }
  .fchip-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
</style>
