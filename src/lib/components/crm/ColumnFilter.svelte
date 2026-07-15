<script lang="ts">
  import { Button, iconSizes } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { Check, ChevronDown } from 'lucide-svelte';
  import type { Snippet } from 'svelte';

  type Option = { value: string; label: string };
  let {
    label,
    options,
    selected = $bindable(),
    align = 'left',
    optionIcon,
    onSelect,
  }: {
    label: string;
    options: Option[];
    /** Empty set = "All". Non-empty = only those values. */
    selected: Set<string>;
    align?: 'left' | 'right';
    optionIcon?: Snippet<[string]>;
    /** Fires with the new set when the selection changes. Use instead of
     *  `bind:selected` when the set isn't a bindable variable (e.g. derived). */
    onSelect?: (s: Set<string>) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  const active = $derived(selected.size > 0);

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
    {#if active}<span class="badge">{selected.size}</span>{/if}
    <ChevronDown size={iconSizes.xs} class="chev {open ? 'flip' : ''}" />
  </Button>

  {#if open}
    <div class="pop" class:right={align === 'right'} role="listbox" aria-multiselectable="true">
      <Button
        variant="ghost"
        size="xs"
        class="row"
        role="option"
        aria-selected={!active}
        onclick={clearAll}
      >
        <span class="box" class:on={!active}>{#if !active}<Check size={iconSizes.xs} />{/if}</span>
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
