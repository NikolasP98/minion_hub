<script lang="ts">
  import AgentRow from './AgentRow.svelte';
  import GatewayInfo from './GatewayInfo.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { agentActivity } from '$lib/state/chat.svelte';
  import AddAgentModal from './AddAgentModal.svelte';

  // Logo component for top of sidebar
  const ACCENT_COLORS = [
    '#3b82f6', '#22c55e', '#a855f7', '#ec4899',
    '#06b6d4', '#f59e0b', '#10b981', '#ef4444',
  ];
</script>

<aside class="sidebar">
  <!-- Logo at top of sidebar -->
  <div class="sidebar-logo" aria-label="Minion Hub">
    <span class="logo-pill">MINION</span><span class="logo-hub">hub</span>
  </div>

  <div class="sidebar-header">
    <span>Agents</span>
    <button class="add-agent-btn" onclick={() => { ui.agentAddOpen = true; }} aria-label="Add agent">+</button>
  </div>
  <div class="sidebar-list">
    {#if !conn.connected}
      <div class="sidebar-empty">
        {conn.connecting ? 'Connecting…' : 'Not connected'}
      </div>
    {:else if gw.agents.length === 0}
      <div class="sidebar-empty">No agents</div>
    {:else}
      {#each gw.agents as agent, i (agent.id)}
        <AgentRow
          {agent}
          selected={ui.selectedAgentId === agent.id}
          accentColor={ACCENT_COLORS[i % ACCENT_COLORS.length]}
          onclick={() => { ui.selectedAgentId = agent.id; }}
        />
      {/each}
    {/if}
  </div>

  <div class="sidebar-footer">
    <GatewayInfo />
  </div>
</aside>

{#if ui.agentAddOpen}
  <AddAgentModal />
{/if}

<style>
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    overflow: hidden;
    border-right: 1px solid var(--border);
    background: var(--bg2);
    display: flex;
    flex-direction: column;
  }
  .sidebar-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 14px 12px 12px;
    border-bottom: 1px solid var(--border);
    user-select: none;
    line-height: 1;
    gap: 0;
  }
  .logo-pill {
    background: var(--brand-pink);
    color: #000;
    font-weight: 900;
    font-size: 14px;
    letter-spacing: 0.5px;
    padding: 3px 9px;
    border-radius: 5px 0 0 5px;
    text-transform: uppercase;
  }
  .logo-hub {
    color: #fff;
    font-weight: 700;
    font-size: 14px;
    padding: 3px 7px;
  }
  .sidebar-header {
    padding: 9px 10px 9px 14px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--text3);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .add-agent-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text3);
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
    flex-shrink: 0;
  }
  .add-agent-btn:hover {
    color: var(--text1);
    border-color: var(--text3);
    background: var(--bg3, rgba(255,255,255,0.06));
  }
  .sidebar-list { flex: 1; overflow-y: auto; }
  .sidebar-empty {
    padding: 28px 14px;
    text-align: center;
    color: var(--text3);
    font-size: 12px;
  }
  .sidebar-footer {
    flex-shrink: 0;
    padding: 8px 10px;
    border-top: 1px solid var(--border);
  }
  .sidebar-footer :global(.gw-info) {
    flex-wrap: wrap;
    gap: 4px;
  }
  .sidebar-footer :global(.gw-tag) {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
  }
  /* Hide sidebar logo when topbar (navbar) is visible */
  :global(.page:has(.topbar)) .sidebar-logo {
    display: none;
  }
</style>
