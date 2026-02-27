<script lang="ts">
  import { hostsState } from '$lib/state/hosts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { fmtTimeAgo } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';

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

<div class="absolute top-[calc(100%+4px)] left-0 z-500 bg-bg2 border border-border rounded-lg shadow-md min-w-[200px] max-w-[320px] overflow-hidden" role="menu" tabindex="0" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
  {#each hostsState.hosts as host (host.id)}
    <div
      class="flex items-center gap-2 py-[9px] px-[14px] cursor-pointer text-[13px] text-foreground border-b border-[rgba(42,53,72,0.5)] transition-colors hover:bg-bg3"
      role="menuitem"
      tabindex="0"
      onclick={() => selectHost(host.id)}
      onkeydown={(e) => e.key === 'Enter' && selectHost(host.id)}
    >
      <span class="w-[7px] h-[7px] rounded-full shrink-0 {host.id === hostsState.activeHostId && conn.connected ? 'bg-success shadow-[0_0_5px_var(--color-success)]' : 'bg-muted-foreground'}"></span>
      <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{host.name}</span>
      <span class="text-[10px] text-muted-foreground shrink-0">{fmtTimeAgo(host.lastConnectedAt)}</span>
    </div>
  {/each}

  <div class="h-px bg-border"></div>
  {#if conn.connected || conn.connecting}
    <div class="py-2 px-[14px] text-xs text-destructive cursor-pointer transition-colors hover:bg-destructive/[0.08]" role="menuitem" tabindex="0" onclick={disconnect} onkeydown={(e) => e.key === 'Enter' && disconnect()}>
      {m.hosts_disconnect()}
    </div>
  {/if}
  <div class="py-2 px-[14px] text-xs text-muted-foreground cursor-pointer transition-colors hover:bg-bg3 hover:text-muted" role="menuitem" tabindex="0" onclick={openManage} onkeydown={(e) => e.key === 'Enter' && openManage(e as unknown as MouseEvent)}>
    {m.hosts_manage()}
  </div>
</div>
