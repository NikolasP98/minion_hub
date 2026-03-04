<script lang="ts">
    import Topbar from '$lib/components/Topbar.svelte';
    import AgentSidebar from '$lib/components/AgentSidebar.svelte';
    import DetailPanel from '$lib/components/DetailPanel.svelte';
    import Splitter from '$lib/components/Splitter.svelte';
    import type { CollapseLevel } from '$lib/components/Splitter.svelte';

    interface SplitterApiHandle {
        toggleMini: () => void;
        expand: () => void;
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
                collapsed={collapseLevel === 'collapsed'}
                ontoggle={() => splitterApi?.toggleMini()}
            />
        {/snippet}
        <DetailPanel />
    </Splitter>
</div>
