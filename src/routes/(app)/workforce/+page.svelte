<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { startPolling } from '$lib/util/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import Sparkline from '$lib/components/Sparkline.svelte';
	import {
		ListTodo,
		ClipboardCheck,
		Activity as ActivityIcon,
		Network,
		Target,
		Gauge,
		Inbox,
		Receipt,
		Settings,
		FolderKanban,
	} from 'lucide-svelte';

	let { data }: { data: PageData } = $props();

	const { summary, badges, activity, costTrend } = $derived(data);
	const trendValues = $derived(costTrend.map((p) => p.cents));

	type WorkforceTile = {
		label: string;
		href: string;
		icon: typeof ListTodo;
		description: string;
		badge?: { text: string; tone: 'primary' | 'amber' | 'destructive' | 'muted' };
	};

	const tiles = $derived<WorkforceTile[]>([
		{
			label: 'Issues',
			href: '/workforce/issues',
			icon: ListTodo,
			description: `${summary.tasks.open + summary.tasks.inProgress} open`,
		},
		{
			label: 'Approvals',
			href: '/workforce/approvals',
			icon: ClipboardCheck,
			description: 'pending decisions',
			badge: badges.approvals > 0 ? { text: String(badges.approvals), tone: 'amber' } : undefined,
		},
		{
			label: 'Activity',
			href: '/workforce/activity',
			icon: ActivityIcon,
			description: 'recent events',
		},
		{
			label: 'Org',
			href: '/workforce/org',
			icon: Network,
			description: 'reporting tree',
		},
		{
			label: 'Goals',
			href: '/workforce/goals',
			icon: Target,
			description: 'company → agent',
		},
		{
			label: 'Projects',
			href: '/workforce/projects',
			icon: FolderKanban,
			description: 'workspaces + scope',
		},
		{
			label: 'Reliability',
			href: '/workforce/reliability',
			icon: Gauge,
			description: 'activity heatmap',
			badge: badges.failedRuns > 0 ? { text: String(badges.failedRuns), tone: 'destructive' } : undefined,
		},
		{
			label: 'Inbox',
			href: '/workforce/inbox',
			icon: Inbox,
			description: 'notifications',
			badge: badges.inbox > 0 ? { text: String(badges.inbox), tone: 'primary' } : undefined,
		},
		{
			label: 'Costs',
			href: '/workforce/costs',
			icon: Receipt,
			description: `${summary.costs.monthUtilizationPercent.toFixed(0)}% of budget`,
		},
		{
			label: 'Settings',
			href: '/workforce/settings',
			icon: Settings,
			description: 'company + agents',
		},
	]);

	const BADGE_TINT: Record<NonNullable<WorkforceTile['badge']>['tone'], string> = {
		primary: 'bg-primary/10 text-primary',
		amber: 'bg-amber-500/10 text-amber-600',
		destructive: 'bg-destructive/10 text-destructive',
		muted: 'bg-muted text-muted-foreground',
	};

	function formatCents(cents: number): string {
		return `$${(cents / 100).toFixed(2)}`;
	}

	onMount(() => startPolling('app:dashboard', 5000));
</script>

