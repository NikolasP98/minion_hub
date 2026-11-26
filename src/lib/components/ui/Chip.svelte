<script lang="ts" module>
  export type ChipStatus = 'success' | 'warning' | 'danger' | 'info';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes } from './icon-sizes';

  interface Props {
    /** Leading status dot colored with the matching status-fg token. */
    status?: ChipStatus;
    /** Trailing count, rendered in mono/tabular styling. */
    count?: number;
    /** Renders a trailing × button when provided. */
    onRemove?: () => void;
    class?: string;
    children: Snippet;
  }

  let { status, count, onRemove, class: cls = '', children }: Props = $props();

  // The × is named "Remove <chip text>": its own label plus the chip's label, by id.
  const uid = $props.id();

  const statusColor: Record<ChipStatus, string> = {
    success: 'var(--color-success-fg)',
    warning: 'var(--color-warning-fg)',
    danger: 'var(--color-danger-fg)',
    info: 'var(--color-info-fg)',
  };
</script>

<!-- Pill shape + × mechanics are the shared `.chip`/`.chip-removable`/
     `.chip-label`/`.chip-x` contract in app.css ("Chip
     contract", 2026-09-29) — FilterChip/GroupByPicker/TagChip share it too. -->
<span class="chip {cls}" class:chip-removable={!!onRemove}>
  <span class="chip-label" id="{uid}-label">
    {#if status}
      <span class="size-1.5 shrink-0 rounded-full" style:background-color={statusColor[status]}
      ></span>
    {/if}
    {@render children()}
    {#if count !== undefined}
      <span class="t-mono">{count}</span>
    {/if}
  </span>
  {#if onRemove}
    <button
      type="button"
      class="chip-x"
      id="{uid}-x"
      aria-label={m.chip_remove()}
      aria-labelledby="{uid}-x {uid}-label"
      onclick={onRemove}
    >
      <X size={iconSizes.xs} />
    </button>
  {/if}
</span>
