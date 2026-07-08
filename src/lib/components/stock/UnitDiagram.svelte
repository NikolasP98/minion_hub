<script lang="ts">
  /**
   * One stock unit (caja/box/tray…) as its container shape with a marker per
   * subunit inside. `filled` is how many subunits are present, may be
   * fractional — the partial marker clips its fill circle bottom-up.
   * count > MAX_MARKERS (or missing) renders no grid; callers fall back to a
   * numeric caption.
   */
  import { containerShape, markerGrid, CONTAINER_VIEWBOX } from './stock-svg';

  interface Props {
    shape?: string | null;
    count: number;
    filled?: number;
    class?: string;
  }
  let { shape = null, count, filled = count, class: cls = '' }: Props = $props();

  const uid = $props.id();
  const { w: W, h: H } = CONTAINER_VIEWBOX;
  const container = $derived(containerShape(shape));
  const cells = $derived(markerGrid(container.content, count, filled));
</script>

<svg viewBox={`0 0 ${W} ${H}`} class={`unit-diagram ${cls}`} role="img">
  {#each container.outline as d (d)}
    <path {d} class="outline" />
  {/each}
  {#each cells as c, i (i)}
    <circle cx={c.cx} cy={c.cy} r={c.r} class="marker" />
    {#if c.fill > 0}
      {#if c.fill >= 1}
        <circle cx={c.cx} cy={c.cy} r={c.r} class="marker-fill" />
      {:else}
        <clipPath id={`ud-${uid}-${i}`}>
          <rect x={c.cx - c.r} y={c.cy - c.r + 2 * c.r * (1 - c.fill)} width={2 * c.r} height={2 * c.r * c.fill} />
        </clipPath>
        <circle cx={c.cx} cy={c.cy} r={c.r} class="marker-fill" clip-path={`url(#ud-${uid}-${i})`} />
      {/if}
    {/if}
  {/each}
</svg>

<style>
  .unit-diagram { width: 7rem; height: auto; }
  .outline { fill: var(--color-bg3); stroke: var(--hairline); stroke-width: 2; }
  .outline:not(:first-child) { fill: none; }
  .marker { fill: none; stroke: var(--color-muted-foreground); stroke-width: 1.2; opacity: 0.55; }
  .marker-fill { fill: color-mix(in srgb, var(--color-accent) 55%, transparent); stroke: var(--color-accent); stroke-width: 1.2; }
</style>
