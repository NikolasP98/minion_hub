<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { addHost, removeHost, updateHost } from '$lib/state/features/hosts.svelte';
  import { wsConnect, wsDisconnect } from '$lib/services/gateway.svelte';
  import { hostsState } from '$lib/state/features/hosts.svelte';

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
    if (!confirm(`Remove ${hostName}?`)) return;
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

  // Deduplicate: a host is in "both" if its URL appears in both lists
  const tursoUrlSet = $derived(new Set(data.tursoHosts.map((h: any) => h.url)));
  const pgOnly = $derived(data.pgGateways.filter((g: any) => !tursoUrlSet.has(g.url)));
</script>

<div class="p-6 space-y-8">
  <section>
    <h1 class="text-lg font-semibold mb-1">Gateways</h1>
    <p class="text-xs text-muted mb-5">Manage gateway connections. Adding here registers the gateway for WS connect and per-user credential resolution.</p>

    <!-- Add form -->
    <div class="border border-border rounded-lg overflow-hidden mb-6">
      <div class="relative px-4 py-3 border-b border-border bg-bg/60">
        <ScanLine speed={10} opacity={0.02} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">Add gateway</span>
      </div>
      <div class="p-4 space-y-3">
        <input bind:value={name} placeholder="Name (e.g. production)"
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        <input bind:value={url} placeholder="URL (ws:// or wss://)"
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        <input bind:value={token} type="password" placeholder="Token"
          class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        {#if addError}<p class="text-[11px] font-mono text-red-400">{addError}</p>{/if}
        {#if addSuccess}<p class="text-[11px] font-mono text-green-400">{addSuccess}</p>{/if}
        <button onclick={addGateway} disabled={adding || !name || !url || !token}
          class="px-4 py-2 rounded border text-sm font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 disabled:opacity-50">
          {adding ? 'Adding…' : 'Add gateway'}
        </button>
      </div>
    </div>

    <!-- Unified gateway list (Turso hosts = source of truth for WS connect) -->
    {#if data.tursoHosts.length === 0 && pgOnly.length === 0}
      <p class="text-sm text-muted">No gateways configured yet.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.tursoHosts as host (host.id)}
          <li class="border border-border rounded overflow-hidden">
            {#if editingId === host.id}
              <div class="p-3 space-y-2">
                <input bind:value={editName} class="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:border-accent/60" />
                <input bind:value={editUrl} class="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:border-accent/60" />
                <input bind:value={editToken} type="password" placeholder="New token (leave blank to keep)"
                  class="w-full bg-bg border border-border rounded px-3 py-1.5 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
                <div class="flex gap-2">
                  <button onclick={saveEdit} class="px-3 py-1 rounded border text-xs font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30">Save</button>
                  <button onclick={cancelEdit} class="px-3 py-1 rounded border text-xs font-mono bg-bg border-border text-muted hover:text-foreground">Cancel</button>
                </div>
              </div>
            {:else}
              <div class="flex items-center justify-between px-3 py-2">
                <div class="flex items-center gap-2 min-w-0">
                  <div class="w-1.5 h-1.5 rounded-full shrink-0 {hostsState.activeHostId === host.id ? 'bg-green-400' : 'bg-muted/30'}"></div>
                  <div class="min-w-0">
                    <div class="text-sm text-foreground truncate">{host.name}</div>
                    <div class="text-xs text-muted font-mono truncate">{host.url}</div>
                  </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0 ml-3">
                  <button onclick={() => connect(host)}
                    class="px-2 py-1 rounded border text-xs font-mono text-accent border-accent/30 hover:bg-accent/10">
                    Connect
                  </button>
                  <button onclick={() => startEdit(host)}
                    class="px-2 py-1 rounded border text-xs font-mono text-muted border-border hover:text-foreground">
                    Edit
                  </button>
                  <button onclick={() => removeTursoHost(host.id, host.name)}
                    class="px-2 py-1 rounded border text-xs font-mono text-red-400 border-red-400/20 hover:bg-red-400/5">
                    Remove
                  </button>
                </div>
              </div>
            {/if}
          </li>
        {/each}

        <!-- PG-only gateways (not yet in Turso — no WS connect button) -->
        {#each pgOnly as g (g.id)}
          <li class="border border-border/50 border-dashed rounded px-3 py-2 flex items-center justify-between opacity-70">
            <div>
              <div class="text-sm text-foreground">{g.name} <span class="text-[10px] text-muted font-mono ml-1">pg only</span></div>
              <div class="text-xs text-muted font-mono">{g.url}</div>
            </div>
            <button onclick={() => removePgGateway(g.id)}
              class="px-2 py-1 rounded border text-xs font-mono text-red-400 border-red-400/20 hover:bg-red-400/5">
              Remove
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
