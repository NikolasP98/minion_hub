<script lang="ts">
    import type { Snippet } from 'svelte';
    import { onMount } from 'svelte';
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { ArrowUpRight, Plus, Settings2 } from 'lucide-svelte';
    import ChannelBrandIcon from './ChannelBrandIcon.svelte';
    import { Button, Toggle } from '$lib/components/ui';
    import { hydratePluginNav, pluginNavState } from '$lib/state/plugin-nav.svelte';
    import { sendRequest } from '$lib/services/gateway.svelte';
    import { configState, loadConfig, beginRestart } from '$lib/state/config/config.svelte';
    import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
    import { deriveChannelDisplayState } from '$lib/utils/channel-display-state';
    import * as m from '$lib/paraglide/messages';

    interface Props {
        type: ChannelType;
        channels: Channel[];
        transportEnabled: boolean | undefined;
        onaddclick: () => void;
        children: Snippet;
    }
    let { type, channels, transportEnabled, onaddclick, children }: Props = $props();

    // Plugin settings deep-link. When the gateway advertises a
    // `settings.plugins` UI for a plugin whose id matches this channel type
    // (first-party comms plugins use pluginId === channelType), surface a
    // CTA that navigates to `/settings/plugins?plugin=<id>` so the user
    // lands directly on that plugin's settings tab. The plugin page reads
    // the query param and auto-selects the matching entry on load.
    const pluginSettingsEntry = $derived(
        pluginNavState.loaded ? pluginNavState.settingsByPluginId[type] : undefined,
    );

    onMount(() => {
        void hydratePluginNav();
    });

    const summary = $derived.by(() => {
        let live = 0, paused = 0, errored = 0;
        for (const c of channels) {
            const s = deriveChannelDisplayState(c);
            if (s === 'live' || s === 'degraded') live++;
            else if (s === 'disabled') paused++;
            // A mismatched (wrong number) account is a genuine problem; an
            // unlinked account is not — it's just awaiting a QR scan, so it is
            // not counted as an error (matches how starting/pairing are treated).
            else if (s === 'error' || s === 'identity-mismatch') errored++;
        }
        return { live, paused, error: errored };
    });

    let toggling = $state(false);
    async function toggleTransport() {
        if (toggling) return;
        toggling = true;
        try {
            if (!configState.baseHash) await loadConfig();
            if (!configState.baseHash) {
                toastError('Toggle failed', 'Could not load config — refresh the page.');
                return;
            }
            const next = !(transportEnabled ?? true);
            const patch = { channels: { [type]: { enabled: next } } };
            const result = (await sendRequest('config.patch', {
                raw: JSON.stringify(patch),
                baseHash: configState.baseHash,
                note: `${next ? 'Enable' : 'Disable'} ${type} transport via Hub`,
            })) as { reloadMode?: string } | undefined;

            const reloadMode = result?.reloadMode ?? 'restart';
            if (reloadMode === 'restart') {
                beginRestart();
                return;
            }
            try { await loadConfig(); } catch { /* refresh baseHash on next call */ }
            toastSuccess(`${next ? 'Enabled' : 'Disabled'} ${CHANNEL_TYPE_LABELS[type]} transport`);
        } catch (e) {
            const msg = (e as Error).message ?? '';
            if (msg.includes('closed') || msg.includes('not connected')) beginRestart();
            else toastError('Toggle failed', msg || 'Unknown error');
        } finally {
            toggling = false;
        }
    }
</script>

<section
    class="rounded-lg border border-border bg-card transition-opacity"
    class:opacity-60={transportEnabled === false}
>
    <header class="flex items-center gap-3 px-4 py-2.5 border-b border-border/60">
        <div class="w-7 h-7 rounded-md bg-bg3 flex items-center justify-center shrink-0 text-foreground">
            <ChannelBrandIcon channel={type} size={16} />
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold text-foreground">{CHANNEL_TYPE_LABELS[type]}</h3>
                <span class="text-xs text-muted-foreground">
                    {m.channel_summary({ live: String(summary.live), paused: String(summary.paused), error: String(summary.error) })}
                </span>
            </div>
        </div>
        <Toggle
            checked={transportEnabled !== false}
            label={transportEnabled === false ? 'Channel off' : 'Channel on'}
            onchange={() => toggleTransport()}
            disabled={toggling}
            size="sm"
        />
        <Button type="button" variant="primary" size="sm" onclick={onaddclick}>
            {#snippet icon()}<Plus size={12} />{/snippet}
            {m.channel_addAccount()}
        </Button>
    </header>
    <div class="p-3 space-y-1.5">
        {@render children()}
    </div>
    {#if pluginSettingsEntry}
        <Button
            variant="ghost"
            href="/settings/plugins?plugin={encodeURIComponent(pluginSettingsEntry.pluginId)}"
            class="!h-auto !w-full !justify-start !rounded-none !px-4 !py-2.5"
        >
            <Settings2 size={12} />
            <span class="font-medium">Plugin settings</span>
            <span class="text-muted-strong">— {pluginSettingsEntry.description}</span>
            <ArrowUpRight size={12} class="ml-auto" />
        </Button>
    {/if}
</section>
