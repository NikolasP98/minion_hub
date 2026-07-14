<script lang="ts">
    import { Button, Toggle } from '$lib/components/ui';
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
    import WhatsAppQrPairing from './WhatsAppQrPairing.svelte';
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
    let removing = $state(false);
    // Two-click confirm for account removal (avoids a blocking window.confirm).
    let confirmRemove = $state(false);
    // WhatsApp re-auth renders the QR pairing flow inline within this card.
    let reauthing = $state(false);

    function handleReauthenticate() {
        if (channel.type === 'whatsapp') {
            showEditForm = false;
            reauthing = true;
        } else {
            // Token-based channels (telegram/discord) re-auth via the wizard modal.
            onreauthenticate?.();
        }
    }

    /**
     * Persist the phone the gateway discovered during pairing onto the channel row's
     * `account_id`. Without this the row stays keyed by its opaque id — orphaned on
     * reconcile and duplicated on the next gateway import. Idempotent: skips when the
     * account is already the phone.
     */
    async function persistPairedAccount(phone?: string) {
        reauthing = false;
        if (!phone || channel.accountId === phone) return;
        try {
            const res = await fetch(`/api/servers/${serverId}/channels/${channel.id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ accountId: phone }),
            });
            if (!res.ok) throw new Error(await res.text());
            toastSuccess(`Linked ${phone}`);
            await loadConfig();
        } catch (e) {
            toastError(
                `Linked, but couldn't save the number: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    // `username` is shown as @handle in the header — exclude it from the credentials grid
    // to avoid double-display.
    const metaEntries = $derived(
        Object.entries(channel.credentialsMeta ?? {}).filter(([k, v]) => v && k !== 'username')
    );

    const GATEWAY_META_LABELS: Record<string, string> = {
        username: 'Bot Username',
        botId: 'Bot ID',
        appId: 'Application ID',
        phone: 'Phone',
        expectedPhone: 'Expected',
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
            // P3-T3b: write the DB (authoritative post-flip) instead of patching
            // gateway.json. The PUT fires publishChannel → the gateway re-hydrates its
            // mirror and (when CHANNEL_RUNTIME_APPLY is on) restarts the channel, then
            // broadcasts status. A json config.patch here would be reverted on restart.
            const res = await fetch(`/api/servers/${serverId}/channels/${channel.id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ enabled: newEnabled }),
            });
            if (!res.ok) throw new Error(await res.text());
            // Wait for the gateway's server-pushed confirmation, else poll once.
            const confirmed = await waitForChannelState(gwChannelType, gwAccountId, newEnabled);
            if (!confirmed) {
                try {
                    const r = await sendRequest('channels.status', {});
                    if (r) gw.channels = r as typeof gw.channels;
                } catch { /* best effort */ }
            }
            await loadConfig().catch(() => {});
            toastSuccess(`${newEnabled ? 'Enabled' : 'Disabled'} ${label}`);
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

    // --- Behavior controls (replies + allowFrom → DB; the gateway mirror reads them) ---
    let behaviorSaving = $state(false);
    /** Current behavior mode derived from the DB-backed channel row. */
    const behaviorMode = $derived<'receive' | 'allowlist' | 'open'>(
        channel.replies === 'none'
            ? 'receive'
            : (channel.allowFrom ?? []).includes('*')
              ? 'open'
              : 'allowlist',
    );
    /** Editable allowlist text (one sender per line), seeded from the row's allowFrom. */
    // svelte-ignore state_referenced_locally
    let allowlistText = $state(
        (channel.allowFrom ?? []).filter((s) => s !== '*').join('\n'),
    );

    function parseAllowlist(text: string): string[] {
        return text
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    /** Persist a behavior change via the same PUT path the enable toggle uses. */
    async function saveBehavior(body: Record<string, unknown>, label: string) {
        if (behaviorSaving) return;
        behaviorSaving = true;
        try {
            const res = await fetch(`/api/servers/${serverId}/channels/${channel.id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(await res.text());
            await loadConfig().catch(() => {});
            toastSuccess(label);
        } catch (e) {
            toastError('Update failed', e instanceof Error ? e.message : 'Unknown error');
        } finally {
            behaviorSaving = false;
        }
    }

    function handleSelectMode(mode: 'receive' | 'allowlist' | 'open') {
        if (mode === behaviorMode && mode !== 'allowlist') return;
        if (mode === 'receive') {
            void saveBehavior({ replies: 'none' }, m.channel_behaviorSavedReceiveOnly());
        } else if (mode === 'open') {
            void saveBehavior(
                { replies: 'bound', allowFrom: ['*'] },
                m.channel_behaviorSavedOpen(),
            );
        }
        // 'allowlist' is applied via the explicit Save button (needs the list).
    }

    function handleSaveAllowlist() {
        void saveBehavior(
            { replies: 'bound', allowFrom: parseAllowlist(allowlistText) },
            m.channel_behaviorSavedAllowlist(),
        );
    }

    // --- WhatsApp markOnline (transport knob — source of truth is gateway.json,
    // NOT the DB mirror; config.patch is the correct durable path here). ---
    let markOnlineSaving = $state(false);
    const markOnlineValue = $derived(
        Boolean(
            gwAccountId &&
                (
                    (configState.current?.channels as
                        | Record<string, { accounts?: Record<string, { markOnline?: boolean }> }>
                        | undefined)?.whatsapp?.accounts?.[gwAccountId]
                )?.markOnline,
        ),
    );

    async function handleToggleMarkOnline() {
        if (!gwAccountId || markOnlineSaving) return;
        const next = !markOnlineValue;
        if (typeof window !== 'undefined' && !window.confirm(m.channel_markOnlineConfirm())) return;
        markOnlineSaving = true;
        try {
            if (!configState.baseHash) await loadConfig();
            if (!configState.baseHash) {
                toastError('Update failed', 'Could not load config — try refreshing the page.');
                return;
            }
            const patch = { channels: { whatsapp: { accounts: { [gwAccountId]: { markOnline: next } } } } };
            const result = (await sendRequest('config.patch', {
                raw: JSON.stringify(patch),
                baseHash: configState.baseHash,
                note: `Set markOnline=${next} for whatsapp:${gwAccountId} via Hub`,
            })) as { reloadMode?: string } | undefined;
            if ((result?.reloadMode ?? 'restart') === 'restart') {
                beginRestart();
                return;
            }
            try { await loadConfig(); } catch { /* refresh baseHash on next call */ }
            toastSuccess(next ? m.channel_markOnlineEnabled() : m.channel_markOnlineDisabled());
        } catch (e) {
            const msg = (e as Error).message ?? '';
            if (msg.includes('closed') || msg.includes('not connected')) {
                beginRestart();
            } else {
                toastError('Update failed', msg || 'Unknown error');
            }
        } finally {
            markOnlineSaving = false;
        }
    }

    // --- Routing visibility (read-only summary of which agent(s) this account routes to) ---
    type BindingMatch = { channel?: string; accountId?: string; peer?: { kind: string; id: string } };
    type BindingEntry = { agentId: string | null; match: BindingMatch };

    const matchingBindings = $derived.by(() => {
        if (!isGateway || !gwChannelType) return [];
        const all = (configState.current?.bindings ?? []) as BindingEntry[];
        return all.filter((b) => {
            if (b.match?.channel !== gwChannelType) return false;
            const acct = b.match?.accountId;
            if (!acct) return gwAccountId === 'default';
            if (acct === '*') return true;
            return acct === gwAccountId;
        });
    });
    /** Direct (non-peer-scoped) matches — these are the primary routing targets shown. */
    const directBindings = $derived(matchingBindings.filter((b) => !b.match.peer));
    const peerBindingCount = $derived(matchingBindings.length - directBindings.length);

    async function handleRemoveAccount() {
        if (!isGateway || !gwChannelType || !gwAccountId || removing) return;
        const label = `${gwChannelType}:${gwAccountId}`;
        removing = true;
        try {
            // Unlink first so credentials are cleared (e.g. WhatsApp logs out the
            // linked device). Best-effort — token channels don't support logout.
            try {
                await sendRequest('channels.logout', { channel: gwChannelType, accountId: gwAccountId });
            } catch {
                /* channel may not support logout — continue to config removal */
            }
            // Refresh baseHash (logout can mutate config) before patching.
            try { await loadConfig(); } catch { /* best effort */ }
            if (!configState.baseHash) {
                toastError('Remove failed', 'Could not load config — try refreshing the page.');
                return;
            }
            // RFC 7386 merge-patch: a null value deletes the account key.
            const patch = { channels: { [gwChannelType]: { accounts: { [gwAccountId]: null } } } };
            await sendRequest('config.patch', {
                raw: JSON.stringify(patch),
                baseHash: configState.baseHash,
                note: `Remove ${label} via Hub`,
            });
            try { await loadConfig(); } catch { /* refresh baseHash */ }
            try {
                const r = await sendRequest('channels.status', {});
                if (r) gw.channels = r as typeof gw.channels;
            } catch { /* best effort */ }
            toastSuccess(`Removed ${label}`);
        } catch (e) {
            const msg = (e as Error).message ?? '';
            if (msg.includes('closed') || msg.includes('not connected')) {
                beginRestart();
            } else {
                toastError('Remove failed', msg || 'Unknown error');
            }
        } finally {
            removing = false;
            confirmRemove = false;
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
    <div class="flex items-center gap-3 px-4 py-3 group">
        <Button
            variant="ghost"
            class="!h-auto min-w-0 flex-1 !justify-start !px-0 !py-0 text-left"
            onclick={() => onclick?.()}
            aria-expanded={expanded}
            aria-controls={`channel-details-${channel.id}`}
        >
          <span class="flex min-w-0 flex-1 flex-col items-start">
            <span class="flex items-baseline gap-2">
                <span class="text-sm font-medium text-foreground truncate">{channel.label}</span>
                {#if channel.credentialsMeta?.username}
                    <span class="text-xs text-muted-strong truncate">@{channel.credentialsMeta.username}</span>
                {/if}
                {#if channel.credentialsMeta?.phone}
                    <span
                        class="text-xs truncate tabular-nums {channel.gwIdentityMismatch ? 'text-warning font-medium' : 'text-muted-strong'}"
                        title={channel.gwIdentityMismatch ? `Linked to ${channel.credentialsMeta.phone}${channel.credentialsMeta.expectedPhone ? ` — expected ${channel.credentialsMeta.expectedPhone}` : ''}` : channel.credentialsMeta.phone}
                    >
                        {channel.gwIdentityMismatch ? '⚠ ' : ''}{channel.credentialsMeta.phone}
                    </span>
                {/if}
            </span>
          </span>
          {#if channel.replies}
            <span
                class="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full {channel.replies === 'bound'
                    ? 'bg-accent/10 text-accent'
                    : 'bg-muted text-muted-foreground'}"
                title={channel.replies === 'bound' ? m.channel_modeBoundHint() : m.channel_modeReceiveOnlyHint()}
            >
                {channel.replies === 'bound' ? m.channel_modeBound() : m.channel_modeReceiveOnly()}
            </span>
          {/if}
          <span
              class="transition-transform duration-[var(--duration-fast)] text-muted-foreground"
              class:rotate-180={expanded}
          >
              <ChevronDown size={16} />
          </span>
        </Button>
        <ChannelStatusPill {channel} size="sm" />
        {#if !isGateway}
            <Button
                variant="danger"
                size="icon"
                type="button"
                class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onclick={(e) => { e.stopPropagation(); ondelete?.(); }}
                title={m.common_delete()}
                aria-label={m.common_delete()}
            >
                <Trash2 size={14} />
            </Button>
        {/if}
    </div>

    <!-- Expanded accordion content -->
    <div
        id={`channel-details-${channel.id}`}
        class="grid transition-[grid-template-rows] duration-[var(--duration-fast)] ease-out"
        style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
    >
        <div class="overflow-hidden">
            <div class="px-4 pb-4 space-y-4 border-t border-border/50 pt-3">

                <!-- Compact details (status pill lives in the header) -->
                <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt class="text-muted-foreground">Account</dt>
                    <dd class="text-foreground truncate">{gwAccountId ?? channel.accountId ?? channel.label}</dd>
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
                        <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{m.channel_credentials()}</h4>
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

                <!-- Behavior: how the agent interacts on this linked channel (DB-driven via the mirror) -->
                {#if isGateway}
                    <div>
                        <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{m.channel_behaviorTitle()}</h4>
                        <div class="flex flex-wrap gap-1.5">
                            <Button
                                variant={behaviorMode === 'receive' ? 'primary' : 'secondary'}
                                size="sm"
                                type="button"
                                disabled={behaviorSaving}
                                aria-pressed={behaviorMode === 'receive'}
                                onclick={(e) => { e.stopPropagation(); handleSelectMode('receive'); }}
                            >{m.channel_behaviorReceiveOnly()}</Button>
                            <Button
                                variant={behaviorMode === 'allowlist' ? 'primary' : 'secondary'}
                                size="sm"
                                type="button"
                                disabled={behaviorSaving}
                                aria-pressed={behaviorMode === 'allowlist'}
                                onclick={(e) => { e.stopPropagation(); handleSelectMode('allowlist'); }}
                            >{m.channel_behaviorAllowlist()}</Button>
                            <Button
                                variant={behaviorMode === 'open' ? 'primary' : 'secondary'}
                                size="sm"
                                type="button"
                                disabled={behaviorSaving}
                                aria-pressed={behaviorMode === 'open'}
                                onclick={(e) => { e.stopPropagation(); handleSelectMode('open'); }}
                            >{m.channel_behaviorOpen()}</Button>
                        </div>
                        <p class="text-xs text-muted-foreground mt-1.5">{m.channel_behaviorHint()}</p>
                        {#if behaviorMode === 'allowlist'}
                            <div class="mt-2 space-y-1.5">
                                <label class="text-xs text-muted-foreground" for={`allowlist-${channel.id}`}>{m.channel_behaviorAllowlistLabel()}</label>
                                <textarea
                                    id={`allowlist-${channel.id}`}
                                    bind:value={allowlistText}
                                    rows="3"
                                    onclick={(e) => e.stopPropagation()}
                                    placeholder="+51999999999"
                                    class="w-full text-xs bg-bg2 border border-border rounded-md p-2 font-mono resize-y"
                                ></textarea>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    type="button"
                                    loading={behaviorSaving}
                                    onclick={(e) => { e.stopPropagation(); handleSaveAllowlist(); }}
                                >{m.channel_behaviorSave()}</Button>
                            </div>
                        {/if}
                    </div>
                {/if}

                <!-- WhatsApp markOnline: transport-level knob, source of truth = gateway.json -->
                {#if isGateway && channel.type === 'whatsapp' && gwAccountId}
                    <div>
                        <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{m.channel_markOnlineTitle()}</h4>
                        <Toggle
                            checked={markOnlineValue}
                            label={m.channel_markOnlineLabel()}
                            disabled={markOnlineSaving}
                            onchange={() => handleToggleMarkOnline()}
                            size="sm"
                        />
                        <p class="text-xs text-muted-foreground mt-1.5">{m.channel_markOnlineHint()}</p>
                    </div>
                {/if}

                <!-- Routing: which agent(s) this account dispatches to (read-only; edit at Settings → Agents) -->
                {#if isGateway && gwChannelType && gwAccountId}
                    <div>
                        <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{m.channel_routingTitle()}</h4>
                        {#if directBindings.length === 0}
                            <p class="text-xs text-warning">{m.channel_routingNone()}</p>
                        {:else}
                            <div class="flex flex-wrap items-center gap-1.5">
                                {#each directBindings as b, i (i)}
                                    <span class="text-xs font-medium px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                                        {b.agentId ?? m.channel_routingNoAgent()}{b.match.accountId === '*' ? ` (${m.channel_routingCatchAll()})` : ''}
                                    </span>
                                {/each}
                            </div>
                        {/if}
                        {#if peerBindingCount > 0}
                            <p class="text-xs text-muted-foreground mt-1">{m.channel_routingPeerRules({ count: peerBindingCount })}</p>
                        {/if}
                        <a
                            href="/settings?s=agents"
                            class="text-xs text-accent hover:underline mt-1 inline-block"
                            onclick={(e) => e.stopPropagation()}
                        >{m.channel_routingEdit()}</a>
                    </div>
                {/if}

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
                    {:else if reauthing}
                        <div class="bg-bg2 border border-border rounded-md p-3 space-y-2">
                            <div class="flex items-center justify-between">
                                <h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Re-authenticate
                                </h4>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    type="button"
                                    onclick={(e) => { e.stopPropagation(); reauthing = false; }}
                                >
                                    {m.channelWizard_close()}
                                </Button>
                            </div>
                            <WhatsAppQrPairing
                                channelId={channel.id}
                                {serverId}
                                accountId={channel.accountId ?? gwAccountId ?? undefined}
                                onpaired={(phone) => persistPairedAccount(phone)}
                            />
                        </div>
                    {:else}
                        <div class="flex items-center gap-3 flex-wrap">
                            <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onclick={(e) => { e.stopPropagation(); showEditForm = true; }}
                            >
                                <Pencil size={12} />
                                {m.common_edit()}
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                type="button"
                                onclick={(e) => { e.stopPropagation(); handleReauthenticate(); }}
                            >
                                <RefreshCw size={12} />
                                Re-authenticate
                            </Button>
                            {#if isGateway && gwChannelType && gwAccountId}
                                <Button
                                    variant={channel.gwEnabled === false ? 'primary' : 'danger'}
                                    size="sm"
                                    type="button"
                                    onclick={(e) => { e.stopPropagation(); handleToggleEnabled(); }}
                                    loading={toggling}
                                    disabled={transportEnabled === false}
                                    title={transportEnabled === false ? m.channel_transportOffTooltip() : ''}
                                >
                                    {#if !toggling}
                                        <Power size={12} />
                                    {/if}
                                    {channel.gwEnabled === false ? m.channel_enable() : m.channel_disable()}
                                </Button>
                                {#if confirmRemove}
                                    <Button
                                        variant="danger"
                                        size="sm"
                                        type="button"
                                        onclick={(e) => { e.stopPropagation(); handleRemoveAccount(); }}
                                        loading={removing}
                                    >
                                        {#if !removing}
                                            <Trash2 size={12} />
                                        {/if}
                                        {m.common_confirm()}
                                    </Button>
                                    <Button variant="ghost" size="sm"
                                        type="button"
                                        onclick={(e) => { e.stopPropagation(); confirmRemove = false; }}
                                        disabled={removing}
                                    >
                                        {m.common_cancel()}
                                    </Button>
                                {:else}
                                    <Button variant="danger" size="sm"
                                        type="button"
                                        onclick={(e) => { e.stopPropagation(); confirmRemove = true; }}
                                    >
                                        <Trash2 size={12} />
                                        {m.common_remove()}
                                    </Button>
                                {/if}
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>
