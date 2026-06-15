<script lang="ts">
	import { type Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!--
	Shared shell for everything under /agents (index, builder, workshop, …).
	Navigation to these surfaces now lives in the primary Sidebar (Agents group:
	Copilots / AI Brains / Autonomous / Workshop / …), so the old icon NavRail
	was removed. `.agents-shell-main` mirrors the (app) layout the pages were
	authored against, so toolbar+content pages and the splitter page render
	unchanged.
-->
<div class="agents-shell">
	<div class="agents-shell-main">
		{@render children()}
	</div>
</div>

<style>
	.agents-shell {
		/* Parent is the (app) layout's block `.h-full` wrapper, not a flex
		   container, so `flex:1` is ignored and the shell grows to content
		   height (overflowing past the viewport). Fill the wrapper explicitly. */
		height: 100%;
		min-height: 0;
		display: flex;
	}
	.agents-shell-main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
