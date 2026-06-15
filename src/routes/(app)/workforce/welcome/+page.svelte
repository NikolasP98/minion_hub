<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	const message = $derived(
		data.reason === 'provision-failed'
			? "We couldn't set up a Workforce workspace for this organization. A paperclip instance admin needs to confirm the hub's board key, then reload."
			: data.reason === 'no-org'
				? 'No organization is selected. Pick an organization from the sidebar to use Workforce.'
				: 'Workforce is not available for this organization yet. Ask an instance admin to enable it.',
	);
</script>

<div class="p-8 max-w-lg">
	<h1 class="text-2xl font-semibold">Welcome</h1>
	<p class="mt-2 text-muted">{message}</p>
</div>
