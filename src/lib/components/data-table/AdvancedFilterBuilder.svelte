<script lang="ts">
  import { Button, Dropdown, Select, iconSizes } from '$lib/components/ui';
  import { ChevronDown, Copy, FolderTree, ListPlus, MoreHorizontal, Trash2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import FilterRuleEditor from './FilterRuleEditor.svelte';
  import Self from './AdvancedFilterBuilder.svelte';
  import { opLabel } from './filter-ops';
  import {
    defaultOp,
    emptyFilter,
    emptyRule,
    isFilterGroup,
    newId,
    opsFor,
    type FilterColumnMeta,
    type FilterGroup,
    type FilterRule,
    type FilterValue,
  } from './filters';

  let {
    group,
    columns,
    onChange,
    onDelete,
  }: {
    group: FilterGroup;
    columns: FilterColumnMeta[];
    onChange: (next: FilterGroup) => void;
    onDelete: () => void;
  } = $props();

  function columnMeta(key: string): FilterColumnMeta | undefined {
    return columns.find((c) => c.key === key);
  }

  function cloneWithIds(item: FilterRule | FilterGroup): FilterRule | FilterGroup {
    if (isFilterGroup(item))
      return { id: newId(), logic: item.logic, items: item.items.map(cloneWithIds) };
    return { id: newId(), key: item.key, value: item.value };
  }

  function replaceItems(items: Array<FilterRule | FilterGroup>) {
    onChange({ ...group, items });
  }

  function setLogic(logic: string) {
    onChange({ ...group, logic: logic === 'or' ? 'or' : 'and' });
  }

  function setItem(index: number, item: FilterRule | FilterGroup) {
    const items = group.items.slice();
    items[index] = item;
    replaceItems(items);
  }

  function fallbackRule(): FilterRule {
    const first = columns[0];
    return first
      ? emptyRule(first.key, first.kind)
      : { id: newId(), key: '', value: emptyFilter('text') };
  }

  function menuAction(index: number, action: string) {
    const items = group.items.slice();
    const item = items[index];
    if (!item) return;
    switch (action) {
      case 'remove':
        items.splice(index, 1);
        replaceItems(items);
        return;
      case 'duplicate':
        items.splice(index + 1, 0, cloneWithIds(item));
        replaceItems(items);
        return;
      case 'turn_into_group':
      case 'wrap_in_group':
        items[index] = { id: newId(), logic: 'and', items: [item] };
        replaceItems(items);
        return;
      case 'turn_into_filter': {
        const inner = isFilterGroup(item) ? item.items[0] : undefined;
        items[index] = inner ?? fallbackRule();
        replaceItems(items);
        return;
      }
    }
  }

  function menuItems(item: FilterRule | FilterGroup) {
    const duplicate = {
      value: 'duplicate',
      label: m.data_table_filter_menu_duplicate(),
      icon: Copy,
    };
    const remove = {
      value: 'remove',
      label: m.data_table_filter_menu_remove(),
      icon: Trash2,
      danger: true,
    };
    if (isFilterGroup(item)) {
      return [
        duplicate,
        {
          value: 'turn_into_filter',
          label: m.data_table_filter_menu_turn_into_filter(),
          icon: ListPlus,
        },
        {
          value: 'wrap_in_group',
          label: m.data_table_filter_menu_wrap_in_group(),
          icon: FolderTree,
        },
        remove,
      ];
    }
    return [
      duplicate,
      {
        value: 'turn_into_group',
        label: m.data_table_filter_menu_turn_into_group(),
        icon: FolderTree,
      },
      remove,
    ];
  }

  function onRuleKeyChange(index: number, item: FilterRule, key: string) {
    const meta = columnMeta(key);
    if (!meta) return;
    setItem(index, {
      ...item,
      key,
      value: { ...emptyFilter(meta.kind), op: defaultOp(meta.kind) } as FilterValue,
    });
  }

  function addRule() {
    replaceItems([...group.items, fallbackRule()]);
  }
  function addGroup() {
    replaceItems([...group.items, { id: newId(), logic: 'and', items: [fallbackRule()] }]);
  }
  const addMenuItems = [
    { value: 'rule', label: m.data_table_filter_add_rule() },
    { value: 'group', label: m.data_table_filter_add_group() },
  ];
  function onAddSelect(v: string) {
    if (v === 'rule') addRule();
    else addGroup();
  }

  const logicOptions = [
    { value: 'and', label: m.data_table_filter_and_label() },
    { value: 'or', label: m.data_table_filter_or_label() },
  ];
</script>

<div class="afb">
  {#each group.items as item, i (item.id)}
    <div class="afb-row">
      <div class="afb-logic">
        {#if i === 0}
          <span class="t-label afb-where">{m.data_table_filter_where()}</span>
        {:else if i === 1}
          <Select
            size="xs"
            value={group.logic}
            options={logicOptions}
            aria-label={m.data_table_filter_logic()}
            onchange={(v) => setLogic(String(v))}
          />
        {:else}
          <span class="t-caption afb-logic-text">
            {group.logic === 'and'
              ? m.data_table_filter_and_label()
              : m.data_table_filter_or_label()}
          </span>
        {/if}
      </div>

      {#if isFilterGroup(item)}
        <div class="afb-group-box">
          <Self
            group={item}
            {columns}
            onChange={(next) => setItem(i, next)}
            onDelete={() => menuAction(i, 'remove')}
          />
        </div>
      {:else}
        {@const meta = columnMeta(item.key)}
        <Select
          size="xs"
          value={item.key}
          options={columns.map((c) => ({ value: c.key, label: c.label }))}
          aria-label={m.data_table_filter_property()}
          onchange={(v) => onRuleKeyChange(i, item, String(v))}
        />
        {#if meta}
          <Select
            size="xs"
            value={item.value.op ?? defaultOp(meta.kind)}
            options={opsFor(meta.kind).map((o) => ({ value: o, label: opLabel(meta.kind, o) }))}
            aria-label={m.data_table_filter_operator()}
            onchange={(v) =>
              setItem(i, { ...item, value: { ...item.value, op: v } as FilterValue })}
          />
          <FilterRuleEditor
            kind={meta.kind}
            options={meta.options}
            value={item.value}
            onValue={(v) => setItem(i, { ...item, value: v })}
            operandOnly
          />
        {/if}
      {/if}

      <Dropdown items={menuItems(item)} onSelect={(v) => menuAction(i, v)}>
        {#snippet trigger()}
          <span class="afb-kebab" aria-label={m.data_table_filter_menu()}>
            <MoreHorizontal size={iconSizes.xs} />
          </span>
        {/snippet}
      </Dropdown>
    </div>
  {/each}

  <div class="afb-footer">
    <Dropdown items={addMenuItems} onSelect={onAddSelect}>
      {#snippet trigger()}
        <span class="afb-add">
          {m.data_table_filter_add_rule_menu()}
          <ChevronDown size={iconSizes.xs} />
        </span>
      {/snippet}
    </Dropdown>
    <Button variant="ghost" size="xs" class="afb-delete" onclick={onDelete}>
      <Trash2 size={iconSizes.xs} />
      {m.data_table_filter_delete()}
    </Button>
  </div>
</div>

<style>
  .afb {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 26rem;
  }
  .afb-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .afb-logic {
    flex: 0 0 4rem;
  }
  .afb-where,
  .afb-logic-text {
    color: var(--color-text-secondary);
  }
  .afb-group-box {
    flex: 1;
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
  }
  .afb-kebab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: var(--space-0-5);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .afb-kebab:hover {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-text-primary);
  }
  .afb-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--hairline);
  }
  .afb-add {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-label);
    color: var(--color-text-secondary);
    cursor: pointer;
  }
  .afb-add:hover {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-text-primary);
  }
  .afb :global(.afb-delete) {
    color: var(--color-danger-fg);
  }
</style>
