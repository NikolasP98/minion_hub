<script lang="ts">
  import { fmtChars, type BarSegment } from './types';

  let {
    segments,
    contextWindowChars,
    totalUsedChars,
  }: {
    segments: BarSegment[];
    contextWindowChars: number;
    totalUsedChars: number;
  } = $props();

  function fmtContextPct(chars: number): string {
    if (!contextWindowChars) return '';
    return `${((chars / contextWindowChars) * 100).toFixed(1)}%`;
  }
</script>

<div class="shrink-0 border-b border-border bg-bg2 px-3 pt-2 pb-2 space-y-1.5">
  <!-- Stacked bar -->
  <div class="relative h-2.5 bg-bg1 rounded-sm overflow-hidden border border-border/40 flex">
    {#each segments as seg (seg.label)}
      <div
        class="h-full shrink-0 transition-all duration-300"
        style:background-color={seg.color}
        style:width="{((seg.chars / contextWindowChars) * 100).toFixed(2)}%"
      ></div>
    {/each}
  </div>

  <!-- Legend row -->
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-3 min-w-0 flex-wrap">
      {#each segments as seg (seg.label)}
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-sm shrink-0" style:background-color={seg.color}></span>
          <span class="text-[10px] text-muted">{seg.label}</span>
          <span class="text-[10px] text-foreground/50">{fmtChars(seg.chars)}</span>
        </span>
      {/each}
    </div>
    <span class="shrink-0 text-[10px] font-mono text-muted whitespace-nowrap">
      {fmtChars(totalUsedChars)} / {fmtChars(contextWindowChars)}
      <span class="text-foreground/60">&middot; {fmtContextPct(totalUsedChars)}</span>
    </span>
  </div>
</div>
