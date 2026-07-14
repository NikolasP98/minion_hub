<script lang="ts">
  import { Button } from '$lib/components/ui';

  import * as m from '$lib/paraglide/messages';
  import { ChevronDown } from 'lucide-svelte';
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
</script>

<div class="cf">
  <Button class="head {active ? 'active' : ''}" onclick={() => (open = !open)}>
    <span>{label}</span>
    {#if active}<span class="badge">{selected.size}</span>{/if}
    <ChevronDown size={12} class="chev {open ? 'flip' : ''}" />
  </Button>

  {#if open}
    <!-- backdrop closes on outside click -->
    <Button class="backdrop" aria-label="close" onclick={() => (open = false)}></Button>
    <div class="pop" class:right={align === 'right'}>
      <Button class="row {!active ? 'sel' : ''}" onclick={clearAll}>
        <span class="box" class:on={!active}></span>
        <span class="lbl">{m.crm_filter_all()}</span>
      </Button>
      <div class="sep"></div>
      {#each options as o (o.value)}
        <Button class="row {selected.has(o.value) ? 'sel' : ''}" onclick={() => toggle(o.value)}>
          <span class="box" class:on={selected.has(o.value)}></span>
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
  }
  .cf :global(.head) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font: inherit;
    color: inherit;
    cursor: pointer;
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
    color: var(--color-accent-foreground);
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
  .cf :global(.backdrop) {
    position: fixed;
    inset: 0;
    z-index: var(--layer-popover);
    background: transparent;
    cursor: default;
  }
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: var(--layer-modal);
    min-width: 11rem;
    max-height: 16rem;
    overflow: auto;
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-elevation-2);
    padding: var(--space-1);
  }
  .pop.right {
    left: auto;
    right: 0;
  }
  .cf :global(.row) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm, 6px);
    font-size: var(--font-size-body);
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    color: var(--color-foreground);
    cursor: pointer;
    text-align: left;
  }
  .cf :global(.row):hover {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .box {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    border: 1.5px solid var(--color-muted-foreground);
  }
  .box.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .lbl {
    flex: 1;
  }
  .sep {
    height: 1px;
    background: var(--hairline);
    margin: var(--space-1) 0;
  }
</style>
