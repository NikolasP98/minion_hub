<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import type { Goal, GoalStatus, GoalLevel } from '@minion-stack/workforce-client';
	import * as m from '$lib/paraglide/messages';
	import { startPolling } from '$lib/utils/live-polling';
	import LiveIndicator from '$lib/components/LiveIndicator.svelte';
	import { PageHeader } from '$lib/components/ui';
	import { Target } from 'lucide-svelte';

	let { data }: { data: PageData } = $props();
	const { goals, agentNames } = $derived(data);

	type GoalNode = Goal & { children: GoalNode[]; depth: number };

	function buildForest(rows: Goal[]): GoalNode[] {
		const byId = new Map<string, GoalNode>();
		for (const g of rows) byId.set(g.id, { ...g, children: [], depth: 0 });
		const roots: GoalNode[] = [];
		for (const node of byId.values()) {
			if (node.parentId && byId.has(node.parentId)) {
				const parent = byId.get(node.parentId)!;
				parent.children.push(node);
			} else {
				roots.push(node);
			}
		}
		// Assign depths via DFS
		const walk = (n: GoalNode, depth: number) => {
			n.depth = depth;
			for (const c of n.children) walk(c, depth + 1);
		};
		roots.forEach((r) => walk(r, 0));
		return roots;
	}

	function flatten(roots: GoalNode[]): GoalNode[] {
		const out: GoalNode[] = [];
		const walk = (n: GoalNode) => {
			out.push(n);
			n.children.forEach(walk);
		};
		roots.forEach(walk);
		return out;
	}

	const flat = $derived(flatten(buildForest(goals)));

	const STATUS_BADGE: Record<GoalStatus, string> = {
		planned: 'bg-muted text-muted-foreground',
		active: 'bg-[var(--color-info-surface)] text-[var(--color-info-fg)]',
		achieved: 'bg-[var(--color-success-surface)] text-[var(--color-success-fg)]',
		cancelled: 'bg-muted text-muted-strong',
	};

	const STATUS_LABELS: Record<GoalStatus, string> = {
		planned: 'Planned',
		active: 'Active',
		achieved: 'Achieved',
		cancelled: 'Cancelled',
	};

	const LEVEL_LABEL: Record<GoalLevel, string> = {
		company: 'Company',
		team: 'Team',
		agent: 'Agent',
		task: 'Task',
	};

	const LEVEL_TINT: Record<GoalLevel, string> = {
		company: 'border-l-amber-500',
		team: 'border-l-blue-500',
		agent: 'border-l-purple-500',
		task: 'border-l-gray-500',
	};

	function agentLabel(agentId: string | null): string {
		if (!agentId) return '—';
		return agentNames[agentId] ?? `${agentId.slice(0, 8)}…`;
	}

	// Quick aggregate per status for the header chips
	const counts = $derived.by(() => {
		const out: Record<GoalStatus, number> = { planned: 0, active: 0, achieved: 0, cancelled: 0 };
		for (const g of goals) out[g.status] += 1;
		return out;
	});

	onMount(() => startPolling('app:goals', 8000));
</script>

<PageHeader title={m.workforce_goals()}>
	{#snippet leading()}
		<Target size={16} class="text-accent shrink-0" />
	{/snippet}
	{#snippet actions()}
		<LiveIndicator intervalMs={8000} />
		<div class="flex flex-wrap gap-2 text-xs">
			{#each (['active', 'planned', 'achieved', 'cancelled'] as GoalStatus[]) as s (s)}
				{#if counts[s] > 0}
					<span class="rounded-full px-2 py-0.5 font-medium {STATUS_BADGE[s]}">
						{counts[s]} {STATUS_LABELS[s].toLowerCase()}
					</span>
				{/if}
			{/each}
		</div>
	{/snippet}
</PageHeader>
<main class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 max-w-5xl">
	{#if goals.length === 0}
		<div class="rounded-lg border border-border bg-card p-12 flex flex-col items-center justify-center text-center">
			<p class="text-muted-foreground text-sm">{m.goals_noGoalsDefined()}</p>
		</div>
	{:else}
		<ul class="space-y-2">
			{#each flat as goal (goal.id)}
				<li
					class="relative rounded-lg border border-border border-l-4 bg-card px-4 py-3 text-sm flex flex-col gap-1.5 transition-colors hover:border-foreground/30 {LEVEL_TINT[goal.level]}"
					style={`--goal-depth:${goal.depth}`}
				>
					<div class="flex items-center gap-3 flex-wrap">
						<span class="rounded px-1.5 py-0.5 t-telemetry font-medium {STATUS_BADGE[goal.status]}">
							{STATUS_LABELS[goal.status]}
						</span>
						<span class="t-telemetry uppercase tracking-wider text-muted-foreground">
							{LEVEL_LABEL[goal.level]}
						</span>
						<span class="font-medium flex-1 min-w-0 truncate">{goal.title}</span>
						<span class="text-xs text-muted-foreground shrink-0">{agentLabel(goal.ownerAgentId)}</span>
					</div>
					{#if goal.description}
						<p class="text-xs text-muted-foreground">{goal.description}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	li[style*='--goal-depth'] {
		margin-left: calc(var(--goal-depth, 0) * var(--space-6));
	}
</style>
