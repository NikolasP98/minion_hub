<script lang="ts">
  /**
   * Radio-style grid of SVG shape previews (vessels or containers) for the
   * item edit form. Value is the shape id; null = registry default.
   */
  import * as m from '$lib/paraglide/messages';
  import { VESSEL_SHAPES, CONTAINER_SHAPES, VESSEL_VIEWBOX, CONTAINER_VIEWBOX, markerGrid } from './stock-svg';

  interface Props {
    kind: 'vessel' | 'container';
    value?: string | null;
    label: string;
  }
  let { kind, value = $bindable(null), label }: Props = $props();

  const shapes = $derived(kind === 'vessel' ? VESSEL_SHAPES : CONTAINER_SHAPES);
  const vb = $derived(kind === 'vessel' ? VESSEL_VIEWBOX : CONTAINER_VIEWBOX);

  const SHAPE_LABELS: Record<string, () => string> = {
    bottle: m.stock_svg_bottle, vial: m.stock_svg_vial, ampoule: m.stock_svg_ampoule,
    jar: m.stock_svg_jar, tube: m.stock_svg_tube, syringe: m.stock_svg_syringe,
    dropper: m.stock_svg_dropper, iv_bag: m.stock_svg_iv_bag,
    box: m.stock_svg_box, carton: m.stock_svg_carton, tray: m.stock_svg_tray,
    pouch: m.stock_svg_pouch, strip: m.stock_svg_strip,
  };
  const labelFor = (id: string) => SHAPE_LABELS[id]?.() ?? id;
</script>

<div class="picker" role="radiogroup" aria-label={label}>
  <span class="picker-label">{label}</span>
  <div class="grid">
    {#each shapes as s (s.id)}
      {@const selected = (value ?? shapes[0].id) === s.id}
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-label={labelFor(s.id)}
        title={labelFor(s.id)}
        class="opt"
        class:selected
        onclick={() => (value = s.id)}
      >
        <svg viewBox={`0 0 ${vb.w} ${vb.h}`} class="preview" class:tall={kind === 'vessel'}>
          {#if 'body' in s}
            <path d={s.body} class="shape" />
            {#each s.extras ?? [] as extra (extra)}<path d={extra} class="extra" />{/each}
          {:else}
            {#each s.outline as d (d)}<path {d} class="shape" />{/each}
            {#each markerGrid(s.content, 6, 6) as c, i (i)}<circle cx={c.cx} cy={c.cy} r={c.r} class="dot" />{/each}
          {/if}
        </svg>
      </button>
    {/each}
  </div>
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 0.25rem; }
  .picker-label { font-size: 0.78rem; color: var(--color-muted-foreground); }
  .grid { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .opt {
    display: flex; align-items: center; justify-content: center;
    width: 2.6rem; height: 2.6rem; padding: 0.25rem;
    border: 1px solid var(--hairline); border-radius: var(--radius-sm);
    background: var(--color-bg3); cursor: pointer;
  }
  .opt:hover { border-color: var(--color-muted-foreground); }
  .opt.selected { border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg3)); }
  .preview { width: 100%; height: 100%; }
  .preview.tall { width: auto; }
  .shape { fill: none; stroke: var(--color-foreground); stroke-width: 4; }
  .preview.tall .shape, .preview.tall .extra { stroke-width: 3; }
  .extra { fill: none; stroke: var(--color-foreground); stroke-width: 4; opacity: 0.7; }
  .dot { fill: none; stroke: var(--color-foreground); stroke-width: 3; }
</style>
