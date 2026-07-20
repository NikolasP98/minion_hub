<script lang="ts">
    import { Button } from '$lib/components/ui';
    import { Dialog } from '$lib/components/ui/foundations';
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { channelOrgVisible } from '$lib/utils/channel-display-state';
    import { hostsState } from '$lib/state/features/hosts.svelte';
    import {
        channelState,
        fetchChannels,
        updateChannel,
        deleteChannel,
    } from '$lib/state/channels';
    import { gw } from '$lib/state/gateway';
    import { conn } from '$lib/state/gateway/connection.svelte';
    import { page } from '$app/state';
    import { configState, loadConfig } from '$lib/state/config/config.svelte';
    import ChannelCard from './ChannelCard.svelte';
    import ChannelGroup from './ChannelGroup.svelte';
    import ChannelSetupWizard from './ChannelSetupWizard.svelte';
    import { MessageSquare, Download } from 'lucide-svelte';
    import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
    import * as m from '$lib/paraglide/messages';

    let wizardType = $state<ChannelType | null>(null);
    let heartbeatChannels = $state<Channel[]>([]);
    let expandedChannelId = $state<string | null>(null);
    let importing = $state(false);

    const serverId = $derived(hostsState.activeHostId);
    // Active org for per-org channel scoping (mirrors filterAgentsByOrg for agents).
    const activeOrgId = $derived((page.data as { activeOrgId?: string | null })?.activeOrgId ?? null);
    // A gateway-only account (not in this org's DB rows) is shown ONLY when it's
    // confirmed to belong to the active org. gw.channels carries orgIds (gateway
    // accountOrgs tag); the heartbeat fallback does not, so an unattributable
    // account is hidden while an org is selected — this is what stops other orgs'
    // accounts (and the unscoped heartbeat snapshot) from bleeding into the list.
    // The org's OWN accounts still come through the DB-backed `enriched` path.
    const orgOwnsExtra = (c: Channel): boolean => channelOrgVisible(c.orgIds, activeOrgId);

    // Pull the gateway's accounts for this org into the DB registry (idempotent upsert).
    async function handleImport() {
        if (!serverId || importing) return;
        importing = true;
        try {
            const res = await fetch(`/api/servers/${serverId}/channels/sync`, { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.ok === false) {
                toastError(m.channel_importFailed(), data.error ?? `HTTP ${res.status}`);
                return;
            }
            toastSuccess(m.channel_importDone({ count: data.imported ?? 0 }));
            await fetchChannels(serverId);
        } catch (e) {
            toastError(m.channel_importFailed(), e instanceof Error ? e.message : String(e));
        } finally {
            importing = false;
        }
    }

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
                    self?: { e164?: string | null; jid?: string | null };
                    linked?: boolean;
                    expectedIdentity?: string | null;
                    identityMismatch?: boolean;
                    tokenSource?: string;
                    dmPolicy?: string;
                    orgIds?: string[];
                };
                // Don't show the synthesized "default" profile for a channel with no
                // real account yet (no credentials, not connected/running). Comms
                // plugins should start with zero profiles; the user adds or pairs one
                // explicitly. A configured/linked/running default still shows.
                if (
                    acct.accountId === 'default' &&
                    !acct.configured &&
                    !acct.connected &&
                    !acct.running
                ) {
                    continue;
                }
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
                const linkedNumber = acct.self?.e164 ?? acct.self?.jid ?? undefined;
                if (linkedNumber) meta.phone = linkedNumber;
                if (acct.identityMismatch && acct.expectedIdentity) meta.expectedPhone = acct.expectedIdentity;
                if (acct.tokenSource && acct.tokenSource !== 'none') meta.tokenSource = acct.tokenSource;
                if (acct.dmPolicy) meta.dmPolicy = acct.dmPolicy;

                const channelKey = `gw:${channelType}:${acct.accountId}`;
                result.push({
                    id: channelKey,
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
                    gwLinked: acct.linked ?? undefined,
                    gwRunning: acct.running ?? undefined,
                    gwLastError: acct.lastError ?? undefined,
                    gwReconnectAttempts: acct.reconnectAttempts ?? undefined,
                    gwExpectedIdentity: acct.expectedIdentity ?? undefined,
                    gwIdentityMismatch: acct.identityMismatch ?? undefined,
                    gwPairing: gw.pairingChannelIds.includes(channelKey),
                    orgIds: acct.orgIds,
                    historySync: acct.historySync,
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

        // Index gateway channels by accountId (robust) and by label (fallback). The live
        // gateway id is `gw:<type>:<accountId>`, so accountId is recoverable from it.
        const gwMap = new Map<string, Channel>();
        const gwAccountOf = (c: Channel) => (c.id.startsWith('gw:') ? c.id.split(':')[2] : c.accountId) ?? null;
        for (const gwCh of gatewayChannels) {
            const acct = gwAccountOf(gwCh);
            if (acct) gwMap.set(`${gwCh.type}:acct:${acct}`, gwCh);
            gwMap.set(`${gwCh.type}:${gwCh.label.toLowerCase()}`, gwCh);
        }

        // Enrich hub channels with live data from matching gateway channels (accountId first).
        const enriched = hubChannels.map((ch) => {
            const gwMatch =
                (ch.accountId ? gwMap.get(`${ch.type}:acct:${ch.accountId}`) : undefined) ??
                gwMap.get(`${ch.type}:${ch.label.toLowerCase()}`);
            if (!gwMatch) return ch;
            return {
                ...ch,
                gwConnected: gwMatch.gwConnected,
                gwEnabled: gwMatch.gwEnabled,
                gwConfigured: gwMatch.gwConfigured,
                gwRunning: gwMatch.gwRunning,
                gwLastError: gwMatch.gwLastError,
                gwReconnectAttempts: gwMatch.gwReconnectAttempts,
                historySync: gwMatch.historySync,
            };
        });

        const hubKeys = new Set<string>();
        for (const ch of hubChannels) {
            hubKeys.add(`${ch.type}:${ch.label.toLowerCase()}`);
            if (ch.accountId) hubKeys.add(`${ch.type}:acct:${ch.accountId}`);
        }
        const extras = gatewayChannels.filter((gwCh) => {
            const acct = gwAccountOf(gwCh);
            return !hubKeys.has(`${gwCh.type}:${gwCh.label.toLowerCase()}`) &&
                !(acct && hubKeys.has(`${gwCh.type}:acct:${acct}`)) &&
                // Org scope: a gateway-only account leaks across orgs unless it's
                // confirmed to belong to the active org (the bleed this fixes).
                orgOwnsExtra(gwCh);
        });
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
                    // Mirror liveChannels: hide a synthesized, unconfigured "default".
                    if (
                        accountId === 'default' &&
                        !status.configured &&
                        !status.connected &&
                        !status.running
                    ) {
                        continue;
                    }
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

    function closeWizard() {
        wizardType = null;
        if (serverId) fetchChannels(serverId);
    }
</script>

<div class="space-y-4">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
        <div>
            <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider">{m.channel_accounts()}</h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                {m.channel_accountsSubtitle()}
            </p>
        </div>
        {#if serverId}
            <Button
                variant="outline"
                size="sm"
                type="button"
                onclick={handleImport}
                loading={importing}
                class="shrink-0"
                title={m.channel_accountsSubtitle()}
            >
                {#if !importing}
                    <Download size={12} />
                {/if}
                {importing ? m.channel_importing() : m.channel_import()}
            </Button>
        {/if}
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
        <!-- New-account setup wizard, presented as a modal dialog. -->
        <Dialog
            open={wizardType !== null}
            title={m.channel_addAccount()}
            size="md"
            onclose={closeWizard}
        >
            {#if wizardType}
                    <ChannelSetupWizard
                        {serverId}
                        channelType={wizardType}
                        onclose={closeWizard}
                    />
            {/if}
        </Dialog>

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
