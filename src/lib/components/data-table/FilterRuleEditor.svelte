<script lang="ts">
  import { Button, Input, Select, iconSizes } from '$lib/components/ui';
  import { Check } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import type { Snippet } from 'svelte';
  import {
    defaultOp,
    opNeedsOperand,
    opsFor,
    type FilterKind,
    type FilterValue,
    type RelativeDate,
  } from './filters';
  import { opLabel, relLabel } from './filter-ops';

  type Option = { value: string; label: string };

  let {
    kind,
    options = [],
    value,
    onValue,
    optionIcon,
    operandOnly = false,
  }: {
    kind: FilterKind;
    /** Enum kind only: the option list. */
    options?: Option[];
    value: FilterValue;
    onValue: (v: FilterValue) => void;
    optionIcon?: Snippet<[string]>;
    /** Hide the op row — the host (e.g. the advanced builder) renders its own. */
    operandOnly?: boolean;
  } = $props();

  const op = $derived(value.op ?? defaultOp(kind));
  const opOptions = $derived(opsFor(kind).map((o) => ({ value: o, label: opLabel(kind, o) })));
  const REL_ORDER: RelativeDate[] = [
    'today',
    'yesterday',
    'tomorrow',
    'this_week',
    'past_week',
    'past_month',
    'past_year',
    'next_week',
    'next_month',
  ];
  const relOptions = REL_ORDER.map((r) => ({ value: r, label: relLabel(r) }));

  let search = $state('');
  const filteredOptions = $derived(
    search.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()))
      : options,
  );

  function setOp(nextOp: string) {
    if (kind === 'boolean') {
      onValue({ kind: 'boolean', op: nextOp as 'checked' | 'unchecked' });
      return;
    }
    onValue({ ...value, op: nextOp } as FilterValue);
  }

  function toggleEnumValue(v: string) {
    if (value.kind !== 'enum') return;
    const has = value.values.includes(v);
    onValue({ ...value, values: has ? value.values.filter((x) => x !== v) : [...value.values, v] });
  }
  function setText(text: string) {
    if (value.kind !== 'text') return;
    onValue({ ...value, text });
  }
  function setNumberBound(bound: 'min' | 'max', raw: string) {
    if (value.kind !== 'number') return;
    const n = raw === '' ? null : Number.isFinite(Number(raw)) ? Number(raw) : null;
    onValue({ ...value, [bound]: n });
  }
  function setDateBound(bound: 'min' | 'max', raw: string) {
    if (value.kind !== 'date') return;
    onValue({ ...value, [bound]: raw === '' ? null : raw });
  }
  function setRel(rel: string) {
    if (value.kind !== 'date') return;
    onValue({ ...value, rel: rel as RelativeDate });
  }
</script>

<div class="fre">
  {#if !operandOnly}
    <Select
      size="xs"
      value={op}
      options={opOptions}
      aria-label={m.data_table_filter_operator()}
      onchange={(v) => setOp(String(v))}
    />
  {/if}

  {#if opNeedsOperand(kind, op)}
    <div class="fre-operand">
      {#if kind === 'enum' && value.kind === 'enum'}
        {@const enumValue = value}
        <input
          class="fre-search"
          type="search"
          placeholder={m.data_table_filter_search()}
          aria-label={m.data_table_filter_search()}
          bind:value={search}
        />
        <div class="fre-list" role="listbox" aria-multiselectable="true">
          {#each filteredOptions as o (o.value)}
            <Button
              variant="ghost"
              size="xs"
              class="fre-row"
              role="option"
              aria-selected={enumValue.values.includes(o.value)}
              onclick={() => toggleEnumValue(o.value)}
            >
              <span class="fre-box" class:on={enumValue.values.includes(o.value)}>
                {#if enumValue.values.includes(o.value)}<Check size={iconSizes.xs} />{/if}
              </span>
              {#if optionIcon}{@render optionIcon(o.value)}{/if}
              <span class="fre-lbl">{o.label}</span>
            </Button>
          {/each}
        </div>
      {:else if kind === 'text' && value.kind === 'text'}
        {@const textValue = value}
        <Input
          size="sm"
          type="text"
          value={textValue.text}
          aria-label={m.data_table_filter_operand()}
          oninput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        />
      {:else if kind === 'number' && value.kind === 'number'}
        {@const numberValue = value}
        <div class="fre-pair">
          <Input
            size="sm"
            type="number"
            value={numberValue.min == null ? '' : String(numberValue.min)}
            aria-label={op === 'between'
              ? m.data_table_filter_min()
              : m.data_table_filter_operand()}
            oninput={(e) => setNumberBound('min', (e.currentTarget as HTMLInputElement).value)}
          />
          {#if op === 'between'}
            <span class="fre-and">{m.data_table_filter_and()}</span>
            <Input
              size="sm"
              type="number"
              value={numberValue.max == null ? '' : String(numberValue.max)}
              aria-label={m.data_table_filter_max()}
              oninput={(e) => setNumberBound('max', (e.currentTarget as HTMLInputElement).value)}
            />
          {/if}
        </div>
      {:else if kind === 'date' && value.kind === 'date'}
        {@const dateValue = value}
        {#if op === 'relative'}
          <Select
            size="xs"
            value={dateValue.rel ?? ''}
            options={relOptions}
            aria-label={m.data_table_filter_operand()}
            onchange={(v) => setRel(String(v))}
          />
        {:else}
          <div class="fre-pair">
            <input
              class="fre-date"
              type="date"
              value={dateValue.min ?? ''}
              aria-label={op === 'between'
                ? m.data_table_filter_min()
                : m.data_table_filter_operand()}
              oninput={(e) => setDateBound('min', (e.currentTarget as HTMLInputElement).value)}
            />
            {#if op === 'between'}
              <span class="fre-and">{m.data_table_filter_and()}</span>
              <input
                class="fre-date"
                type="date"
                value={dateValue.max ?? ''}
                aria-label={m.data_table_filter_max()}
                oninput={(e) => setDateBound('max', (e.currentTarget as HTMLInputElement).value)}
              />
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .fre {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 14rem;
  }
  .fre-operand {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .fre-pair {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .fre-and {
    font-size: var(--font-size-label);
    color: var(--color-text-secondary);
    flex-shrink: 0;
  }
  .fre-search {
    height: 1.65rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .fre-search:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .fre-date {
    flex: 1;
    min-width: 0;
    height: 1.65rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body);
    color: var(--color-text-primary);
    background: var(--color-surface-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .fre-date:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .fre-list {
    display: flex;
    flex-direction: column;
    max-height: 14rem;
    overflow: auto;
  }
  /* Forwarded to Button (see governance's "inner-span trap"): the outer
     rule targets the button root, the `> span` rule targets its inner row. */
  .fre :global(.fre-row) {
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
  .fre :global(.fre-row > span) {
    width: 100%;
    justify-content: flex-start;
    gap: var(--space-2);
  }
  .fre :global(.fre-row:hover) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .fre-box {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-2);
    color: transparent;
  }
  .fre-box.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-on-accent);
  }
  .fre-lbl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
