<script lang="ts">
	import { financeSync } from '$lib/state/features/finance-sync.svelte';
	import * as progress from '@zag-js/progress';
	import { useMachine, normalizeProps } from '@zag-js/svelte';

	const service = useMachine(progress.machine as any, () => ({
		id: 'fin-nav-progress',
		value: financeSync.total == null ? null : financeSync.processed,
		max: financeSync.total ?? 100,
	}));
	const api = $derived(progress.connect(service as unknown as progress.Service, normalizeProps));
</script>

{#if financeSync.active}
	<span {...api.getRootProps()} class="badge" title={`${financeSync.percent}%`}>
		<svg viewBox="0 0 24 24" width="14" height="14" class={financeSync.total == null ? 'spin' : ''}>
			<circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-bg3)" stroke-width="3" />
			<circle
				cx="12" cy="12" r="9" fill="none" stroke="var(--color-accent)" stroke-width="3"
				stroke-linecap="round" transform="rotate(-90 12 12)"
				stroke-dasharray={2 * Math.PI * 9}
				stroke-dashoffset={financeSync.total == null
					? 2 * Math.PI * 9 * 0.7
					: 2 * Math.PI * 9 * (1 - financeSync.percent / 100)}
			/>
		</svg>
	</span>
{/if}

<style>
	.badge { display: inline-flex; align-items: center; justify-content: center; margin-left: auto; }
	.spin { animation: spin 1s linear infinite; transform-origin: center; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
