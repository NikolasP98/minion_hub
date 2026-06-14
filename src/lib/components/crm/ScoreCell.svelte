<script lang="ts">
	import * as msg from '$lib/paraglide/messages';
	import { scoreColor } from './crm-format';
	import ScoreBadge from './ScoreBadge.svelte';
	let {
		score,
		r,
		f,
		m,
	}: { score: number; r: number; f: number; m: number } = $props();

	const parts = $derived([
		{ k: 'R', label: msg.crm_recency(), v: r, hint: msg.crm_score_recency_hint() },
		{ k: 'F', label: msg.crm_frequency(), v: f, hint: msg.crm_score_frequency_hint() },
		{ k: 'M', label: msg.crm_score_m_label(), v: m, hint: msg.crm_score_engagement_hint() },
	]);
</script>

<div class="cell">
	<ScoreBadge {score} {r} {f} {m} />
	<div class="tip" role="tooltip">
		<div class="tip-head">
			<span class="big" style:color={scoreColor(score)}>{Math.round(score)}</span>
			<span class="tip-title">{msg.crm_engagement_score()}</span>
		</div>
		<div class="tip-formula">0.5·R + 0.3·F + 0.2·M</div>
		{#each parts as p (p.k)}
			<div class="tip-row">
				<span class="tip-k" style:color={scoreColor(p.v)}>{p.k}</span>
				<span class="tip-label">{p.label}</span>
				<div class="tip-bar"><div class="tip-fill" style:width="{Math.max(2, Math.min(100, p.v))}%" style:background={scoreColor(p.v)}></div></div>
				<span class="tip-val">{p.v}</span>
			</div>
		{/each}
	</div>
</div>

<style>
	.cell { position: relative; display: inline-flex; }
	.tip {
		position: absolute; top: calc(100% + 6px); left: 0; z-index: 50;
		width: 15rem; padding: 0.6rem 0.7rem; pointer-events: none;
		background: var(--color-card); border: 1px solid var(--hairline);
		border-radius: var(--radius-md); box-shadow: 0 10px 30px rgba(0,0,0,0.4);
		opacity: 0; transform: translateY(-3px); transition: opacity 0.12s, transform 0.12s;
	}
	.cell:hover .tip { opacity: 1; transform: translateY(0); }
	.tip-head { display: flex; align-items: baseline; gap: 0.4rem; margin-bottom: 0.1rem; }
	.big { font-size: 1.3rem; font-weight: 700; font-variant-numeric: tabular-nums; }
	.tip-title { font-size: 0.72rem; color: var(--color-muted-foreground); }
	.tip-formula { font-size: 0.66rem; color: var(--color-muted-foreground); font-family: var(--font-mono, monospace); margin-bottom: 0.45rem; }
	.tip-row { display: grid; grid-template-columns: 1rem 1fr 3.5rem 2rem; align-items: center; gap: 0.4rem; padding: 0.12rem 0; }
	.tip-k { font-weight: 700; font-size: 0.78rem; }
	.tip-label { font-size: 0.72rem; color: var(--color-muted-foreground); }
	.tip-bar { height: 5px; border-radius: 999px; background: var(--color-muted); overflow: hidden; }
	.tip-fill { height: 100%; border-radius: 999px; }
	.tip-val { font-size: 0.74rem; font-variant-numeric: tabular-nums; text-align: right; font-weight: 600; }
</style>
