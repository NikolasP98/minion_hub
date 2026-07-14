<script lang="ts">
  import { Button } from '$lib/components/ui';
import {
		getSortedSubagents,
		resolveStatus,
		selectSubagent,
		subagentState,
		type SubagentSession
	} from '$lib/state/features/subagent-data.svelte';
	import * as m from '$lib/paraglide/messages';

	const sessions = $derived(
		[...getSortedSubagents()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
	);

	const statusColor: Record<string, string> = {
		running: 'bg-[var(--color-warning-surface)]',
		completed: 'bg-[var(--color-success-surface)]',
		failed: 'bg-[var(--color-danger-surface)]',
		unknown: 'bg-[var(--color-surface-2)]'
	};

	const statusRing: Record<string, string> = {
		running: 'ring-[var(--color-warning-border)]',
		completed: 'ring-[var(--color-success-border)]',
		failed: 'ring-[var(--color-danger-border)]',
		unknown: 'ring-[var(--color-border-default)]'
	};

	function formatTime(ts: number | null): string {
		if (!ts) return '\u2014';
		const d = new Date(ts);
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}

	function formatDate(ts: number | null): string {
		if (!ts) return '';
		const d = new Date(ts);
		const today = new Date();
		if (d.toDateString() === today.toDateString()) return m.common_today();
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		if (d.toDateString() === yesterday.toDateString()) return m.common_yesterday();
		return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
	}

	// Group sessions by date
	const grouped = $derived.by(() => {
		const groups: { date: string; sessions: SubagentSession[] }[] = [];
		let currentDate = '';
		for (const s of sessions) {
			const date = formatDate(s.updatedAt);
			if (date !== currentDate) {
				currentDate = date;
				groups.push({ date, sessions: [s] });
			} else {
				groups[groups.length - 1].sessions.push(s);
			}
		}
		return groups;
	});
</script>

<div class="flex flex-col">
	{#each grouped as group}
		<!-- Date header -->
		<div class="px-3 py-1.5 text-[length:var(--font-size-telemetry)] font-semibold text-muted-strong uppercase tracking-wider sticky top-0 bg-bg z-[var(--layer-sticky)]">
			{group.date}
		</div>

		{#each group.sessions as session (session.key)}
			{@const status = resolveStatus(session)}
			<Button variant="ghost"
				type="button"
				class="flex items-center gap-3 w-full py-2 px-3 text-left transition-colors duration-[var(--duration-fast)]
					hover:bg-[var(--color-text-primary)]/[0.03] cursor-pointer border-0 bg-transparent text-foreground
					{subagentState.selectedKey === session.key ? '!bg-bg3' : ''}"
				onclick={() => selectSubagent(session.key)}
			>
				<!-- Timeline connector -->
				<div class="flex flex-col items-center shrink-0 self-stretch">
					<div class="w-px flex-1 bg-[var(--color-text-primary)]/[0.06]"></div>
					<span class="w-3 h-3 rounded-full shrink-0 ring-2 {statusColor[status]} {statusRing[status]}"></span>
					<div class="w-px flex-1 bg-[var(--color-text-primary)]/[0.06]"></div>
				</div>

				<!-- Time -->
				<span class="text-[length:var(--font-size-telemetry)] text-muted-strong font-mono w-16 shrink-0">
					{formatTime(session.updatedAt)}
				</span>

				<!-- Info -->
				<div class="flex flex-col gap-0.5 flex-1 min-w-0">
					<span class="text-[length:var(--font-size-caption)] font-medium truncate">
						{session.label || session.displayName || session.key.split(':').pop() || m.subagent_unnamed()}
					</span>
					<div class="flex items-center gap-2 text-[length:var(--font-size-telemetry)] text-muted-strong">
						<span>{session.model ?? m.subagent_unknown()}</span>
						{#if session.spawnDepth != null}
							<span class="opacity-60">&middot;</span>
							<span>{m.subagent_depth({ depth: session.spawnDepth })}</span>
						{/if}
						{#if status === 'running'}
							<span class="text-[var(--color-warning-fg)] animate-pulse">{m.subagent_running()}</span>
						{/if}
					</div>
				</div>
			</Button>
		{/each}
	{/each}
</div>
