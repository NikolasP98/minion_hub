<script lang="ts">
	import { page } from '$app/state';
	import { Home, Users, Wrench, Settings } from 'lucide-svelte';

	const items = [
		{ href: '/my-agent', label: 'My Agent', icon: Home },
		{ href: '/agents', label: 'Agents', icon: Users },
		{ href: '/agents/workshop', label: 'Workshop', icon: Wrench },
		{ href: '/settings', label: 'Settings', icon: Settings },
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

<nav class="nav-rail" aria-label="Primary">
	{#each items as item (item.href)}
		{@const Icon = item.icon}
		{@const active = item.href === activeHref}
		<a
			href={item.href}
			class="nav-rail-item"
			class:active
			aria-label={item.label}
			aria-current={active ? 'page' : undefined}
		>
			<Icon size={18} />
		</a>
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
		background: var(--color-bg, #0d0d0d);
		border-right: 1px solid rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
	}

	.nav-rail-item {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		color: rgba(255, 255, 255, 0.55);
		text-decoration: none;
		transition: color 120ms ease, background 120ms ease;
	}

	.nav-rail-item:hover {
		color: rgba(255, 255, 255, 0.85);
		background: rgba(255, 255, 255, 0.04);
	}

	.nav-rail-item.active {
		color: #e87d6a;
		background: rgba(232, 125, 106, 0.08);
	}

	.nav-rail-item:focus-visible {
		outline: 2px solid #e87d6a;
		outline-offset: 2px;
	}
</style>
