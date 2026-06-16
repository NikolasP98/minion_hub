<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { toastError } from '$lib/state/ui/toast.svelte';

	const status = $derived(page.status);
	// 502/503/504 from the workforce loads mean the Workforce backend was
	// unreachable or errored — distinct from a real app bug.
	const isBackend = $derived(status === 502 || status === 503 || status === 504);

	const title = $derived(isBackend ? 'Workforce backend unavailable' : 'Something went wrong');
	const detail = $derived(
		isBackend
			? 'Couldn’t reach the Workforce backend. It may be starting up, restarting, or temporarily unreachable — retry in a moment.'
			: (page.error?.message ?? 'An unexpected error occurred.'),
	);

	onMount(() => {
		toastError(title, isBackend ? `HTTP ${status}` : (page.error?.message ?? undefined));
	});
</script>

<div class="max-w-xl p-6">
	<h1 class="text-xl font-semibold">{title}</h1>
	<p class="text-muted-foreground mt-2 leading-relaxed">{detail}</p>
	<button
		class="hover:bg-accent mt-4 rounded border px-3 py-1.5 text-sm transition-colors"
		onclick={() => location.reload()}
	>
		Retry
	</button>
	{#if status}
		<p class="text-muted-foreground/50 mt-3 text-xs">Status {status}</p>
	{/if}
</div>
