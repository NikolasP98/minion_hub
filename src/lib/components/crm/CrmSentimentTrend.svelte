<script lang="ts">
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { line, curveMonotoneX } from 'd3-shape';
  import * as m from '$lib/paraglide/messages';

  let {
    points,
    current,
  }: {
    points: { month: string; avg: number; n: number }[];
    current: { avg: number; n: number } | null;
  } = $props();

  const W = 600;
  const H = 200;
  const PAD = { top: 16, right: 16, bottom: 24, left: 32 };

  // month 'YYYY-MM' → Date at the 1st (UTC).
  const data = $derived(
    points.map((p) => ({ date: new Date(`${p.month}-01T00:00:00Z`), avg: p.avg, n: p.n })),
  );

  const x = $derived(
    scaleTime()
      .domain(data.length ? [data[0].date, data[data.length - 1].date] : [new Date(), new Date()])
      .range([PAD.left, W - PAD.right]),
  );
  const y = $derived(scaleLinear().domain([-1, 1]).range([H - PAD.bottom, PAD.top]));
  const path = $derived(
    data.length
      ? (line<{ date: Date; avg: number }>()
          .x((d) => x(d.date))
          .y((d) => y(d.avg))
          .curve(curveMonotoneX)(data) ?? '')
      : '',
  );
  const yTicks = $derived(y.ticks(5));
  const fmtScore = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2);
</script>

<header class="trend-head">
  {#if current}
    <span class="trend-cur" style:color={current.avg >= 0 ? 'var(--color-success)' : 'var(--color-destructive)'}>
      {fmtScore(current.avg)}
    </span>
    <span class="t-caption">{m.crm_insights_sentiment_n({ count: current.n })}</span>
  {:else}
    <span class="t-caption">{m.crm_insights_sentiment_none()}</span>
  {/if}
</header>

{#if data.length > 0}
  <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-auto" role="img" aria-label={m.crm_insights_sentiment_trend()}>
    <!-- zero baseline -->
    <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="var(--hairline)" stroke-dasharray="3 3" />
    {#each yTicks as t (t)}
      <text x={PAD.left - 6} y={y(t)} text-anchor="end" dominant-baseline="middle" font-size="9" fill="var(--color-muted-foreground)">{fmtScore(t)}</text>
    {/each}
    <path d={path} fill="none" stroke="var(--color-accent)" stroke-width="2" />
    {#each data as d (d.date.toISOString())}
      <circle cx={x(d.date)} cy={y(d.avg)} r="3" fill="var(--color-accent)" />
    {/each}
  </svg>
{/if}
