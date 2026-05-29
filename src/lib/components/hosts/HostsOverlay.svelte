<script lang="ts">
    import {
        hostsState,
        addHost,
        updateHost,
        removeHost,
    } from "$lib/state/features/hosts.svelte";
    import { ui } from "$lib/state/ui/ui.svelte";
    import { wsConnect, wsDisconnect } from "$lib/services/gateway.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { fmtTimeAgo } from "$lib/utils/format";
    import type { Host } from "$lib/types/host";
    import { Button } from "$lib/components/ui";
    import * as m from "$lib/paraglide/messages";

    let formName = $state("");
    let formUrl = $state("");
    let formToken = $state("");
    let editingId = $state<string | null>(null);
    let confirmDeleteId = $state<string | null>(null);

    function handleUrlPaste(e: ClipboardEvent) {
        const text = e.clipboardData?.getData("text") ?? "";
        if (text && !/^wss?:\/\/|^https?:\/\//.test(text)) {
            e.preventDefault();
            formUrl = "wss://" + text.trim();
        }
    }

    function close() {
        ui.overlayOpen = false;
        editingId = null;
        confirmDeleteId = null;
    }

    function startEdit(host: Host) {
        editingId = host.id;
        formName = host.name;
        formUrl = host.url;
        // Tokens are no longer carried in the host cache — leave the field
        // blank so the user can decide whether to rotate. Submitting an
        // empty token preserves the stored one server-side.
        formToken = "";
    }

    function cancelEdit() {
        editingId = null;
        formName = "";
        formUrl = "";
        formToken = "";
    }

    async function saveHost() {
        if (!formUrl.trim()) return;
        const name =
            formName.trim() ||
            (() => {
                try {
                    return new URL(formUrl).hostname;
                } catch {
                    return "host";
                }
            })();
        const wasEditing = editingId;
        if (editingId) {
            await updateHost(editingId, {
                name,
                url: formUrl.trim(),
                token: formToken.trim(),
            });
        } else {
            await addHost({
                name,
                url: formUrl.trim(),
                token: formToken.trim(),
            });
        }
        cancelEdit();
        if (!wasEditing) {
            close();
            wsConnect();
        }
    }

    async function deleteHost(id: string) {
        if (hostsState.activeHostId === id) {
            wsDisconnect();
        }
        await removeHost(id);
        if (hostsState.activeHostId === id) {
            hostsState.activeHostId = hostsState.hosts[0]?.id ?? null;
        }
        confirmDeleteId = null;
    }

    function connectTo(id: string) {
        if (hostsState.activeHostId === id && conn.connected) {
            close();
            return;
        }
        wsDisconnect();
        hostsState.activeHostId = id;
        wsConnect();
        close();
    }
</script>

<div
    class="fixed inset-0 z-1000 bg-black/60 flex items-center justify-center cursor-pointer"
    role="button"
    tabindex="-1"
    aria-label={m.common_close()}
    onclick={close}
    onkeydown={(e) => e.key === "Escape" && close()}
