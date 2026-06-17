<script lang="ts">
	import { funnelStageColor } from './crm-funnel';
	import { funnelStageLabel } from './crm-i18n';

	// `stage` may be null (a manual contact with no first contact yet → "—").
	let { stage, overridden = false }: { stage: string | null; overridden?: boolean } = $props();
</script>

{#if stage}
	<span class="pill" style:--c={funnelStageColor(stage)}>
		{funnelStageLabel(stage)}
		{#if overridden}<span class="dot" aria-hidden="true"></span>{/if}
	</span>
{:else}
	<span class="none">—</span>
{/if}

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
	.none {
		color: var(--color-muted-foreground);
	}
</style>
