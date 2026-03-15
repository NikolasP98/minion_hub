<script lang="ts">
    import Topbar from '$lib/components/layout/Topbar.svelte';
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

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
    <Topbar />
    <Splitter
        storageKey="sidebar-main"
        defaultSize={20}
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
</div>
