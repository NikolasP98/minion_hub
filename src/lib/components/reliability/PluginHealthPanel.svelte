<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import {
		Puzzle,
		Activity,
		AlertCircle,
		Wrench,
		Webhook,
		Radio,
		Cpu,
		Code2,
		Workflow,
		Clock,
		CircleAlert
	} from 'lucide-svelte';
	import { createPluginHealthState, type PluginHealthEntry } from '$lib/state/reliability/plugin-health.svelte';

	interface Props {
		serverId: string;
		from: number;
		to: number;
	}

	let { serverId, from, to }: Props = $props();

	const state = createPluginHealthState();
	let snap = $derived(state.snapshot);

	// ── Summary across all installed plugins ──────────────────────────────────
	let summary = $derived.by(() => {
		const plugins = snap?.plugins ?? [];
		let loaded = 0;
		let errored = 0;
		let disabled = 0;
		let events = 0;
		let errors = 0;
		for (const p of plugins) {
			if (p.status === 'loaded') loaded++;
			else if (p.status === 'error') errored++;
			else disabled++;
			events += p.telemetry.totalEvents;
			errors += p.telemetry.errors;
		}
		return { total: plugins.length, loaded, errored, disabled, events, errors };
	});

	function statusColor(status: string): string {
		switch (status) {
			case 'loaded':
				return 'var(--color-success)';
			case 'error':
				return 'var(--color-destructive)';
			default:
				return 'var(--color-muted-foreground)';
		}
	}

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'loaded':
				return 'bg-success/15 text-success';
			case 'error':
				return 'bg-destructive/15 text-destructive';
			default:
				return 'bg-bg3 text-muted-foreground';
		}
	}

	function originBadgeClass(origin: string): string {
		switch (origin) {
			case 'bundled':
				return 'bg-accent/10 text-accent';
			case 'workspace':
				return 'bg-purple/15 text-purple';
			case 'global':
				return 'bg-cyan/15 text-cyan';
			default:
				return 'bg-bg3 text-muted-foreground';
		}
	}

	function formatNumber(n: number): string {
		return n.toLocaleString('en-US');
	}

	function relTime(ts: number | null): string {
		if (ts == null) return m.reliability_pluginNoActivity();
		const diff = Date.now() - ts;
		const s = Math.floor(diff / 1000);
		const mn = Math.floor(s / 60);
		const h = Math.floor(mn / 60);
		const d = Math.floor(h / 24);
		if (s < 60) return `${s}s`;
		if (mn < 60) return `${mn}m`;
		if (h < 24) return `${h}h`;
		return `${d}d`;
	}

	// Per-plugin KPI tiles: always-visible reliability metrics + the plugin's
	// declared capability counts (only the non-trivial dimensions per plugin).
	type Kpi = { key: string; Icon: typeof Activity; label: string; value: number; color: string; danger?: boolean };

	function kpis(p: PluginHealthEntry): Kpi[] {
		const c = p.capabilities;
		const t = p.telemetry;
		const out: Kpi[] = [
			{ key: 'events', Icon: Activity, label: m.reliability_capEvents(), value: t.totalEvents, color: 'var(--color-accent)' },
			{ key: 'errors', Icon: AlertCircle, label: m.reliability_capErrors(), value: t.errors, color: 'var(--color-destructive)', danger: t.errors > 0 },
			{ key: 'tools', Icon: Wrench, label: m.reliability_capTools(), value: c.tools, color: 'var(--color-purple)' },
			{ key: 'hooks', Icon: Webhook, label: m.reliability_capHooks(), value: c.hooks, color: 'var(--color-cyan)' },
			{ key: 'channels', Icon: Radio, label: m.reliability_capChannels(), value: c.channels, color: 'var(--color-warning)' },
			{ key: 'providers', Icon: Cpu, label: m.reliability_capProviders(), value: c.providers, color: 'var(--color-success)' },
			{ key: 'methods', Icon: Code2, label: m.reliability_capMethods(), value: c.gatewayMethods, color: '#60a5fa' },
			{ key: 'flows', Icon: Workflow, label: m.reliability_capFlows(), value: c.flows + c.flowNodes, color: '#f472b6' }
		];
		return out;
	}

	// 60s polling refresh (the $effect below handles the initial load + reloads
	// when serverId / date range change, so onMount only owns the interval).
	onMount(() => {
		const interval = setInterval(() => {
			if (serverId) state.load(serverId, from, to);
		}, 60_000);
		return () => clearInterval(interval);
	});

	$effect(() => {
		const f = from;
		const t = to;
		const sid = serverId;
		if (sid) state.load(sid, f, t);
	});
</script>

