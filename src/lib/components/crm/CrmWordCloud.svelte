<script lang="ts">
  import cloud from 'd3-cloud';
  import { wordSize } from './crm-insights';
  import * as m from '$lib/paraglide/messages';

  let { words }: { words: { word: string; count: number }[] } = $props();

  const W = 600;
  const H = 320;
  type Placed = { text: string; size: number; x: number; y: number; rotate: number };
  let placed = $state<Placed[]>([]);
  // Words are laid out centered on the origin; d3-cloud lets large edge words
  // spill past the nominal W×H box, so we fit the viewBox to the actual rendered
  // bounding box (+padding) — nothing clips. Starts centered, refined post-render.
  let gEl = $state<SVGGElement | undefined>(undefined);
  let viewBox = $state(`${-W / 2} ${-H / 2} ${W} ${H}`);
  $effect(() => {
    placed; // re-fit whenever the layout changes
    if (!gEl || placed.length === 0) return;
    const el = gEl;
    const id = requestAnimationFrame(() => {
      try {
        const b = el.getBBox();
        const pad = 10;
        viewBox = `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`;
      } catch {
        /* getBBox can throw if detached; keep the centered default */
      }
    });
    return () => cancelAnimationFrame(id);
  });

  // Recompute the layout whenever the word list changes. d3-cloud measures text
  // on a canvas and finishes async (the 'end' callback), so we collect there and
  // let Svelte render the resulting positions reactively.
  $effect(() => {
    const list = words.slice(0, 60);
    if (list.length === 0) {
      placed = [];
      return;
    }
    const counts = list.map((w) => w.count);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    let cancelled = false;
    const layout = cloud<{ text: string; size: number }>()
      .size([W, H])
      .words(list.map((w) => ({ text: w.word, size: wordSize(w.count, min, max) })))
      .padding(3)
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

  // Accent-tinted by relative size for a calm, on-brand cloud.
  function fill(size: number): string {
    const t = Math.min(1, Math.max(0, (size - 12) / 36));
    return `color-mix(in srgb, var(--color-accent) ${Math.round(35 + t * 65)}%, var(--color-muted-foreground))`;
  }
</script>

{#if placed.length === 0}
  <p class="t-caption py-6 text-center">{m.crm_insights_no_words()}</p>
{:else}
  <svg {viewBox} class="w-full h-auto" role="img" aria-label={m.crm_insights_wordcloud()}>
    <g bind:this={gEl}>
      {#each placed as w (w.text)}
        <text
          text-anchor="middle"
          transform={`translate(${w.x}, ${w.y}) rotate(${w.rotate})`}
          font-size={`${w.size}px`}
          font-family="sans-serif"
          font-weight="600"
          fill={fill(w.size)}>{w.text}</text>
      {/each}
    </g>
  </svg>
{/if}
