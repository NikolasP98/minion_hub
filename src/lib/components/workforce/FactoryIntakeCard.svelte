<script lang="ts">
	import { ArrowUpRight, CircleAlert, Factory, GitBranch, ScanSearch } from 'lucide-svelte';
	import type { FactoryIntakeView } from '$lib/workforce/factory-intake';
	import * as m from '$lib/paraglide/messages';

	let {
		intake,
		pending = false,
		error = null,
	}: {
		intake: FactoryIntakeView | null;
		pending?: boolean;
		error?: string | null;
	} = $props();

	const stateLabel = $derived.by(() => {
		if (pending || intake?.state === 'scouting') return m.factoryDesk_stateScouting();
		if (intake?.state === 'awaiting_routing_approval') return m.factoryDesk_stateDecision();
		if (intake?.state === 'pipeline_active' || intake?.state === 'completed') return m.factoryDesk_stateRouted();
		if (intake?.state === 'rejected') return m.factoryDesk_stateRejected();
		if (intake?.state === 'failed') return m.factoryDesk_stateFailed();
		return intake?.state ?? m.factoryDesk_stateQueued();
	});

	const activeStep = $derived(
		pending || intake?.state === 'scouting'
			? 0
			: intake?.state === 'awaiting_routing_approval'
				? 1
				: intake?.state === 'pipeline_active' || intake?.state === 'completed'
					? 2
					: 0,
	);
</script>

<section class="factory-card" aria-live="polite" aria-label={m.factoryDesk_resultLabel()}>
	<header>
		<div class="mark"><Factory size={13} /></div>
		<div class="identity">
			<span class="eyebrow">{m.factoryDesk_controlDesk()}</span>
			<strong>{intake?.identifier ?? m.factoryDesk_newIntake()}</strong>
		</div>
		<span class:warning={intake?.state === 'awaiting_routing_approval'} class:error={intake?.state === 'failed' || intake?.state === 'rejected'} class="signal">
			<span></span>{stateLabel}
		</span>
	</header>

	{#if error}
		<div class="fault"><CircleAlert size={13} /> <span>{error}</span></div>
	{:else}
		<div class="track" aria-hidden="true">
			<div class:active={activeStep >= 0} class="station"><ScanSearch size={12} /><span>{m.factoryDesk_scout()}</span></div>
			<i class:lit={activeStep >= 1}></i>
			<div class:active={activeStep >= 1} class="station"><GitBranch size={12} /><span>{m.factoryDesk_route()}</span></div>
			<i class:lit={activeStep >= 2}></i>
			<div class:active={activeStep >= 2} class="station"><Factory size={12} /><span>{m.factoryDesk_line()}</span></div>
		</div>

		{#if intake}
			<div class="ticket">
				<strong>{intake.title}</strong>
				{#if intake.project}
					<span>{intake.portfolio?.name ?? m.factoryDesk_portfolio()} / {intake.project.name}</span>
				{:else if intake.state === 'awaiting_routing_approval'}
					<span>{m.factoryDesk_decisionHint()}</span>
				{:else}
					<span>{m.factoryDesk_scoutHint()}</span>
				{/if}
			</div>

			<nav aria-label={m.factoryDesk_actions()}>
				{#if intake.state === 'awaiting_routing_approval'}
					<a class="primary" href={intake.workHref}>{m.factoryDesk_reviewInWork()} <ArrowUpRight size={11} /></a>
				{:else if intake.projectHref}
					<a class="primary" href={intake.projectHref}>{m.factoryDesk_openLine()} <ArrowUpRight size={11} /></a>
				{/if}
				<a href={intake.issueHref}>{m.factoryDesk_openTicket()} <ArrowUpRight size={11} /></a>
			</nav>
		{/if}
	{/if}
</section>

<style>
	.factory-card {
		position: relative;
		margin: 0.5rem 0.75rem;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--color-accent) 28%, var(--color-border));
		border-radius: 0.65rem;
		background:
			repeating-linear-gradient(135deg, transparent 0 10px, color-mix(in srgb, var(--color-accent) 3%, transparent) 10px 11px),
			var(--color-canvas);
		box-shadow: inset 3px 0 0 color-mix(in srgb, var(--color-accent) 70%, #f59e0b);
	}
	header { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.65rem; border-bottom: 1px solid var(--color-border); }
	.mark { display: grid; place-items: center; width: 1.7rem; height: 1.7rem; border: 1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-border)); border-radius: 0.35rem; color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 9%, transparent); }
	.identity { display: flex; min-width: 0; flex: 1; flex-direction: column; line-height: 1.05; }
	.identity strong { overflow: hidden; color: var(--color-foreground); font-family: ui-monospace, monospace; font-size: 0.68rem; text-overflow: ellipsis; }
	.eyebrow { color: var(--color-muted-foreground); font-size: 0.5rem; font-weight: 750; letter-spacing: 0.14em; text-transform: uppercase; }
	.signal { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--color-muted-foreground); font-family: ui-monospace, monospace; font-size: 0.55rem; text-transform: uppercase; }
	.signal span { width: 0.35rem; height: 0.35rem; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0.45rem #22c55e; animation: signal-pulse 1.6s ease-in-out infinite; }
	.signal.warning span { background: #f59e0b; box-shadow: 0 0 0.45rem #f59e0b; }
	.signal.error { color: var(--color-destructive); }
	.signal.error span { background: var(--color-destructive); box-shadow: 0 0 0.45rem color-mix(in srgb, var(--color-destructive) 70%, transparent); }
	.track { display: grid; grid-template-columns: auto 1fr auto 1fr auto; align-items: center; gap: 0.35rem; padding: 0.55rem 0.65rem 0.35rem; }
	.station { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; color: var(--color-muted-foreground); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.45; }
	.station.active { color: var(--color-foreground); opacity: 1; }
	.track i { height: 1px; background: var(--color-border); }
	.track i.lit { background: color-mix(in srgb, var(--color-accent) 68%, #f59e0b); box-shadow: 0 0 0.35rem color-mix(in srgb, var(--color-accent) 30%, transparent); }
	.ticket { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.35rem 0.65rem 0.5rem; }
	.ticket strong { color: var(--color-foreground); font-size: 0.7rem; line-height: 1.25; }
	.ticket span { color: var(--color-muted-foreground); font-size: 0.59rem; }
	nav { display: flex; gap: 0.35rem; padding: 0 0.65rem 0.65rem; }
	nav a { display: inline-flex; align-items: center; gap: 0.2rem; border: 1px solid var(--color-border); border-radius: 0.32rem; padding: 0.3rem 0.45rem; color: var(--color-muted-foreground); background: var(--color-bg2); font-size: 0.6rem; font-weight: 650; text-decoration: none; }
	nav a:hover, nav a:focus-visible { border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border)); color: var(--color-foreground); outline: none; }
	nav a.primary { border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border)); color: var(--color-accent); }
	.fault { display: flex; align-items: flex-start; gap: 0.4rem; padding: 0.7rem; color: var(--color-destructive); font-size: 0.65rem; }
	@keyframes signal-pulse { 50% { opacity: 0.45; } }
	@media (prefers-reduced-motion: reduce) { .signal span { animation: none; } }
</style>
