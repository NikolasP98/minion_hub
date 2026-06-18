<script lang="ts">
	import { invalidate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { Check, Sparkles, RotateCw } from 'lucide-svelte';
	import {
		FUNNEL_ORDER,
		funnelStageColor,
		funnelStageIndex,
		readFunnelMeta,
		effectiveFunnelStage,
		maxFunnelStage,
		type FunnelStage,
	} from './crm-funnel';
	import { funnelStageLabel } from './crm-i18n';

	let {
		contactId,
		customFields,
		inbound,
		financeFloor = null,
	}: { contactId: string; customFields: Record<string, unknown> | null; inbound: number; financeFloor?: FunnelStage | null } = $props();

	const meta = $derived(readFunnelMeta(customFields));
	// Chat-derived stage, advanced by the finance floor (real purchases beat
	// sentiment). Read-time only — never persisted, so it stays decoupled.
	const chatStage = $derived(effectiveFunnelStage(customFields, { inbound }));
	const current = $derived(maxFunnelStage(chatStage, financeFloor));
	const curIdx = $derived(current ? funnelStageIndex(current) : -1);
	const overridden = $derived(meta ? !meta.auto : false);
	// True when billing pushed the contact past whatever chat/sentiment found.
	const byBilling = $derived(
		!!financeFloor &&
			current === financeFloor &&
			(!chatStage || funnelStageIndex(financeFloor) > funnelStageIndex(chatStage)),
	);

	let busy = $state(false);
	let analyzing = $state(false);
	// A suggestion the agent returned but did NOT apply (because a human pinned
	// the stage). Surfaced as a hint so the override stays in control.
	let suggestion = $state<{ stage: FunnelStage; reason: string; confidence: number } | null>(null);

	async function setStage(stage: FunnelStage) {
		if (busy || stage === current) return;
		busy = true;
		try {
			const res = await fetch(`/api/crm/contacts/${contactId}/funnel`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ stage }),
			});
			if (res.ok) {
				suggestion = null;
				await invalidate('crm:contact');
			}
		} finally {
			busy = false;
		}
	}

	async function analyze() {
		if (analyzing) return;
		analyzing = true;
		try {
			const res = await fetch(`/api/crm/contacts/${contactId}/funnel/analyze`, { method: 'POST' });
			if (!res.ok) return;
			const r = await res.json();
			if (r.applied) {
				suggestion = null;
				await invalidate('crm:contact');
			} else if (r.stage && funnelStageIndex(r.stage) > curIdx) {
				// Not applied (a human pinned the stage) but the agent sees the
				// contact further along — surface it as a non-destructive hint.
				suggestion = { stage: r.stage, reason: r.reason ?? '', confidence: r.confidence ?? 0 };
			}
		} finally {
			analyzing = false;
		}
	}

	// One-time auto-analysis on first view: only when the contact has inbound
	// messages and has NEVER been analyzed (no stored funnel blob). Guarded so it
	// never re-fires within the session even if the call fails.
	let autoTried = $state(false);
	$effect(() => {
		if (!autoTried && !meta && inbound > 0 && !analyzing) {
			autoTried = true;
			analyze();
		}
	});
</script>

