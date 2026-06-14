<script lang="ts">
	import { stageColor } from './crm-format';
	import { stageLabel } from './crm-i18n';
	let { stage, overridden = false }: { stage: string; overridden?: boolean } = $props();
</script>

<span class="pill" style:--c={stageColor(stage)}>
	{stageLabel(stage)}
	{#if overridden}<span class="dot" aria-hidden="true"></span>{/if}
</span>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--c);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
		white-space: nowrap;
	}
	.dot {
		width: 4px;
		height: 4px;
		border-radius: 999px;
		background: var(--c);
	}
</style>
