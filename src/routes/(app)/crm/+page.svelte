<script lang="ts">
	import type { PageData } from './$types';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { LayoutDashboard, Users, UserPlus, Activity, TrendingDown } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';
	import StagePill from '$lib/components/crm/StagePill.svelte';
	import CrmFunnelRibbon from '$lib/components/crm/CrmFunnelRibbon.svelte';
	import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
	import { relativeTime, contactLabel } from '$lib/components/crm/crm-format';
	import { stageLabel } from '$lib/components/crm/crm-i18n';

	let { data }: { data: PageData } = $props();
	const s = $derived(data.stats);

	const STAGES = ['New', 'Engaged', 'Active', 'Dormant', 'Churned'];
	const funnelMax = $derived(Math.max(1, ...STAGES.map((st) => s.stageCounts[st] ?? 0)));
	const bucketMax = $derived(Math.max(1, ...s.scoreBuckets));
	const channelTotal = $derived(s.channels.reduce((acc, c) => acc + c.count, 0));

	const kpis = $derived([
		{ label: m.crm_dash_total(), value: s.total, icon: Users },
		{ label: m.crm_dash_active(), value: s.activeWeek, icon: Activity },
		{ label: m.crm_dash_new(), value: s.newCount, icon: UserPlus },
		{ label: m.crm_dash_churned(), value: s.churned, icon: TrendingDown },
	]);

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
		<!-- KPI cards -->
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
			{#each kpis as k (k.label)}
				{@const Icon = k.icon}
				<div class="kpi">
					<div class="kpi-icon"><Icon size={16} /></div>
					<div class="kpi-val">{k.value.toLocaleString()}</div>
					<div class="kpi-label">{k.label}</div>
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
						<button class="funnel-row" onclick={() => goto(`/crm/customers`)} title={stageLabel(st)}>
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

			<!-- Recent activity -->
			<section class="card">
				<header class="card-h">{m.crm_dash_recent()}</header>
				{#if s.recent.length === 0}
					<p class="t-caption py-2">{m.crm_no_interactions()}</p>
				{:else}
					<ul class="recent">
						{#each s.recent as c (c.contact_id)}
							<li>
								<button class="rec-row" onclick={() => goto(`/crm/${c.contact_id}`)}>
									<span class="rec-name" title={contactLabel(c.display_name)}>{contactLabel(c.display_name)}</span>
									<span class="rec-channels">
										{#each c.channels.slice(0, 3) as ch (ch)}<ChannelBrandIcon channel={ch} size={13} />{/each}
									</span>
									<StagePill stage={c.stage} overridden={false} />
									<span class="rec-when t-caption">{relativeTime(c.last_contact_at)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
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
		font-size: 0.78rem;
		color: var(--color-muted-foreground);
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

	/* recent activity */
	.recent { display: flex; flex-direction: column; }
	.rec-row {
		display: grid;
		grid-template-columns: 1fr auto auto auto;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.45rem 0;
		border-top: 1px solid var(--hairline);
		text-align: left;
	}
	.recent li:first-child .rec-row { border-top: none; }
	.rec-row:hover { color: var(--color-accent); }
	.rec-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.rec-channels { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--color-muted-foreground); }
	.rec-when { min-width: 4rem; text-align: right; }
</style>
