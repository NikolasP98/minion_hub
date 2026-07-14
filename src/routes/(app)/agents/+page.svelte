<script lang="ts">
  import { ArrowLeft, Bot } from 'lucide-svelte';
  import AgentSidebar from '$lib/components/agents/AgentSidebar.svelte';
  import DetailPanel from '$lib/components/layout/DetailPanel.svelte';
  import Splitter from '$lib/components/layout/Splitter.svelte';
  import { Button, PageHeader } from '$lib/components/ui';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import * as m from '$lib/paraglide/messages';

  function showAgentList() {
    ui.selectedAgentId = null;
    ui.selectedSessionKey = null;
  }
</script>

<PageShell archetype="master-detail" scroll="none">
  <PageHeader title={m.agent_title()} subtitle={m.nav_agents()}>
    {#snippet leading()}
      {#if ui.selectedAgentId}
        <span class="compact-only">
          <Button
            variant="ghost"
            size="sm"
            shape="icon"
            aria-label={m.common_back()}
            onclick={showAgentList}
          >
            {#snippet icon()}<ArrowLeft size={16} aria-hidden="true" />{/snippet}
          </Button>
        </span>
      {:else}
        <Bot size={16} aria-hidden="true" />
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody padding="none" scroll="none" class="agents-body">
    <div class="wide-agent-workspace">
      <Splitter storageKey="sidebar-main-v2" defaultSize={24} minibarSize={5} maxSize={35}>
        {#snippet panel({ collapseLevel })}
          <AgentSidebar {collapseLevel} />
        {/snippet}
        <DetailPanel />
      </Splitter>
    </div>

    <div class="compact-agent-workspace">
      {#if ui.selectedAgentId}
        <DetailPanel />
      {:else}
        <AgentSidebar collapseLevel="expanded" />
      {/if}
    </div>
  </PageBody>
</PageShell>

<style>
  :global(.agents-body),
  .wide-agent-workspace,
  .compact-agent-workspace {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }

  .compact-agent-workspace,
  .compact-only {
    display: none;
  }

  @media (max-width: 767.98px) {
    .wide-agent-workspace {
      display: none;
    }

    .compact-agent-workspace,
    .compact-only {
      display: flex;
    }
  }
</style>
