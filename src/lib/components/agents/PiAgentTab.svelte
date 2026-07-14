<script lang="ts">
  import { Button } from '$lib/components/ui';
import PiAgentControls from './PiAgentControls.svelte';
	import SubagentTree from './SubagentTree.svelte';
	import PiAgentOrchestrations from './PiAgentOrchestrations.svelte';
	import PiAgentTemplates from './PiAgentTemplates.svelte';
	import DreamActivity from './DreamActivity.svelte';
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
	import * as m from '$lib/paraglide/messages';

	let { agentId }: { agentId: string } = $props();

	// Collapsible section state
	let subagentsOpen = $state(true);
	let orchestrationsOpen = $state(false);
	let templatesOpen = $state(false);
	let dreamOpen = $state(false);

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
		<h3 class="text-[length:var(--font-size-caption)] font-semibold text-foreground">{m.agent_tabPiAgent()}</h3>
		<Button variant="ghost"
			type="button"
			class="text-[length:var(--font-size-telemetry)] text-muted hover:text-foreground border border-border rounded px-2 py-0.5 cursor-pointer hover:bg-bg3 transition-colors"
			onclick={handleRefresh}
			disabled={piAgentState.loading}
		>
			{piAgentState.loading ? m.common_loading() : m.skills_refresh()}
		</Button>
	</div>

	<!-- Error display -->
	{#if piAgentState.error}
		<div class="text-[length:var(--font-size-caption)] text-[var(--color-danger-fg)] bg-[var(--color-danger-surface)] border border-[var(--color-danger-border)] rounded-lg p-3">
			{piAgentState.error}
		</div>
	{/if}

	<!-- Controls card (always visible) -->
	<PiAgentControls {agentId} />

	<!-- Subagents section (collapsible) -->
	<div class="border border-border rounded-lg overflow-hidden">
		<Button variant="ghost"
			type="button"
			class="w-full flex items-center justify-between px-3 py-2 bg-bg2 hover:bg-bg3 transition-colors cursor-pointer"
			onclick={() => (subagentsOpen = !subagentsOpen)}
		>
			<span class="text-[length:var(--font-size-caption)] font-semibold text-foreground">
				{m.pi_subagents()}
				{#if subagentState.sessions.length > 0}
					<span class="text-muted font-normal ml-1">({subagentState.sessions.length})</span>
				{/if}
			</span>
			<span class="text-[length:var(--font-size-telemetry)] text-muted">{subagentsOpen ? '\u25B2' : '\u25BC'}</span>
		</Button>
		{#if subagentsOpen}
			<div class="p-3 border-t border-border">
				{#if subagentState.sessions.length > 0}
					<SubagentTree />
				{:else}
					<p class="text-[length:var(--font-size-caption)] text-muted">{m.pi_noActiveSubagents()}</p>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Orchestrations section (collapsible) -->
	<div class="border border-border rounded-lg overflow-hidden">
		<Button variant="ghost"
			type="button"
			class="w-full flex items-center justify-between px-3 py-2 bg-bg2 hover:bg-bg3 transition-colors cursor-pointer"
			onclick={() => (orchestrationsOpen = !orchestrationsOpen)}
		>
			<span class="text-[length:var(--font-size-caption)] font-semibold text-foreground">
				{m.pi_orchestrations()}
				{#if piAgentState.orchestrations.length > 0}
					<span class="text-muted font-normal ml-1">({piAgentState.orchestrations.length})</span>
				{/if}
			</span>
			<span class="text-[length:var(--font-size-telemetry)] text-muted">{orchestrationsOpen ? '\u25B2' : '\u25BC'}</span>
		</Button>
		{#if orchestrationsOpen}
			<div class="border-t border-border">
				<PiAgentOrchestrations />
			</div>
		{/if}
	</div>

	<!-- Templates section (collapsible) -->
	<div class="border border-border rounded-lg overflow-hidden">
		<Button variant="ghost"
			type="button"
			class="w-full flex items-center justify-between px-3 py-2 bg-bg2 hover:bg-bg3 transition-colors cursor-pointer"
			onclick={() => (templatesOpen = !templatesOpen)}
		>
			<span class="text-[length:var(--font-size-caption)] font-semibold text-foreground">
				{m.pi_templates()}
				{#if piAgentState.templates.length > 0}
					<span class="text-muted font-normal ml-1">({piAgentState.templates.length})</span>
				{/if}
			</span>
			<span class="text-[length:var(--font-size-telemetry)] text-muted">{templatesOpen ? '\u25B2' : '\u25BC'}</span>
		</Button>
		{#if templatesOpen}
			<div class="border-t border-border">
				<PiAgentTemplates />
			</div>
		{/if}
	</div>

	<!-- Dream Activity section (collapsible) -->
	<div class="border border-border rounded-lg overflow-hidden">
		<Button variant="ghost"
			type="button"
			class="w-full flex items-center justify-between px-3 py-2 bg-bg2 hover:bg-bg3 transition-colors cursor-pointer"
			onclick={() => (dreamOpen = !dreamOpen)}
		>
			<span class="text-[length:var(--font-size-caption)] font-semibold text-foreground">{m.pi_dreamActivity()}</span>
			<span class="text-[length:var(--font-size-telemetry)] text-muted">{dreamOpen ? '\u25B2' : '\u25BC'}</span>
		</Button>
		{#if dreamOpen}
			<div class="border-t border-border">
				<DreamActivity {agentId} />
			</div>
		{/if}
	</div>
</div>
