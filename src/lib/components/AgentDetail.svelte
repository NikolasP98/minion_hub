<script lang="ts">
  import DetailHeader from './DetailHeader.svelte';
  import SessionDropdown from './SessionDropdown.svelte';
  import SessionViewer from './SessionViewer.svelte';
  import SessionKanban from './SessionKanban.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import AgentSettingsPanel from './AgentSettingsPanel.svelte';
  import SessionMonitor from './SessionMonitor.svelte';
  import AgentFiles from './AgentFiles.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import type { Agent } from '$lib/types/gateway';
  import type { SessionRow } from './SessionsList.svelte';

  let { agentId, agent }: { agentId: string; agent: Agent } = $props();

  let activeTab = $state<'chat' | 'monitor' | 'files'>('chat');

  $effect(() => {
    agentId; // track agentId changes
    activeTab = 'chat';
  });
  const mainSessionKey = $derived(`agent:${agentId}:main`);
  const isMainSession = $derived(ui.selectedSessionKey === mainSessionKey);

  const selectedSessionRow: SessionRow | null = $derived.by(() => {
    const key = ui.selectedSessionKey;
    if (!key) return null;
    const s = gw.sessions.find((sess) => sess.sessionKey === key);
    if (!s) return null;
    const now = Date.now();
    return {
      id: s.sessionKey,
      serverId: ui.selectedServerId ?? '',
      agentId: s.agentId ?? agentId,
      sessionKey: s.sessionKey,
      status: s.status ?? 'unknown',
      metadata: s.label || s.model ? JSON.stringify({ label: s.label, model: s.model }) : null,
      createdAt: s.createdAt ?? now,
      updatedAt: s.lastActiveAt ?? s.createdAt ?? now,
    };
  });
</script>

<div class="flex-1 min-h-0 flex flex-col overflow-hidden">
  <DetailHeader {agentId} {agent} />
  <SessionDropdown {agentId} serverId={ui.selectedServerId} />

  <!-- Tab bar -->
  <div class="shrink-0 flex items-center border-b border-border bg-bg2">
    <button
      type="button"
      class="px-4 py-2 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer
        {activeTab === 'chat'
        ? 'border-accent text-accent'
        : 'border-transparent text-muted hover:text-foreground'}"
      onclick={() => (activeTab = 'chat')}
    >
      Chat
    </button>
    <button
      type="button"
      class="px-4 py-2 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer
        {activeTab === 'monitor'
        ? 'border-accent text-accent'
        : 'border-transparent text-muted hover:text-foreground'}"
      onclick={() => (activeTab = 'monitor')}
    >
      Monitor
    </button>
    <button
      type="button"
      class="px-4 py-2 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer
        {activeTab === 'files'
        ? 'border-accent text-accent'
        : 'border-transparent text-muted hover:text-foreground'}"
      onclick={() => (activeTab = 'files')}
    >
      Files
    </button>
  </div>

  <!-- Main content: chat or monitor -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    {#if activeTab === 'monitor'}
      <SessionKanban sessionKey={ui.selectedSessionKey} serverId={ui.selectedServerId} />
      <SessionMonitor
        {agentId}
        sessionKey={ui.selectedSessionKey}
        serverId={ui.selectedServerId}
      />
    {:else if activeTab === 'files'}
      <AgentFiles {agentId} />
    {:else}
      {#if !isMainSession && ui.selectedSessionKey}
        <SessionViewer
          serverId={ui.selectedServerId}
          sessionKey={ui.selectedSessionKey}
          session={selectedSessionRow}
        />
      {/if}
      <ChatPanel {agentId} readonly={!isMainSession} />
    {/if}
  </div>
</div>

{#if ui.agentSettingsOpen}
  <AgentSettingsPanel {agentId} />
{/if}