>
    <div
        class="bg-bg2 border border-border rounded-xl w-130 max-w-[calc(100vw-40px)] max-h-[80vh] flex flex-col shadow-md"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
    >
        <div
            class="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-border shrink-0"
        >
            <span class="text-base font-bold">{m.hosts_title()}</span>
            <Button
                variant="ghost"
                size="icon"
                class="text-xl leading-none"
                onclick={close}
                aria-label={m.common_close()}>×</Button
            >
        </div>
        <div class="flex-1 overflow-y-auto py-3 px-4">
            {#each hostsState.hosts as host (host.id)}
                <div
                    class="bg-bg3 border rounded-lg py-3 px-3.5 mb-2 flex items-start gap-3 {editingId ===
                    host.id
                        ? 'border-accent'
                        : 'border-border'}"
                >
                    <div class="flex-1 min-w-0">
                        <div
                            class="text-sm font-semibold flex items-center gap-2"
                        >
                            {host.name}
                            {#if host.id === hostsState.activeHostId && conn.connected}
                                <span
                                    class="text-[10px] font-semibold bg-success/12 text-success border border-success/25 rounded-full py-px px-1.75"
                                    >{m.conn_connected()}</span
                                >
                            {/if}
                        </div>
                        <div
                            class="text-[11px] text-muted-foreground font-mono mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis"
                        >
                            {host.url}
                        </div>
                        {#if host.id === hostsState.activeHostId && conn.connectError}
                            <div
                                class="text-[11px] text-destructive mt-1 leading-snug"
                            >
                                {conn.connectError}
                            </div>
                        {:else}
                            <div class="text-[10px] text-muted-foreground mt-1">
                                {m.hosts_last()} {fmtTimeAgo(host.lastConnectedAt)}
                            </div>
                        {/if}
                        {#if confirmDeleteId === host.id}
                            <div
                                class="flex items-center gap-2 pt-1.5 text-xs text-warning"
                            >
                                {m.hosts_delete()}
                                {m.hosts_title()}?
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onclick={() => deleteHost(host.id)}
                                    >{m.hosts_delete()}</Button
                                >
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onclick={() => (confirmDeleteId = null)}
                                    >{m.hosts_cancel()}</Button
                                >
                            </div>
                        {/if}
                    </div>
                    <div class="flex gap-1.5 shrink-0">
                        <Button
                            variant="secondary"
                            size="sm"
                            onclick={() => connectTo(host.id)}
                            >{m.hosts_connect()}</Button
                        >
                        <Button
                            variant="secondary"
                            size="sm"
                            onclick={() => startEdit(host)}
                            >{m.common_edit()}</Button
                        >
                        <Button
                            variant="secondary"
                            size="sm"
                            onclick={() => (confirmDeleteId = host.id)}
                            >{m.hosts_delete()}</Button
                        >
                    </div>
                </div>
            {/each}
        </div>
        <form
            class="border-t border-border py-3.5 px-4 shrink-0"
            onsubmit={(e) => {
                e.preventDefault();
                saveHost();
            }}
        >
            <div
                class="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2.5"
            >
                {editingId ? m.hosts_editTitle() : m.hosts_addTitle()}
            </div>
            <div class="grid grid-cols-2 gap-2 mb-2.5">
                <div class="flex flex-col gap-1">
                    <label
                        for="host-name"
                        class="text-[11px] text-muted-foreground"
                        >{m.hosts_name()}</label
                    >
                    <input
                        id="host-name"
                        class="bg-bg3 border border-border rounded-[5px] text-foreground py-1.25 px-2.25 font-[inherit] text-xs outline-none transition-colors focus:border-accent"
                        type="text"
                        bind:value={formName}
                        placeholder="protopi"
                    />
                </div>
                <div class="flex flex-col gap-1">
                    <label
                        for="host-token"
                        class="text-[11px] text-muted-foreground"
                        >{m.hosts_token()}</label
                    >
                    <input
                        id="host-token"
                        class="bg-bg3 border border-border rounded-[5px] text-foreground py-1.25 px-2.25 font-[inherit] text-xs outline-none transition-colors focus:border-accent"
                        type="password"
                        bind:value={formToken}
                        placeholder="••••••"
                    />
                </div>
                <div class="flex flex-col gap-1 col-span-2">
                    <label
                        for="host-url"
                        class="text-[11px] text-muted-foreground"
                        >{m.hosts_url()}</label
                    >
                    <input
                        id="host-url"
                        class="bg-bg3 border border-border rounded-[5px] text-foreground py-1.25 px-2.25 font-[inherit] text-xs outline-none transition-colors focus:border-accent"
                        type="text"
                        bind:value={formUrl}
                        placeholder="wss://host.ts.net"
                        onpaste={handleUrlPaste}
                    />
                </div>
            </div>
            <div class="flex gap-2 justify-end">
                {#if editingId}
                    <Button
                        variant="secondary"
                        size="sm"
                        onclick={cancelEdit}>{m.hosts_cancel()}</Button
                    >
                {/if}
                <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    >{editingId ? m.hosts_save() : m.hosts_addTitle()}</Button
                >
            </div>
        </form>
    </div>
</div>
