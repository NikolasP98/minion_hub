<script lang="ts">
  let {
    state,
    label,
    expanded = false,
    status,
    size = 'md',
  }: {
    /** Labeled chip variant. */
    state?: 'active' | 'attention' | 'disabled';
    label?: string;
    expanded?: boolean;
    /** Plain animated-dot variant (ported from the retired decorations/StatusDot). */
    status?: 'running' | 'thinking' | 'idle' | 'aborted';
    /** Plain-dot variant only. */
    size?: 'sm' | 'md' | 'lg';
  } = $props();

  // ── plain-dot variant maps ──
  const sizeMap = { sm: 'w-2 h-2', md: 'w-2.5 h-2.5', lg: 'w-3 h-3' };
  const colorMap = {
    running: 'bg-success',
    thinking: 'bg-[var(--color-status-thinking)]',
    idle: 'bg-muted-foreground',
    aborted: 'bg-warning',
  };
  const glowMap: Record<string, string> = {
    running: 'text-success shadow-[var(--shadow-status-glow)]',
    thinking: 'text-[var(--color-status-thinking)] shadow-[var(--shadow-status-glow)]',
    idle: '',
    aborted: 'text-warning shadow-[var(--shadow-status-glow)]',
  };
  const animMap: Record<string, string> = {
    running: 'animate-[dot-pulse_2s_ease_infinite]',
    thinking: 'animate-[dot-pulse_2s_ease_infinite]',
    idle: '',
    aborted: 'animate-[dot-pulse_1.5s_ease_infinite]',
  };

  const dot = $derived(
    state === 'active' ? 'bg-success' : state === 'attention' ? 'bg-warning' : 'bg-foreground/30',
  );
  const text = $derived(
    state === 'active'
      ? 'text-[var(--color-success-fg)]'
      : state === 'attention'
        ? 'text-[var(--color-warning-fg)]'
        : 'text-foreground/50',
  );
  // expanded → label always visible. Otherwise the label reveals when an
  // ancestor marked `group/card` is hovered (i.e. hovering the whole card),
  // not the chip itself. Margins live on the label so the collapsed chip is a
  // clean, symmetrically-padded dot (no stray right padding).
  // Defensive: also reveal on the pill's OWN hover (`group` on the wrapping
  // span below) so an ancestor refactor that drops `group/card` can't
  // silently kill the affordance again — the pill still works stood alone.
  const reveal = $derived(
    expanded
      ? 'max-w-[10rem] opacity-100 ml-1.5 mr-0.5'
      : 'max-w-0 opacity-0 group-hover:max-w-[10rem] group-hover:opacity-100 group-hover:ml-1.5 group-hover:mr-0.5 group-hover/card:max-w-[10rem] group-hover/card:opacity-100 group-hover/card:ml-1.5 group-hover/card:mr-0.5',
  );
</script>

{#if status}
  <!-- Plain animated dot (no label chrome). -->
  <div class="rounded-full shrink-0 {sizeMap[size]} {colorMap[status]} {glowMap[status]} {animMap[status]}"></div>
{:else}
  <!-- Non-interactive status chip. The label rides aria-label so AT always gets it;
       visually it expands on card hover (or is always shown when `expanded`).
       `group` (unnamed) is scoped to THIS span so its own hover reveals the
       label even without a `group/card` ancestor. -->
  <span
    class="group inline-flex items-center rounded-full bg-foreground/[0.04] p-1 ring-1 ring-border"
    role="img"
    aria-label={label}
  >
    <span class="size-2 shrink-0 rounded-full {dot}"></span>
    <span
      class="sd-label overflow-hidden whitespace-nowrap text-[length:var(--font-size-caption)] font-medium leading-none transition-all duration-[var(--duration-normal)] {reveal} {text}"
      >{label}</span
    >
  </span>
{/if}

<style>
  @media (prefers-reduced-motion: reduce) {
    .sd-label {
      transition: none;
    }
  }
</style>
