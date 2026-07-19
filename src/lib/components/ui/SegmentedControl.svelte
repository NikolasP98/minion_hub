<script lang="ts" module>
  export type SegmentItem = {
    value: string;
    label: string;
    disabled?: boolean;
    /** Tooltip (e.g. why a disabled option is unavailable). */
    title?: string;
  };
  export type SegmentedSize = 'sm' | 'md';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  // Canonical segmented control: a bordered pill group where the active option is
  // an accent-TINTED pill with accent text (never a full accent fill — that's a
  // primary-action style). The single default for dashboard toggles + range/period
  // pickers. See UI-governance "segmented control" contract.
  interface Props {
    items: SegmentItem[];
    /** Bindable active value. */
    value?: string;
    size?: SegmentedSize;
    class?: string;
    'aria-label': string;
    onValueChange?: (value: string) => void;
    /** Forwarded so callers can open an extended-range menu on right-click. */
    oncontextmenu?: (e: MouseEvent) => void;
    /** Non-selectable content rendered inside the group at the end (e.g. a menu
     *  trigger). Divided from the options. */
    trailing?: Snippet;
  }

  let {
    items,
    value = $bindable(items[0]?.value ?? ''),
    size = 'sm',
    class: cls = '',
    'aria-label': ariaLabel,
    onValueChange,
    oncontextmenu,
    trailing,
  }: Props = $props();

  function select(v: string, disabled?: boolean) {
    if (disabled || v === value) return;
    value = v;
    onValueChange?.(v);
  }
</script>

<div class="seg {size} {cls}" role="group" aria-label={ariaLabel} {oncontextmenu}>
  {#each items as it (it.value)}
    <button
      type="button"
      class="seg-btn"
      class:active={it.value === value}
      aria-pressed={it.value === value}
      disabled={it.disabled}
      title={it.title}
      onclick={() => select(it.value, it.disabled)}>{it.label}</button
    >
  {/each}
  {#if trailing}
    <span class="seg-div" aria-hidden="true"></span>
    {@render trailing()}
  {/if}
</div>

<style>
  .seg {
    display: inline-flex;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--color-border, var(--hairline));
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
  }
  .seg-btn {
    padding: var(--space-1) var(--space-3);
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-caption);
    font-weight: 500;
    color: var(--color-text-secondary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  .seg.md .seg-btn {
    padding: var(--space-1) var(--space-4);
    font-size: var(--font-size-body);
  }
  .seg-btn:hover:not(:disabled):not(.active) {
    color: var(--color-text-primary);
  }
  .seg-btn.active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    font-weight: 600;
  }
  .seg-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .seg-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
  /* Divider before a trailing (non-selectable) affordance. */
  .seg-div {
    width: 1px;
    align-self: stretch;
    margin: var(--space-0-5) var(--space-0-5);
    background: var(--color-border, var(--hairline));
  }
</style>
