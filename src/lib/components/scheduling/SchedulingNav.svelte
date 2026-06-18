<script lang="ts">
	import { LayoutDashboard, CalendarDays, Users, Sparkles, CalendarClock, Link2, Settings } from 'lucide-svelte';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { SideNav, type SideNavItem } from '$lib/components/ui';

	const items = $derived<SideNavItem[]>([
		{ id: 'dashboard', label: m.sched_nav_dashboard(), icon: LayoutDashboard, href: '/scheduling' },
		{ id: 'calendar', label: m.sched_nav_calendar(), icon: CalendarDays, href: '/scheduling/calendar' },
		{ id: 'bookings', label: m.sched_nav_bookings(), icon: CalendarClock, href: '/scheduling/bookings' },
		{ id: 'resources', label: m.sched_nav_resources(), icon: Users, href: '/scheduling/resources' },
		{ id: 'eventTypes', label: m.sched_nav_eventTypes(), icon: Sparkles, href: '/scheduling/event-types' },
		{ id: 'links', label: m.sched_nav_links(), icon: Link2, href: '/scheduling/links' },
		{ id: 'settings', label: m.sched_nav_settings(), icon: Settings, href: '/scheduling/settings' },
	]);

	const pathname = $derived(page.url.pathname);

	function isActive(id: string, href: string): boolean {
		if (id === 'dashboard') return pathname === '/scheduling';
		return pathname.startsWith(href);
	}

	const activeId = $derived(items.find((i) => isActive(i.id, i.href ?? ''))?.id);
</script>

<SideNav {items} {activeId} ariaLabel="Scheduling" header={m.nav_scheduling()} />
