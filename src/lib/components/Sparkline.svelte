<script lang="ts">
	let {
		bins,
		color = '#3b82f6',
		glow = false
	}: {
		bins: number[];
		color?: string;
		glow?: boolean;
	} = $props();

	const uid = $props.id();

	function hexToRgba(hex: string, alpha: number): string {
		const cleaned = hex.replace('#', '');
		const r = parseInt(cleaned.substring(0, 2), 16);
		const g = parseInt(cleaned.substring(2, 4), 16);
		const b = parseInt(cleaned.substring(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	/**
	 * Convert a set of data points into a smooth SVG path using
	 * Catmull-Rom to cubic bezier conversion.
	 * Returns both the stroke path and the closed fill path.
	 */
	function catmullRomToBezier(
		points: [number, number][],
		alpha: number = 0.5
	): { strokePath: string; fillPath: string } {
		if (points.length < 2) return { strokePath: '', fillPath: '' };

		if (points.length === 2) {
			const line = `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
			const fill = `${line} L${points[1][0]},${viewBoxHeight} L${points[0][0]},${viewBoxHeight} Z`;
			return { strokePath: line, fillPath: fill };
		}

		// Pad with duplicated endpoints for Catmull-Rom
		const pts: [number, number][] = [points[0], ...points, points[points.length - 1]];
		let d = `M${points[0][0]},${points[0][1]}`;

		for (let i = 0; i < pts.length - 3; i++) {
			const p0 = pts[i];
			const p1 = pts[i + 1];
			const p2 = pts[i + 2];
			const p3 = pts[i + 3];

			// Catmull-Rom to cubic bezier control points
			const cp1x = p1[0] + (p2[0] - p0[0]) / (6 * alpha);
			const cp1y = p1[1] + (p2[1] - p0[1]) / (6 * alpha);
			const cp2x = p2[0] - (p3[0] - p1[0]) / (6 * alpha);
			const cp2y = p2[1] - (p3[1] - p1[1]) / (6 * alpha);

			d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`;
		}

		const lastPoint = points[points.length - 1];
		const firstPoint = points[0];
		const fillD = `${d} L${lastPoint[0]},${viewBoxHeight} L${firstPoint[0]},${viewBoxHeight} Z`;

		return { strokePath: d, fillPath: fillD };
	}

	const viewBoxWidth = 100;
	const viewBoxHeight = 20;
	const padding = 1;

	let paths = $derived.by(() => {
		if (!bins || bins.length === 0) return { strokePath: '', fillPath: '' };

		const max = Math.max(...bins, 1);
		const count = bins.length;
		const usableHeight = viewBoxHeight - padding * 2;

		const points: [number, number][] = bins.map((val, i) => {
			const x = count === 1 ? viewBoxWidth / 2 : (i / (count - 1)) * viewBoxWidth;
			const y = padding + usableHeight - (val / max) * usableHeight;
			return [x, y];
		});

		return catmullRomToBezier(points);
	});

	let strokeColor = $derived(hexToRgba(color, 0.8));
	let fillColorTop = $derived(hexToRgba(color, 0.3));
	let fillColorBottom = $derived(hexToRgba(color, 0));
</script>

<div class="w-full h-[20px]">
	<svg
		width="100%"
		height="100%"
		viewBox="0 0 {viewBoxWidth} {viewBoxHeight}"
		preserveAspectRatio="none"
		xmlns="http://www.w3.org/2000/svg"
	>
		<defs>
			<linearGradient id="{uid}-grad" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color={fillColorTop} />
				<stop offset="100%" stop-color={fillColorBottom} />
			</linearGradient>
			{#if glow}
				<filter id="{uid}-glow">
					<feGaussianBlur stdDeviation="1.5" result="blur" />
					<feMerge>
						<feMergeNode in="blur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			{/if}
		</defs>

		{#if paths.fillPath}
			<path
				d={paths.fillPath}
				fill="url(#{uid}-grad)"
				stroke="none"
			/>
		{/if}

		{#if paths.strokePath}
			<path
				d={paths.strokePath}
				fill="none"
				stroke={strokeColor}
				stroke-width="1"
				vector-effect="non-scaling-stroke"
				filter={glow ? `url(#${uid}-glow)` : undefined}
			/>
		{/if}
	</svg>
</div>