<div class="p-6 space-y-6">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<h1 class="text-2xl font-semibold">Dashboard</h1>
			<LiveIndicator intervalMs={5000} />
		</div>
		{#if badges.approvals > 0 || badges.inbox > 0 || badges.failedRuns > 0 || badges.joinRequests > 0}
			<div class="flex gap-2 text-xs">
				{#if badges.inbox > 0}
					<span class="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
						{badges.inbox} inbox
					</span>
				{/if}
				{#if badges.approvals > 0}
					<span class="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600">
						{badges.approvals} approvals
					</span>
				{/if}
				{#if badges.failedRuns > 0}
					<span class="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
						{badges.failedRuns} failed
					</span>
				{/if}
				{#if badges.joinRequests > 0}
					<span class="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
						{badges.joinRequests} join requests
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Summary cards -->
	<section aria-label="Summary" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<!-- Agents -->
		<div class="rounded-lg border border-border bg-card p-4 space-y-2">
			<h2 class="text-sm font-medium text-muted-foreground">Agents</h2>
			<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
				<span class="text-muted-foreground">Active</span>
				<span class="font-medium tabular-nums">{summary.agents.active}</span>
				<span class="text-muted-foreground">Running</span>
				<span class="font-medium tabular-nums">{summary.agents.running}</span>
				<span class="text-muted-foreground">Paused</span>
				<span class="font-medium tabular-nums">{summary.agents.paused}</span>
				<span class="text-muted-foreground">Error</span>
				<span class="font-medium tabular-nums text-destructive">{summary.agents.error}</span>
			</div>
		</div>

		<!-- Tasks (clickable, drills into filtered issues) -->
		<div class="rounded-lg border border-border bg-card p-4 space-y-2">
			<h2 class="text-sm font-medium text-muted-foreground">Tasks</h2>
			<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
				<a
					href="/workforce/issues?status=todo"
					class="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
				>
					Open
				</a>
				<a
					href="/workforce/issues?status=todo"
					class="font-medium tabular-nums hover:underline underline-offset-2"
				>
					{summary.tasks.open}
				</a>
				<a
					href="/workforce/issues?status=in_progress"
					class="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
				>
					In progress
				</a>
				<a
					href="/workforce/issues?status=in_progress"
					class="font-medium tabular-nums hover:underline underline-offset-2"
				>
					{summary.tasks.inProgress}
				</a>
				<a
					href="/workforce/issues?status=blocked"
					class="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
				>
					Blocked
				</a>
				<a
					href="/workforce/issues?status=blocked"
					class="font-medium tabular-nums text-amber-600 hover:underline underline-offset-2"
				>
					{summary.tasks.blocked}
				</a>
				<a
					href="/workforce/issues?status=done"
					class="text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
				>
					Done
				</a>
				<a
					href="/workforce/issues?status=done"
					class="font-medium tabular-nums text-green-600 hover:underline underline-offset-2"
				>
					{summary.tasks.done}
				</a>
			</div>
		</div>

		<!-- Costs -->
		<div class="rounded-lg border border-border bg-card p-4 space-y-2">
			<div class="flex items-start justify-between gap-2">
				<div class="space-y-1">
					<h2 class="text-sm font-medium text-muted-foreground">Monthly spend</h2>
					<div class="text-2xl font-semibold tabular-nums">{formatCents(summary.costs.monthSpendCents)}</div>
				</div>
				{#if trendValues.length > 1}
					<div class="text-primary shrink-0 mt-1" title="Daily spend over the last 14 days">
						<Sparkline values={trendValues} width={120} height={32} />
					</div>
				{/if}
			</div>
			<div class="text-xs text-muted-foreground">
				of {formatCents(summary.costs.monthBudgetCents)} budget
				({summary.costs.monthUtilizationPercent.toFixed(1)}%)
			</div>
			{#if summary.costs.monthUtilizationPercent > 0}
				<div class="h-1.5 w-full rounded-full bg-muted overflow-hidden">
					<div
						class="h-full rounded-full bg-primary transition-all"
						style="width: {Math.min(summary.costs.monthUtilizationPercent, 100)}%"
					></div>
				</div>
			{/if}
		</div>
	</section>

	<!-- Budget / incidents row -->
	{#if summary.budgets.activeIncidents > 0 || summary.pendingApprovals > 0}
		<section aria-label="Alerts" class="flex flex-wrap gap-3">
			{#if summary.budgets.activeIncidents > 0}
				<div class="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm">
					<span class="font-medium text-destructive">{summary.budgets.activeIncidents}</span>
					<span class="text-muted-foreground ml-1">active budget incident{summary.budgets.activeIncidents !== 1 ? 's' : ''}</span>
				</div>
			{/if}
			{#if summary.pendingApprovals > 0}
				<a
					href="/workforce/approvals"
					class="rounded-lg border border-amber-300/30 bg-amber-500/5 px-4 py-2 text-sm hover:bg-amber-500/10 transition-colors"
				>
					<span class="font-medium text-amber-600">{summary.pendingApprovals}</span>
					<span class="text-muted-foreground ml-1">pending approval{summary.pendingApprovals !== 1 ? 's' : ''}</span>
				</a>
			{/if}
			{#if summary.budgets.pausedAgents > 0}
				<div class="rounded-lg border border-border bg-muted/50 px-4 py-2 text-sm">
					<span class="font-medium">{summary.budgets.pausedAgents}</span>
					<span class="text-muted-foreground ml-1">agent{summary.budgets.pausedAgents !== 1 ? 's' : ''} paused</span>
				</div>
			{/if}
			{#if summary.budgets.pausedProjects > 0}
				<div class="rounded-lg border border-border bg-muted/50 px-4 py-2 text-sm">
					<span class="font-medium">{summary.budgets.pausedProjects}</span>
					<span class="text-muted-foreground ml-1">project{summary.budgets.pausedProjects !== 1 ? 's' : ''} paused</span>
				</div>
			{/if}
		</section>
	{/if}

	<!-- Workforce nav tiles (bento grid) -->
	<section aria-label="Workforce navigation">
		<h2 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
			Explore workforce
		</h2>
		<ul class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
			{#each tiles as tile (tile.href)}
				{@const Icon = tile.icon}
				<li>
					<a
						href={tile.href}
						class="group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
						aria-label="{tile.label} — {tile.description}"
					>
						<div class="flex items-center justify-between gap-2">
							<span class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground transition-colors">
								<Icon size={18} aria-hidden="true" />
							</span>
							{#if tile.badge}
								<span
									class="rounded-full px-2 py-0.5 text-xs font-medium tabular-nums {BADGE_TINT[tile.badge.tone]}"
								>
									{tile.badge.text}
								</span>
							{/if}
						</div>
						<div class="space-y-0.5 min-w-0">
							<div class="text-sm font-medium text-foreground truncate">{tile.label}</div>
							<div class="text-xs text-muted-foreground truncate">{tile.description}</div>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<!-- Activity feed -->
	<section aria-label="Recent activity">
		<div class="flex items-center justify-between mb-2">
			<h2 class="text-lg font-semibold">Recent activity</h2>
			<a href="/workforce/activity" class="text-xs text-muted-foreground hover:text-foreground hover:underline">
				view all →
			</a>
		</div>
		{#if activity.length === 0}
			<p class="text-muted-foreground text-sm">No recent activity yet.</p>
		{:else}
			<ul class="divide-y divide-border rounded-lg border border-border bg-card">
				{#each activity.slice(0, 8) as item (item.id)}
					<li class="px-4 py-2 text-sm flex items-start gap-3">
						<span class="shrink-0 mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground uppercase tracking-wide">
							{item.actorType}
						</span>
						<div class="min-w-0 flex-1">
							<span class="font-medium">{item.action}</span>
							{#if item.entityType}
								<span class="text-muted-foreground"> on {item.entityType}</span>
							{/if}
							{#if item.details !== null}
								<pre class="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{JSON.stringify(item.details)}</pre>
							{/if}
						</div>
						<time
							class="shrink-0 text-xs text-muted-foreground"
							datetime={new Date(item.createdAt).toISOString()}
						>
							{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
						</time>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
