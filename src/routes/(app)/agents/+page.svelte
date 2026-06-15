<script lang="ts">
    import AgentSidebar from '$lib/components/agents/AgentSidebar.svelte';
    import DetailPanel from '$lib/components/layout/DetailPanel.svelte';
    import Splitter from '$lib/components/layout/Splitter.svelte';
    import type { CollapseLevel } from '$lib/components/layout/Splitter.svelte';

    interface SplitterApiHandle {
        toggle: () => void;
        expand: () => void;
        hide: () => void;
        mini: () => void;
        collapseLevel: () => CollapseLevel;
    }

    let splitterApi = $state<SplitterApiHandle | null>(null);
</script>

<!-- Navigation lives in the primary Sidebar (Agents group). -->
<Splitter
    storageKey="sidebar-main-v2"
    defaultSize={5}
    minibarSize={5}
    maxSize={28}
    onapi={(api) => { splitterApi = api; }}
>
    {#snippet panel({ collapseLevel })}
        <AgentSidebar
            {collapseLevel}
        />
    {/snippet}
    <DetailPanel />
</Splitter>
