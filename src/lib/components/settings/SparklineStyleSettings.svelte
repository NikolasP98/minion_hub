<script lang="ts">
  import { sparklineStyle, SPARKLINE_STYLE_OPTIONS } from '$lib/state/ui/sparkline-style.svelte';
  import { theme } from '$lib/state/ui/theme.svelte';
  import EChartsSparkline from '$lib/components/charts/EChartsSparkline.svelte';

  // Synthetic 24h demo data
  const DEMO_BINS = Array.from({ length: 144 }, (_, i) => {
    const t = i / 143;
    return Math.max(0, Math.round(Math.sin(t * Math.PI * 4 + 1) * 7 + Math.sin(t * Math.PI * 9) * 3 + 4));
  });

  const accentColor = $derived(theme.accent.value);
</script>

<section class="space-y-4">
  <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider">Sparkline Style</h2>

  <!--
    Small: column layout — buttons fill full width in a row, preview below.
    Large (sm+): row layout — buttons column on left, preview fills right.
  -->
  <div class="flex flex-col sm:flex-row sm:items-stretch gap-3">

    <!-- Style buttons: row on small (equal width), column on large -->
    <div class="flex sm:flex-col gap-2">
      {#each SPARKLINE_STYLE_OPTIONS as opt (opt.id)}
        <button
          type="button"
          class="flex-1 sm:flex-none flex items-center justify-center sm:justify-start gap-2 px-3 py-2.5 rounded-lg border transition-all cursor-pointer
            {sparklineStyle.current === opt.id
              ? 'border-accent bg-accent/8 text-accent'
              : 'border-border bg-card text-muted-foreground hover:border-muted hover:text-foreground'}"
          onclick={() => sparklineStyle.set(opt.id)}
        >
          <span class="text-base font-mono leading-none">{opt.icon}</span>
          <span class="text-[10px] font-medium tracking-wide">{opt.label}</span>
        </button>
      {/each}
    </div>

    <!-- Live preview: below on small, fills right side on large -->
    <div class="relative flex-1 rounded-lg border border-border overflow-hidden bg-bg px-3 flex items-center min-h-[48px]">
      <EChartsSparkline bins={DEMO_BINS} color={accentColor} glow={false} chartStyle={sparklineStyle.current} />
      <span class="absolute inset-0 flex items-end justify-end px-2 pb-1 pointer-events-none">
        <span class="text-[9px] text-muted/40 uppercase tracking-widest">preview</span>
      </span>
    </div>

  </div>
</section>
