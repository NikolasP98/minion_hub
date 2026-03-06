<script lang="ts">
	import SessionMonitor from './SessionMonitor.svelte';
	import SubagentMeta from './SubagentMeta.svelte';
	import { selectedSubagent, subagentState } from '$lib/state/subagent-data.svelte';
	import { ui } from '$lib/state/ui.svelte';

	let activeTab = $state<'chat' | 'monitor' | 'meta'>('monitor');

	const agentId = $derived(ui.selectedAgentId ?? '');
	const serverId = $derived(ui.selectedServerId);
</script>

<div class="flex flex-col h-full overflow-hidden bg-bg">
	{#if !selectedSubagent}
		<div class="flex-1 flex flex-col items-center justify-center gap-2.5 text-muted text-[13px]">
			<span class="text-[28px] opacity-40">&larr;</span>
			<span>Select a subagent to view details</span>
		</div>
	{:else}
		<!-- Header with session info -->
		<div class="shrink-0 px-4 py-2 border-b border-border bg-bg2 flex items-center gap-3">
			<span class="text-[12px] font-medium truncate">
				{selectedSubagent.label || selectedSubagent.key.split(':').pop() || 'Subagent'}
			</span>
			<span class="text-[10px] text-muted font-mono">
				{selectedSubagent.model ?? ''}
			</span>
		</div>

		<!-- Sub-tabs -->
		<div class="shrink-0 flex items-center border-b border-border bg-bg2">
			{#each [{ id: 'monitor', label: 'Monitor' }, { id: 'meta', label: 'Meta' }] as tab (tab.id)}
				<button
					type="button"
					class="px-4 py-1.5 text-[10px] font-semibold border-b-2 transition-colors cursor-pointer
						{activeTab === tab.id
						? 'border-accent text-accent'
						: 'border-transparent text-muted hover:text-foreground'}"
					onclick={() => (activeTab = tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Content -->
		<div class="flex-1 min-h-0 flex flex-col overflow-hidden">
			{#if activeTab === 'monitor'}
				<SessionMonitor
					{agentId}
					sessionKey={subagentState.selectedKey}
					{serverId}
				/>
			{:else}
				<SubagentMeta session={selectedSubagent} />
			{/if}
		</div>
	{/if}
</div>
