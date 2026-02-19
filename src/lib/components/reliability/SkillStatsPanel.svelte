<script lang="ts">
	import { onMount } from 'svelte';
	import { createSkillStatsState, type SkillAggregate, type SkillStatus } from '$lib/state/skill-stats.svelte';

	interface Props {
		serverId: string;
	}

	let { serverId }: Props = $props();

	const state = createSkillStatsState();
	let skills = $derived(state.aggregate());
	let maxTotal = $derived(skills.length > 0 ? skills[0].total : 1);

	const STATUS_ORDER: SkillStatus[] = ['ok', 'error', 'auth_error', 'timeout'];

	const STATUS_COLORS: Record<SkillStatus, string> = {
		ok: 'var(--green)',
		error: 'var(--red)',
		auth_error: 'var(--amber)',
		timeout: 'var(--purple)',
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

<div class="panel">
	<div class="panel-header">
		<h3 class="panel-title">Skill Execution Stats</h3>
	</div>

	{#if state.loading && skills.length === 0}
		<div class="panel-empty">Loading...</div>
	{:else if state.error}
		<div class="panel-empty panel-error">{state.error}</div>
	{:else if skills.length === 0}
		<div class="panel-empty">No skill data</div>
	{:else}
		<div class="legend">
			{#each STATUS_ORDER as s (s)}
				<span class="legend-item">
					<span class="legend-dot" style:background={STATUS_COLORS[s]}></span>
					{STATUS_LABELS[s]}
				</span>
			{/each}
		</div>

		<div class="skill-list">
			{#each skills as skill (skill.skillName)}
				<div class="skill-row">
					<div class="skill-meta">
						<span class="skill-name" title={skill.skillName}>{skill.skillName}</span>
						<span class="skill-count">{skill.total} exec</span>
						<span class="skill-duration">{formatDuration(skill.avgDurationMs)}</span>
					</div>
					<div class="bar-track">
						{#each barSegments(skill) as seg (seg.status)}
							<div
								class="bar-segment"
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

<style>
	.panel {
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
	}

	.panel-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		margin: 0;
	}

	.panel-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px 16px;
		color: var(--text3);
		font-size: 13px;
	}

	.panel-error {
		color: var(--red);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--text2);
	}

	.legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.skill-list {
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.skill-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.skill-meta {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.skill-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--text);
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.skill-count {
		font-size: 11px;
		color: var(--text3);
		font-variant-numeric: tabular-nums;
	}

	.skill-duration {
		font-size: 11px;
		color: var(--text3);
		font-variant-numeric: tabular-nums;
		margin-left: auto;
	}

	.bar-track {
		display: flex;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
		background: var(--bg3);
		gap: 1px;
	}

	.bar-segment {
		height: 100%;
		min-width: 2px;
		border-radius: 1px;
		transition: width 0.3s ease;
	}
</style>
