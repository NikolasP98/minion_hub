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

<div class="kpi-card" style:--kpi-color="var({color})">
	<div class="accent-bar"></div>
	<div class="content">
		<div class="header">
			{#if icon}
				<span class="icon">{icon}</span>
			{/if}
			<span class="label">{label}</span>
		</div>
		<div class="value">{value}</div>
		{#if trend !== null}
			<div class="trend" style:color={trendColor}>
				{#if trendArrow}
					<span class="trend-arrow">{trendArrow}</span>
				{/if}
				<span class="trend-value">{trendLabel}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.kpi-card {
		position: relative;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		min-width: 160px;
		padding: 0;
		overflow: hidden;
		display: flex;
	}

	.accent-bar {
		width: 4px;
		flex-shrink: 0;
		background: var(--kpi-color);
		border-radius: var(--radius) 0 0 var(--radius);
	}

	.content {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.icon {
		font-size: 14px;
		line-height: 1;
	}

	.label {
		font-size: 12px;
		color: var(--text2);
		font-weight: 500;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.value {
		font-size: 24px;
		font-weight: 700;
		color: var(--text);
		line-height: 1.1;
	}

	.trend {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		font-weight: 500;
	}

	.trend-arrow {
		font-weight: 700;
	}
</style>