<div class="flex flex-col gap-3">
	<!-- Section overview -->
	<div class="surface-2 rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap">
		<div class="flex items-center gap-2">
			<Puzzle size={14} class="text-accent shrink-0" />
			<span class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
				>{m.reliability_pluginTitle()}</span
			>
		</div>
		{#if snap}
			<span class="text-[11px] text-muted-foreground tabular-nums">
				{m.reliability_pluginsOverview({ loaded: summary.loaded, total: summary.total })}
			</span>
			{#if summary.errored > 0}
				<span class="text-[11px] text-destructive font-semibold tabular-nums"
					>{m.reliability_pluginFailed({ count: summary.errored })}</span
				>
			{/if}
			<span class="flex-1"></span>
			<span class="text-[10px] text-muted-strong tabular-nums">
				{formatNumber(summary.events)}
				{m.reliability_events()} · {formatNumber(summary.errors)}
				{m.reliability_capErrors().toLowerCase()}
			</span>
		{/if}
	</div>

	{#if state.loading && !snap}
		<div class="surface-2 rounded-lg flex items-center justify-center py-12 text-muted-foreground text-[13px]">
			{m.common_loading()}
		</div>
	{:else if state.error}
		<div class="surface-2 rounded-lg flex items-center justify-center py-12 text-destructive text-[13px]">
			{state.error}
		</div>
	{:else if !snap || snap.plugins.length === 0}
		<div class="surface-2 rounded-lg flex items-center justify-center py-12 text-muted-foreground text-[13px]">
			{m.reliability_noPlugins()}
		</div>
	{:else}
		<!-- One section per installed plugin -->
		{#each snap.plugins as plugin (plugin.pluginId)}
			<div class="surface-2 rounded-lg overflow-hidden">
				<!-- Status accent stripe -->
				<div class="h-[2px] w-full" style:background={statusColor(plugin.status)}></div>

				<!-- Header -->
				<div class="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-border">
					<span class="w-2 h-2 rounded-full shrink-0" style:background={statusColor(plugin.status)}></span>
					<span class="text-[13px] font-semibold text-foreground">{plugin.name}</span>
					{#if plugin.name !== plugin.pluginId}
						<span class="text-[10px] text-muted-strong font-mono">{plugin.pluginId}</span>
					{/if}
					{#if plugin.version}
						<span class="text-[10px] text-muted-strong tabular-nums">v{plugin.version}</span>
					{/if}
					<span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-wide {originBadgeClass(plugin.origin)}">
						{plugin.origin}
					</span>
					<span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-wide {statusBadgeClass(plugin.status)}">
						{plugin.status}
					</span>
					{#if !plugin.configEnabled}
						<span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-sm uppercase tracking-wide bg-bg3 text-muted-foreground">
							{m.reliability_pluginDisabled()}
						</span>
					{/if}
					<span class="flex-1"></span>
					<span class="flex items-center gap-1 text-[10px] text-muted-strong tabular-nums" title={m.reliability_pluginLastActivity()}>
						<Clock size={10} class="shrink-0" />
						{relTime(plugin.telemetry.lastActivityAt)}
					</span>
				</div>

				<!-- KPI widget grid -->
				<div class="grid grid-cols-8 divide-x divide-border/60 max-[1100px]:grid-cols-4 max-[640px]:grid-cols-2">
					{#each kpis(plugin) as kpi (kpi.key)}
						{@const Icon = kpi.Icon}
						<div class="px-3 py-2.5 flex flex-col gap-1">
							<div class="flex items-center gap-1">
								<span style:color={kpi.danger ? 'var(--color-destructive)' : kpi.color} class="shrink-0 flex"><Icon size={9} /></span>
								<span class="text-[8.5px] font-semibold text-muted-foreground uppercase tracking-widest truncate">{kpi.label}</span>
							</div>
							<span
								class="text-2xl font-bold font-mono tabular-nums leading-none"
								style:color={kpi.value === 0 ? 'var(--color-muted-strong)' : kpi.danger ? 'var(--color-destructive)' : kpi.color}
							>
								{formatNumber(kpi.value)}
							</span>
						</div>
					{/each}
				</div>

				<!-- Error detail -->
				{#if plugin.status === 'error' && plugin.error}
					<div class="flex items-start gap-2 px-4 py-2 border-t border-border bg-destructive/5">
						<CircleAlert size={12} class="text-destructive shrink-0 mt-0.5" />
						<span class="text-[11px] text-destructive break-words">{plugin.error}</span>
					</div>
				{:else if plugin.telemetry.lastError}
					<div class="flex items-start gap-2 px-4 py-2 border-t border-border">
						<CircleAlert size={12} class="text-warning shrink-0 mt-0.5" />
						<div class="min-w-0">
							<span class="text-[10px] font-mono text-warning">{plugin.telemetry.lastError.event}</span>
							<span class="text-[11px] text-muted-foreground break-words">— {plugin.telemetry.lastError.message}</span>
						</div>
					</div>
				{/if}

				<!-- Top failure modes + capability chips -->
				{#if plugin.telemetry.topFailureModes.length > 0 || plugin.channelIds.length > 0 || plugin.providerIds.length > 0}
					<div class="flex items-center gap-x-4 gap-y-1.5 flex-wrap px-4 py-2 border-t border-border">
						{#if plugin.telemetry.topFailureModes.length > 0}
							<div class="flex items-center gap-1.5 flex-wrap">
								<span class="text-[9px] font-semibold uppercase tracking-widest text-muted-strong">{m.reliability_pluginTopModes()}</span>
								{#each plugin.telemetry.topFailureModes as mode (mode.event)}
									<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-bg3 border border-border">
										<span class="font-mono text-foreground">{mode.failureMode}</span>
										<span class="text-muted-strong tabular-nums">{formatNumber(mode.count)}</span>
									</span>
								{/each}
							</div>
						{/if}
						{#if plugin.channelIds.length > 0}
							<div class="flex items-center gap-1.5 flex-wrap">
								<Radio size={10} class="text-warning shrink-0" />
								{#each plugin.channelIds as ch (ch)}
									<span class="text-[10px] px-1.5 py-0.5 rounded-md bg-warning/10 text-warning">{ch}</span>
								{/each}
							</div>
						{/if}
						{#if plugin.providerIds.length > 0}
							<div class="flex items-center gap-1.5 flex-wrap">
								<Cpu size={10} class="text-success shrink-0" />
								{#each plugin.providerIds as pr (pr)}
									<span class="text-[10px] px-1.5 py-0.5 rounded-md bg-success/10 text-success">{pr}</span>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	{/if}
</div>
