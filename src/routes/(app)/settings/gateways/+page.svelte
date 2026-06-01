<script lang="ts">
  import { invalidateAll, goto } from '$app/navigation';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { addHost, removeHost, updateHost, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Plus, Plug, Trash2, Wrench, Pencil, X, Check, Wifi, WifiOff } from 'lucide-svelte';

  const { data } = $props();

  // ── Add form ────────────────────────────────────────────────────────
  let name = $state('');
  let url = $state('');
  let token = $state('');
  let adding = $state(false);
  let addError = $state<string | null>(null);
  let addSuccess = $state<string | null>(null);

  // ── Inline edit (Turso hosts) ────────────────────────────────────────
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editUrl = $state('');
  let editToken = $state('');

  async function addGateway() {
    if (adding) return;
    adding = true; addError = null; addSuccess = null;
    // Add to both PG (new) and Turso (legacy, for WS connect compat)
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), url: url.trim(), token: token.trim() }),
    });
    if (res.ok) {
      // Also add to PG gateway table
      await fetch('/api/gateways', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), token: token.trim() }),
      });
      name = ''; url = ''; token = '';
      addSuccess = 'Gateway added.';
      await invalidateAll();
    } else {
      const j = await res.json().catch(() => ({})) as { error?: string };
      addError = j.error ?? 'Could not add gateway.';
    }
    adding = false;
  }

  async function removeTursoHost(id: string, hostName: string) {
    if (!confirm(m.hosts_deleteConfirm({ name: hostName }))) return;
    await removeHost(id);
    await invalidateAll();
  }

  async function removePgGateway(id: string) {
    await fetch(`/api/gateways/${id}`, { method: 'DELETE' });
    await invalidateAll();
  }

  function startEdit(host: { id: string; name: string; url: string }) {
    editingId = host.id;
    editName = host.name;
    editUrl = host.url;
    // Token field starts blank — submitting empty preserves the server-stored value.
    editToken = '';
  }

  async function saveEdit() {
    if (!editingId || !editName.trim() || !editUrl.trim()) return;
    await updateHost(editingId, { name: editName.trim(), url: editUrl.trim(), token: editToken.trim() });
    editingId = null;
    await invalidateAll();
  }

  function cancelEdit() { editingId = null; }

  function connect(host: { id: string }) {
    hostsState.activeHostId = host.id;
    wsConnect();
  }

  function formatTime(ts: number | null | undefined): string {
    if (!ts) return m.hosts_never();
    return new Date(ts).toLocaleString();
  }

  // Deduplicate: a host is in "both" if its URL appears in both lists
  const tursoUrlSet = $derived(new Set(data.tursoHosts.map((h: { url: string }) => h.url)));
  const pgOnly = $derived(data.pgGateways.filter((g: { url: string }) => !tursoUrlSet.has(g.url)));
</script>

