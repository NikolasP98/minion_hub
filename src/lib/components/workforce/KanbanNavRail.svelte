<script lang="ts">
	import { page } from '$app/state';
	import { LayoutDashboard, Inbox, MailOpen, CheckCircle2, Target, Layers, FolderKanban, Users } from 'lucide-svelte';
	import * as m from '$lib/paraglide/messages';
	import { SectionNav, type SectionNavItem } from '$lib/components/ui/foundations';

	// The KANBAN plugin's detail views — mirrors the /my-agent icon rail. Order +
	// icons match the canonical route registry ($lib/nav/routes.ts workforce block).
	const items = [
		{ href: '/workforce', label: m.workforce_dashboard(), icon: LayoutDashboard },
		{ href: '/workforce/issues', label: m.workforce_issues(), icon: Inbox },
		{ href: '/workforce/inbox', label: m.workforce_inbox(), icon: MailOpen },
		{ href: '/workforce/approvals', label: m.workforce_approvals(), icon: CheckCircle2 },
		{ href: '/workforce/goals', label: m.workforce_goals(), icon: Target },
		{ href: '/workforce/portfolios', label: m.workforce_portfolios(), icon: Layers },
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

	const navItems = $derived<SectionNavItem[]>(
		items.map((item) => ({ id: item.href, ...item })),
	);
</script>

<SectionNav items={navItems} activeId={activeHref} ariaLabel={m.a11y3_kanbanNav()} />
