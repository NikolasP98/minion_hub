<script lang="ts">
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS, CHANNEL_FIELDS } from '$lib/types/channels';
    import { Trash2, ChevronDown, Pencil, Power, RefreshCw } from 'lucide-svelte';
    import { sendRequest } from '$lib/services/gateway.svelte';
    import { gw } from '$lib/state/gateway';
    import { configState, loadConfig, beginRestart } from '$lib/state/config/config.svelte';
    import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
    import ChannelAssignmentPicker from './ChannelAssignmentPicker.svelte';
    import ChannelEditForm from './ChannelEditForm.svelte';
    import ChannelStatusPill from './ChannelStatusPill.svelte';
    import * as m from '$lib/paraglide/messages';

    interface Props {
        channel: Channel;
        expanded?: boolean;
        serverId: string;
        onclick?: () => void;
        ondelete?: () => void;
        onsave?: (data: { type: ChannelType; label: string; credentials: Record<string, string>; credentialsMeta: Record<string, string> }) => Promise<void>;
        transportEnabled?: boolean;
        onreauthenticate?: () => void;
    }

    let { channel, expanded = false, serverId, onclick, ondelete, onsave, transportEnabled, onreauthenticate }: Props = $props();

    const isGateway = $derived(channel.source === 'gateway');
    let showEditForm = $state(false);
    let toggling = $state(false);

    const metaEntries = $derived(
        Object.entries(channel.credentialsMeta ?? {}).filter(([, v]) => v)
    );

    const GATEWAY_META_LABELS: Record<string, string> = {
        username: 'Bot Username',
        botId: 'Bot ID',
        appId: 'Application ID',
        phone: 'Phone',
        tokenSource: 'Token Source',
        dmPolicy: 'DM Policy',
    };

    const fieldDefs = $derived(CHANNEL_FIELDS[channel.type] ?? []);
    const metaFieldLabels = $derived({
        ...GATEWAY_META_LABELS,
        ...Object.fromEntries(fieldDefs.map((f) => [f.key, f.label])),
    });

    /** Parse gateway channel ID (gw:<type>:<accountId>) */
    const gwParts = $derived(channel.id.startsWith('gw:') ? channel.id.split(':') : null);
    const gwChannelType = $derived(gwParts?.[1] ?? null);
    const gwAccountId = $derived(gwParts?.[2] ?? null);

    /** Wait for a server-pushed channels.status update confirming the toggle */
    function waitForChannelState(
        chType: string, acctId: string, expectedEnabled: boolean, timeoutMs = 10_000
    ): Promise<boolean> {
        return new Promise((resolve) => {
            let done = false;
            const check = () => {
                const accounts = gw.channels?.channelAccounts?.[chType];
                if (!Array.isArray(accounts)) return false;
                const acct = accounts.find((a: { accountId: string }) => a.accountId === acctId);
                return acct?.enabled === expectedEnabled;
            };
            const cleanup = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                window.removeEventListener('channels.status.updated', onPush);
            };
            const onPush = () => { if (check()) { cleanup(); resolve(true); } };
            const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
            window.addEventListener('channels.status.updated', onPush);
            // Already updated (broadcast arrived before response)
            if (check()) { cleanup(); resolve(true); }
        });
    }

    async function handleToggleEnabled() {
        if (!isGateway || !gwChannelType || !gwAccountId || toggling) return;
        const newEnabled = !(channel.gwEnabled ?? true);
        const label = `${gwChannelType}:${gwAccountId}`;
        toggling = true;
        try {
            if (!configState.baseHash) {
                await loadConfig();
            }
            if (!configState.baseHash) {
                toastError('Toggle failed', `Could not load config — try refreshing the page.`);
                return;
            }
            const isDefault = gwAccountId === 'default';
            const patch = isDefault
                ? { channels: { [gwChannelType]: { enabled: newEnabled } } }
                : { channels: { [gwChannelType]: { accounts: { [gwAccountId]: { enabled: newEnabled } } } } };
            const result = await sendRequest('config.patch', {
                raw: JSON.stringify(patch),
                baseHash: configState.baseHash,
                note: `${newEnabled ? 'Enable' : 'Disable'} ${label} via Hub`,
            }) as { reloadMode?: string } | undefined;

            const reloadMode = result?.reloadMode ?? 'restart';

            if (reloadMode === 'hot' || reloadMode === 'noop') {
                try { await loadConfig(); } catch { /* refresh baseHash */ }
                // Wait for server-pushed confirmation or timeout
                const confirmed = await waitForChannelState(gwChannelType, gwAccountId, newEnabled);
                if (!confirmed) {
                    // Fallback: poll manually
                    try {
                        const r = await sendRequest('channels.status', {});
                        if (r) gw.channels = r as typeof gw.channels;
                    } catch { /* best effort */ }
                }
                toastSuccess(`${newEnabled ? 'Enabled' : 'Disabled'} ${label}`);
            } else {
                // Full restart — wait for reconnect then refresh
                try {
                    await loadConfig();
                    const confirmed = await waitForChannelState(gwChannelType, gwAccountId, newEnabled);
                    if (!confirmed) {
                        try {
                            const r = await sendRequest('channels.status', {});
                            if (r) gw.channels = r as typeof gw.channels;
                        } catch { /* best effort */ }
                    }
                    toastSuccess(`${newEnabled ? 'Enabled' : 'Disabled'} ${label}`);
                } catch (reloadErr) {
                    const msg = (reloadErr as Error).message ?? '';
                    if (msg.includes('closed') || msg.includes('not connected')) {
                        beginRestart();
                    } else {
                        toastError('Toggle failed', `Config saved but could not refresh: ${msg}`);
                    }
                }
            }
        } catch (e) {
            const msg = (e as Error).message ?? '';
            if (msg.includes('closed') || msg.includes('not connected')) {
                beginRestart();
            } else {
                toastError('Toggle failed', msg || 'Unknown error');
            }
        } finally {
            toggling = false;
        }
    }

    async function handleInlineSave(data: { type: ChannelType; label: string; credentials: Record<string, string>; credentialsMeta: Record<string, string> }) {
        await onsave?.(data);
        showEditForm = false;
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="w-full text-left bg-card border rounded-lg transition-all
        {expanded ? 'border-accent ring-1 ring-accent/30' : 'border-border hover:border-muted-foreground'}"
>
    <!-- Header row (always visible) -->
    <div
        class="flex items-center gap-3 px-4 py-3 cursor-pointer group"
        onclick={() => onclick?.()}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onclick?.(); }}
        role="button"
        tabindex="0"
    >
        <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
                <span class="text-sm font-medium text-foreground truncate">{channel.label}</span>
                {#if channel.credentialsMeta?.username}
                    <span class="text-xs text-muted-foreground/70 truncate">@{channel.credentialsMeta.username}</span>
                {/if}
            </div>
        </div>
        <ChannelStatusPill {channel} size="sm" />
        {#if !isGateway}
            <button
                type="button"
                class="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                onclick={(e) => { e.stopPropagation(); ondelete?.(); }}
                title={m.common_delete()}
            >
                <Trash2 size={14} />
            </button>
        {/if}
        <div
            class="transition-transform duration-200 text-muted-foreground"
            class:rotate-180={expanded}
        >
            <ChevronDown size={16} />
        </div>
    </div>

    <!-- Expanded accordion content -->
    <div
        class="grid transition-[grid-template-rows] duration-200 ease-out"
        style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
    >
        <div class="overflow-hidden">
            <div class="px-4 pb-4 space-y-4 border-t border-border/50 pt-3">

                <!-- Compact details (status pill lives in the header) -->
                <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt class="text-muted-foreground">Account</dt>
                    <dd class="text-foreground truncate">{gwAccountId ?? channel.label}</dd>
                    <dt class="text-muted-foreground">Transport</dt>
                    <dd class="text-foreground">{CHANNEL_TYPE_LABELS[channel.type]}</dd>
                    {#if channel.gwReconnectAttempts && channel.gwReconnectAttempts > 0}
                        <dt class="text-muted-foreground">Reconnects</dt>
                        <dd class="text-warning">{channel.gwReconnectAttempts}</dd>
                    {/if}
                </dl>
                {#if channel.gwLastError}
                    <details class="text-xs">
                        <summary class="text-destructive cursor-pointer">Show error</summary>
                        <pre class="mt-1 p-2 bg-bg3 rounded text-destructive overflow-x-auto whitespace-pre-wrap break-words">{channel.gwLastError}</pre>
                    </details>
                {/if}

                <!-- Credentials Meta -->
                {#if metaEntries.length > 0}
                    <div>
                        <h4 class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{m.channel_credentials()}</h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            {#each metaEntries as [key, value]}
                                <div class="flex items-center gap-1.5 min-w-0">
                                    <span class="text-muted-foreground shrink-0">{metaFieldLabels[key] ?? key}:</span>
                                    <span class="text-foreground truncate">{value}</span>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Assignments (route incoming messages from this channel to specific users/sessions) -->
                <ChannelAssignmentPicker {serverId} channelId={channel.id} />

                <!-- Edit / Re-authenticate / Power toggle -->
                <div>
                    {#if showEditForm}
                        <div class="bg-bg2 border border-border rounded-md p-3">
                            <ChannelEditForm
                                initialLabel={channel.label}
                                initialMeta={channel.credentialsMeta ?? {}}
                                channelType={channel.type}
                                onsave={async (data) => {
                                    await onsave?.({
                                        type: channel.type,
                                        label: data.label,
                                        credentials: {},
                                        credentialsMeta: data.credentialsMeta,
                                    });
                                    showEditForm = false;
                                }}
                                oncancel={() => { showEditForm = false; }}
                            />
                        </div>
                    {:else}
                        <div class="flex items-center gap-3 flex-wrap">
                            <button
                                type="button"
                                class="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
                                onclick={(e) => { e.stopPropagation(); showEditForm = true; }}
                            >
                                <Pencil size={12} />
                                {m.common_edit()}
                            </button>
                            <button
                                type="button"
                                class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                onclick={(e) => { e.stopPropagation(); onreauthenticate?.(); }}
                            >
                                <RefreshCw size={12} />
                                Re-authenticate
                            </button>
                            {#if isGateway && gwChannelType && gwAccountId}
                                <button
                                    type="button"
                                    class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors {channel.gwEnabled === false
                                        ? 'bg-success/10 text-success hover:bg-success/20'
                                        : 'bg-destructive/10 text-destructive hover:bg-destructive/20'}"
                                    onclick={(e) => { e.stopPropagation(); handleToggleEnabled(); }}
                                    disabled={toggling || transportEnabled === false}
                                    title={transportEnabled === false ? m.channel_transportOffTooltip() : ''}
                                >
                                    {#if toggling}
                                        <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                                    {:else}
                                        <Power size={12} />
                                        {channel.gwEnabled === false ? m.channel_enable() : m.channel_disable()}
                                    {/if}
                                </button>
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>
