<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { LayoutDashboard, Users, UserPlus, Activity, TrendingDown, Info, Flame, Wallet } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';
	import StagePill from '$lib/components/crm/StagePill.svelte';
	import CrmFunnelRibbon from '$lib/components/crm/CrmFunnelRibbon.svelte';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import { temperatureColor, type Temperature } from '$lib/components/crm/crm-format';
	import { funnelStageColor } from '$lib/components/crm/crm-funnel';
	import { stageLabel } from '$lib/components/crm/crm-i18n';

	let { data }: { data: PageData } = $props();
	const s = $derived(data.stats);

	const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
	const funnelMax = $derived(Math.max(1, ...STAGES.map((st) => s.stageCounts[st] ?? 0)));
	const bucketMax = $derived(Math.max(1, ...s.scoreBuckets));
	const channelTotal = $derived(s.channels.reduce((acc, c) => acc + c.count, 0));

	// Per-stage definition tooltips (transparency: "what makes someone Active?").
	const STAGE_HELP: Record<string, string> = {
		New: m.crm_stage_help_New(),
		Engaged: m.crm_stage_help_Engaged(),
		Active: m.crm_stage_help_Active(),
		Dormant: m.crm_stage_help_Dormant(),
		Churned: m.crm_stage_help_Churned(),
	};

	const kpis = $derived([
		{ label: m.crm_dash_total(), value: s.total, icon: Users, help: m.crm_dash_total_help() },
		{ label: m.crm_dash_active(), value: s.activeWeek, icon: Activity, help: m.crm_dash_active_help() },
		{ label: m.crm_dash_new(), value: s.newCount, icon: UserPlus, help: m.crm_dash_new_help() },
		{ label: m.crm_dash_churned(), value: s.churned, icon: TrendingDown, help: m.crm_dash_churned_help() },
	]);

	// Engagement-temperature breakdown (hot/warm/cold), computed server-side.
	const tempRows = $derived(
		(['hot', 'warm', 'cold'] as Temperature[]).map((t) => ({
			key: t,
			label: t === 'hot' ? m.crm_temp_hot() : t === 'warm' ? m.crm_temp_warm() : m.crm_temp_cold(),
			count: s.temperature[t],
			color: temperatureColor(t),
		})),
	);
	const tempTotal = $derived(s.temperature.hot + s.temperature.warm + s.temperature.cold);

	// Conversion funnel rows (leads → booked → bought), coloured by funnel stage.
	const convRows = $derived([
		{ key: 'leads', label: m.crm_conv_leads(), count: s.conversion.leads, color: funnelStageColor('lead') },
		{ key: 'booked', label: m.crm_conv_booked(), count: s.conversion.booked, color: funnelStageColor('intent') },
		{ key: 'bought', label: m.crm_conv_bought(), count: s.conversion.bought, color: funnelStageColor('customer') },
	]);

	const fmtMoney = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

	// Acquisition-date range filter (server-side cohort scoping).
	const RANGES = [
		{ id: 'all', label: () => m.crm_dash_range_all() },
		{ id: '7d', label: () => m.crm_dash_range_7d() },
		{ id: '30d', label: () => m.crm_dash_range_30d() },
		{ id: '90d', label: () => m.crm_dash_range_90d() },
		{ id: '365d', label: () => m.crm_dash_range_365d() },
	];
	function setRange(r: string) {
		const url = new URL(page.url);
		if (r === 'all') url.searchParams.delete('range');
		else url.searchParams.set('range', r);
		url.searchParams.delete('from');
		url.searchParams.delete('to');
		goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	// Score-bucket bar accent: low scores muted → high scores accent.
	function bucketColor(i: number): string {
		const pct = i / 9;
		return `color-mix(in srgb, var(--color-accent) ${Math.round(25 + pct * 75)}%, var(--color-muted))`;
	}
</script>

<svelte:head><title>{m.crm_nav_dashboard()} — {m.crm_title()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.crm_nav_dashboard()} subtitle={m.crm_subtitle()}>
		{#snippet leading()}
			<LayoutDashboard size={16} class="text-accent shrink-0" />
		{/snippet}
	</PageHeader>

	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-6xl">
		<!-- Date-range cohort filter -->
		<div class="flex items-center gap-2 flex-wrap">
			<div class="seg" role="group" title={m.crm_dash_range_hint()}>
				{#each RANGES as r (r.id)}
					<button class="seg-btn" class:active={s.range === r.id} onclick={() => setRange(r.id)}>{r.label()}</button>
				{/each}
			</div>
			<span class="t-caption">{m.crm_dash_range_hint()}</span>
		</div>

		<!-- KPI cards -->
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
			{#each kpis as k (k.label)}
				{@const Icon = k.icon}
				<div class="kpi">
					<div class="kpi-icon"><Icon size={16} /></div>
					<div class="kpi-val">{k.value.toLocaleString()}</div>
					<div class="kpi-label">
						<span>{k.label}</span>
						<span class="kpi-help" title={k.help}><Info size={12} /></span>
					</div>
				</div>
			{/each}
		</div>

		<!-- Marketing-funnel ribbon (breakdown across stages) -->
		<section class="card">
			<header class="card-h">{m.crm_funnel_title()}</header>
			<CrmFunnelRibbon counts={s.funnelCounts} />
		</section>

		<div class="grid gap-4 lg:grid-cols-2">
			<!-- Stage funnel -->
			<section class="card">
				<header class="card-h">{m.crm_dash_stage_funnel()}</header>
				<div class="funnel">
					{#each STAGES as st (st)}
						{@const n = s.stageCounts[st] ?? 0}
						<button class="funnel-row" onclick={() => goto(`/crm/customers`)} title={`${stageLabel(st)} — ${STAGE_HELP[st]}`}>
							<span class="funnel-label"><StagePill stage={st} overridden={false} /></span>
							<span class="funnel-bar-wrap">
								<span class="funnel-bar" style:width={`${(n / funnelMax) * 100}%`}></span>
							</span>
							<span class="funnel-n">{n.toLocaleString()}</span>
						</button>
					{/each}
				</div>
			</section>

			<!-- Score distribution -->
			<section class="card">
				<header class="card-h">{m.crm_dash_score_dist()} <span class="avg">{m.crm_dash_avg_score({ score: s.avgScore })}</span></header>
				<div class="dist">
					{#each s.scoreBuckets as count, i (i)}
						<div class="dist-col" title={`${i * 10}–${i * 10 + 9}: ${count}`}>
							<div class="dist-bar" style:height={`${Math.max(2, (count / bucketMax) * 100)}%`} style:background={bucketColor(i)}></div>
						</div>
					{/each}
				</div>
				<div class="dist-axis"><span>0</span><span>50</span><span>100</span></div>
			</section>

			<!-- Channel mix -->
			<section class="card">
				<header class="card-h">{m.crm_dash_channels()}</header>
				{#if s.channels.length === 0}
					<p class="t-caption py-2">{m.crm_channels_none()}</p>
				{:else}
					<ul class="chmix">
						{#each s.channels as c (c.channel)}
							{@const pct = channelTotal ? Math.round((c.count / channelTotal) * 100) : 0}
							<li class="chrow">
								<ChannelBrandIcon channel={c.channel} size={16} />
								<span class="ch-name">{c.channel.charAt(0).toUpperCase() + c.channel.slice(1)}</span>
								<span class="ch-bar-wrap"><span class="ch-bar" style:width={`${pct}%`}></span></span>
								<span class="ch-n">{c.count.toLocaleString()}</span>
								<span class="ch-pct">{pct}%</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<!-- Engagement temperature (hot/warm/cold by RFM score) -->
			<section class="card">
				<header class="card-h">
					<span class="flex items-center gap-1.5"><Flame size={13} /> {m.crm_dash_temperature()}</span>
					<span class="kpi-help" title={m.crm_dash_temperature_help()}><Info size={12} /></span>
				</header>
				<ul class="chmix">
					{#each tempRows as t (t.key)}
						{@const pct = tempTotal ? Math.round((t.count / tempTotal) * 100) : 0}
						<li class="chrow">
							<span class="temp-dot" style:background={t.color}></span>
							<span class="ch-name">{t.label}</span>
							<span class="ch-bar-wrap"><span class="ch-bar" style:width={`${pct}%`} style:background={t.color}></span></span>
							<span class="ch-n">{t.count.toLocaleString()}</span>
							<span class="ch-pct">{pct}%</span>
						</li>
					{/each}
				</ul>
			</section>

			<!-- Revenue from CRM (only when CRM + Finances are both enabled) -->
			{#if s.revenue}
				<section class="card">
					<header class="card-h"><span class="flex items-center gap-1.5"><Wallet size={13} /> {m.crm_dash_revenue_title()}</span></header>
					<div class="rev-grid">
						<div class="rev-stat">
							<span class="rev-val">{fmtMoney(s.revenue.revenue)}</span>
							<span class="rev-label">{m.crm_rev_total()}</span>
						</div>
						<div class="rev-stat">
							<span class="rev-val">{fmtMoney(s.revenue.avgTicket)}</span>
							<span class="rev-label">{m.crm_rev_avg_ticket()}</span>
						</div>
						<div class="rev-stat">
							<span class="rev-val">{s.revenue.buyers.toLocaleString()}</span>
							<span class="rev-label">{m.crm_rev_buyers()}</span>
						</div>
						<div class="rev-stat">
							<span class="rev-val">{s.revenue.invoices.toLocaleString()}</span>
							<span class="rev-label">{m.crm_rev_invoices()}</span>
						</div>
					</div>
					{#if s.revenue.reserved > 0}
						<a class="rev-cta" href="/crm/customers?reserved=1">{m.crm_dash_reserved_cta({ count: s.revenue.reserved })}</a>
					{/if}
				</section>
			{/if}

			<!-- B5 — message responsiveness -->
			<section class="card">
				<header class="card-h">
					<span>{m.crm_dash_response()}</span>
					<span class="kpi-help" title={m.crm_resp_help()}><Info size={12} /></span>
				</header>
				<div class="rev-grid">
					<div class="rev-stat">
						<span class="rev-val">{s.response.awaiting.toLocaleString()}</span>
						<span class="rev-label">{m.crm_resp_awaiting()}</span>
					</div>
					<div class="rev-stat">
						<span class="rev-val">{s.response.responseRate}%</span>
						<span class="rev-label">{m.crm_resp_rate()}</span>
					</div>
				</div>
				{#if s.response.awaitingByTemp.hot > 0}
					<a class="rev-cta" href="/crm/customers?awaiting=1">{m.crm_resp_hot_awaiting({ count: s.response.awaitingByTemp.hot })}</a>
				{/if}
			</section>

			<!-- B6 — conversion funnel (leads → booked → bought) -->
			<section class="card">
				<header class="card-h">
					<span>{m.crm_dash_conversion()}</span>
					<span class="kpi-help" title={m.crm_dash_conversion_help()}><Info size={12} /></span>
				</header>
				<ul class="chmix">
					{#each convRows as r (r.key)}
						{@const pct = s.conversion.leads ? Math.round((r.count / s.conversion.leads) * 100) : 0}
						<li class="chrow">
							<span class="temp-dot" style:background={r.color}></span>
							<span class="ch-name">{r.label}</span>
							<span class="ch-bar-wrap"><span class="ch-bar" style:width={`${pct}%`} style:background={r.color}></span></span>
							<span class="ch-n">{r.count.toLocaleString()}</span>
							<span class="ch-pct">{pct}%</span>
						</li>
					{/each}
				</ul>
			</section>
		</div>
	</div>
</div>

<style>
	.kpi {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		position: relative;
	}
	.kpi-icon {
		position: absolute;
		top: 0.85rem;
		right: 0.9rem;
		color: var(--color-muted-foreground);
		opacity: 0.6;
	}
	.kpi-val {
		font-size: 1.75rem;
		font-weight: 700;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.kpi-label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.78rem;
		color: var(--color-muted-foreground);
	}
	.kpi-help {
		display: inline-flex;
		color: var(--color-muted-foreground);
		opacity: 0.5;
		cursor: help;
		transition: opacity var(--duration-fast) var(--ease-standard);
	}
	.kpi-help:hover {
		opacity: 1;
	}
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: 0.85rem 1rem;
	}
	.card-h {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: 0.8rem;
	}
	.avg {
		font-size: 0.72rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: var(--color-accent);
	}

	/* funnel */
	.funnel { display: flex; flex-direction: column; gap: 0.5rem; }
	.funnel-row {
		display: grid;
		grid-template-columns: 5.5rem 1fr auto;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		text-align: left;
	}
	.funnel-label { display: inline-flex; }
	.funnel-bar-wrap { height: 0.6rem; border-radius: 999px; background: var(--color-bg3); overflow: hidden; }
	.funnel-bar { display: block; height: 100%; border-radius: 999px; background: var(--color-accent); transition: width var(--duration-fast) var(--ease-standard); }
	.funnel-n { font-size: 0.82rem; font-variant-numeric: tabular-nums; min-width: 2.5rem; text-align: right; }
	.funnel-row:hover .funnel-bar { filter: brightness(1.15); }

	/* score distribution */
	.dist { display: flex; align-items: flex-end; gap: 0.3rem; height: 7rem; }
	.dist-col { flex: 1; display: flex; align-items: flex-end; height: 100%; }
	.dist-bar { width: 100%; border-radius: var(--radius-sm, 4px) var(--radius-sm, 4px) 0 0; transition: height var(--duration-fast) var(--ease-standard); }
	.dist-axis { display: flex; justify-content: space-between; font-size: 0.66rem; color: var(--color-muted-foreground); margin-top: 0.35rem; }

	/* channel mix */
	.chmix { display: flex; flex-direction: column; gap: 0.55rem; }
	.chrow { display: grid; grid-template-columns: auto 5rem 1fr auto auto; align-items: center; gap: 0.55rem; font-size: 0.84rem; }
	.ch-name { font-weight: 500; }
	.ch-bar-wrap { height: 0.55rem; border-radius: 999px; background: var(--color-bg3); overflow: hidden; }
	.ch-bar { display: block; height: 100%; border-radius: 999px; background: var(--color-accent); }
	.ch-n { font-variant-numeric: tabular-nums; text-align: right; min-width: 2.5rem; }
	.ch-pct { font-variant-numeric: tabular-nums; color: var(--color-muted-foreground); min-width: 2.5rem; text-align: right; }

	/* date-range segmented control */
	.seg {
		display: inline-flex;
		gap: 0.15rem;
		padding: 0.2rem;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--color-card);
	}
	.seg-btn {
		padding: 0.25rem 0.65rem;
		border-radius: var(--radius-sm, 6px);
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--color-muted-foreground);
		font-variant-numeric: tabular-nums;
		transition:
			color var(--duration-fast) var(--ease-standard),
			background-color var(--duration-fast) var(--ease-standard);
	}
	.seg-btn:hover { color: var(--color-foreground); }
	.seg-btn.active {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		font-weight: 600;
	}

	/* temperature breakdown (reuses .chmix/.chrow grid) */
	.temp-dot { width: 0.7rem; height: 0.7rem; border-radius: 999px; }

	/* revenue summary */
	.rev-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem 1rem; }
	.rev-stat { display: flex; flex-direction: column; gap: 0.1rem; }
	.rev-val { font-size: 1.3rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
	.rev-label { font-size: 0.74rem; color: var(--color-muted-foreground); }
	.rev-cta {
		display: inline-block; margin-top: 0.8rem; font-size: 0.78rem; font-weight: 600;
		color: var(--color-warning); text-decoration: none;
	}
	.rev-cta:hover { text-decoration: underline; }
</style>
