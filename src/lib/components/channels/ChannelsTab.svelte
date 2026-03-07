<script lang="ts">
    import { onMount } from 'svelte';
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { hostsState } from '$lib/state/features/hosts.svelte';
    import {
        channelState,
        fetchChannels,
        createChannel,
        updateChannel,
        deleteChannel,
        getSelectedChannel,
    } from '$lib/state/channels';
    import ChannelCard from './ChannelCard.svelte';
    import ChannelForm from './ChannelForm.svelte';
    import ChannelAssignmentPicker from './ChannelAssignmentPicker.svelte';
    import { Plus, MessageSquare } from 'lucide-svelte';

    let showForm = $state(false);
    let editingChannel = $state<Channel | null>(null);

    const serverId = $derived(hostsState.activeHostId);
    const selected = $derived(getSelectedChannel());

    // Group channels by type
    const grouped = $derived.by(() => {
        const map = new Map<ChannelType, Channel[]>();
        for (const ch of channelState.channels) {
            const list = map.get(ch.type) ?? [];
            list.push(ch);
            map.set(ch.type, list);
        }
        return map;
    });

    $effect(() => {
        if (serverId) fetchChannels(serverId);
    });

    async function handleSave(data: { type: ChannelType; label: string; credentials: Record<string, string>; credentialsMeta: Record<string, string> }) {
        if (!serverId) return;
        if (editingChannel) {
            await updateChannel(serverId, editingChannel.id, data);
        } else {
            await createChannel(serverId, data);
        }
        showForm = false;
        editingChannel = null;
    }

    async function handleDelete(channel: Channel) {
        if (!serverId) return;
        if (!confirm(`Delete channel "${channel.label}"?`)) return;
        await deleteChannel(serverId, channel.id);
    }

    function startEdit(channel: Channel) {
        editingChannel = channel;
        showForm = true;
    }

    function startCreate() {
        editingChannel = null;
        showForm = true;
    }
</script>

<div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
        <div>
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider">Channel Accounts</h2>
            <p class="text-[10px] text-muted-foreground mt-0.5">
                Register Discord, WhatsApp, and Telegram accounts for this gateway.
            </p>
        </div>
        {#if !showForm}
            <button
                type="button"
                class="flex items-center gap-1.5 bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity"
                onclick={startCreate}
            >
                <Plus size={13} />
                Add Channel
            </button>
        {/if}
    </div>

    {#if !serverId}
        <p class="text-sm text-muted-foreground text-center py-8">
            Select a server from the topbar to manage channels.
        </p>
    {:else if showForm}
        <div class="bg-card border border-border rounded-lg p-5">
            <ChannelForm
                {serverId}
                initialType={editingChannel?.type}
                initialLabel={editingChannel?.label ?? ''}
                initialCredentials={editingChannel?.credentials}
                initialMeta={editingChannel?.credentialsMeta}
                channelId={editingChannel?.id}
                onsave={handleSave}
                oncancel={() => { showForm = false; editingChannel = null; }}
            />
        </div>
    {:else if channelState.loading}
        <div class="text-sm text-muted-foreground text-center py-8">Loading channels...</div>
    {:else if channelState.error}
        <div class="text-sm text-destructive text-center py-8">{channelState.error}</div>
    {:else if channelState.channels.length === 0}
        <div class="text-center py-12 space-y-3">
            <div class="w-12 h-12 rounded-full bg-bg3 flex items-center justify-center mx-auto">
                <MessageSquare size={20} class="text-muted-foreground" />
            </div>
            <p class="text-sm text-muted-foreground">No channels configured yet.</p>
            <button
                type="button"
                class="text-xs text-accent hover:underline"
                onclick={startCreate}
            >
                Add your first channel
            </button>
        </div>
    {:else}
        <!-- Channel list grouped by type -->
        <div class="space-y-4">
            {#each [...grouped.entries()] as [type, channels] (type)}
                <div>
                    <h3 class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        {CHANNEL_TYPE_LABELS[type]}
                    </h3>
                    <div class="space-y-1.5">
                        {#each channels as channel (channel.id)}
                            <ChannelCard
                                {channel}
                                selected={channelState.selectedChannelId === channel.id}
                                onclick={() => { channelState.selectedChannelId = channelState.selectedChannelId === channel.id ? null : channel.id; }}
                                onedit={() => startEdit(channel)}
                                ondelete={() => handleDelete(channel)}
                            />
                        {/each}
                    </div>
                </div>
            {/each}
        </div>

        <!-- Assignment picker for selected channel -->
        {#if selected}
            <div class="bg-card border border-border rounded-lg p-4 mt-4">
                <ChannelAssignmentPicker {serverId} channelId={selected.id} />
            </div>
        {/if}
    {/if}
</div>
