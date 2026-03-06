<script lang="ts">
	import SubagentList from './SubagentList.svelte';
	import SubagentDetail from './SubagentDetail.svelte';
	import {
		loadSubagents,
		clearSubagents,
		handleSessionEvent,
		subagentState
	} from '$lib/state/features/subagent-data.svelte';
	import { gw } from '$lib/state/gateway/gateway-data.svelte';

	let { agentId }: { agentId: string } = $props();

	$effect(() => {
		if (agentId) {
			loadSubagents(agentId);
		}
		return () => {
			clearSubagents();
		};
	});

	// Forward subagent session events from the main session store
	$effect(() => {
		const sessions = gw.sessions;
		for (const s of sessions) {
			if (
				s.sessionKey?.includes(':subagent:') &&
				s.sessionKey?.startsWith(`agent:${agentId}:`)
			) {
				handleSessionEvent({ key: s.sessionKey, ...s });
			}
		}
	});
</script>

<div class="flex flex-1 min-h-0 overflow-hidden">
	<!-- Left: Subagent list -->
	<div class="w-72 border-r border-border flex-shrink-0">
		<SubagentList />
	</div>

	<!-- Right: Detail panel -->
	<div class="flex-1 min-h-0">
		<SubagentDetail />
	</div>
</div>
