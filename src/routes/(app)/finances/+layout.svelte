<script lang="ts">
    import type { Snippet } from 'svelte';
    import FinanceNav from '$lib/components/finance/FinanceNav.svelte';
    let { children }: { children: Snippet } = $props();
</script>
<div class="h-full flex">
    <FinanceNav />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{@render children()}</div>
</div>
