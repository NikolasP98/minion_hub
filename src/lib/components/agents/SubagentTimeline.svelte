<script lang="ts">
	import {
		getSortedSubagents,
		resolveStatus,
		selectSubagent,
		subagentState,
		type SubagentSession
	} from '$lib/state/features/subagent-data.svelte';

	const sessions = $derived(
		[...getSortedSubagents()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
	);

	const statusColor: Record<string, string> = {
		running: 'bg-yellow-400',
		completed: 'bg-emerald-400',
		failed: 'bg-red-400',
		unknown: 'bg-zinc-500'
	};

	const statusRing: Record<string, string> = {
		running: 'ring-yellow-400/30',
		completed: 'ring-emerald-400/30',
		failed: 'ring-red-400/30',
		unknown: 'ring-zinc-500/30'
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
		if (d.toDateString() === today.toDateString()) return 'Today';
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
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
		<div class="px-3 py-1.5 text-[9px] font-semibold text-muted/40 uppercase tracking-wider sticky top-0 bg-bg z-10">
			{group.date}
		</div>

		{#each group.sessions as session (session.key)}
			{@const status = resolveStatus(session)}
			<button
				type="button"
				class="flex items-center gap-3 w-full py-2 px-3 text-left transition-colors duration-100
					hover:bg-white/[0.03] cursor-pointer border-0 bg-transparent text-foreground
					{subagentState.selectedKey === session.key ? '!bg-bg3' : ''}"
				onclick={() => selectSubagent(session.key)}
			>
				<!-- Timeline connector -->
				<div class="flex flex-col items-center shrink-0 self-stretch">
					<div class="w-px flex-1 bg-white/[0.06]"></div>
					<span class="w-3 h-3 rounded-full shrink-0 ring-2 {statusColor[status]} {statusRing[status]}"></span>
					<div class="w-px flex-1 bg-white/[0.06]"></div>
				</div>

				<!-- Time -->
				<span class="text-[10px] text-muted/50 font-mono w-16 shrink-0">
					{formatTime(session.updatedAt)}
				</span>

				<!-- Info -->
				<div class="flex flex-col gap-0.5 flex-1 min-w-0">
					<span class="text-[11px] font-medium truncate">
						{session.label || session.displayName || session.key.split(':').pop() || 'Unnamed'}
					</span>
					<div class="flex items-center gap-2 text-[9px] text-muted/50">
						<span>{session.model ?? 'unknown'}</span>
						{#if session.spawnDepth != null}
							<span class="opacity-60">&middot;</span>
							<span>depth {session.spawnDepth}</span>
						{/if}
						{#if status === 'running'}
							<span class="text-yellow-400 animate-pulse">running</span>
						{/if}
					</div>
				</div>
			</button>
		{/each}
	{/each}
</div>
