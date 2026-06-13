<script lang="ts">
	import { type Snippet } from 'svelte';
	import KanbanNavRail from '$lib/components/workforce/KanbanNavRail.svelte';
	let { children }: { children: Snippet } = $props();
</script>

<!--
	KANBAN plugin shell. The icon rail (KanbanNavRail) gives the detail views —
	dashboard / issues / approvals / goals / projects / org — a compact /my-agent
	style sub-nav, so the section reads as a standalone plugin rather than six
	expanded entries in the primary sidebar.

	The right pane keeps the single shared scroll container the workforce subtree
	relies on: the parent (app) layout is flex-col h-screen overflow-hidden with a
	fixed Topbar, so without a scroll wrapper here every page that exceeds viewport
	height gets clipped. flex-1 min-h-0 fills remaining height; overflow-y-auto
	gives scroll without breaking pages that constrain their own height (e.g. the
	org chart's h-[calc(100vh-3.5rem)] still resolves to the same value).
-->
<div class="kanban-shell">
	<KanbanNavRail />
	<main class="flex-1 min-w-0 min-h-0 overflow-y-auto">
		{@render children()}
	</main>
</div>

<style>
	.kanban-shell {
		display: flex;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
</style>
