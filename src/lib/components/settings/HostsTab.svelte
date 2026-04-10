<script lang="ts">
    import { hostsState, addHost, updateHost, removeHost, loadHosts } from "$lib/state/features/hosts.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import * as m from '$lib/paraglide/messages';
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
        if (!confirm(m.hosts_deleteConfirm({ name }))) return;
        try {
            await removeHost(id);
        } catch (e) {
            console.error('Failed to delete host:', e);
        }
    }

    function formatTime(ts: number | null): string {
        if (!ts) return m.hosts_never();
        return new Date(ts).toLocaleString();
    }
</script>

<div class="space-y-4">
    <div class="flex items-center justify-between mb-2">
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
            <HardDrive size={13} class="text-muted-foreground/70" />
            {m.hosts_servers()}
        </h2>
        <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-accent-foreground border-none cursor-pointer transition-colors hover:opacity-90"
            onclick={() => { showAddForm = !showAddForm; }}
        >
            <Plus size={13} />
            {m.hosts_addServer()}
        </button>
    </div>

    <!-- Server list -->
    {#if hostsState.hosts.length === 0}
        <div class="bg-card border border-border rounded-lg px-5 py-8 text-center">
            <p class="text-sm text-muted-foreground">{m.hosts_noServers()}</p>
            <p class="text-xs text-muted-foreground/60 mt-1">{m.hosts_noServersHint()}</p>
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
                                placeholder={m.hosts_namePlaceholder()}
                                class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <input
                                type="text"
                                bind:value={editUrl}
                                placeholder={m.hosts_urlPlaceholder()}
                                class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <input
                                type="password"
                                bind:value={editToken}
                                placeholder={m.hosts_tokenPlaceholder()}
                                class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                            <div class="flex gap-2 justify-end">
                                <button
                                    type="button"
                                    class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-transparent border border-border text-muted-foreground cursor-pointer hover:text-foreground"
                                    onclick={() => { editingId = null; }}
                                >
                                    <X size={12} /> {m.hosts_cancel()}
                                </button>
                                <button
                                    type="button"
                                    class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90"
                                    onclick={saveEdit}
                                >
                                    <Check size={12} /> {m.hosts_save()}
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
                                    <span class="text-[10px] text-muted-foreground/60">&middot;</span>
                                    <span class="text-[10px] text-muted-foreground/60">
                                        {m.hosts_lastConnected({ time: formatTime(host.lastConnectedAt) })}
                                    </span>
                                </div>
                            </div>

                            <div class="flex items-center gap-1 shrink-0">
                                <button
                                    type="button"
                                    class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none"
                                    title={m.common_edit()}
                                    onclick={() => startEdit(host)}
                                >
                                    <Pencil size={14} />
                                </button>
                                <button
                                    type="button"
                                    class="p-1.5 rounded text-muted-foreground hover:text-accent hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none"
                                    title={m.hosts_provision()}
                                    onclick={() => goto(`/settings/provision?server=${host.id}`)}
                                >
                                    <Wrench size={14} />
                                </button>
                                <button
                                    type="button"
                                    class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-bg2 transition-colors cursor-pointer bg-transparent border-none"
                                    title={m.hosts_delete()}
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
                {m.hosts_newServer()}
            </h3>
            <div class="space-y-2">
                <input
                    type="text"
                    bind:value={addName}
                    placeholder={m.hosts_namePlaceholder()}
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <input
                    type="text"
                    bind:value={addUrl}
                    placeholder={m.hosts_urlPlaceholder()}
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <input
                    type="password"
                    bind:value={addToken}
                    placeholder={m.hosts_tokenPlaceholder()}
                    class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <div class="flex gap-2 justify-end pt-1">
                    <button
                        type="button"
                        class="px-3 py-1.5 text-xs font-medium rounded bg-transparent border border-border text-muted-foreground cursor-pointer hover:text-foreground"
                        onclick={() => { showAddForm = false; }}
                    >
                        {m.hosts_cancel()}
                    </button>
                    <button
                        type="button"
                        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
                        disabled={adding || !addName.trim() || !addUrl.trim()}
                        onclick={handleAdd}
                    >
                        {#if adding}
                            {m.hosts_adding()}
                        {:else}
                            <Plus size={12} /> {m.common_add()}
                        {/if}
                    </button>
                </div>
            </div>
        </div>
    {/if}
</div>
