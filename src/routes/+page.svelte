<script lang="ts">
    import Topbar from '$lib/components/Topbar.svelte';
    import AgentSidebar from '$lib/components/AgentSidebar.svelte';
    import DetailPanel from '$lib/components/DetailPanel.svelte';
    import Splitter from '$lib/components/Splitter.svelte';
    import { ui } from '$lib/state/ui.svelte';

    interface SplitterApiHandle {
        collapse: () => void;
        expand: () => void;
        isCollapsed: () => boolean;
    }

    let splitterApi = $state<SplitterApiHandle | null>(null);

    function handleSidebarToggle() {
        if (!splitterApi) {
            ui.sidebarCollapsed = !ui.sidebarCollapsed;
            return;
        }
        if (splitterApi.isCollapsed()) {
            splitterApi.expand();
        } else {
            ui.sidebarCollapsed = !ui.sidebarCollapsed;
        }
    }
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden">
    <Topbar />
    <Splitter
        storageKey="sidebar-main"
        defaultSize={20}
        minSize={5}
        collapsedSize={0}
        onapi={(api) => { splitterApi = api; }}
        oncollapse={() => { ui.sidebarCollapsed = false; }}
        onexpand={() => { ui.sidebarCollapsed = false; }}
    >
        {#snippet panel({ collapsed })}
            <AgentSidebar
                collapsed={collapsed || ui.sidebarCollapsed}
                ontoggle={handleSidebarToggle}
            />
        {/snippet}
        <DetailPanel />
    </Splitter>
</div>
