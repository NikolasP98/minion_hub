<script lang="ts">
  import { Button } from '$lib/components/ui';
// Custom tristate checkbox — terminal/monospace aesthetic, amber accent.
  // Three states: "off" (empty box), "on" (filled box + check), "mixed"
  // (filled box + dash). Implemented as a button so the indeterminate state
  // is just data; no DOM-level `indeterminate` IDL property to wrangle.
  let {
    state,
    onchange,
    label,
    size = 14,
  }: {
    state: "off" | "on" | "mixed";
    onchange: () => void;
    label: string;
    size?: number;
  } = $props();
</script>

<Button variant="ghost"
  type="button"
  role="checkbox"
  aria-checked={state === "on" ? "true" : state === "mixed" ? "mixed" : "false"}
  aria-label={label}
  onclick={(e) => {
    e.stopPropagation();
    onchange();
  }}
  class="relative shrink-0 inline-flex items-center justify-center rounded-[var(--radius-xs)] border transition-all
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-0
    {state === 'off'
      ? 'border-border bg-bg2 hover:border-fg/40 hover:bg-bg3'
      : 'border-accent bg-accent text-bg shadow-[var(--shadow-focus)]'}"
  style="width: {size}px; height: {size}px;"
>
  {#if state === "on"}
    <svg viewBox="0 0 14 14" class="w-full h-full p-[var(--space-0-5)]" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7.5 L6 10.5 L11 4" />
    </svg>
  {:else if state === "mixed"}
    <svg viewBox="0 0 14 14" class="w-full h-full p-[var(--space-0-5)]" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <path d="M3.5 7 L10.5 7" />
    </svg>
  {/if}
</Button>
