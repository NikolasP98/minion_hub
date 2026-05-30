<script lang="ts" module>
  export type MultiSelectOption = {
    value: string;
    label: string;
    /** Optional swatch colour (drives the dot + pill tint). */
    color?: string;
    /** Optional count shown after the label in the popover. */
    count?: number;
  };
</script>

<script lang="ts">
  import { ChevronDown, X, Check } from 'lucide-svelte';

  // Multi-select filter: a compact dropdown trigger that opens a checkbox
  // popover, with the applied selections rendered as removable pills inline
  // next to the trigger. Purely presentational — selection state and
  // persistence live in the parent (driven via onToggle/onClear callbacks),
  // so nothing selected = no pills = "show everything".
  interface Props {
    label: string;
    options: MultiSelectOption[];
    /** Currently-applied values. */
    selected: Set<string>;
    onToggle: (value: string) => void;
    onClear: () => void;
    /** Shown muted inside the trigger when nothing is selected. */
    allLabel?: string;
    class?: string;
  }

  let { label, options, selected, onToggle, onClear, allLabel = 'All', class: cls = '' }: Props =
    $props();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);

  const selectedOptions = $derived(options.filter((o) => selected.has(o.value)));
  const count = $derived(selected.size);

  function onWindowPointer(e: MouseEvent) {
    if (open && rootEl && !rootEl.contains(e.target as Node)) open = false;
  }
  function onWindowKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) open = false;
  }
</script>

<svelte:window onclick={onWindowPointer} onkeydown={onWindowKey} />

<div bind:this={rootEl} class="relative flex items-center gap-1.5 flex-wrap {cls}">
  <!-- Trigger -->
  <button
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    class="flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-md border text-[11px] font-medium cursor-pointer transition-colors
      {count > 0
      ? 'border-accent/40 bg-accent/10 text-foreground'
      : 'border-border bg-bg3/60 text-muted-foreground hover:text-foreground hover:border-white/15'}"
    onclick={() => (open = !open)}
  >
    <span class="uppercase tracking-wide text-[9px] font-semibold">{label}</span>
    {#if count > 0}
      <span class="rounded-full bg-accent/20 text-accent px-1.5 text-[9px] tabular-nums leading-[1.4]"
        >{count}</span
      >
    {:else}
      <span class="text-muted-strong text-[10px]">{allLabel}</span>
    {/if}
    <ChevronDown size={12} class="shrink-0 transition-transform {open ? 'rotate-180' : ''}" />
  </button>

  <!-- Applied pills -->
  {#each selectedOptions as opt (opt.value)}
    <span
      class="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md text-[10px] font-semibold border"
      style={opt.color
        ? `background:${opt.color}1f;color:${opt.color};border-color:${opt.color}55`
        : 'background:var(--color-bg3);border-color:var(--color-border)'}
    >
      {opt.label}
      <button
        type="button"
        aria-label={`Remove ${opt.label}`}
        class="flex items-center justify-center w-3.5 h-3.5 rounded-sm hover:bg-white/15 cursor-pointer transition-colors"
        onclick={() => onToggle(opt.value)}
      >
        <X size={10} />
      </button>
    </span>
  {/each}

  <!-- Popover -->
  {#if open}
    <div
      role="listbox"
      aria-multiselectable="true"
      class="absolute left-0 top-full mt-1.5 z-50 min-w-[180px] max-h-[280px] overflow-y-auto
        rounded-lg border border-border bg-bg2 shadow-[0_8px_24px_rgba(0,0,0,0.5)] p-1"
    >
      {#if count > 0}
        <button
          type="button"
          class="flex items-center w-full gap-2 px-2 py-1.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-bg3 cursor-pointer transition-colors"
          onclick={onClear}
        >
          <X size={12} class="shrink-0" />
          {allLabel}
        </button>
        <div class="my-1 h-px bg-border"></div>
      {/if}
      {#each options as opt (opt.value)}
        {@const isSel = selected.has(opt.value)}
        <button
          type="button"
          role="option"
          aria-selected={isSel}
          class="flex items-center w-full gap-2 px-2 py-1.5 rounded text-[11px] cursor-pointer transition-colors
            {isSel ? 'text-foreground bg-bg3/60' : 'text-muted-foreground hover:text-foreground hover:bg-bg3'}"
          onclick={() => onToggle(opt.value)}
        >
          <span
            class="flex items-center justify-center w-3.5 h-3.5 rounded-sm border shrink-0 {isSel
              ? 'bg-accent border-accent'
              : 'border-border'}"
          >
            {#if isSel}<Check size={10} class="text-bg" />{/if}
          </span>
          {#if opt.color}
            <span class="w-2 h-2 rounded-full shrink-0" style:background={opt.color}></span>
          {/if}
          <span class="flex-1 text-left truncate">{opt.label}</span>
          {#if opt.count !== undefined}
            <span class="text-[9px] text-muted-strong tabular-nums shrink-0">{opt.count}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
