<script lang="ts">
  import cloud from 'd3-cloud';
  import { wordSize } from './crm-insights';
  import * as m from '$lib/paraglide/messages';

  let { words }: { words: { word: string; count: number }[] } = $props();

  const W = 600;
  const H = 320;
  type Placed = {
    text: string;
    size: number;
    count: number;
    t: number;
    x: number;
    y: number;
    rotate: number;
  };
  let placed = $state<Placed[]>([]);
  let gEl = $state<SVGGElement | undefined>(undefined);
  let viewBox = $state(`${-W / 2} ${-H / 2} ${W} ${H}`);
  // Hover state drives the highlight + the cursor-following tooltip.
  let hovered = $state<number | null>(null);
  let tip = $state({ x: 0, y: 0 });

  // Fit the viewBox to the rendered bounding box (+padding) so large edge words
  // never clip — d3-cloud lets words spill past the nominal W×H box.
  $effect(() => {
    placed;
    if (!gEl || placed.length === 0) return;
    const el = gEl;
    const id = requestAnimationFrame(() => {
      try {
        const b = el.getBBox();
        const pad = 12;
        viewBox = `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`;
      } catch {
        /* getBBox can throw if detached; keep the centered default */
      }
    });
    return () => cancelAnimationFrame(id);
  });

  // Recompute the layout whenever the word list changes.
  $effect(() => {
    const list = words.slice(0, 60);
    if (list.length === 0) {
      placed = [];
      return;
    }
    const counts = list.map((w) => w.count);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const norm = (c: number) => (max <= min ? 1 : (c - min) / (max - min));
    let cancelled = false;
    const layout = cloud<Placed>()
      .size([W, H])
      .words(
        list.map((w) => ({
          text: w.word,
          size: wordSize(w.count, min, max),
          count: w.count,
          t: norm(w.count),
          x: 0,
          y: 0,
          rotate: 0,
        })),
      )
      .padding(4)
      .rotate(() => 0)
      .font('sans-serif')
      .fontSize((d) => d.size ?? 12)
      .on('end', (out) => {
        if (!cancelled) placed = out as Placed[];
      });
    layout.start();
    return () => {
      cancelled = true;
      layout.stop();
    };
  });

  // Heatmap ramp (cool → hot) keyed by relative frequency. A perceptual-ish
  // indigo→sky→green→amber→red gradient so the busiest words read as "hottest".
  const STOPS: [number, string][] = [
    [0.0, 'var(--color-purple)'],
    [0.35, 'var(--color-info)'],
    [0.6, 'var(--color-success)'],
    [0.8, 'var(--color-warning)'],
    [1.0, 'var(--color-destructive)'],
  ];
  function heat(t: number): string {
    const v = Math.min(1, Math.max(0, t));
    let a = STOPS[0];
    let b = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (v >= STOPS[i][0] && v <= STOPS[i + 1][0]) {
        a = STOPS[i];
        b = STOPS[i + 1];
        break;
      }
    }
    const span = b[0] - a[0] || 1;
    const f = (v - a[0]) / span;
    return `color-mix(in srgb, ${a[1]} ${Math.round((1 - f) * 100)}%, ${b[1]})`;
  }

  function onMove(e: MouseEvent, i: number) {
    hovered = i;
    tip = { x: e.clientX, y: e.clientY };
  }
</script>

{#if placed.length === 0}
  <p class="t-caption py-6 text-center">{m.crm_insights_no_words()}</p>
{:else}
  <div class="wc-wrap">
    <svg {viewBox} class="w-full h-auto" role="img" aria-label={m.crm_insights_wordcloud()}>
      <g bind:this={gEl}>
        {#each placed as w, i (w.text)}
          <text
            class="wc-word"
            class:dim={hovered !== null && hovered !== i}
            class:hot={hovered === i}
            text-anchor="middle"
            transform={`translate(${w.x}, ${w.y}) rotate(${w.rotate})`}
            font-size={`${w.size}px`}
            font-family="sans-serif"
            font-weight="600"
            fill={heat(w.t)}
            role="listitem"
            aria-label={`${w.text}: ${w.count}`}
            onmouseenter={(e) => onMove(e, i)}
            onmousemove={(e) => onMove(e, i)}
            onmouseleave={() => (hovered = null)}>{w.text}</text
          >
        {/each}
      </g>
    </svg>
    {#if hovered !== null && placed[hovered]}
      <div class="wc-tip" style:left={`${tip.x}px`} style:top={`${tip.y}px`}>
        <span class="wc-tip-word">{placed[hovered].text}</span>
        <span class="wc-tip-count"
          >{m.crm_insights_word_occurrences({ count: placed[hovered].count })}</span
        >
      </div>
    {/if}
  </div>
{/if}

<style>
  .wc-wrap {
    position: relative;
  }
  .wc-word {
    cursor: default;
    transition:
      opacity var(--duration-fast) var(--ease-standard),
      filter var(--duration-fast) var(--ease-standard);
  }
  .wc-word.dim {
    opacity: 0.22;
  }
  .wc-word.hot {
    filter: brightness(1.25)
      drop-shadow(0 1px 6px color-mix(in srgb, var(--color-bg) 50%, transparent));
  }
  .wc-tip {
    position: fixed;
    transform: translate(-50%, calc(-100% - 10px));
    z-index: var(--layer-modal);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-0);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-card);
    border: 1px solid var(--hairline);
    box-shadow: var(--shadow-elevation-2);
    white-space: nowrap;
  }
  .wc-tip-word {
    font-size: var(--font-size-body);
    font-weight: 700;
    text-transform: capitalize;
  }
  .wc-tip-count {
    font-size: var(--font-size-caption);
    color: var(--color-muted-foreground);
    font-variant-numeric: tabular-nums;
  }
</style>
