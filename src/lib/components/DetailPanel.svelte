<script lang="ts">
    import AgentDetail from "./AgentDetail.svelte";
    import WelcomePanel from "./WelcomePanel.svelte";
    import DotGrid from "$lib/components/decorations/DotGrid.svelte";
    import { ui } from "$lib/state/ui.svelte";
    import { gw } from "$lib/state/gateway-data.svelte";
    import { conn } from "$lib/state/connection.svelte";
    import { bgPattern } from "$lib/state/bg-pattern.svelte";

    const agent = $derived(
        gw.agents.find(
            (a) => (a as { id: string }).id === ui.selectedAgentId,
        ) ?? null,
    );
</script>

<section class="flex-1 min-w-0 flex flex-col overflow-hidden">
    {#if agent && ui.selectedAgentId}
        <AgentDetail agentId={ui.selectedAgentId} {agent} />
    {:else}
        {#if bgPattern.pattern === "none"}<DotGrid opacity={0.06} />{/if}
        <WelcomePanel />
    {/if}
</section>
