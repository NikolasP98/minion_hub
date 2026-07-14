<script lang="ts">
	interface Rev {
		resourceId: string;
		name: string;
		bookings: number;
		linkedRevenue: number;
	}
	let { revenue }: { revenue: Rev[] } = $props();

	const max = $derived(Math.max(1, ...revenue.map((r) => r.linkedRevenue)));
	const soles = (n: number) => `S/ ${Math.round(n).toLocaleString()}`;
</script>

<div class="rev">
	{#each revenue as r (r.resourceId)}
		<div class="rev-row">
			<div class="rev-meta">
				<span class="rev-name" title={r.name}>{r.name}</span>
				<span class="t-caption">{r.bookings} · {soles(r.linkedRevenue)}</span>
			</div>
			<div class="rev-bar-track">
				<div class="rev-bar" style="width:{Math.round((r.linkedRevenue / max) * 100)}%"></div>
			</div>
		</div>
	{/each}
</div>

<style>
	.rev {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}
	.rev-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.rev-meta {
		width: 180px;
		min-width: 180px;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		overflow: hidden;
	}
	.rev-name {
		font-size: 0.85rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rev-bar-track {
		flex: 1;
		height: 10px;
		background: var(--hairline);
		border-radius: 5px;
		overflow: hidden;
	}
	.rev-bar {
		height: 100%;
		background: var(--color-accent);
		border-radius: 5px;
		min-width: 2px;
	}
</style>
