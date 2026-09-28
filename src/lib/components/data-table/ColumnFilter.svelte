<script lang="ts">
  import { Button, iconSizes } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { Check, ChevronDown } from 'lucide-svelte';
  import type { Snippet } from 'svelte';
  import { emptyFilter, isFilterActive, type FilterKind, type FilterValue } from './filters';

  type Option = { value: string; label: string };
  let {
    label,
    options = [],
    selected = $bindable(new Set<string>()),
    align = 'left',
    optionIcon,
    onSelect,
    kind = 'enum',
    value = null,
    onValue,
  }: {
    label: string;
    /** Enum kind only: the option list. */
    options?: Option[];
    /** Enum kind only. Empty set = "All". Non-empty = only those values. */
    selected?: Set<string>;
    align?: 'left' | 'right';
    optionIcon?: Snippet<[string]>;
    /** Fires with the new set when the selection changes. Use instead of
     *  `bind:selected` when the set isn't a bindable variable (e.g. derived). */
    onSelect?: (s: Set<string>) => void;
    /** `enum` (default) = multi-select. `text` = contains. `number`/`date` = an
     *  inclusive min/max range. */
    kind?: FilterKind;
    /** Current value for a non-enum kind. */
    value?: FilterValue | null;
    /** Fires with the new value for a non-enum kind. */
    onValue?: (v: FilterValue) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  const active = $derived(kind === 'enum' ? selected.size > 0 : isFilterActive(value));
  const text = $derived(value?.kind === 'text' ? value.text : '');
  const min = $derived(value && value.kind !== 'enum' && value.kind !== 'text' ? value.min : null);
  const max = $derived(value && value.kind !== 'enum' && value.kind !== 'text' ? value.max : null);
  const rangeType = $derived(kind === 'date' ? 'date' : 'number');

  function emitText(next: string) {
    onValue?.({ kind: 'text', text: next });
  }
  /** A blank input clears that bound; both blank ⇒ the filter is inert. */
  function emitRange(bound: 'min' | 'max', raw: string) {
    const other = bound === 'min' ? max : min;
    const parse = (v: string) =>
      v === '' ? null : kind === 'date' ? v : Number.isFinite(Number(v)) ? Number(v) : null;
    const nextBound = parse(raw);
    const pair = bound === 'min' ? [nextBound, other] : [other, nextBound];
    onValue?.(
      kind === 'date'
        ? {
            kind: 'date',
            min: (pair[0] ?? null) as string | null,
            max: (pair[1] ?? null) as string | null,
          }
        : {
            kind: 'number',
            min: (pair[0] ?? null) as number | null,
            max: (pair[1] ?? null) as number | null,
          },
    );
  }
  function clearValue() {
    onValue?.(emptyFilter(kind));
  }

  function commit(next: Set<string>) {
    selected = next;
    onSelect?.(next);
  }
  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    commit(next);
  }
  function clearAll() {
    commit(new Set());
  }

  // Outside-click dismissal via a document listener. The previous fixed-inset
  // backdrop element could not work here: this component lives inside the
  // table's sticky <thead>, whose backdrop-filter makes it the containing
  // block for position:fixed descendants — the "viewport" backdrop only ever
  // covered the header strip.
  function onDocPointerDown(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') open = false;
  }
</script>

<svelte:document onpointerdown={onDocPointerDown} onkeydown={onDocKeydown} />

