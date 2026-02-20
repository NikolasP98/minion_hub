<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		serverId: string;
	}

	interface Heartbeat {
		id: number;
		serverId: string;
		uptimeMs: number;
		activeSessions: number;
		activeAgents: number;
		memoryRssMb: number | null;
		capturedAt: number;
	}

	let { serverId }: Props = $props();

	let heartbeats = $state<Heartbeat[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let latest = $derived(heartbeats.length > 0 ? heartbeats[0] : null);

	/** Memory data points in chronological order for the sparkline. */
	let memoryPoints = $derived.by(() => {
		const points: number[] = [];
		// heartbeats come newest-first; reverse for chronological sparkline
		for (let i = heartbeats.length - 1; i >= 0; i--) {
			const hb = heartbeats[i];
			if (hb.memoryRssMb != null) {
				points.push(hb.memoryRssMb);
			}
		}
		return points;
	});

	let memoryMin = $derived(memoryPoints.length > 0 ? Math.min(...memoryPoints) : 0);
	let memoryMax = $derived(memoryPoints.length > 0 ? Math.max(...memoryPoints) : 1);

	/** Build the SVG polyline path for the memory sparkline. */
	let sparklinePath = $derived.by(() => {
		if (memoryPoints.length < 2) return '';
		const width = 240;
		const height = 32;
		const padding = 2;
		const range = memoryMax - memoryMin || 1;
		const stepX = (width - padding * 2) / (memoryPoints.length - 1);

		const coords = memoryPoints.map((val, i) => {
			const x = padding + i * stepX;
			const y = padding + (1 - (val - memoryMin) / range) * (height - padding * 2);
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return coords.join(' ');
	});

	/** Fill area path (sparkline + bottom edge). */
	let sparklineArea = $derived.by(() => {
		if (memoryPoints.length < 2) return '';
		const width = 240;
		const height = 32;
		const padding = 2;
		const range = memoryMax - memoryMin || 1;
		const stepX = (width - padding * 2) / (memoryPoints.length - 1);

		let d = '';
		memoryPoints.forEach((val, i) => {
			const x = padding + i * stepX;
			const y = padding + (1 - (val - memoryMin) / range) * (height - padding * 2);
			d += i === 0 ? `M ${x.toFixed(1)},${y.toFixed(1)}` : ` L ${x.toFixed(1)},${y.toFixed(1)}`;
		});
		// Close path along bottom
		const lastX = padding + (memoryPoints.length - 1) * stepX;
		d += ` L ${lastX.toFixed(1)},${height} L ${padding},${height} Z`;
		return d;
	});

	function formatUptime(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

	function formatAgo(ts: number): string {
		const diff = Date.now() - ts;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	async function load() {
		loading = true;
		error = null;
		try {
			const res = await globalThis.fetch(
				`/api/metrics/gateway-heartbeats?serverId=${encodeURIComponent(serverId)}&limit=50`,
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			heartbeats = data.heartbeats ?? [];
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		const interval = setInterval(load, 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="panel">
	<div class="panel-header">
		<h3 class="panel-title">Gateway Health</h3>
		{#if latest}
			<span class="panel-meta">{formatAgo(latest.capturedAt)}</span>
		{/if}
	</div>

	{#if loading && !latest}
		<div class="panel-empty">Loading...</div>
	{:else if error}
		<div class="panel-empty panel-error">{error}</div>
	{:else if !latest}
		<div class="panel-empty">No heartbeat data</div>
	{:else}
		<div class="stats-grid">
			<div class="stat-card">
				<span class="stat-label">Uptime</span>
				<span class="stat-value ok">{formatUptime(latest.uptimeMs)}</span>
			</div>
			<div class="stat-card">
				<span class="stat-label">Sessions</span>
				<span class="stat-value">{latest.activeSessions}</span>
			</div>
			<div class="stat-card">
				<span class="stat-label">Agents</span>
				<span class="stat-value">{latest.activeAgents}</span>
			</div>
			<div class="stat-card">
				<span class="stat-label">Memory</span>
				<span class="stat-value">
					{latest.memoryRssMb != null ? `${latest.memoryRssMb.toFixed(0)} MB` : '-'}
				</span>
			</div>
		</div>

		{#if memoryPoints.length >= 2}
			<div class="sparkline-section">
				<div class="sparkline-header">
					<span class="sparkline-label">Memory trend</span>
					<span class="sparkline-range">
						{memoryMin.toFixed(0)}&ndash;{memoryMax.toFixed(0)} MB
					</span>
				</div>
				<svg
					class="sparkline-svg"
					viewBox="0 0 240 32"
					width="100%"
				preserveAspectRatio="xMidYMid meet"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d={sparklineArea} fill="rgba(59, 130, 246, 0.1)" />
					<polyline
						points={sparklinePath}
						fill="none"
						stroke="var(--accent)"
						stroke-width="2"
						stroke-linejoin="round"
						stroke-linecap="round"
						vector-effect="non-scaling-stroke"
					/>
				</svg>
			</div>
		{/if}
	{/if}
</div>

<style>
	.panel {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
	}

	.panel-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		margin: 0;
	}

	.panel-meta {
		font-size: 11px;
		color: var(--text3);
	}

	.panel-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px 16px;
		color: var(--text3);
		font-size: 13px;
	}

	.panel-error {
		color: var(--red);
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1px;
		background: var(--border);
		border-bottom: 1px solid var(--border);
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 14px 8px;
		background: var(--card);
	}

	.stat-label {
		font-size: 11px;
		color: var(--text3);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 500;
	}

	.stat-value {
		font-size: 18px;
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.stat-value.ok {
		color: var(--green);
	}

	.sparkline-section {
		padding: 12px 16px;
	}

	.sparkline-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}

	.sparkline-label {
		font-size: 11px;
		color: var(--text3);
		font-weight: 500;
	}

	.sparkline-range {
		font-size: 11px;
		color: var(--text3);
		font-variant-numeric: tabular-nums;
	}

	.sparkline-svg {
		width: 100%;
		height: 32px;
		display: block;
	}
</style>
