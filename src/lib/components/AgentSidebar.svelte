<script lang="ts">
  import AgentRow from './AgentRow.svelte';
  import GatewayInfo from './GatewayInfo.svelte';
  import HudBorder from '$lib/components/decorations/HudBorder.svelte';
  import DotMatrix from '$lib/components/decorations/DotMatrix.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import AddAgentModal from './AddAgentModal.svelte';
  import * as m from '$lib/paraglide/messages';

  const ACCENT_COLORS = [
    '#3b82f6', '#22c55e', '#a855f7', '#ec4899',
    '#06b6d4', '#f59e0b', '#10b981', '#ef4444',
  ];

  const activityData = $derived(
    conn.connected
      ? Array.from({ length: 16 }, () => Math.random() * 0.8 + 0.2)
      : new Array(16).fill(0)
  );

  const collapsed = $derived(ui.sidebarCollapsed);

  function toggleCollapse() {
    ui.sidebarCollapsed = !ui.sidebarCollapsed;
  }
</script>

<HudBorder class="{collapsed ? 'w-[52px]' : 'w-[260px]'} shrink-0 overflow-hidden border-r border-border bg-bg2 flex flex-col transition-[width] duration-200">
  <div class="hidden items-center justify-center px-3 py-3.5 border-b border-border select-none leading-none">
    <span class="bg-brand-pink text-black font-black text-sm tracking-wide px-2 py-0.5 rounded-l-[5px] uppercase">MINION</span>
    <span class="text-white font-bold text-sm px-1.5 py-0.5">hub</span>
  </div>

  <!-- Header -->
  {#if collapsed}
    <div class="px-1 py-2.5 border-b border-border shrink-0 flex flex-col items-center gap-1.5">
      <button
        class="flex items-center justify-center w-7 h-5 p-0 border border-border rounded-sm bg-transparent text-muted-foreground text-[10px] leading-none cursor-pointer transition-all duration-150 hover:text-foreground hover:border-muted hover:bg-bg3"
        onclick={toggleCollapse}
        aria-label="Expand sidebar"
      >
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button
        class="flex items-center justify-center w-7 h-5 p-0 border border-border rounded-sm bg-transparent text-muted-foreground text-base leading-none cursor-pointer transition-all duration-150 hover:text-foreground hover:border-muted hover:bg-bg3"
        onclick={() => { ui.agentAddOpen = true; }}
        aria-label={m.agent_addLabel()}
      >+</button>
    </div>
  {:else}
    <div class="px-3.5 py-2.5 text-[10px] font-bold tracking-widest uppercase text-muted-foreground border-b border-border shrink-0 flex items-center justify-between">
      <span>{m.agent_title()}</span>
      <div class="flex items-center gap-1">
        <button
          class="flex items-center justify-center w-5 h-5 p-0 border border-border rounded-sm bg-transparent text-muted-foreground text-base leading-none cursor-pointer transition-all duration-150 hover:text-foreground hover:border-muted hover:bg-bg3"
          onclick={() => { ui.agentAddOpen = true; }}
          aria-label={m.agent_addLabel()}
        >+</button>
        <button
          class="flex items-center justify-center w-5 h-5 p-0 border border-border rounded-sm bg-transparent text-muted-foreground text-[10px] leading-none cursor-pointer transition-all duration-150 hover:text-foreground hover:border-muted hover:bg-bg3"
          onclick={toggleCollapse}
          aria-label="Collapse sidebar"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
    </div>
  {/if}

  <!-- Agent list -->
  <div class="flex-1 overflow-y-auto">
    {#if !conn.connected}
      <div class="py-7 px-1 text-center text-muted-foreground text-xs">
        {#if collapsed}
          <span class="text-[10px]">{conn.connecting ? '...' : '—'}</span>
        {:else}
          {conn.connecting ? m.conn_connecting() : m.conn_notConnected()}
        {/if}
      </div>
    {:else if gw.agents.length === 0}
      <div class="py-7 px-1 text-center text-muted-foreground text-xs">
        {#if collapsed}
          <span class="text-lg">∅</span>
        {:else}
          {m.agent_noAgents()}
        {/if}
      </div>
    {:else}
      {#each gw.agents as agent, i (agent.id)}
        <AgentRow
          {agent}
          selected={ui.selectedAgentId === agent.id}
          accentColor={ACCENT_COLORS[i % ACCENT_COLORS.length]}
          compact={collapsed}
          onclick={() => {
            ui.selectedAgentId = agent.id;
            ui.selectedSessionKey = `agent:${agent.id}:main`;
          }}
        />
      {/each}
    {/if}
  </div>

  <!-- Footer -->
  {#if collapsed}
    <div class="shrink-0 px-1 py-2 border-t border-border flex flex-col items-center">
      <div class="w-1.5 h-1.5 rounded-full {conn.connected ? 'bg-green-500' : 'bg-red-500'}"></div>
    </div>
  {:else}
    <div class="shrink-0 px-2.5 py-2 border-t border-border flex flex-col gap-2">
      <GatewayInfo />
      <div class="flex items-center justify-center py-1">
        <DotMatrix data={activityData} cols={8} />
      </div>
    </div>
  {/if}
</HudBorder>

{#if ui.agentAddOpen}
  <AddAgentModal />
{/if}
