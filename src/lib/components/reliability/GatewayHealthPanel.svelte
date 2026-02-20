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

<div class="bg-card border border-border rounded-lg overflow-hidden">
	<div class="flex items-center justify-between py-3 px-4 border-b border-border">
		<h3 class="text-[13px] font-semibold text-foreground m-0">Gateway Health</h3>
		{#if latest}
			<span class="text-[11px] text-muted-foreground">{formatAgo(latest.capturedAt)}</span>
		{/if}
	</div>

	{#if loading && !latest}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">Loading...</div>
	{:else if error}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{error}</div>
	{:else if !latest}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">No heartbeat data</div>
	{:else}
		<div class="grid grid-cols-4 gap-px bg-border border-b border-border">
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Uptime</span>
				<span class="text-lg font-bold text-success tabular-nums">{formatUptime(latest.uptimeMs)}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Sessions</span>
				<span class="text-lg font-bold text-foreground tabular-nums">{latest.activeSessions}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Agents</span>
				<span class="text-lg font-bold text-foreground tabular-nums">{latest.activeAgents}</span>
			</div>
			<div class="flex flex-col items-center gap-1 py-3.5 px-2 bg-card">
				<span class="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Memory</span>
				<span class="text-lg font-bold text-foreground tabular-nums">
					{latest.memoryRssMb != null ? `${latest.memoryRssMb.toFixed(0)} MB` : '-'}
				</span>
			</div>
		</div>

		{#if memoryPoints.length >= 2}
			<div class="py-3 px-4">
				<div class="flex items-center justify-between mb-1.5">
					<span class="text-[11px] text-muted-foreground font-medium">Memory trend</span>
					<span class="text-[11px] text-muted-foreground tabular-nums">
						{memoryMin.toFixed(0)}&ndash;{memoryMax.toFixed(0)} MB
					</span>
				</div>
				<svg
					class="w-full h-8 block"
					viewBox="0 0 240 32"
					preserveAspectRatio="xMidYMid meet"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d={sparklineArea} fill="rgba(59, 130, 246, 0.1)" />
					<polyline
						points={sparklinePath}
						fill="none"
						stroke="var(--color-accent)"
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
