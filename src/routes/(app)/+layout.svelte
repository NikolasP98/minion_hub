<script lang="ts">
	import Topbar from '$lib/components/layout/Topbar.svelte';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import DynamicIsland from '$lib/components/layout/DynamicIsland.svelte';
	import ConnectionBanner from '$lib/components/layout/ConnectionBanner.svelte';
	import CommandPalette from '$lib/components/layout/CommandPalette.svelte';
	import LiveRunWidget from '$lib/components/sessions/LiveRunWidget.svelte';
	import FloatingAssistant from '$lib/components/layout/FloatingAssistant.svelte';
	import { type Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { ensurePermissions } from '$lib/state/features/permissions.svelte';
	import { hydratePluginNav } from '$lib/state/plugin-nav.svelte';

	let { children }: { children: Snippet } = $props();

	// Workshop editor (a specific save, /agents/workshop/<id>) runs in an immersive
	// focus mode: the global left rail collapses so the spatial canvas is the hero.
	// The gallery (/agents/workshop) keeps the rail. WorkshopToolbar's "↩ Gallery"
	// link is the escape hatch.
	const immersive = $derived(/^\/agents\/workshop\/[^/]+/.test(page.url.pathname));

	onMount(() => {
		void ensurePermissions();
		void hydratePluginNav();
	});
</script>

<div class="relative z-10 flex h-screen overflow-hidden text-foreground">
	{#if !immersive}
		<Sidebar />
	{/if}
	<div class="shell-main flex flex-col flex-1 min-w-0 overflow-hidden">
		<Topbar />
		<ConnectionBanner />
		{@render children()}
	</div>
	<DynamicIsland />
</div>

<CommandPalette />
<LiveRunWidget />
<FloatingAssistant />
