<script lang="ts" generics="T">
  /**
   * "Primitive picker combobox" (owner 2026-09-17): one field, two ways in —
   * type to filter a dropdown (Zag `Combobox`) or press the trailing icon to
   * open the full `Picker` primitive over the SAME items. Both write the same
   * bound `value`, so callers pre-filter `items` once (e.g. a service's
   * assignees) and every path respects it.
   */
  import { ListFilter } from 'lucide-svelte';
  import { Button } from '@minion-stack/ui';
  import Combobox from './Combobox.svelte';
  import Picker from './Picker.svelte';
  import { iconSizes } from './icon-sizes';
  import type { PickerColumn } from './picker';

  interface Props {
    id: string;
    items: T[];
    itemToValue: (item: T) => string;
    itemToString: (item: T) => string;
    /** Bound selection (an `itemToValue` result, '' = none). */
    value?: string;
    onchange?: (value: string) => void;
    label?: string;
    placeholder?: string;
    /** Picker window. */
    pickerTitle: string;
    columns: PickerColumn<T>[];
    searchText?: (item: T) => string;
    emptyLabel?: string;
    storageKey?: string;
    /** Accessible name of the icon that opens the picker. */
    pickerLabel?: string;
    /** Both ways in are off (e.g. a dependent field before its parent is picked). */
    disabled?: boolean;
  }

  let {
    id,
    items,
    itemToValue,
    itemToString,
    value = $bindable(''),
    onchange,
    label,
    placeholder,
    pickerTitle,
    columns,
    searchText,
    emptyLabel,
    storageKey,
    pickerLabel,
    disabled = false,
  }: Props = $props();

  let open = $state(false);

  function set(next: string) {
    if (next === value) return;
    value = next;
    onchange?.(next);
  }
</script>

<div class="picker-combobox">
  <div class="picker-combobox-input">
    <Combobox
      {id}
      {items}
      {itemToValue}
      {itemToString}
      {label}
      {placeholder}
      {disabled}
      bind:value
      onValueChange={(v) => onchange?.(v)}
    />
  </div>
  <Button
    type="button"
    variant="outline"
    size="sm"
    shape="icon"
    class="picker-combobox-open"
    aria-haspopup="dialog"
    aria-label={pickerLabel ?? pickerTitle}
    {disabled}
    onclick={() => (open = true)}
  >
    <ListFilter size={iconSizes.sm} aria-hidden="true" />
  </Button>
</div>

<Picker
  bind:open
  title={pickerTitle}
  {columns}
  rows={items}
  getRowId={itemToValue}
  searchText={searchText ?? itemToString}
  onPick={(row) => set(itemToValue(row))}
  selectionMode="single"
  searchPlaceholder={pickerTitle}
  {emptyLabel}
  {storageKey}
/>

<style>
  .picker-combobox {
    display: flex;
    align-items: flex-end;
    gap: var(--space-1);
  }
  .picker-combobox-input {
    flex: 1;
    min-width: 0;
  }
  /* Match the combobox control height (input padding + 1px border). */
  .picker-combobox :global(.picker-combobox-open) {
    height: var(--control-height-md);
    width: var(--control-height-md);
    flex-shrink: 0;
  }
</style>
