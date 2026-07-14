<script lang="ts">
  import { Button } from '$lib/components/ui';
import * as m from '$lib/paraglide/messages';
  import { fmtChars, type BarSegment } from './types';

  let {
    segments,
    contextWindowChars,
    totalUsedChars,
    cachedPct = 0,
    onToggleRail,
  }: {
    segments: BarSegment[];
    contextWindowChars: number;
    totalUsedChars: number;
    /** Whole-prompt cacheable ratio (0–1). */
    cachedPct?: number;
    /** When provided, renders a rail-drawer toggle (narrow viewports). */
    onToggleRail?: () => void;
  } = $props();

  const usedRatio = $derived(
    contextWindowChars > 0 ? totalUsedChars / contextWindowChars : 0,
  );
  const overBudget = $derived(usedRatio >= 0.8);
  const cachedLabel = $derived(`${Math.round(cachedPct * 100)}%`);

  function fmtContextPct(chars: number): string {
    if (!contextWindowChars) return '';
    return `${((chars / contextWindowChars) * 100).toFixed(1)}%`;
  }
</script>

<div class="shrink-0 border-b border-border bg-bg2 px-3 pt-2 pb-2 space-y-1.5">
  <!-- Stacked bar -->
  <div
    class="relative h-2.5 rounded-sm overflow-hidden border flex
      {overBudget ? 'bg-[var(--color-warning-surface)] border-[var(--color-warning-border)]' : 'bg-bg1 border-border/40'}"
  >
    {#each segments as seg (seg.label)}
      <div
        class="h-full shrink-0 transition-all duration-[var(--duration-normal)]"
        style:background-color={overBudget ? 'var(--color-warning-fg)' : seg.color}
        style:opacity={overBudget ? '0.85' : '1'}
        style:width="{((seg.chars / contextWindowChars) * 100).toFixed(2)}%"
      ></div>
    {/each}
  </div>

  <!-- Legend row -->
  <div class="flex items-center justify-between gap-2">
    <div class="flex items-center gap-3 min-w-0 flex-wrap">
      {#if onToggleRail}
        <Button variant="ghost"
          type="button"
          class="lg:hidden shrink-0 text-[length:var(--font-size-telemetry)] px-1.5 py-0.5 rounded border border-border text-muted hover:text-foreground transition-colors cursor-pointer"
          onclick={onToggleRail}
          title={m.ctx_toggleSections()}
          aria-label={m.ctx_toggleSectionsRail()}
        >
          ☰ {m.ctx_sections()}
        </Button>
      {/if}
      {#each segments as seg (seg.label)}
        <span class="flex items-center gap-1">
          <span class="w-2 h-2 rounded-sm shrink-0" style:background-color={seg.color}></span>
          <span class="text-[length:var(--font-size-telemetry)] text-muted">{seg.label}</span>
          <span class="text-[length:var(--font-size-telemetry)] text-foreground/50">{fmtChars(seg.chars)}</span>
        </span>
      {/each}
    </div>
    <div class="flex items-center gap-3 shrink-0">
      <span
        class="text-[length:var(--font-size-telemetry)] font-mono whitespace-nowrap"
        class:text-[var(--color-warning-fg)]={cachedPct > 0}
        class:text-muted={cachedPct === 0}
        title={m.ctx_cacheableShare()}
      >
        ⚡ {cachedLabel} {m.ctx_cached()}
      </span>
      <span
        class="text-[length:var(--font-size-telemetry)] font-mono whitespace-nowrap"
        class:text-[var(--color-warning-fg)]={overBudget}
        class:text-muted={!overBudget}
      >
        {fmtChars(totalUsedChars)} / {fmtChars(contextWindowChars)}
        <span class:text-[var(--color-warning-fg)]={overBudget} class:text-foreground={!overBudget} class="opacity-70"
          >&middot; {fmtContextPct(totalUsedChars)}</span
        >
      </span>
    </div>
  </div>
</div>
