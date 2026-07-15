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

  const statusColor: Record<ChipStatus, string> = {
    success: 'var(--color-success-fg)',
    warning: 'var(--color-warning-fg)',
    danger: 'var(--color-danger-fg)',
    info: 'var(--color-info-fg)',
  };
</script>

<span class={`chip ${cls}`}>
  {#if status}
    <span
      class="size-1.5 shrink-0 rounded-full"
      style:background-color={statusColor[status]}
    ></span>
  {/if}
  {@render children()}
  {#if count !== undefined}
    <span class="t-mono">{count}</span>
  {/if}
  {#if onRemove}
    <button
      type="button"
      class="inline-flex shrink-0 items-center justify-center rounded-full transition-colors-fast hover:text-foreground"
      aria-label={m.chip_remove()}
      onclick={onRemove}
    >
      <X size={iconSizes.xs} />
    </button>
  {/if}
</span>
