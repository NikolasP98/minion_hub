<script lang="ts">
  import { canAct } from '$lib/access/can.svelte';
  import { Picker, type PickerColumn, type PickerDuplicatePolicy } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import StockItemCreateForm, { type StockItemOption } from './StockItemCreateForm.svelte';

  let {
    open = $bindable(false),
    items,
    onPick,
    onUnpick,
    title = m.stock_add_items(),
    subtitle,
    selectionMode = 'single',
    duplicatePolicy = 'prevent',
    pickedIds,
    columns,
    columnsConfigurable = false,
    allowCreate = true,
    storageKey,
    filter,
  }: {
    open?: boolean;
    items: StockItemOption[];
    onPick: (item: StockItemOption) => void;
    /** Supply to make picked rows removable from inside the picker. */
    onUnpick?: (item: StockItemOption) => void;
    title?: string;
    subtitle?: string;
    selectionMode?: 'single' | 'multiple';
    duplicatePolicy?: PickerDuplicatePolicy;
    pickedIds?: ReadonlySet<string>;
    columns?: PickerColumn<StockItemOption>[];
    columnsConfigurable?: boolean;
    allowCreate?: boolean;
    storageKey?: string;
    filter?: (item: StockItemOption) => boolean;
  } = $props();

  const defaultColumns: PickerColumn<StockItemOption>[] = [
    {
      key: 'code',
      label: m.stock_col_code(),
      priority: 10,
      hideable: false,
      searchable: true,
    },
    {
      key: 'name',
      label: m.stock_col_name(),
      priority: 20,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
    {
      key: 'uom',
      label: m.stock_col_uom(),
      priority: 30,
      searchable: true,
    },
    {
      key: 'itemGroup',
      label: m.stock_col_group(),
      value: (item) => item.itemGroup ?? '',
      priority: 40,
      defaultHidden: true,
      searchable: true,
    },
  ];

  let createdItems = $state<StockItemOption[]>([]);
  const availableItems = $derived.by(() => {
    const merged = new Map<string, StockItemOption>();
    for (const item of [...createdItems, ...items]) merged.set(item.id, item);
    const result = [...merged.values()];
    return filter ? result.filter(filter) : result;
  });
  const resolvedColumns = $derived(columns ?? defaultColumns);
  const canCreate = $derived(allowCreate && canAct('stock', 'create'));

  function handleCreated(item: StockItemOption, complete: (item: StockItemOption) => void) {
    createdItems = [item, ...createdItems.filter((candidate) => candidate.id !== item.id)];
    complete(item);
  }
</script>

{#snippet createItemForm(context: {
  oncreated: (item: StockItemOption) => void;
  oncancel: () => void;
})}
  <StockItemCreateForm
    oncreated={(item) => handleCreated(item, context.oncreated)}
    oncancel={context.oncancel}
  />
{/snippet}

<Picker
  bind:open
  {title}
  {subtitle}
  columns={resolvedColumns}
  rows={availableItems}
  getRowId={(item) => item.id}
  searchText={(item) => `${item.code} ${item.name} ${item.uom} ${item.itemGroup ?? ''}`}
  {onPick}
  {onUnpick}
  {selectionMode}
  {duplicatePolicy}
  {pickedIds}
  {columnsConfigurable}
  searchPlaceholder={m.stock_search_items()}
  emptyLabel={m.stock_items_empty()}
  {storageKey}
  create={canCreate
    ? {
        label: m.stock_new_item(),
        tabLabel: m.stock_create_item_title(),
        form: createItemForm,
      }
    : undefined}
/>
