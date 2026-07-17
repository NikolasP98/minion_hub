<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
	import Topbar from '$lib/components/layout/Topbar.svelte';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import DynamicIsland from '$lib/components/layout/DynamicIsland.svelte';
	import { type Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { ensurePermissions } from '$lib/state/features/permissions.svelte';
	import { hydratePluginNav } from '$lib/state/plugin-nav.svelte';
	import { fadeIn } from '$lib/animations';
	import { QueryClientProvider } from '@tanstack/svelte-query';
	import { queryClient } from '$lib/query/client';
	import { AppViewport } from '$lib/components/ui/foundations';

	let { children }: { children: Snippet } = $props();

	// Workshop editor (a specific save, /agents/workshop/<id>) runs in an immersive
	// focus mode: the global left rail collapses so the spatial canvas is the hero.
	// The gallery (/agents/workshop) and the experiment subtabs (compare/groupchat/
	// leaderboard) keep the rail — only a save-id path is immersive.
	const WORKSHOP_NON_IMMERSIVE = /^\/agents\/workshop\/(compare|groupchat|leaderboard)(\/|$)/;
	const immersive = $derived(
		/^\/agents\/workshop\/[^/]+/.test(canonicalPath(page.url.pathname)) &&
			!WORKSHOP_NON_IMMERSIVE.test(canonicalPath(page.url.pathname)),
	);

	// Fade wrapper keys on the top-level module segment, NOT the full pathname:
	// keying on the full path tore the whole routed subtree down on every nav,
	// recreating the module's side-nav (CrmNav/FinanceNav/…) and resetting its
	// scroll. Segment-keyed, module layouts persist across sub-page navigation
	// (scroll kept); the fade still plays when switching between modules.
	const moduleKey = $derived(canonicalPath(page.url.pathname).split('/')[1] ?? '');

	// Overlay chrome (palette, assistant, shortcuts, g-nav, live-run) is
	// invisible until invoked — mount after first idle so its chunks stay off
	// the shell's hydration path. Hotkeys go live once mounted (≤1.5s).
	let idleReady = $state(false);

	onMount(() => {
		void ensurePermissions();
		void hydratePluginNav();
		const markIdle = () => (idleReady = true);
		if ('requestIdleCallback' in window) requestIdleCallback(markIdle, { timeout: 1500 });
		else setTimeout(markIdle, 300);
	});
</script>

<QueryClientProvider client={queryClient}>
	<AppViewport density="compact" class="hub-shell-viewport">
		<div data-part="primary-shell" class="relative flex flex-1 min-w-0 min-h-0 overflow-hidden text-foreground">
			{#if !immersive}
				<Sidebar />
			{/if}
			<div class="shell-main flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
				<Topbar />
				<div data-part="route-viewport" class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
					{#key moduleKey}
						<div in:fadeIn={{ duration: 200 }} class="h-full min-h-0 flex flex-col">
							{@render children()}
						</div>
					{/key}
				</div>
			</div>
			<DynamicIsland />
		</div>
	</AppViewport>

	{#if idleReady}
		{#await import('$lib/components/layout/CommandPalette.svelte') then { default: CommandPalette }}
			<CommandPalette />
		{/await}
		{#await import('$lib/components/sessions/LiveRunWidget.svelte') then { default: LiveRunWidget }}
			<LiveRunWidget />
		{/await}
		{#await import('$lib/components/layout/FloatingAssistant.svelte') then { default: FloatingAssistant }}
			<FloatingAssistant />
		{/await}
		{#await import('$lib/components/layout/ShortcutsOverlay.svelte') then { default: ShortcutsOverlay }}
			<ShortcutsOverlay />
		{/await}
		{#await import('$lib/components/layout/GNav.svelte') then { default: GNav }}
			<GNav />
		{/await}
	{/if}

	{#if import.meta.env.DEV}
		{#await import('@tanstack/svelte-query-devtools') then { SvelteQueryDevtools }}
			<SvelteQueryDevtools />
		{/await}
	{/if}
</QueryClientProvider>
