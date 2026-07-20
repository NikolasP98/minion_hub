<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
	import Topbar from '$lib/components/layout/Topbar.svelte';
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import DynamicIsland from '$lib/components/layout/DynamicIsland.svelte';
	// Eager (not idle-gated like the palette/shortcuts/g-nav/live-run group
	// below): the launcher pill is persistent, always-visible chrome — not an
	// invoked-on-demand overlay — so it must render on first paint, not appear
	// ~0.3-1.5s later once requestIdleCallback fires (that gap read as "the
	// hover pill isn't there" — regression from the P2 boot-diet commit,
	// which mis-grouped it with the genuinely invoke-only overlays).
	import FloatingAssistant from '$lib/components/layout/FloatingAssistant.svelte';
	import { type Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { loadHosts } from '$lib/state/features/hosts.svelte';
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

	// Overlay chrome (palette, shortcuts, g-nav, live-run) is invisible until
	// invoked — mount after first idle so their chunks stay off the shell's
	// hydration path. Hotkeys go live once mounted (≤1.5s). FloatingAssistant
	// is imported eagerly above — it is NOT invoked-only, its launcher pill is
	// always-visible chrome.
	let idleReady = $state(false);

	onMount(() => {
		void ensurePermissions();
		void hydratePluginNav();
		const markIdle = () => (idleReady = true);
		if ('requestIdleCallback' in window) requestIdleCallback(markIdle, { timeout: 1500 });
		else setTimeout(markIdle, 300);
	});

	// Re-sync hosts whenever the authoritative list lands or changes.
	// loadHosts() also runs from the ROOT layout, but that fires before this
	// (app) layout's data exists — so it used to initialise activeHostId from an
	// empty list and never re-run, leaving the picker showing "Add host" (and a
	// stale cached subset) until the user happened to visit a route that called
	// it again. Keyed on the server list so it re-runs on org switch too.
	$effect(() => {
		const servers = (page.data as { hosts?: { servers?: unknown[] } })?.hosts?.servers;
		if (servers) loadHosts();
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

	<FloatingAssistant />

	{#if idleReady}
		{#await import('$lib/components/layout/CommandPalette.svelte') then { default: CommandPalette }}
			<CommandPalette />
		{/await}
		{#await import('$lib/components/sessions/LiveRunWidget.svelte') then { default: LiveRunWidget }}
			<LiveRunWidget />
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
