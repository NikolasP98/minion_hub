<script lang="ts">
    import type { Snippet } from 'svelte';
    import CrmNav from '$lib/components/crm/CrmNav.svelte';

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();
</script>

<div class="h-full flex">
    <CrmNav />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {@render children()}
    </div>
</div>
