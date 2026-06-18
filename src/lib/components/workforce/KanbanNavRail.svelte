<script lang="ts">
	import { page } from '$app/state';
	import { LayoutDashboard, Inbox, CheckCircle2, Target, FolderKanban, Users } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import { Tooltip } from '$lib/components/ui';

	// The KANBAN plugin's detail views — mirrors the /my-agent icon rail. Order +
	// icons match the canonical route registry ($lib/nav/routes.ts workforce block).
	const items = [
		{ href: '/workforce', label: m.workforce_dashboard(), icon: LayoutDashboard },
		{ href: '/workforce/issues', label: m.workforce_issues(), icon: Inbox },
		{ href: '/workforce/approvals', label: m.workforce_approvals(), icon: CheckCircle2 },
		{ href: '/workforce/goals', label: m.workforce_goals(), icon: Target },
		{ href: '/workforce/projects', label: m.workforce_projects(), icon: FolderKanban },
		{ href: '/workforce/org', label: m.workforce_org(), icon: Users },
	];

	const currentPath = $derived(page.url.pathname);

	// Highlight only the most-specific matching item so e.g. /workforce/issues
	// lights up Issues rather than both Issues and the (prefix) Dashboard.
	const activeHref = $derived.by(() => {
		let best = '';
		for (const it of items) {
			if (
				(currentPath === it.href || currentPath.startsWith(it.href + '/')) &&
				it.href.length > best.length
			) {
				best = it.href;
			}
		}
		return best;
	});
</script>

<nav class="nav-rail" aria-label={m.a11y3_kanbanNav()}>
	{#each items as item (item.href)}
		{@const Icon = item.icon}
		{@const active = item.href === activeHref}
		<Tooltip label={item.label} id={`kanban-nav-tip-${item.href}`} placement="right" openDelay={150} asChild>
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
