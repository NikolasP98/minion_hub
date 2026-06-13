<script lang="ts">
	// Tiny inline-SVG sparkline for a KPI's per-bucket series over the selected
	// range. Overlays three things so the hover tooltip tells the whole story:
	//   • raw series      — the KPI value in each time bucket (faint, in `color`)
	//   • rolling average — trailing-window mean (solid, in `color`)
	//   • ±3σ band + mean — 6-sigma control limits (dashed) so out-of-control
	//                       points are visible against the process mean.
	// Pure SVG (no echarts) — it's a thumbnail, not an interactive chart.
	let {
		series,
		rollAvg = [],
		mean,
		sigma,
		color = '#3b82f6',
		height = 38,
	}: {
		series: number[];
		rollAvg?: number[];
		mean: number;
		sigma: number;
		color?: string;
		height?: number;
	} = $props();

	const W = 100; // viewBox width (the SVG scales to its container via width:100%)
	const PAD = 3;

	// y-domain spans the data AND the ±3σ control limits so both are always
	// visible, with a little breathing room. Clamped to a sane [0,100] percent.
	const domain = $derived.by(() => {
		const ucl = mean + 3 * sigma;
		const lcl = mean - 3 * sigma;
		const vals = [...series, ...rollAvg, ucl, lcl, mean].filter((v) => Number.isFinite(v));
		let lo = Math.min(...vals);
		let hi = Math.max(...vals);
		if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 100 };
		if (hi - lo < 1) { lo -= 1; hi += 1; } // avoid a flat zero-height domain
		const pad = (hi - lo) * 0.12;
		return { lo: Math.max(0, lo - pad), hi: Math.min(100, hi + pad) };
	});

	const H = $derived(height);

	function x(i: number, n: number): number {
		if (n <= 1) return W / 2;
		return PAD + (i / (n - 1)) * (W - 2 * PAD);
	}
	function y(v: number): number {
		const { lo, hi } = domain;
		const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
		return PAD + (1 - t) * (H - 2 * PAD);
	}

	function path(data: number[]): string {
		if (!data.length) return '';
		return data.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, data.length).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
	}

	const rawPath = $derived(path(series));
	const avgPath = $derived(path(rollAvg.length ? rollAvg : series));
	const meanY = $derived(y(mean));
	const uclY = $derived(y(Math.min(100, mean + 3 * sigma)));
	const lclY = $derived(y(Math.max(0, mean - 3 * sigma)));
	const lastX = $derived(x(series.length - 1, series.length));
	const lastY = $derived(series.length ? y(series[series.length - 1]) : 0);
</script>

<svg
	viewBox={`0 0 ${W} ${H}`}
	preserveAspectRatio="none"
	class="w-full block"
	style="height:{H}px"
	role="img"
	aria-label="KPI trend sparkline"
>
	<!-- ±3σ control band -->
	<rect x={PAD} y={uclY} width={W - 2 * PAD} height={Math.max(0, lclY - uclY)} fill={color} opacity="0.06" />
	<!-- mean (process centre) -->
	<line x1={PAD} y1={meanY} x2={W - PAD} y2={meanY} stroke={color} stroke-width="0.5" stroke-dasharray="2 2" opacity="0.5" />
	<!-- raw series -->
	<path d={rawPath} fill="none" stroke={color} stroke-width="0.8" opacity="0.35" vector-effect="non-scaling-stroke" />
	<!-- rolling average -->
	<path d={avgPath} fill="none" stroke={color} stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
	<!-- latest point -->
	{#if series.length}
		<circle cx={lastX} cy={lastY} r="1.6" fill={color} />
	{/if}
</svg>
