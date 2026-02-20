<script lang="ts">
  import { hostsState, getActiveHost, loadHosts, saveHosts } from '$lib/state/hosts.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { fmtTimeAgo } from '$lib/utils/format';
  import { uuid } from '$lib/utils/uuid';
  import type { Host } from '$lib/types/host';

  let formName = $state('');
  let formUrl = $state('');
  let formToken = $state('');
  let editingId = $state<string | null>(null);
  let confirmDeleteId = $state<string | null>(null);

  function close() { ui.overlayOpen = false; editingId = null; confirmDeleteId = null; }

  function startEdit(host: Host) {
    editingId = host.id;
    formName = host.name;
    formUrl = host.url;
    formToken = host.token;
  }

  function cancelEdit() { editingId = null; formName = ''; formUrl = ''; formToken = ''; }

  function saveHost() {
    if (!formUrl.trim()) return;
    const name = formName.trim() || (() => { try { return new URL(formUrl).hostname; } catch { return 'host'; } })();
    if (editingId) {
      const h = hostsState.hosts.find((x) => x.id === editingId);
      if (h) { h.name = name; h.url = formUrl.trim(); h.token = formToken.trim(); }
    } else {
      hostsState.hosts.push({ id: uuid(), name, url: formUrl.trim(), token: formToken.trim(), lastConnectedAt: null });
      hostsState.activeHostId = hostsState.hosts[hostsState.hosts.length - 1].id;
    }
    saveHosts();
    cancelEdit();
    if (!editingId) { close(); wsConnect(); }
  }

  function deleteHost(id: string) {
    hostsState.hosts = hostsState.hosts.filter((h) => h.id !== id);
    saveHosts();
    if (hostsState.activeHostId === id) {
      wsDisconnect();
      hostsState.activeHostId = hostsState.hosts[0]?.id ?? null;
    }
    confirmDeleteId = null;
  }

  function connectTo(id: string) {
    if (hostsState.activeHostId === id && conn.connected) { close(); return; }
    wsDisconnect();
    hostsState.activeHostId = id;
    wsConnect();
    close();
  }
</script>

<div class="fixed inset-0 z-1000 bg-black/60 flex items-center justify-center" role="dialog" aria-modal="true" onclick={close}>
  <div class="bg-bg2 border border-border rounded-xl w-[520px] max-w-[calc(100vw-40px)] max-h-[80vh] flex flex-col shadow-md" onclick={(e) => e.stopPropagation()}>
    <div class="flex items-center justify-between px-5 pt-4 pb-[14px] border-b border-border shrink-0">
      <span class="text-base font-bold">Manage Hosts</span>
      <button class="bg-transparent border-none text-muted-foreground cursor-pointer text-xl leading-none px-[6px] py-[2px] rounded-sm transition-colors hover:text-foreground" onclick={close} aria-label="Close">×</button>
    </div>
    <div class="flex-1 overflow-y-auto py-3 px-4">
      {#each hostsState.hosts as host (host.id)}
        <div class="bg-bg3 border rounded-lg py-3 px-[14px] mb-2 flex items-start gap-3 {editingId === host.id ? 'border-accent' : 'border-border'}">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold flex items-center gap-2">
              {host.name}
              {#if host.id === hostsState.activeHostId && conn.connected}
                <span class="text-[10px] font-semibold bg-success/[0.12] text-success border border-success/25 rounded-full py-[1px] px-[7px]">connected</span>
              {/if}
            </div>
            <div class="text-[11px] text-muted-foreground font-mono mt-[2px] whitespace-nowrap overflow-hidden text-ellipsis">{host.url}</div>
            <div class="text-[10px] text-muted-foreground mt-1">Last: {fmtTimeAgo(host.lastConnectedAt)}</div>
            {#if confirmDeleteId === host.id}
              <div class="flex items-center gap-2 pt-[6px] text-xs text-warning">
                Delete this host?
                <button class="bg-destructive border-none rounded-sm text-white cursor-pointer text-[11px] font-semibold py-[3px] px-[10px]" onclick={() => deleteHost(host.id)}>Delete</button>
                <button class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer font-[inherit] text-xs py-[6px] px-3 transition-colors hover:text-muted" onclick={() => confirmDeleteId = null}>Cancel</button>
              </div>
            {/if}
          </div>
          <div class="flex gap-[6px] shrink-0">
            <button class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-[13px] py-1 px-2 transition-all hover:border-muted hover:text-foreground" onclick={() => connectTo(host.id)}>Connect</button>
            <button class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-[13px] py-1 px-2 transition-all hover:border-muted hover:text-foreground" onclick={() => startEdit(host)}>Edit</button>
            <button class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer text-[13px] py-1 px-2 transition-all hover:border-destructive hover:text-destructive" onclick={() => confirmDeleteId = host.id}>Delete</button>
          </div>
        </div>
      {/each}
    </div>
    <div class="border-t border-border py-[14px] px-4 shrink-0">
      <div class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-[10px]">{editingId ? 'Edit Host' : 'Add Host'}</div>
      <div class="grid grid-cols-2 gap-2 mb-[10px]">
        <div class="flex flex-col gap-1">
          <label class="text-[11px] text-muted-foreground">Name</label>
          <input class="bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] font-[inherit] text-xs outline-none transition-colors focus:border-accent" type="text" bind:value={formName} placeholder="protopi" />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[11px] text-muted-foreground">Token</label>
          <input class="bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] font-[inherit] text-xs outline-none transition-colors focus:border-accent" type="password" bind:value={formToken} placeholder="••••••" />
        </div>
        <div class="flex flex-col gap-1 col-span-2">
          <label class="text-[11px] text-muted-foreground">WebSocket URL</label>
          <input class="bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] font-[inherit] text-xs outline-none transition-colors focus:border-accent" type="text" bind:value={formUrl} placeholder="wss://host.ts.net" />
        </div>
      </div>
      <div class="flex gap-2 justify-end">
        {#if editingId}
          <button class="bg-transparent border border-border rounded-[5px] text-muted-foreground cursor-pointer font-[inherit] text-xs py-[6px] px-3 transition-colors hover:text-muted" onclick={cancelEdit}>Cancel</button>
        {/if}
        <button class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-4 transition-[filter] hover:brightness-115" onclick={saveHost}>{editingId ? 'Save' : 'Add & Connect'}</button>
      </div>
    </div>
  </div>
</div>
