<script lang="ts">
  import { hostsState, getActiveHost, saveHosts } from '$lib/state/hosts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { fmtTimeAgo } from '$lib/utils/format';

  function selectHost(id: string) {
    if (hostsState.activeHostId === id) { ui.dropdownOpen = false; return; }
    wsDisconnect();
    hostsState.activeHostId = id;
    ui.dropdownOpen = false;
    wsConnect();
  }

  function disconnect() {
    wsDisconnect();
    ui.dropdownOpen = false;
  }

  function openManage(e: MouseEvent) {
    e.stopPropagation();
    ui.dropdownOpen = false;
    ui.overlayOpen = true;
  }
</script>

<div class="dropdown" role="menu" onclick={(e) => e.stopPropagation()}>
  {#each hostsState.hosts as host (host.id)}
    <div
      class="dropdown-item"
      role="menuitem"
      tabindex="0"
      onclick={() => selectHost(host.id)}
      onkeydown={(e) => e.key === 'Enter' && selectHost(host.id)}
    >
      <span class="dot {host.id === hostsState.activeHostId && conn.connected ? 'active' : ''}"></span>
      <span class="name">{host.name}</span>
      <span class="last">{fmtTimeAgo(host.lastConnectedAt)}</span>
    </div>
  {/each}

  <div class="divider"></div>
  {#if conn.connected || conn.connecting}
    <div class="dropdown-action danger" role="menuitem" tabindex="0" onclick={disconnect} onkeydown={(e) => e.key === 'Enter' && disconnect()}>
      Disconnect
    </div>
  {/if}
  <div class="dropdown-action" role="menuitem" tabindex="0" onclick={openManage} onkeydown={(e) => e.key === 'Enter' && openManage(e as unknown as MouseEvent)}>
    Manage hosts…
  </div>
</div>

<style>
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 500;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
    min-width: 200px;
    max-width: 320px;
    overflow: hidden;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
    border-bottom: 1px solid rgba(42,53,72,0.5);
    transition: background 0.12s;
  }
  .dropdown-item:hover { background: var(--bg3); }
  .dot {
    width: 7px; height: 7px;
    border-radius: 50%; flex-shrink: 0;
    background: var(--text3);
  }
  .dot.active { background: var(--green); box-shadow: 0 0 5px var(--green); }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .last { font-size: 10px; color: var(--text3); flex-shrink: 0; }
  .divider { height: 1px; background: var(--border); }
  .dropdown-action {
    padding: 8px 14px; font-size: 12px; color: var(--text3);
    cursor: pointer; transition: background 0.12s;
  }
  .dropdown-action:hover { background: var(--bg3); color: var(--text2); }
  .dropdown-action.danger { color: var(--red); }
  .dropdown-action.danger:hover { background: rgba(239,68,68,0.08); }
</style>
