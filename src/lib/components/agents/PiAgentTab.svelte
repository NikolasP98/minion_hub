<script lang="ts">
	import PiAgentControls from './PiAgentControls.svelte';
	import SubagentTree from './SubagentTree.svelte';
	import PiAgentOrchestrations from './PiAgentOrchestrations.svelte';
	import PiAgentTemplates from './PiAgentTemplates.svelte';
	import {
		piAgentState,
		loadPiAgentData,
		clearPiAgentData,
		refreshPiAgentData
	} from '$lib/state/features/pi-agent-state.svelte';
	import {
		loadSubagents,
		clearSubagents,
		subagentState
	} from '$lib/state/features/subagent-data.svelte';

	let { agentId }: { agentId: string } = $props();

	// Collapsible section state
	let subagentsOpen = $state(true);
	let orchestrationsOpen = $state(false);
	let templatesOpen = $state(false);

	// Debounced refresh for event-driven updates
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	const DEBOUNCE_MS = 2000;

	function scheduleRefresh() {
		if (refreshTimer) clearTimeout(refreshTimer);
		refreshTimer = setTimeout(() => {
			refreshPiAgentData();
		}, DEBOUNCE_MS);
	}

	// Load data on mount, listen for events, cleanup
	$effect(() => {
		if (agentId) {
			loadPiAgentData(agentId);
			loadSubagents(agentId);
		}

		const events = [
			'pi-agent.run-end',
			'pi-agent.tool-call',
			'pi-agent.subagent-spawned',
			'pi-agent.subagent-completed'
		];
		for (const e of events) window.addEventListener(e, scheduleRefresh);

		return () => {
			for (const e of events) window.removeEventListener(e, scheduleRefresh);
			if (refreshTimer) clearTimeout(refreshTimer);
			clearPiAgentData();
			clearSubagents();
		};
	});

	function handleRefresh() {
		refreshPiAgentData();
		if (piAgentState.agentId) loadSubagents(piAgentState.agentId);
	}
</script>

<div class="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 gap-4">
	<!-- Header with refresh button -->
	<div class="flex items-center justify-between">
		<h3 class="text-[12px] font-semibold text-foreground">Pi-Agent</h3>
		<button
			type="button"
			class="text-[10px] text-muted hover:text-foreground border border-border rounded px-2 py-0.5 cursor-pointer hover:bg-bg3 transition-colors"
			onclick={handleRefresh}
			disabled={piAgentState.loading}
		>
			{piAgentState.loading ? 'Loading...' : 'Refresh'}
		</button>
	</div>

	<!-- Error display -->
	{#if piAgentState.error}
		<div class="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
			{piAgentState.error}
		</div>
	{/if}

	<!-- Controls card (always visible) -->
	<PiAgentControls {agentId} />

	<!-- Subagents section (collapsible) -->
	<div class="border border-border rounded-lg overflow-hidden">
		<button
			type="button"
			class="w-full flex items-center justify-between px-3 py-2 bg-bg2 hover:bg-bg3 transition-colors cursor-pointer"
			onclick={() => (subagentsOpen = !subagentsOpen)}
		>
			<span class="text-[11px] font-semibold text-foreground">
				Subagents
				{#if subagentState.sessions.length > 0}
					<span class="text-muted font-normal ml-1">({subagentState.sessions.length})</span>
				{/if}
			</span>
			<span class="text-[10px] text-muted">{subagentsOpen ? '\u25B2' : '\u25BC'}</span>
		</button>
		{#if subagentsOpen}
			<div class="p-3 border-t border-border">
				{#if subagentState.sessions.length > 0}
					<SubagentTree />
				{:else}
					<p class="text-[11px] text-muted">No active subagents.</p>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Orchestrations section (collapsible) -->
	<div class="border border-border rounded-lg overflow-hidden">
		<button
			type="button"
			class="w-full flex items-center justify-between px-3 py-2 bg-bg2 hover:bg-bg3 transition-colors cursor-pointer"
			onclick={() => (orchestrationsOpen = !orchestrationsOpen)}
		>
			<span class="text-[11px] font-semibold text-foreground">
				Orchestrations
				{#if piAgentState.orchestrations.length > 0}
					<span class="text-muted font-normal ml-1">({piAgentState.orchestrations.length})</span>
				{/if}
			</span>
			<span class="text-[10px] text-muted">{orchestrationsOpen ? '\u25B2' : '\u25BC'}</span>
		</button>
		{#if orchestrationsOpen}
			<div class="border-t border-border">
				<PiAgentOrchestrations />
			</div>
		{/if}
	</div>

	<!-- Templates section (collapsible) -->
	<div class="border border-border rounded-lg overflow-hidden">
		<button
			type="button"
			class="w-full flex items-center justify-between px-3 py-2 bg-bg2 hover:bg-bg3 transition-colors cursor-pointer"
			onclick={() => (templatesOpen = !templatesOpen)}
		>
			<span class="text-[11px] font-semibold text-foreground">
				Templates
				{#if piAgentState.templates.length > 0}
					<span class="text-muted font-normal ml-1">({piAgentState.templates.length})</span>
				{/if}
			</span>
			<span class="text-[10px] text-muted">{templatesOpen ? '\u25B2' : '\u25BC'}</span>
		</button>
		{#if templatesOpen}
			<div class="border-t border-border">
				<PiAgentTemplates />
			</div>
		{/if}
	</div>
</div>
