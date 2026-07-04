<script lang="ts">
    import type { Snippet } from 'svelte';
    import BrainsNav from '$lib/components/brains/BrainsNav.svelte';
    let { children }: { children: Snippet } = $props();
</script>
<div class="h-full flex">
    <BrainsNav />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{@render children()}</div>
</div>
