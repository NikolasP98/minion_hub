<script lang="ts">
    import type { Snippet } from 'svelte';
    import AdsNav from '$lib/components/ads/AdsNav.svelte';
    let { children }: { children: Snippet } = $props();
</script>
<div class="h-full flex">
    <AdsNav />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{@render children()}</div>
</div>
