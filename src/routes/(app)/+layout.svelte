<script lang="ts">
	import Topbar from '$lib/components/layout/Topbar.svelte';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import DynamicIsland from '$lib/components/layout/DynamicIsland.svelte';
	import Breadcrumbs from '$lib/components/layout/Breadcrumbs.svelte';
	import ConnectionBanner from '$lib/components/layout/ConnectionBanner.svelte';
	import CommandPalette from '$lib/components/layout/CommandPalette.svelte';
	import LiveRunWidget from '$lib/components/sessions/LiveRunWidget.svelte';
	import FloatingAssistant from '$lib/components/layout/FloatingAssistant.svelte';
	import { type Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { ensurePermissions } from '$lib/state/features/permissions.svelte';
	import { hydratePluginNav } from '$lib/state/plugin-nav.svelte';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		void ensurePermissions();
		void hydratePluginNav();
	});
</script>

<div class="relative z-10 flex h-screen overflow-hidden text-foreground">
	<Sidebar />
	<div class="shell-main flex flex-col flex-1 min-w-0 overflow-hidden">
		<Topbar />
		<ConnectionBanner />
		<Breadcrumbs />
		{@render children()}
	</div>
	<DynamicIsland />
</div>

<CommandPalette />
<LiveRunWidget />
<FloatingAssistant />
