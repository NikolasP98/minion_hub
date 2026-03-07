<script lang="ts">
    import { hostsState, addHost, updateHost, removeHost, loadHosts } from "$lib/state/features/hosts.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import {
        HardDrive,
        Plus,
        Plug,
        Trash2,
        Wrench,
        Pencil,
        X,
        Check,
        Wifi,
        WifiOff,
    } from "lucide-svelte";

    // ─── Add host form state ─────────────────────────────────────────
    let showAddForm = $state(false);
    let addName = $state('');
    let addUrl = $state('');
    let addToken = $state('');
    let adding = $state(false);

    // ─── Inline edit state ───────────────────────────────────────────
    let editingId = $state<string | null>(null);
    let editName = $state('');
    let editUrl = $state('');
    let editToken = $state('');

    onMount(() => {
        loadHosts();
    });

    async function handleAdd() {
        if (!addName.trim() || !addUrl.trim()) return;
        adding = true;
        try {
            await addHost({ name: addName.trim(), url: addUrl.trim(), token: addToken.trim() });
            addName = '';
            addUrl = '';
            addToken = '';
            showAddForm = false;
        } catch (e) {
            console.error('Failed to add host:', e);
        } finally {
            adding = false;
        }
    }

    function startEdit(host: { id: string; name: string; url: string; token: string }) {
        editingId = host.id;
        editName = host.name;
        editUrl = host.url;
        editToken = host.token;
    }

    async function saveEdit() {
        if (!editingId || !editName.trim() || !editUrl.trim()) return;
        try {
            await updateHost(editingId, { name: editName.trim(), url: editUrl.trim(), token: editToken.trim() });
        } catch (e) {
            console.error('Failed to update host:', e);
        }
        editingId = null;
    }

    async function handleDelete(id: string, name: string) {
        if (!confirm(`Delete server "${name}"? This cannot be undone.`)) return;
        try {
            await removeHost(id);
        } catch (e) {
            console.error('Failed to delete host:', e);
        }
    }

    function formatTime(ts: number | null): string {
        if (!ts) return 'Never';
        return new Date(ts).toLocaleString();
    }
</script>

<div class="space-y-4">
    <div class="flex items-center justify-between mb-2">
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
            <HardDrive size={13} class="text-muted-foreground/70" />
            Servers
        </h2>
        <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground border-none cursor-pointer transition-colors hover:opacity-90"
            onclick={() => { showAddForm = !showAddForm; }}
        >
            <Plus size={13} />
            Add Server
        </button>
    </div>

    <!-- Server list -->
    {#if hostsState.hosts.length === 0}
        <div class="bg-card border border-border rounded-lg px-5 py-8 text-center">
            <p class="text-sm text-muted-foreground">No servers configured yet.</p>
            <p class="text-xs text-muted-foreground/60 mt-1">Add a server to get started.</p>
        </div>
    {:else}
        <div class="space-y-2">
            {#each hostsState.hosts as host (host.id)}
                {@const isConnected = conn.connected && hostsState.activeHostId === host.id}
                {@const isEditing = editingId === host.id}

                <div class="bg-card border border-border rounded-lg px-4 py-3 transition-colors
                    {isConnected ? 'border-accent/40' : ''}">

                    {#if isEditing}
                        <!-- Inline edit mode -->
                        <div class="space-y-2">
                            <input
                                type="text"
                                bind:value={editName}
                                placeholder="Server name"
                                class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <input
                                type="text"
                                bind:value={editUrl}
                                placeholder="ws://host:port"
                                class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <input
                                type="password"
                                bind:value={editToken}
                                placeholder="Token (optional)"
                                class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <div class="flex gap-2 justify-end">
                                <button
                                    type="button"
                                    class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-transparent border border-border text-muted-foreground cursor-pointer hover:text-foreground"
                                    onclick={() => { editingId = null; }}
                                >
                                    <X size={12} /> Cancel
                                </button>
                                <button
                                    type="button"
                                    class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90"
                                    onclick={saveEdit}
                                >
                                    <Check size={12} /> Save
                                </button>
                            </div>
                        </div>
                    {:else}
                        <!-- Display mode -->
                        <div class="flex items-center gap-3">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="text-sm font-medium text-foreground truncate">{host.name}</span>
                                    {#if isConnected}
                                        <span class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-medium">
                                            <Wifi size={10} /> Connected
                                        </span>
                                    {:else}
                                        <span class="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium">
                                            <WifiOff size={10} /> Offline
                                        </span>
                                    {/if}
                                </div>
                                <div class="flex items-center gap-2 mt-0.5">
                                    <span class="text-xs text-muted-foreground font-mono truncate">{host.url}</span>
                                    <span class="text-[10px] text-muted-foreground/60">&middot;</span>
                                    <span class="text-[10px] text-muted-foreground/60">
                                        Last connected: {formatTime(host.lastConnectedAt)}
                                    </span>
                                </div>
                            </div>

                            <div class="flex items-center gap-1 shrink-0">
                                <button
                                    type="button"
                                    class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none"
                                    title="Edit"
                                    onclick={() => startEdit(host)}
                                >
                                    <Pencil size={14} />
                                </button>
                                <button
                                    type="button"
                                    class="p-1.5 rounded text-muted-foreground hover:text-accent hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none"
                                    title="Provision"
                                    onclick={() => goto(`/settings/provision?server=${host.id}`)}
                                >
                                    <Wrench size={14} />
                                </button>
                                <button
                                    type="button"
                                    class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none"
                                    title="Delete"
                                    onclick={() => handleDelete(host.id, host.name)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}

    <!-- Add host form -->
    {#if showAddForm}
        <div class="bg-card border border-border rounded-lg px-4 py-3">
            <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                <Plug size={12} class="text-muted-foreground/70" />
                New Server
            </h3>
            <div class="space-y-2">
                <input
                    type="text"
                    bind:value={addName}
                    placeholder="Server name"
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <input
                    type="text"
                    bind:value={addUrl}
                    placeholder="ws://host:port"
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <input
                    type="password"
                    bind:value={addToken}
                    placeholder="Token (optional)"
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <div class="flex gap-2 justify-end pt-1">
                    <button
                        type="button"
                        class="px-3 py-1.5 text-xs font-medium rounded bg-transparent border border-border text-muted-foreground cursor-pointer hover:text-foreground"
                        onclick={() => { showAddForm = false; }}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
                        disabled={adding || !addName.trim() || !addUrl.trim()}
                        onclick={handleAdd}
                    >
                        {#if adding}
                            Adding...
                        {:else}
                            <Plus size={12} /> Add
                        {/if}
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>
