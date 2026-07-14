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
  import { Popover } from '$lib/components/ui';

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

  let {
    label,
    options,
    selected,
    onToggle,
    onClear,
    allLabel = 'All',
    class: cls = '',
  }: Props = $props();

  let open = $state(false);

  const selectedOptions = $derived(options.filter((o) => selected.has(o.value)));
  const count = $derived(selected.size);
</script>

<div class="flex items-center gap-1.5 flex-wrap {cls}">
  <!-- Trigger + popover panel (Zag handles outside-click / Escape dismissal) -->
  <Popover bind:open placement="bottom" bare>
    {#snippet trigger()}
      <span
        aria-haspopup="listbox"
        aria-expanded={open}
        class="flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-md border text-[length:var(--font-size-caption)] font-medium cursor-pointer transition-colors
          {count > 0
          ? 'border-accent/40 bg-accent/10 text-foreground'
          : 'border-border bg-bg3/60 text-muted-foreground hover:text-foreground hover:border-[var(--color-border-strong)]'}"
      >
        <span class="uppercase tracking-wide text-[length:var(--font-size-telemetry)] font-semibold"
          >{label}</span
        >
        {#if count > 0}
          <span
            class="rounded-full bg-accent/20 text-accent px-1.5 text-[length:var(--font-size-telemetry)] tabular-nums leading-[1.4]"
            >{count}</span
          >
        {:else}
          <span class="text-muted-strong text-[length:var(--font-size-telemetry)]">{allLabel}</span>
        {/if}
        <ChevronDown size={12} class="shrink-0 transition-transform {open ? 'rotate-180' : ''}" />
      </span>
    {/snippet}

    <div
      role="listbox"
      aria-multiselectable="true"
      class="min-w-[180px] max-h-[280px] overflow-y-auto
        rounded-lg border border-border bg-bg2 shadow-[var(--shadow-overlay)] p-1"
    >
      <!-- "All" = the empty-selection state (everything shown). Mutually exclusive
           with individual picks: choosing it clears specific selections, and
           picking any option drops out of "All" automatically. -->
      <button
        type="button"
        role="option"
        aria-selected={count === 0}
        class="flex items-center w-full gap-2 px-2 py-1.5 rounded text-[length:var(--font-size-caption)] cursor-pointer transition-colors
          {count === 0
          ? 'text-foreground bg-bg3/60'
          : 'text-muted-foreground hover:text-foreground hover:bg-bg3'}"
        onclick={onClear}
      >
        <span
          class="flex items-center justify-center w-3.5 h-3.5 rounded-sm border shrink-0 {count ===
          0
            ? 'bg-accent border-accent'
            : 'border-border'}"
        >
          {#if count === 0}<Check size={10} class="text-bg" />{/if}
        </span>
        <span class="flex-1 text-left font-medium">{allLabel}</span>
      </button>
      <div class="my-1 h-px bg-border"></div>
      {#each options as opt (opt.value)}
        {@const isSel = selected.has(opt.value)}
        <button
          type="button"
          role="option"
          aria-selected={isSel}
          class="flex items-center w-full gap-2 px-2 py-1.5 rounded text-[length:var(--font-size-caption)] cursor-pointer transition-colors
            {isSel
            ? 'text-foreground bg-bg3/60'
            : 'text-muted-foreground hover:text-foreground hover:bg-bg3'}"
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
            <span
              class="text-[length:var(--font-size-telemetry)] text-muted-strong tabular-nums shrink-0"
              >{opt.count}</span
            >
          {/if}
        </button>
      {/each}
    </div>
  </Popover>

  <!-- Applied pills -->
  {#each selectedOptions as opt (opt.value)}
    <span
      class="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md text-[length:var(--font-size-telemetry)] font-semibold border"
      style={opt.color
        ? `background:${opt.color}1f;color:${opt.color};border-color:${opt.color}55`
        : 'background:var(--color-bg3);border-color:var(--color-border)'}
    >
      {opt.label}
      <button
        type="button"
        aria-label={`Remove ${opt.label}`}
        class="flex items-center justify-center w-3.5 h-3.5 rounded-sm hover:bg-foreground/15 cursor-pointer transition-colors"
        onclick={() => onToggle(opt.value)}
      >
        <X size={10} />
      </button>
    </span>
  {/each}
</div>
