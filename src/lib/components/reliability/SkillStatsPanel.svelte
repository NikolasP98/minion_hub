<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { createSkillStatsState, type SkillAggregate, type SkillStatus } from '$lib/state/skill-stats.svelte';
	import { Zap } from 'lucide-svelte';

	interface Props {
		serverId: string;
	}

	let { serverId }: Props = $props();

	const state = createSkillStatsState();
	let skills = $derived(state.aggregate());
	let maxTotal = $derived(skills.length > 0 ? skills[0].total : 1);

	const STATUS_ORDER: SkillStatus[] = ['ok', 'error', 'auth_error', 'timeout'];

	const STATUS_COLORS: Record<SkillStatus, string> = {
		ok: 'var(--color-success)',
		error: 'var(--color-destructive)',
		auth_error: 'var(--color-warning)',
		timeout: 'var(--color-purple)',
	};

	const STATUS_LABELS: Record<SkillStatus, string> = {
		ok: 'OK',
		error: 'Error',
		auth_error: 'Auth Error',
		timeout: 'Timeout',
	};

	function barSegments(skill: SkillAggregate): Array<{ status: SkillStatus; width: number; count: number }> {
		const segments: Array<{ status: SkillStatus; width: number; count: number }> = [];
		for (const s of STATUS_ORDER) {
			const count = skill.byStatus[s] ?? 0;
			if (count > 0) {
				segments.push({
					status: s,
					width: (count / maxTotal) * 100,
					count,
				});
			}
		}
		return segments;
	}

	function formatDuration(ms: number | null): string {
		if (ms == null) return '-';
		if (ms < 1000) return `${Math.round(ms)}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	}

	onMount(() => {
		state.load(serverId);
		const interval = setInterval(() => state.load(serverId), 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden">
	<div class="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg3/20">
		<Zap size={11} class="text-accent shrink-0" />
		<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1">{m.reliability_skillTitle()}</span>
	</div>

	{#if state.loading && skills.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.common_loading()}</div>
	{:else if state.error}
		<div class="flex items-center justify-center py-12 px-4 text-destructive text-[13px]">{state.error}</div>
	{:else if skills.length === 0}
		<div class="flex items-center justify-center py-12 px-4 text-muted-foreground text-[13px]">{m.reliability_noSkills()}</div>
	{:else}
		<div class="flex flex-wrap gap-3 py-2.5 px-4 border-b border-border">
			{#each STATUS_ORDER as s (s)}
				<span class="flex items-center gap-1.5 text-[11px] text-muted">
					<span class="w-2 h-2 rounded-full shrink-0" style:background={STATUS_COLORS[s]}></span>
					{STATUS_LABELS[s]}
				</span>
			{/each}
		</div>

		<div class="py-3 px-4 flex flex-col gap-2.5">
			{#each skills as skill (skill.skillName)}
				<div class="flex flex-col gap-1">
					<div class="flex items-baseline gap-2">
						<span class="text-xs font-semibold text-foreground max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap" title={skill.skillName}>{skill.skillName}</span>
						<span class="text-[11px] text-muted-foreground tabular-nums">{skill.total} exec</span>
						<span class="text-[11px] text-muted-foreground tabular-nums ml-auto">{formatDuration(skill.avgDurationMs)}</span>
					</div>
					<div class="flex h-2 rounded overflow-hidden bg-bg3 gap-px">
						{#each barSegments(skill) as seg (seg.status)}
							<div
								class="h-full min-w-0.5 rounded-sm transition-[width] duration-300 ease-in-out"
								style:width="{seg.width}%"
								style:background={STATUS_COLORS[seg.status]}
								title="{STATUS_LABELS[seg.status]}: {seg.count}"
							></div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
