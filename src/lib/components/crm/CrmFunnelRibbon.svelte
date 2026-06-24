<script lang="ts">
	import { FUNNEL_ORDER, funnelStageColor } from './crm-funnel';
	import { funnelStageLabel } from './crm-i18n';

	// counts: { lead: n, interest: n, … } — the marketing-funnel breakdown.
	// hrefFor (optional): make each segment a link to the filtered customer list.
	let { counts, hrefFor }: { counts: Record<string, number>; hrefFor?: (id: string) => string } = $props();

	const segments = $derived(FUNNEL_ORDER.map((id) => ({ id, count: counts[id] ?? 0 })));
	const total = $derived(segments.reduce((a, s) => a + s.count, 0));
	const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
</script>

<div class="ribbon" role="img" aria-label="Marketing funnel breakdown">
	{#each segments as s, i (s.id)}
		{@const color = funnelStageColor(s.id)}
		<svelte:element
			this={hrefFor ? 'a' : 'div'}
			href={hrefFor?.(s.id)}
			class="seg"
			class:first={i === 0}
			class:last={i === segments.length - 1}
			class:empty={s.count === 0}
			class:link={!!hrefFor}
			style:--c={color}
			style:flex-grow={s.count}
			title={`${funnelStageLabel(s.id)}: ${s.count} (${pct(s.count)}%)`}
		>
			<span class="seg-inner">
				<span class="seg-label">{funnelStageLabel(s.id)}</span>
				<span class="seg-count">{s.count.toLocaleString()} · {pct(s.count)}%</span>
			</span>
		</svelte:element>
	{/each}
</div>

<style>
	.ribbon {
		display: flex;
		align-items: stretch;
		width: 100%;
		height: 3.25rem;
		gap: 0;
	}
	.seg {
		position: relative;
		flex: 1 1 0;
		min-width: 5.5rem;
		display: grid;
		place-items: center;
		padding: 0 0.6rem 0 1.1rem;
		color: color-mix(in srgb, var(--c) 92%, white);
		background: color-mix(in srgb, var(--c) 20%, transparent);
		border-top: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
		/* chevron ribbon: arrow on the right, notch on the left (interlocking). */
		clip-path: polygon(0 0, calc(100% - 13px) 0, 100% 50%, calc(100% - 13px) 100%, 0 100%, 13px 50%);
		margin-left: -11px;
		transition: background-color var(--duration-fast) var(--ease-standard);
	}
	.seg.first {
		clip-path: polygon(0 0, calc(100% - 13px) 0, 100% 50%, calc(100% - 13px) 100%, 0 100%);
		margin-left: 0;
		padding-left: 0.8rem;
		border-left: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
		border-top-left-radius: var(--radius-md);
		border-bottom-left-radius: var(--radius-md);
	}
	.seg.last {
		clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 13px 50%);
		padding-right: 0.9rem;
		border-right: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
		border-top-right-radius: var(--radius-md);
		border-bottom-right-radius: var(--radius-md);
	}
	.seg.empty {
		color: var(--color-muted-foreground);
		background: var(--color-bg3);
		border-color: var(--hairline);
	}
	.seg.link { cursor: pointer; text-decoration: none; }
	.seg:hover {
		background: color-mix(in srgb, var(--c) 32%, transparent);
	}
	.seg-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		line-height: 1.1;
		min-width: 0;
		text-align: center;
	}
	.seg-label {
		font-size: 0.78rem;
		font-weight: 600;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.seg-count {
		font-size: 0.68rem;
		opacity: 0.85;
		font-variant-numeric: tabular-nums;
	}
</style>
