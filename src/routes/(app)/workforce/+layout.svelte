<script lang="ts">
	import { type Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<!--
	Workforce subtree shares one scroll container. The parent (app) layout uses
	flex-col h-screen overflow-hidden with the Topbar fixed inside; without a
	scroll wrapper here every workforce page that exceeds viewport height gets
	clipped. flex-1 min-h-0 lets the wrapper fill remaining height; overflow-y-auto
	gives it scroll without breaking pages that constrain their own height
	(e.g., org chart's h-[calc(100vh-3.5rem)] still resolves to the same value).
-->
<main class="flex-1 min-h-0 overflow-y-auto">
	{@render children()}
</main>
