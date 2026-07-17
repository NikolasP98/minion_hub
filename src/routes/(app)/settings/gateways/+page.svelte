<script lang="ts">
  import { Button, Input } from '$lib/components/ui';
  import { invalidateAll, goto } from '$lib/navigation';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import GatewayUpdateCard from '$lib/components/settings/GatewayUpdateCard.svelte';
  import { addHost, removeHost, updateHost, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Plus, Plug, Trash2, Wrench, Pencil, X, Check, Wifi, WifiOff } from 'lucide-svelte';
  import { toastAsync } from '$lib/state/ui/toast.svelte';

  const { data } = $props();

  // ── Add form ────────────────────────────────────────────────────────
  let name = $state('');
  let url = $state('');
  let token = $state('');
  let adding = $state(false);

  // ── Inline edit (Turso hosts) ────────────────────────────────────────
  let editingId = $state<string | null>(null);
  let editName = $state('');
  let editUrl = $state('');
  let editToken = $state('');

  async function addGateway() {
    if (adding) return;
    adding = true;
    try {
      await toastAsync(
        (async () => {
          const res = await fetch('/api/servers', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), url: url.trim(), token: token.trim() }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error ?? 'Could not add gateway.');
          }
          await fetch('/api/gateways', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), url: url.trim(), token: token.trim() }),
          });
          name = ''; url = ''; token = '';
        })(),
        {
          loading: m.hosts_adding(),
          getOutcome: () => ({ type: 'success', title: 'Server added' }),
          onError: (err: unknown) => ({
            title: 'Failed to add gateway',
            description: err instanceof Error ? err.message : 'Could not add gateway.',
          }),
        },
      );
      await invalidateAll();
    } finally {
      adding = false;
    }
  }

  async function removePgGateway(id: string) {
    try {
      await toastAsync(
        fetch(`/api/gateways/${id}`, { method: 'DELETE' }).then(async (res) => {
          if (!res.ok) throw new Error('Delete failed');
        }),
        {
          loading: 'Removing gateway…',
          getOutcome: () => ({ type: 'success', title: 'Server removed' }),
          onError: (err: unknown) => ({
            title: 'Failed to remove gateway',
            description: err instanceof Error ? err.message : 'Delete failed',
          }),
        },
      );
      await invalidateAll();
    } catch {
      // Error shown via toast
    }
  }

  async function saveEdit() {
    if (!editingId || !editName.trim() || !editUrl.trim()) return;
    try {
      await updateHost(editingId, { name: editName.trim(), url: editUrl.trim(), token: editToken.trim() });
      editingId = null;
      await invalidateAll();
    } catch {
      // Error shown via toast in updateHost
    }
  }
  function startEdit(host: { id: string; name: string; url: string }) {
    editingId = host.id;
    editName = host.name;
    editUrl = host.url;
    // Token field starts blank — submitting empty preserves the server-stored value.
    editToken = '';
  }

  function cancelEdit() { editingId = null; }

  async function removeTursoHost(id: string, name: string) {
    if (!confirm(`Delete gateway "${name}"?`)) return;
    try {
      await removeHost(id);
      await invalidateAll();
    } catch {
      // Error shown via toast in removeHost
    }
  }

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

    <GatewayUpdateCard gatewayCount={data.pgGateways.length} />

    <!-- Add form -->
    <div class="border border-border rounded-lg overflow-hidden mb-6">
      <div class="relative px-4 py-3 border-b border-border bg-bg/60 flex items-center gap-2">
        <ScanLine speed={10} opacity={0.02} />
        <Plug size={12} class="text-muted-strong" />
        <span class="text-xs font-mono text-muted uppercase tracking-widest">{m.hosts_newServer()}</span>
      </div>
      <div class="p-4 space-y-3">
        <Input bind:value={name} placeholder={m.hosts_namePlaceholder()} class="w-full font-mono" />
        <Input bind:value={url} type="url" placeholder={m.hosts_urlPlaceholder()} class="w-full font-mono" />
        <Input bind:value={token} type="password" placeholder={m.hosts_tokenPlaceholder()} class="w-full font-mono" />
        <Button variant="primary" onclick={addGateway} loading={adding} disabled={!name || !url || !token} class="font-mono">
          {#if !adding}<Plus size={13} />{/if} {m.hosts_addServer()}
        </Button>
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
                <Input bind:value={editName} size="sm" placeholder={m.hosts_namePlaceholder()} class="w-full font-mono" />
                <Input bind:value={editUrl} type="url" size="sm" placeholder={m.hosts_urlPlaceholder()} class="w-full font-mono" />
                <Input bind:value={editToken} type="password" size="sm" placeholder={m.hosts_tokenPlaceholder()} class="w-full font-mono" />
                <div class="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onclick={cancelEdit} class="font-mono"><X size={12} /> {m.hosts_cancel()}</Button>
                  <Button variant="primary" size="sm" onclick={saveEdit} class="font-mono"><Check size={12} /> {m.hosts_save()}</Button>
                </div>
              </div>
            {:else}
              <div class="flex items-center gap-3 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-foreground truncate">{host.name}</span>
                    {#if isConnected}
                      <span class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-success/10 text-success text-xs font-medium">
                        <Wifi size={10} /> {m.hosts_connect()}
                      </span>
                    {:else}
                      <span class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-medium">
                        <WifiOff size={10} /> {m.hosts_offline()}
                      </span>
                    {/if}
                  </div>
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-xs text-muted-foreground font-mono truncate">{host.url}</span>
                    <span class="text-xs text-muted-strong">&middot;</span>
                    <span class="text-xs text-muted-strong">{m.hosts_lastConnected({ time: formatTime(host.lastConnectedAt) })}</span>
                  </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  {#if !isConnected}
                    <Button variant="outline" size="sm" onclick={() => connect(host)} class="font-mono">
                      {m.hosts_connect()}
                    </Button>
                  {/if}
                  <Button variant="ghost" size="icon" onclick={() => goto(`/settings/provision?server=${host.id}`)} title={m.hosts_provision()} aria-label={m.hosts_provision()}>
                    <Wrench size={14} />
                  </Button>
                  <Button variant="ghost" size="icon" onclick={() => startEdit(host)} title={m.common_edit()} aria-label={m.common_edit()}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="danger" size="icon" onclick={() => removeTursoHost(host.id, host.name)} title={m.hosts_delete()} aria-label={m.hosts_delete()}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            {/if}
          </li>
        {/each}

        <!-- PG-only gateways (not yet in Turso — no WS connect button) -->
        {#each pgOnly as g (g.id)}
          <li class="border border-border/50 border-dashed rounded-lg px-4 py-3 flex items-center justify-between opacity-70">
            <div class="min-w-0">
              <div class="text-sm text-foreground truncate">{g.name} <span class="text-xs text-muted font-mono ml-1">pg only</span></div>
              <div class="text-xs text-muted font-mono truncate">{g.url}</div>
            </div>
            <Button variant="danger" size="icon" onclick={() => removePgGateway(g.id)} title={m.hosts_delete()} aria-label={m.hosts_delete()} class="shrink-0">
              <Trash2 size={14} />
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
