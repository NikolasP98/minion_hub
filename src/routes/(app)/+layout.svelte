<script lang="ts">
	import Topbar from '$lib/components/layout/Topbar.svelte';
	import { type Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
	<Topbar />
	{@render children()}
</div>
