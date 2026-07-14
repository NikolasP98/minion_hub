<script lang="ts">
	import { type Snippet } from 'svelte';
	import KanbanNavRail from '$lib/components/workforce/KanbanNavRail.svelte';
	import { SectionShell } from '$lib/components/ui/foundations';
	let { children }: { children: Snippet } = $props();
</script>

<!--
	KANBAN plugin shell. The icon rail (KanbanNavRail) gives the detail views —
	dashboard / issues / approvals / goals / projects / org — a compact /my-agent
	style sub-nav, so the section reads as a standalone plugin rather than six
	expanded entries in the primary sidebar.

	The right pane keeps the single shared scroll container the workforce subtree
	relies on. AppViewport owns dynamic viewport height and SectionShell owns the
	responsive rail-to-strip transformation; this main region is the one vertical
	scroll owner for ordinary workforce pages. Boards keep only their named inline
	scroll region.
-->
<SectionShell mode="responsive">
	{#snippet navigation()}<KanbanNavRail />{/snippet}
	<main class="flex-1 min-w-0 min-h-0 overflow-y-auto">
		{@render children()}
	</main>
</SectionShell>
