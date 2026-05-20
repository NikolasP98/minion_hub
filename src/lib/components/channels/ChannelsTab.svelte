<script lang="ts">
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { hostsState } from '$lib/state/features/hosts.svelte';
    import {
        channelState,
        fetchChannels,
        updateChannel,
        deleteChannel,
    } from '$lib/state/channels';
    import { gw } from '$lib/state/gateway';
    import { conn } from '$lib/state/gateway/connection.svelte';
    import { configState, loadConfig } from '$lib/state/config/config.svelte';
    import ChannelCard from './ChannelCard.svelte';
    import ChannelGroup from './ChannelGroup.svelte';
    import ChannelSetupWizard from './ChannelSetupWizard.svelte';
    import { MessageSquare } from 'lucide-svelte';
    import * as m from '$lib/paraglide/messages';

    let wizardType = $state<ChannelType | null>(null);
    let heartbeatChannels = $state<Channel[]>([]);
    let expandedChannelId = $state<string | null>(null);

    const serverId = $derived(hostsState.activeHostId);
    const gatewayBaseUrl = $derived.by(() => {
        // Track both hosts list and active id so the derived re-runs on host
        // switch — getActiveHost() reads from a separate local store that
        // isn't reactive on its own. PluginIframe expects an HTTP(S) URL
        // (the iframe is loaded via http; ws scheme is derived internally),
        // so convert from the stored WS URL.
        const id = hostsState.activeHostId;
        if (!id) return undefined;
        const url = hostsState.hosts.find((h) => h.id === id)?.url;
        if (!url) return undefined;
        return url.replace(/^ws/, 'http');
    });

    /** Transform live WS channelAccounts (array-based) into Channel objects */
    const liveChannels = $derived.by((): Channel[] => {
        const ca = gw.channels?.channelAccounts;
        if (!ca) return [];
        const result: Channel[] = [];
        for (const [channelType, accounts] of Object.entries(ca)) {
            const type = (CHANNEL_TYPE_LABELS[channelType as ChannelType] ? channelType : 'discord') as ChannelType;
            for (const acctRaw of accounts) {
                // The gateway snapshot is intentionally open-ended (additionalProperties: true).
                // Widen the local type so we can read channel-specific fields like `bot`,
                // `application`, `self`, `probe`, `tokenSource`, `dmPolicy` without a per-field cast.
                const acct = acctRaw as typeof acctRaw & {
                    bot?: { id?: string | number; username?: string };
                    probe?: { bot?: { id?: string | number; username?: string } };
                    application?: { id?: string };
                    self?: { e164?: string };
                    tokenSource?: string;
                    dmPolicy?: string;
                };
                const displayName = acct.name || acct.accountId;
                // Channels with persistent connections (WhatsApp) use `connected`;
                // channels without (Discord, Telegram) treat `running` as active.
                const hasConnectedField = acct.connected !== undefined;
                const isActive = hasConnectedField ? acct.connected : acct.running;
                const isPairing = hasConnectedField && acct.running && !acct.connected;

                // Build credentialsMeta from gateway snapshot data
                // `bot` is the direct runtime field (Discord); Telegram surfaces the same
                // info via the periodic probe under `acct.probe.bot`.
                const meta: Record<string, string> = {};
                const botUsername = acct.bot?.username ?? acct.probe?.bot?.username;
                const botId = acct.bot?.id ?? acct.probe?.bot?.id;
                if (botUsername) meta.username = String(botUsername);
                if (botId) meta.botId = String(botId);
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

    // Fetch channel data when serverId changes (separate from config to avoid re-fetching on baseHash updates)
    $effect(() => {
        if (serverId) {
            fetchChannels(serverId);
            fetchHeartbeatChannels(serverId);
        }
    });

    // Preload config baseHash for channel toggles (separate effect to avoid triggering channel re-fetch)
    $effect(() => {
        if (serverId && conn.connected && !configState.baseHash) loadConfig();
    });

    async function handleSave(channelId: string, data: { type: ChannelType; label: string; credentials: Record<string, string>; credentialsMeta: Record<string, string> }) {
        if (!serverId) return;
        await updateChannel(serverId, channelId, data);
    }

    async function handleDelete(channel: Channel) {
        if (!serverId) return;
        if (!confirm(m.channel_confirmDelete({ label: channel.label }))) return;
        await deleteChannel(serverId, channel.id);
    }

    function toggleExpand(id: string) {
        expandedChannelId = expandedChannelId === id ? null : id;
    }
</script>

<div class="space-y-4">
    <!-- Header -->
    <div>
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider">{m.channel_accounts()}</h2>
        <p class="text-[10px] text-muted-foreground mt-0.5">
            {m.channel_accountsSubtitle()}
        </p>
    </div>

    {#if !serverId}
        <p class="text-sm text-muted-foreground text-center py-8">
            {m.channel_selectServer()}
        </p>
    {:else if channelState.loading && mergedChannels.length === 0}
        <div class="text-sm text-muted-foreground text-center py-8">{m.channel_loadingChannels()}</div>
    {:else if channelState.error}
        <div class="text-sm text-destructive text-center py-8">{channelState.error}</div>
    {:else}
        <!-- Wizard overlay (covers create + re-authenticate) -->
        {#if wizardType}
            <ChannelSetupWizard
                {serverId}
                channelType={wizardType}
                onclose={() => {
                    wizardType = null;
                    fetchChannels(serverId);
                }}
            />
        {/if}

        <!-- One section per type, always rendered -->
        {#each ['telegram', 'whatsapp', 'discord'] as t (t)}
            {@const type = t as ChannelType}
            {@const channelsOfType = grouped.get(type) ?? []}
            {@const configChannels = (configState.original?.channels as Record<string, { enabled?: boolean }> | undefined)}
            {@const transportEnabled = configChannels?.[type]?.enabled ?? true}
            <ChannelGroup
                {type}
                channels={channelsOfType}
                {transportEnabled}
                {gatewayBaseUrl}
                onaddclick={() => { wizardType = type; }}
            >
                {#if channelsOfType.length === 0}
                    <p class="text-xs text-muted-foreground text-center py-4">
                        No {CHANNEL_TYPE_LABELS[type]} accounts yet.
                    </p>
                {:else}
                    {#each channelsOfType as channel (channel.id)}
                        <ChannelCard
                            {channel}
                            {serverId}
                            {transportEnabled}
                            expanded={expandedChannelId === channel.id}
                            onclick={() => toggleExpand(channel.id)}
                            ondelete={() => handleDelete(channel)}
                            onsave={(data) => handleSave(channel.id, data)}
                            onreauthenticate={() => { wizardType = channel.type; }}
                        />
                    {/each}
                {/if}
            </ChannelGroup>
        {/each}
    {/if}
</div>
