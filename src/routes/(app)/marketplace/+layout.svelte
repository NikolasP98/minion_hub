<script lang="ts">
    import type { Snippet } from 'svelte';
    import MarketplaceNav from '$lib/components/marketplace/MarketplaceNav.svelte';

    let { children }: { children: Snippet } = $props();
</script>

<div class="h-full flex">
    <MarketplaceNav />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {@render children()}
    </div>
</div>
