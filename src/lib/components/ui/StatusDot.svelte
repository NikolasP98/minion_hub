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
  // expanded → label always visible; otherwise reveal on hover (mouse).
  const reveal = $derived(
    expanded
      ? 'max-w-[10rem] opacity-100'
      : 'max-w-0 opacity-0 group-hover/sd:max-w-[10rem] group-hover/sd:opacity-100',
  );
</script>

<!-- Non-interactive status chip. The label rides aria-label so AT always gets it;
     visually it expands on hover (or is always shown when `expanded`). -->
<span
  class="group/sd inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-1.5 py-0.5 ring-1 ring-white/10"
  role="img"
  aria-label={label}
>
  <span class="size-2 shrink-0 rounded-full {dot}"></span>
  <span
    class="sd-label overflow-hidden whitespace-nowrap text-[11px] font-medium transition-all duration-200 {reveal} {text}"
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
