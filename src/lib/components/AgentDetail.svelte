<script lang="ts">
  import DetailHeader from './DetailHeader.svelte';
  import KanbanBoard from './KanbanBoard.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import type { Agent } from '$lib/types/gateway';

  let { agentId, agent }: { agentId: string; agent: Agent } = $props();
</script>

<div class="agent-detail">
  <DetailHeader {agentId} {agent} />
  <KanbanBoard {agentId} />
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
