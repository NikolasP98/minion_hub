<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { page } from '$app/state';
	import { Home, Users, Wrench } from 'lucide-svelte';
	import Tooltip from '$lib/components/layout/Tooltip.svelte';

	const items = [
		{ href: '/my-agent', label: m.nav_myAgent(), icon: Home },
		{ href: '/agents', label: m.nav_agents(), icon: Users },
		{ href: '/agents/workshop', label: m.nav_workshop(), icon: Wrench },
	];

	const currentPath = $derived(page.url.pathname);

	// Highlight only the most-specific matching item so e.g. /agents/workshop
	// lights up Workshop rather than both Workshop and Agents.
	const activeHref = $derived.by(() => {
		let best = '';
		for (const it of items) {
			if ((currentPath === it.href || currentPath.startsWith(it.href + '/')) && it.href.length > best.length) {
				best = it.href;
			}
		}
		return best;
	});
</script>

<nav class="nav-rail" aria-label={m.nav_primaryAria()}>
	{#each items as item (item.href)}
		{@const Icon = item.icon}
		{@const active = item.href === activeHref}
		<Tooltip label={item.label} id={`agent-nav-tip-${item.href}`} placement="right" openDelay={150}>
			{#snippet children(trigger)}
				<a
					href={item.href}
					{...trigger}
					class="nav-rail-item"
					class:active
					aria-label={item.label}
					aria-current={active ? 'page' : undefined}
				>
					<Icon size={18} />
				</a>
			{/snippet}
		</Tooltip>
	{/each}
</nav>

<style>
	.nav-rail {
		width: 48px;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 12px 0;
		background: var(--color-bg);
		border-right: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.nav-rail-item {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--theme-radius, 8px);
		color: var(--color-muted);
		text-decoration: none;
		transition: color 120ms ease, background 120ms ease;
	}

	.nav-rail-item:hover {
		color: var(--color-foreground);
		background: color-mix(in srgb, var(--color-foreground) 5%, transparent);
	}

	.nav-rail-item.active {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 10%, transparent);
	}

	.nav-rail-item:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
