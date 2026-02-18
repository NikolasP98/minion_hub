<script lang="ts">
  import AgentRow from './AgentRow.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { agentActivity } from '$lib/state/chat.svelte';

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

  <div class="sidebar-header">Agents</div>
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
</aside>

<style>
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    overflow-y: auto;
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
    padding: 9px 14px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--text3);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .sidebar-list { flex: 1; }
  .sidebar-empty {
    padding: 28px 14px;
    text-align: center;
    color: var(--text3);
    font-size: 12px;
  }
</style>
