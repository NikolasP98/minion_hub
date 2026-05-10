<script lang="ts">
	import Topbar from '$lib/components/layout/Topbar.svelte';
	import CommandPalette from '$lib/components/layout/CommandPalette.svelte';
	import LiveRunWidget from '$lib/components/sessions/LiveRunWidget.svelte';
	import FloatingAssistant from '$lib/components/layout/FloatingAssistant.svelte';
	import { type Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
	<Topbar />
	{@render children()}
</div>

<CommandPalette />
<LiveRunWidget />
<FloatingAssistant />
