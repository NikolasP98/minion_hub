<script lang="ts">
  import DetailHeader from './DetailHeader.svelte';
  import SessionDropdown from './SessionDropdown.svelte';
  import MissionContext from './MissionContext.svelte';
  import KanbanBoard from './KanbanBoard.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import type { Agent } from '$lib/types/gateway';

  let { agentId, agent }: { agentId: string; agent: Agent } = $props();
</script>

<div class="agent-detail">
  <DetailHeader {agentId} {agent} />
  <SessionDropdown {agentId} serverId={ui.selectedServerId} />
  {#if ui.selectedSessionKey}
    <MissionContext sessionKey={ui.selectedSessionKey} serverId={ui.selectedServerId} />
    {#if ui.selectedMissionId}
      <KanbanBoard missionId={ui.selectedMissionId} serverId={ui.selectedServerId} />
    {/if}
  {/if}
  <ChatPanel {agentId} />
</div>

<style>
  .agent-detail {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
