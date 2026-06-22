<script lang="ts">
  let {
    state,
    label,
    expanded = false,
  }: { state: 'active' | 'attention' | 'disabled'; label: string; expanded?: boolean } = $props();

  const dot = $derived(
    state === 'active' ? 'bg-emerald-400' : state === 'attention' ? 'bg-amber-400' : 'bg-white/30',
  );
  const text = $derived(
    state === 'active' ? 'text-emerald-300' : state === 'attention' ? 'text-amber-300' : 'text-white/50',
  );
  // expanded → label always visible. Otherwise the label reveals when an
  // ancestor marked `group/card` is hovered (i.e. hovering the whole card),
  // not the chip itself. Margins live on the label so the collapsed chip is a
  // clean, symmetrically-padded dot (no stray right padding).
  const reveal = $derived(
    expanded
      ? 'max-w-[10rem] opacity-100 ml-1.5 mr-0.5'
      : 'max-w-0 opacity-0 group-hover/card:max-w-[10rem] group-hover/card:opacity-100 group-hover/card:ml-1.5 group-hover/card:mr-0.5',
  );
</script>

<!-- Non-interactive status chip. The label rides aria-label so AT always gets it;
     visually it expands on card hover (or is always shown when `expanded`). -->
<span
  class="inline-flex items-center rounded-full bg-white/[0.04] p-1 ring-1 ring-white/10"
  role="img"
  aria-label={label}
>
  <span class="size-2 shrink-0 rounded-full {dot}"></span>
  <span
    class="sd-label overflow-hidden whitespace-nowrap text-[11px] font-medium leading-none transition-all duration-200 {reveal} {text}"
    >{label}</span
  >
</span>

<style>
  @media (prefers-reduced-motion: reduce) {
    .sd-label {
      transition: none;
    }
  }
</style>
