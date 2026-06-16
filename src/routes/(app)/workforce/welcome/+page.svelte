<script lang="ts">
	import { onMount } from 'svelte';
	import { toastWarning, toastInfo } from '$lib/state/ui/toast.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Copy = { title: string; body: string; tone: 'info' | 'warning' };

	// One entry per failure mode the /workforce gate + pages can redirect with.
	// Keep these specific and actionable — this page is the only thing the user
	// sees when Workforce can't load, so a vague message reads as "broken".
	const COPY: Record<string, Copy> = {
		'no-org': {
			title: 'No organization selected',
			body: 'Pick an organization from the switcher in the sidebar to open its Workforce workspace.',
			tone: 'info',
		},
		'no-company': {
			title: 'Workforce workspace not connected',
			body:
				"This organization isn't linked to a Workforce workspace yet, or the hub's " +
				'Workforce credentials are missing in this environment. An instance admin should confirm ' +
				'HUB_WORKFORCE_BOARD_KEY is set and that this org has a company mapping, then reload.',
			tone: 'warning',
		},
		'provision-failed': {
			title: "Couldn't set up the Workforce workspace",
			body:
				'We tried to create a Workforce workspace for this organization but the Workforce backend ' +
				"rejected it. This usually means the hub's board key is missing or isn't an instance admin. " +
				'Ask an instance admin to confirm HUB_WORKFORCE_BOARD_KEY, then reload.',
			tone: 'warning',
		},
	};

	const FALLBACK: Copy = {
		title: 'Workforce unavailable',
		body:
			"Workforce isn't available for this organization right now. If this keeps happening, an " +
			"instance admin should check the hub's Workforce configuration.",
		tone: 'warning',
	};

	const reason = $derived(data.reason ?? null);
	const copy = $derived((reason && COPY[reason]) || FALLBACK);

	onMount(() => {
		// Surface a toast for actionable failures so it's noticed even if the user
		// navigates away from this page. "no-org" is benign (just pick an org).
		if (reason === 'no-org') return;
		const notify = copy.tone === 'warning' ? toastWarning : toastInfo;
		notify(copy.title, reason ? `Reason: ${reason}` : undefined);
	});
</script>

<div class="max-w-xl p-8">
	<h1 class="text-2xl font-semibold">{copy.title}</h1>
	<p class="text-muted-foreground mt-2 leading-relaxed">{copy.body}</p>

	{#if reason && reason !== 'no-org'}
		<button
			class="hover:bg-accent mt-5 rounded border px-3 py-1.5 text-sm transition-colors"
			onclick={() => location.reload()}
		>
			Reload
		</button>
		<p class="text-muted-foreground/50 mt-3 text-xs">Reason code: {reason}</p>
	{/if}
</div>
