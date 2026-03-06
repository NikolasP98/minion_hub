<script lang="ts">
	/**
	 * Mini activity bar chart (histogram) for per-agent activity monitoring.
	 * More appropriate than a smooth curve for discrete event-count data.
	 *
	 * Expects `bins` to already be rotated chronologically (oldest at index 0,
	 * most-recent at index bins.length-1 → rightmost bar).
	 */
	let {
		bins,
		highlightLast = false,
	}: {
		bins: number[];
		highlightLast?: boolean;
	} = $props();

	const W = 100;
	const H = 20;
	const n = 30; // fixed bar count
	const barW = 2.2;
	const totalGap = W - n * barW;
	const gap = totalGap / (n - 1);

	const maxVal = $derived(Math.max(...bins, 1));

	// Pre-compute bar data as a derived array for clean SVG iteration
	const bars = $derived(
		Array.from({ length: n }, (_, i) => {
			const val = bins[i] ?? 0;
			const bh = val === 0 ? 0.5 : Math.max(2, (val / maxVal) * (H - 2));
			let opacity: number;
			if (val === 0) {
				opacity = 0.12;
			} else if (highlightLast && i === n - 1) {
				opacity = 1;
			} else {
				opacity = 0.35 + (val / maxVal) * 0.65;
			}
			return { x: i * (barW + gap), bh, opacity };
		})
	);
</script>

<svg
	width="100%"
	height="100%"
	viewBox="0 0 {W} {H}"
	preserveAspectRatio="none"
	xmlns="http://www.w3.org/2000/svg"
>
	{#each bars as bar, i (i)}
		<rect
			x={bar.x}
			y={H - bar.bh - 1}
			width={barW}
			height={bar.bh}
			rx="0.4"
			fill="currentColor"
			opacity={bar.opacity}
		/>
	{/each}
</svg>