<div class="cf" bind:this={root}>
  <Button
    variant="ghost"
    size="xs"
    class="head {active ? 'active' : ''}"
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span>{label}</span>
    {#if active}<span class="badge" class:dot={kind !== 'enum'}
        >{kind === 'enum' ? selected.size : ''}</span
      >{/if}
    <ChevronDown size={iconSizes.xs} class="chev {open ? 'flip' : ''}" />
  </Button>

  {#if open && kind !== 'enum'}
    <!-- Non-enum kinds: `text` is a case-insensitive contains, `number`/`date`
         an inclusive min/max range (both endpoints are IN the result). -->
    <div class="pop pop-form" class:right={align === 'right'}>
      {#if kind === 'text'}
        <input
          class="cf-inp"
          type="search"
          value={text}
          aria-label={m.data_table_filter_contains()}
          placeholder={m.data_table_filter_contains()}
          oninput={(e) => emitText(e.currentTarget.value)}
        />
      {:else}
        <label class="cf-field">
          <span class="cf-lbl">{m.data_table_filter_min()}</span>
          <input
            class="cf-inp"
            type={rangeType}
            step={kind === 'number' ? 'any' : undefined}
            value={min ?? ''}
            oninput={(e) => emitRange('min', e.currentTarget.value)}
          />
        </label>
        <label class="cf-field">
          <span class="cf-lbl">{m.data_table_filter_max()}</span>
          <input
            class="cf-inp"
            type={rangeType}
            step={kind === 'number' ? 'any' : undefined}
            value={max ?? ''}
            oninput={(e) => emitRange('max', e.currentTarget.value)}
          />
        </label>
      {/if}
      <Button variant="ghost" size="xs" class="row" disabled={!active} onclick={clearValue}>
        <span class="lbl">{m.data_table_filter_clear()}</span>
      </Button>
    </div>
  {:else if open}
    <div class="pop" class:right={align === 'right'} role="listbox" aria-multiselectable="true">
      <Button
        variant="ghost"
        size="xs"
        class="row"
        role="option"
        aria-selected={!active}
        onclick={clearAll}
      >
        <span class="box" class:on={!active}
          >{#if !active}<Check size={iconSizes.xs} />{/if}</span
        >
        <span class="lbl">{m.crm_filter_all()}</span>
      </Button>
      <div class="sep"></div>
      {#each options as o (o.value)}
        <Button
          variant="ghost"
          size="xs"
          class="row"
          role="option"
          aria-selected={selected.has(o.value)}
          onclick={() => toggle(o.value)}
        >
          <span class="box" class:on={selected.has(o.value)}>
            {#if selected.has(o.value)}<Check size={iconSizes.xs} />{/if}
          </span>
          {#if optionIcon}{@render optionIcon(o.value)}{/if}
          <span class="lbl">{o.label}</span>
        </Button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cf {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }
  /* Header-first trigger: inherits the th's .t-label typography; the only
     affordance is the chevron. Strips the Button primitive's control chrome
     so the header row height never inflates. */
  .cf :global(.head) {
    height: auto;
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .cf :global(.head > span) {
    gap: var(--space-1);
  }
  .cf :global(.head:hover) {
    background: transparent;
    color: var(--color-foreground);
  }
  .cf :global(.head.active) {
    color: var(--color-accent);
  }
  .badge {
    font-size: var(--font-size-telemetry);
    min-width: 1rem;
    height: 1rem;
    padding: 0 0.2rem;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    color: var(--color-on-accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  :global(.cf .chev) {
    transition: transform var(--duration-fast);
    opacity: 0.6;
  }
  :global(.cf .chev.flip) {
    transform: rotate(180deg);
  }
  .pop {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    z-index: var(--layer-dropdown);
    min-width: 11rem;
    max-height: 16rem;
    overflow: auto;
    background: var(--color-overlay);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-1);
  }
  .pop.right {
    left: auto;
    right: 0;
  }
  /* text / range kinds: a small form instead of an option list */
  .pop-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 12rem;
  }
  .cf-field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .cf-lbl {
    flex: 0 0 2.5rem;
    font-size: var(--font-size-label);
    color: var(--color-muted-foreground);
  }
  .cf-inp {
    flex: 1;
    min-width: 0;
    height: 1.65rem;
    padding: 0 var(--space-2);
    font-size: var(--font-size-body);
    font-weight: 400;
    color: var(--color-foreground);
    background: var(--color-surface-2);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
  }
  .cf-inp:focus {
    outline: none;
    border-color: var(--color-accent);
  }
  .badge.dot {
    min-width: 0.5rem;
    width: 0.5rem;
    height: 0.5rem;
    padding: 0;
  }
  /* Option rows: checkbox + label on one line, identical height per row.
     Anchored :global() because `row` is forwarded to Button (see .head). */
  .cf :global(.row) {
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
    letter-spacing: normal;
    color: var(--color-foreground);
    cursor: pointer;
    text-align: left;
  }
  .cf :global(.row > span) {
    width: 100%;
    justify-content: flex-start;
    gap: var(--space-2);
  }
  .cf :global(.row:hover) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  /* Same selection-control contract as DataTable's row checkboxes: fixed 1rem
     box in both states, strong border on a raised surface when unchecked. */
  .box {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 1rem;
    height: 1rem;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-2);
    color: transparent;
  }
  .box.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-on-accent);
  }
  .lbl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sep {
    height: 1px;
    background: var(--hairline);
    margin: var(--space-1) 0;
  }
</style>
