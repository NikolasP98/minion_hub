<script lang="ts">
	import { LayoutDashboard, CalendarDays, Users, Sparkles, CalendarClock, Link2, Settings, BellRing } from 'lucide-svelte';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';

	type Tab = { id: string; label: () => string; icon: typeof Users; href: string };
	const TABS: Tab[] = [
		{ id: 'dashboard', label: () => m.sched_nav_dashboard(), icon: LayoutDashboard, href: '/scheduling' },
		{ id: 'calendar', label: () => m.sched_nav_calendar(), icon: CalendarDays, href: '/scheduling/calendar' },
		{ id: 'bookings', label: () => m.sched_nav_bookings(), icon: CalendarClock, href: '/scheduling/bookings' },
		{ id: 'resources', label: () => m.sched_nav_resources(), icon: Users, href: '/scheduling/resources' },
		{ id: 'eventTypes', label: () => m.sched_nav_eventTypes(), icon: Sparkles, href: '/scheduling/event-types' },
		{ id: 'links', label: () => m.sched_nav_links(), icon: Link2, href: '/scheduling/links' },
		{ id: 'reminders', label: () => m.sched_nav_reminders(), icon: BellRing, href: '/scheduling/reminders' },
		{ id: 'settings', label: () => m.sched_nav_settings(), icon: Settings, href: '/scheduling/settings' },
	];

	const pathname = $derived(page.url.pathname);

	function isActive(t: Tab): boolean {
		if (t.id === 'dashboard') return pathname === '/scheduling';
		return pathname.startsWith(t.href);
	}
</script>

<aside
	class="surface-1 shrink-0 w-14 lg:w-[208px] h-full border-r border-[var(--hairline)] flex flex-col overflow-hidden"
	aria-label="Scheduling"
>
	<nav class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-3 flex flex-col gap-0.5">
		<div class="set-head t-label hidden lg:block">{m.nav_scheduling()}</div>
		{#each TABS as tab (tab.id)}
			{@const Icon = tab.icon}
			{@const active = isActive(tab)}
			<a
				href={tab.href}
				class="set-row {active ? 'set-active' : ''}"
				aria-current={active ? 'page' : undefined}
				title={tab.label()}
			>
				<Icon size={16} class="set-icon shrink-0" />
				<span class="hidden lg:inline">{tab.label()}</span>
			</a>
		{/each}
	</nav>
</aside>