<section class="card">
	<header class="card-h">
		<span>{m.crm_funnel_title()}</span>
		<button class="reanalyze" onclick={analyze} disabled={analyzing || busy} title={m.crm_funnel_analyze()}>
			{#if analyzing}<RotateCw size={13} class="animate-spin" />{:else}<Sparkles size={13} />{/if}
			<span>{analyzing ? m.crm_funnel_analyzing() : m.crm_funnel_analyze()}</span>
		</button>
	</header>

	<div class="funnel" class:busy>
		{#each FUNNEL_ORDER as id, i (id)}
			{@const reached = curIdx >= 0 && i <= curIdx}
			{@const isCurrent = i === curIdx}
			<button
				class="row"
				class:reached
				class:current={isCurrent}
				style:--c={funnelStageColor(id)}
				onclick={() => setStage(id)}
				disabled={busy}
				aria-current={isCurrent ? 'step' : undefined}
				title={m.crm_funnel_set_to({ stage: funnelStageLabel(id) })}
			>
				<span class="track">
					<span class="band" style:width={`${100 - i * 13}%`}></span>
				</span>
				<span class="label">
					<span class="name">{funnelStageLabel(id)}</span>
					{#if isCurrent}
						<span class="now">◀ {m.crm_funnel_now()}</span>
					{:else if reached}
						<Check size={13} class="chk" />
					{/if}
				</span>
			</button>
		{/each}
	</div>

	<footer class="foot">
		{#if current}
			<span class="cur-line">
				{m.crm_funnel_current()}
				<strong style:color={funnelStageColor(current)}>{funnelStageLabel(current)}</strong>
				{#if overridden}<span class="badge">{m.crm_funnel_pinned()}</span>{/if}
			</span>
			{#if byBilling}
				<span class="reason">{m.crm_funnel_by_billing()}</span>
			{:else if meta?.reason}
				<span class="reason">{meta.reason}</span>
			{/if}
		{:else}
			<span class="reason">{m.crm_funnel_none()}</span>
		{/if}

		{#if suggestion}
			<button class="suggest" onclick={() => suggestion && setStage(suggestion.stage)} disabled={busy}>
				<Sparkles size={12} />
				{m.crm_funnel_suggested({ stage: funnelStageLabel(suggestion.stage) })}
				{#if suggestion.reason}<span class="suggest-why">— {suggestion.reason}</span>{/if}
			</button>
		{/if}
	</footer>
</section>

<style>
	.card {
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		background: var(--color-card);
		padding: 0.85rem 1rem;
	}
	.card-h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-muted-foreground);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: 0.7rem;
	}
	.reanalyze {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.7rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: var(--color-accent);
		padding: 0.15rem 0.4rem;
		border-radius: var(--radius-md);
	}
	.reanalyze:hover {
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}
	.reanalyze:disabled {
		opacity: 0.6;
	}

	.funnel {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.funnel.busy {
		opacity: 0.7;
		pointer-events: none;
	}
	.row {
		display: grid;
		grid-template-columns: 9rem 1fr;
		align-items: center;
		gap: 0.7rem;
		width: 100%;
		text-align: left;
		border-radius: var(--radius-md);
		padding: 0.1rem 0.2rem;
	}
	.row:hover {
		background: rgba(255, 255, 255, 0.04);
	}
	.track {
		display: flex;
		justify-content: center;
		height: 1.6rem;
	}
	.band {
		height: 100%;
		border-radius: 4px;
		background: var(--color-bg3);
		border: 1px solid var(--hairline);
		transition:
			background-color var(--duration-fast) var(--ease-standard),
			border-color var(--duration-fast) var(--ease-standard);
	}
	/* reached bands are filled with the stage colour */
	.row.reached .band {
		background: color-mix(in srgb, var(--c) 22%, transparent);
		border-color: color-mix(in srgb, var(--c) 45%, transparent);
	}
	.row.current .band {
		background: color-mix(in srgb, var(--c) 38%, transparent);
		border-color: var(--c);
		box-shadow: 0 0 0 1px var(--c);
	}
	.label {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.84rem;
	}
	.name {
		color: var(--color-muted-foreground);
		font-weight: 500;
	}
	.row.reached .name {
		color: var(--color-foreground);
	}
	.row.current .name {
		color: var(--c);
		font-weight: 700;
	}
	.now {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--c);
	}
	:global(.row .chk) {
		color: color-mix(in srgb, var(--c) 80%, var(--color-foreground));
	}

	.foot {
		margin-top: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.cur-line {
		font-size: 0.8rem;
		color: var(--color-muted-foreground);
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.badge {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.05rem 0.3rem;
		border-radius: var(--radius-xs, 4px);
		color: var(--color-muted-foreground);
		background: rgba(255, 255, 255, 0.06);
	}
	.reason {
		font-size: 0.74rem;
		color: var(--color-muted-foreground);
		line-height: 1.35;
	}
	.suggest {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		text-align: left;
		font-size: 0.74rem;
		color: var(--color-accent);
		padding: 0.3rem 0.45rem;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-accent) 8%, transparent);
		border: 1px dashed color-mix(in srgb, var(--color-accent) 35%, transparent);
	}
	.suggest:hover {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
	}
	.suggest-why {
		color: var(--color-muted-foreground);
	}
</style>
