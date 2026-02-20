<script lang="ts">
	interface Props {
		label: string;
		value: string;
		trend?: number | null;
		trendInvert?: boolean;
		color?: string;
		icon?: string;
	}

	let {
		label,
		value,
		trend = null,
		trendInvert = false,
		color = '--accent',
		icon = ''
	}: Props = $props();

	let trendIsPositive = $derived(trend !== null && trend > 0);
	let trendColor = $derived.by(() => {
		if (trend === null || trend === 0) return 'var(--text3)';
		if (trendInvert) {
			return trendIsPositive ? 'var(--red)' : 'var(--green)';
		}
		return trendIsPositive ? 'var(--green)' : 'var(--red)';
	});
	let trendArrow = $derived.by(() => {
		if (trend === null || trend === 0) return '';
		return trendIsPositive ? '\u2191' : '\u2193';
	});
	let trendLabel = $derived.by(() => {
		if (trend === null) return '';
		if (trend === 0) return '0';
		const abs = Math.abs(trend);
		return trendIsPositive ? `+${abs}` : `-${abs}`;
	});
</script>

<div class="relative bg-card border border-border rounded-lg min-w-40 p-0 overflow-hidden flex" style:--kpi-color="var({color})">
	<div class="w-1 shrink-0 border-l-4 rounded-l-lg" style:border-left-color="var({color})"></div>
	<div class="p-4 flex flex-col gap-2 flex-1 min-w-0">
		<div class="flex items-center gap-1.5">
			{#if icon}
				<span class="text-sm leading-none">{icon}</span>
			{/if}
			<span class="text-xs text-muted font-medium tracking-wide uppercase whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
		</div>
		<div class="text-2xl font-bold text-foreground leading-tight">{value}</div>
		{#if trend !== null}
			<div class="flex items-center gap-1 text-[13px] font-medium" style:color={trendColor}>
				{#if trendArrow}
					<span class="font-bold">{trendArrow}</span>
				{/if}
				<span>{trendLabel}</span>
			</div>
		{/if}
	</div>
</div>