<div class="flex-1 overflow-y-auto p-6 space-y-8">
  <section>
    <h1 class="text-lg font-semibold mb-1">{m.hosts_title()}</h1>
    <p class="text-xs text-muted mb-5">Manage gateway connections. Adding here registers the gateway for WS connect and per-user credential resolution.</p>

    <!-- Add form -->
    <div class="border border-border rounded-lg overflow-hidden mb-6">
      <div class="relative px-4 py-3 border-b border-border bg-bg/60 flex items-center gap-2">
        <ScanLine speed={10} opacity={0.02} />
        <Plug size={12} class="text-muted-strong" />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">{m.hosts_newServer()}</span>
      </div>
      <div class="p-4 space-y-3">
        <input bind:value={name} placeholder={m.hosts_namePlaceholder()}
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60" />
        <input bind:value={url} placeholder={m.hosts_urlPlaceholder()}
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60" />
        <input bind:value={token} type="password" placeholder={m.hosts_tokenPlaceholder()}
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60" />
        {#if addError}<p class="text-[11px] font-mono text-red-400">{addError}</p>{/if}
        {#if addSuccess}<p class="text-[11px] font-mono text-green-400">{addSuccess}</p>{/if}
        <button onclick={addGateway} disabled={adding || !name || !url || !token}
          class="flex items-center gap-1.5 px-4 py-2 rounded border text-sm font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 disabled:opacity-50">
          {#if adding}{m.hosts_adding()}{:else}<Plus size={13} /> {m.hosts_addServer()}{/if}
        </button>
      </div>
    </div>

    <!-- Unified gateway list (Turso hosts = source of truth for WS connect) -->
    {#if data.tursoHosts.length === 0 && pgOnly.length === 0}
      <div class="bg-card border border-border rounded-lg px-5 py-8 text-center">
        <p class="text-sm text-muted-foreground">{m.hosts_noServers()}</p>
        <p class="text-xs text-muted-strong mt-1">{m.hosts_noServersHint()}</p>
      </div>
    {:else}
      <ul class="space-y-2">
        {#each data.tursoHosts as host (host.id)}
          {@const isConnected = conn.connected && hostsState.activeHostId === host.id}
          <li class="border border-border rounded-lg overflow-hidden bg-card {isConnected ? 'border-accent/40' : ''}">
            {#if editingId === host.id}
              <div class="p-3 space-y-2">
                <input bind:value={editName} placeholder={m.hosts_namePlaceholder()} class="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:border-accent/60" />
                <input bind:value={editUrl} placeholder={m.hosts_urlPlaceholder()} class="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:border-accent/60" />
                <input bind:value={editToken} type="password" placeholder={m.hosts_tokenPlaceholder()}
                  class="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-strong focus:outline-none focus:border-accent/60" />
                <div class="flex gap-2 justify-end">
                  <button onclick={cancelEdit} class="flex items-center gap-1 px-3 py-1 rounded border text-xs font-mono bg-bg border-border text-muted hover:text-foreground"><X size={12} /> {m.hosts_cancel()}</button>
                  <button onclick={saveEdit} class="flex items-center gap-1 px-3 py-1 rounded border text-xs font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30"><Check size={12} /> {m.hosts_save()}</button>
                </div>
              </div>
            {:else}
              <div class="flex items-center gap-3 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-foreground truncate">{host.name}</span>
                    {#if isConnected}
                      <span class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-medium">
                        <Wifi size={10} /> {m.hosts_connect()}
                      </span>
                    {:else}
                      <span class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                        <WifiOff size={10} /> {m.hosts_offline()}
                      </span>
                    {/if}
                  </div>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-xs text-muted-foreground font-mono truncate">{host.url}</span>
                    <span class="text-[10px] text-muted-strong">&middot;</span>
                    <span class="text-[10px] text-muted-strong">{m.hosts_lastConnected({ time: formatTime(host.lastConnectedAt) })}</span>
                  </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  {#if !isConnected}
                    <button onclick={() => connect(host)} title={m.hosts_connect()}
                      class="px-2 py-1 rounded border text-xs font-mono text-accent border-accent/30 hover:bg-accent/10">
                      {m.hosts_connect()}
                    </button>
                  {/if}
                  <button onclick={() => goto(`/settings/provision?server=${host.id}`)} title={m.hosts_provision()}
                    class="p-1.5 rounded text-muted-foreground hover:text-accent hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none">
                    <Wrench size={14} />
                  </button>
                  <button onclick={() => startEdit(host)} title={m.common_edit()}
                    class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none">
                    <Pencil size={14} />
                  </button>
                  <button onclick={() => removeTursoHost(host.id, host.name)} title={m.hosts_delete()}
                    class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            {/if}
          </li>
        {/each}

        <!-- PG-only gateways (not yet in Turso — no WS connect button) -->
        {#each pgOnly as g (g.id)}
          <li class="border border-border/50 border-dashed rounded-lg px-4 py-3 flex items-center justify-between opacity-70">
            <div class="min-w-0">
              <div class="text-sm text-foreground truncate">{g.name} <span class="text-[10px] text-muted font-mono ml-1">pg only</span></div>
              <div class="text-xs text-muted font-mono truncate">{g.url}</div>
            </div>
            <button onclick={() => removePgGateway(g.id)} title={m.hosts_delete()}
              class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none shrink-0">
              <Trash2 size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
