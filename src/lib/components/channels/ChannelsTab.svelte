<script lang="ts">
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { hostsState } from '$lib/state/features/hosts.svelte';
    import {
        channelState,
        fetchChannels,
        createChannel,
        updateChannel,
        deleteChannel,
    } from '$lib/state/channels';
    import { gw } from '$lib/state/gateway';
    import { configState, loadConfig } from '$lib/state/config/config.svelte';
    import ChannelCard from './ChannelCard.svelte';
    import ChannelForm from './ChannelForm.svelte';
    import { Plus, MessageSquare } from 'lucide-svelte';

    let showCreateForm = $state(false);
    let heartbeatChannels = $state<Channel[]>([]);
    let expandedChannelId = $state<string | null>(null);

    const serverId = $derived(hostsState.activeHostId);

    /** Transform live WS channelAccounts (array-based) into Channel objects */
    const liveChannels = $derived.by((): Channel[] => {
        const ca = gw.channels?.channelAccounts;
        if (!ca) return [];
        const result: Channel[] = [];
        for (const [channelType, accounts] of Object.entries(ca)) {
            const type = (CHANNEL_TYPE_LABELS[channelType as ChannelType] ? channelType : 'discord') as ChannelType;
            for (const acct of accounts) {
                const displayName = acct.name || acct.accountId;
                // Channels with persistent connections (WhatsApp) use `connected`;
                // channels without (Discord, Telegram) treat `running` as active.
                const hasConnectedField = acct.connected !== undefined;
                const isActive = hasConnectedField ? acct.connected : acct.running;
                const isPairing = hasConnectedField && acct.running && !acct.connected;

                // Build credentialsMeta from gateway snapshot data
                const meta: Record<string, string> = {};
                if (acct.bot?.username) meta.username = acct.bot.username;
                if (acct.bot?.id) meta.botId = acct.bot.id;
                if (acct.application?.id) meta.appId = acct.application.id;
                if (acct.self?.e164) meta.phone = acct.self.e164;
                if (acct.tokenSource && acct.tokenSource !== 'none') meta.tokenSource = acct.tokenSource;
                if (acct.dmPolicy) meta.dmPolicy = acct.dmPolicy;

                result.push({
                    id: `gw:${channelType}:${acct.accountId}`,
                    serverId: serverId ?? '',
                    type,
                    label: displayName,
                    credentialsMeta: meta,
                    status: isActive ? 'active' : (isPairing ? 'pairing' : 'inactive'),
                    createdAt: 0,
                    updatedAt: 0,
                    source: 'gateway',
                    gwConnected: acct.connected ?? undefined,
                    gwEnabled: acct.enabled ?? undefined,
                    gwConfigured: acct.configured ?? undefined,
                    gwRunning: acct.running ?? undefined,
                    gwLastError: acct.lastError ?? undefined,
                    gwReconnectAttempts: acct.reconnectAttempts ?? undefined,
                });
            }
        }
        return result;
    });

    /** Use live WS channels if available, otherwise fall back to heartbeat */
    const gatewayChannels = $derived(liveChannels.length > 0 ? liveChannels : heartbeatChannels);

    /** Merge hub DB channels with gateway-reported channels (hub takes precedence on type+label match) */
    const mergedChannels = $derived.by((): Channel[] => {
        const hubChannels = channelState.channels.map((ch) => ({ ...ch, source: 'hub' as const }));

        // Build a map of gateway channels by type+label for enrichment
        const gwMap = new Map<string, Channel>();
        for (const gwCh of gatewayChannels) {
            gwMap.set(`${gwCh.type}:${gwCh.label.toLowerCase()}`, gwCh);
        }

        // Enrich hub channels with live data from matching gateway channels
        const enriched = hubChannels.map((ch) => {
            const gwMatch = gwMap.get(`${ch.type}:${ch.label.toLowerCase()}`);
            if (!gwMatch) return ch;
            return {
                ...ch,
                gwConnected: gwMatch.gwConnected,
                gwEnabled: gwMatch.gwEnabled,
                gwConfigured: gwMatch.gwConfigured,
                gwRunning: gwMatch.gwRunning,
                gwLastError: gwMatch.gwLastError,
                gwReconnectAttempts: gwMatch.gwReconnectAttempts,
            };
        });

        const hubKeys = new Set(hubChannels.map((ch) => `${ch.type}:${ch.label.toLowerCase()}`));
        const extras = gatewayChannels.filter((gwCh) => !hubKeys.has(`${gwCh.type}:${gwCh.label.toLowerCase()}`));
        return [...enriched, ...extras];
    });

    // Group channels by type
    const grouped = $derived.by(() => {
        const map = new Map<ChannelType, Channel[]>();
        for (const ch of mergedChannels) {
            const list = map.get(ch.type) ?? [];
            list.push(ch);
            map.set(ch.type, list);
        }
        return map;
    });

    /** Fetch latest heartbeat channelStatusJson as fallback when WS has no channelAccounts */
    async function fetchHeartbeatChannels(sid: string) {
        try {
            const res = await fetch(`/api/metrics/gateway-heartbeats?serverId=${sid}&limit=1`);
            if (!res.ok) return;
            const { heartbeats } = await res.json();
            if (!heartbeats?.[0]?.channelStatusJson) return;
            const data = JSON.parse(heartbeats[0].channelStatusJson);
            if (!data?.channelAccounts) return;
            const result: Channel[] = [];
            for (const [channelType, accounts] of Object.entries(data.channelAccounts as Record<string, Record<string, { enabled?: boolean; configured?: boolean; running?: boolean; connected?: boolean; reconnectAttempts?: number; lastError?: string | null }>>)) {
                const type = (CHANNEL_TYPE_LABELS[channelType as ChannelType] ? channelType : 'discord') as ChannelType;
                for (const [accountId, status] of Object.entries(accounts)) {
                    const hasConn = status.connected !== undefined;
                    const active = hasConn ? status.connected : status.running;
                    const pairing = hasConn && status.running && !status.connected;
                    result.push({
                        id: `gw:${channelType}:${accountId}`,
                        serverId: sid,
                        type,
                        label: accountId,
                        credentialsMeta: {},
                        status: active ? 'active' : (pairing ? 'pairing' : 'inactive'),
                        createdAt: 0,
                        updatedAt: 0,
                        source: 'gateway',
                        gwConnected: status.connected,
                        gwEnabled: status.enabled,
                        gwConfigured: status.configured,
                        gwRunning: status.running,
                        gwLastError: status.lastError ?? undefined,
                        gwReconnectAttempts: status.reconnectAttempts,
                    });
                }
            }
            heartbeatChannels = result;
        } catch { /* ignore */ }
    }

    $effect(() => {
        if (serverId) {
            fetchChannels(serverId);
            fetchHeartbeatChannels(serverId);
            if (!configState.baseHash) loadConfig();
        }
    });

    async function handleSave(channelId: string, data: { type: ChannelType; label: string; credentials: Record<string, string>; credentialsMeta: Record<string, string> }) {
        if (!serverId) return;
        await updateChannel(serverId, channelId, data);
    }

    async function handleCreate(data: { type: ChannelType; label: string; credentials: Record<string, string>; credentialsMeta: Record<string, string> }) {
        if (!serverId) return;
        await createChannel(serverId, data);
        showCreateForm = false;
    }

    async function handleDelete(channel: Channel) {
        if (!serverId) return;
        if (!confirm(`Delete channel "${channel.label}"?`)) return;
        await deleteChannel(serverId, channel.id);
    }

    function toggleExpand(id: string) {
        expandedChannelId = expandedChannelId === id ? null : id;
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
        {#if !showCreateForm}
            <button
                type="button"
                class="flex items-center gap-1.5 bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity"
                onclick={() => { showCreateForm = true; }}
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
    {:else if showCreateForm}
        <div class="bg-card border border-border rounded-lg p-5">
            <ChannelForm
                {serverId}
                onsave={handleCreate}
                oncancel={() => { showCreateForm = false; }}
            />
        </div>
    {:else if channelState.loading}
        <div class="text-sm text-muted-foreground text-center py-8">Loading channels...</div>
    {:else if channelState.error}
        <div class="text-sm text-destructive text-center py-8">{channelState.error}</div>
    {:else if mergedChannels.length === 0}
        <div class="text-center py-12 space-y-3">
            <div class="w-12 h-12 rounded-full bg-bg3 flex items-center justify-center mx-auto">
                <MessageSquare size={20} class="text-muted-foreground" />
            </div>
            <p class="text-sm text-muted-foreground">No channels configured yet.</p>
            <button
                type="button"
                class="text-xs text-accent hover:underline"
                onclick={() => { showCreateForm = true; }}
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
                                {serverId}
                                expanded={expandedChannelId === channel.id}
                                onclick={() => toggleExpand(channel.id)}
                                ondelete={() => handleDelete(channel)}
                                onsave={(data) => handleSave(channel.id, data)}
                            />
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
