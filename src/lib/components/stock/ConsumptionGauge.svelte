<script lang="ts">
  /**
   * Pure-SVG vertical container (bottle/vial) gauge for per-item consumption.
   * `max` is the gauge's ceiling (see stock-ui.ts gaugeMax — ml per subunit
   * when subunits are configured, else the whole stock-uom conversion).
   * Draggable vertically; fills from the top down to the consumption level.
   * value > max (consumed more than one container) shows a "×N + remainder"
   * caption and the gauge itself displays the remainder fill only.
   */
  import * as m from '$lib/paraglide/messages';

  interface Props {
    max: number;
    value?: number;
    unit?: string;
    readonly?: boolean;
    step?: number;
    class?: string;
  }
  let { max, value = $bindable(0), unit = '', readonly = false, step = 0.5, class: cls = '' }: Props = $props();

  const uid = $props.id();
  const W = 64, H = 140, NECK_H = 14, PAD = 6;
  const bodyTop = NECK_H;
  const bodyH = H - NECK_H - PAD;
  const bodyLeft = PAD;
  const bodyW = W - PAD * 2;

  const active = $derived(max > 0 && !readonly);
  const overflowing = $derived(max > 0 && value > max + 1e-6);
  // Whole containers already consumed; the gauge always shows the remainder.
  const bottles = $derived.by(() => {
    if (max <= 0) return 0;
    let n = Math.floor(value / max);
    const rem = value - n * max;
    if (rem <= 1e-6 && n > 0) n -= 1;
    return n;
  });
  const remainder = $derived(max > 0 ? value - bottles * max : 0);
  const gaugeVal = $derived(overflowing ? remainder : Math.max(0, Math.min(value, max)));
  const fillH = $derived(max > 0 ? Math.max(0, Math.min(1, gaugeVal / max)) * bodyH : 0);
  const lineY = $derived(bodyTop + fillH);

  function setFromClientY(clientY: number, rect: DOMRect) {
    const frac = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const raw = frac * max;
    value = Math.max(0, Math.min(max, Math.round(raw / step) * step));
  }

  let dragging = $state(false);
  function onPointerDown(e: PointerEvent) {
    if (!active) return;
    const el = e.currentTarget as SVGSVGElement;
    el.setPointerCapture(e.pointerId);
    dragging = true;
    setFromClientY(e.clientY, el.getBoundingClientRect());
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    setFromClientY(e.clientY, (e.currentTarget as SVGSVGElement).getBoundingClientRect());
  }
  function onPointerUp() {
    dragging = false;
  }
  function onKeydown(e: KeyboardEvent) {
    if (!active) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      value = Math.min(max, value + step);
      e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      value = Math.max(0, value - step);
      e.preventDefault();
    }
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
</script>

<div class={`gauge-wrap ${cls}`}>
  <svg
    viewBox={`0 0 ${W} ${H}`}
    class="gauge"
    class:inert={!active}
    role="slider"
    tabindex={active ? 0 : -1}
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={max}
    aria-valuetext={`${fmt(value)} ${unit}`}
    aria-readonly={readonly}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onkeydown={onKeydown}
  >
    <clipPath id={`gauge-clip-${uid}`}>
      <rect x={bodyLeft} y={bodyTop} width={bodyW} height={bodyH} rx="10" />
    </clipPath>
    <rect x={W / 2 - 8} y="0" width="16" height={NECK_H} class="vessel" />
    <rect x={bodyLeft} y={bodyTop} width={bodyW} height={bodyH} rx="10" class="vessel" />
    <g clip-path={`url(#gauge-clip-${uid})`}>
      <rect x={bodyLeft} y={bodyTop} width={bodyW} height={fillH} class="fill" />
    </g>
    {#each [0.25, 0.5, 0.75] as t (t)}
      <line x1={bodyLeft} x2={bodyLeft + 6} y1={bodyTop + t * bodyH} y2={bodyTop + t * bodyH} class="tick" />
    {/each}
    <line x1={bodyLeft - 2} x2={bodyLeft + bodyW + 2} y1={lineY} y2={lineY} class="drag-line" />
  </svg>
  <div class="caption">
    {#if overflowing}
      <span class="overflow">{m.stock_gauge_overflow({ count: bottles + 1, remainder: fmt(remainder), unit })}</span>
    {:else}
      <span>{fmt(value)} {unit}</span>
    {/if}
  </div>
</div>

<style>
  .gauge-wrap { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; }
  .gauge { width: 2.75rem; height: 6rem; touch-action: none; cursor: ns-resize; outline: none; }
  .gauge-wrap.compact .gauge { width: 1.75rem; height: 3.75rem; }
  .gauge-wrap.compact .caption { font-size: 0.62rem; }
  .gauge:focus-visible .vessel { stroke: var(--color-accent); stroke-width: 2; }
  .gauge.inert { cursor: default; }
  .vessel { fill: var(--color-bg3); stroke: var(--hairline); stroke-width: 1.5; }
  .fill { fill: color-mix(in srgb, var(--color-accent) 55%, transparent); }
  .tick { stroke: var(--color-muted-foreground); stroke-width: 1; opacity: 0.6; }
  .drag-line { stroke: var(--color-accent); stroke-width: 2.5; }
  .gauge.inert .drag-line { stroke: var(--color-muted-foreground); }
  .caption { font-size: 0.7rem; color: var(--color-muted-foreground); text-align: center; white-space: nowrap; }
  .caption .overflow { color: var(--color-accent); font-weight: 600; }
</style>
