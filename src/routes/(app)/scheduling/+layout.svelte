<script lang="ts">
	import type { Snippet } from 'svelte';
	import SchedulingNav from '$lib/components/scheduling/SchedulingNav.svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="h-full flex">
	<SchedulingNav />
	<div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{@render children()}</div>
</div>
