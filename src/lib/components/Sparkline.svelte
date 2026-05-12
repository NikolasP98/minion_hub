<script lang="ts">
	type Props = {
		values: number[];
		width?: number;
		height?: number;
		stroke?: string;
		fill?: string;
		strokeWidth?: number;
	};
	let {
		values,
		width = 160,
		height = 36,
		stroke = 'currentColor',
		fill = 'currentColor',
		strokeWidth = 1.5,
	}: Props = $props();

	const path = $derived.by(() => {
		if (values.length < 2) return '';
		const min = Math.min(...values);
		const max = Math.max(...values);
		const range = max - min || 1;
		const stepX = width / (values.length - 1);
		return values
			.map((v, i) => {
				const x = i * stepX;
				const y = height - ((v - min) / range) * height;
				return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
			})
			.join(' ');
	});

	const fillPath = $derived(path ? `${path} L ${width} ${height} L 0 ${height} Z` : '');
</script>

<svg
	{width}
	{height}
	viewBox="0 0 {width} {height}"
	preserveAspectRatio="none"
	aria-hidden="true"
	class="block"
>
	{#if fillPath}
		<path d={fillPath} {fill} fill-opacity="0.12" stroke="none" />
	{/if}
	{#if path}
		<path d={path} fill="none" {stroke} stroke-width={strokeWidth} stroke-linecap="round" stroke-linejoin="round" />
	{/if}
</svg>
