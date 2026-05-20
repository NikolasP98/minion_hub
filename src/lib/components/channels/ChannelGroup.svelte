<script lang="ts">
    import type { Snippet } from 'svelte';
    import { onMount } from 'svelte';
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { ChevronDown, Plus, Power, Settings2 } from 'lucide-svelte';
    import ChannelBrandIcon from './ChannelBrandIcon.svelte';
    import PluginIframe from '$lib/plugins/PluginIframe.svelte';
    import type { Theme } from '$lib/plugins/bridge-protocol';
    import { hostsState, fetchHostToken } from '$lib/state/features/hosts.svelte';
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
        /** Gateway base URL (HTTP) used to construct the plugin iframe src. */
        gatewayBaseUrl?: string;
    }
    let { type, channels, transportEnabled, onaddclick, children, gatewayBaseUrl }: Props = $props();

    // Plugin settings inline-embed. We surface a "Plugin settings" disclosure
    // when the gateway advertises a `settings.plugins` UI for a plugin whose
    // id matches this channel type (first-party comms plugins use pluginId
    // === channelType). The plugin's own settings page is the source of
    // truth — embedding it inline gives users one consistent surface and
    // avoids duplicating the config schema in the hub.
    let pluginSettingsOpen = $state(false);
    const pluginSettingsEntry = $derived(
        pluginNavState.loaded ? pluginNavState.settingsByPluginId[type] : undefined,
    );

    // Lazy iframe state — only materialise theme/tokens/token-fetch when the
    // user actually expands the section. Avoids paying for an iframe per
    // channel group on every comms-tab visit.
    //
    // Theme/tokens are stored as plain `let` (NOT `$state`) because PluginIframe
    // forwards them through `postMessage`, which can't clone Svelte 5 reactive
    // proxies (DataCloneError). The /settings/plugins page uses the same plain
    // `let` pattern for the same reason. Values are read once when the iframe
    // mounts (gated by `iframeAuthToken`), so reactivity isn't needed here.
    let iframeTheme: Theme = 'light';
    let iframeTokens: Record<string, string> = {};
    let iframeAuthToken = $state('');
    let iframeTokenError = $state<string | null>(null);

    function snapshotThemeTokens() {
        if (typeof document === 'undefined') return;
        iframeTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        const root = document.documentElement;
        const computed = getComputedStyle(root);
        const next: Record<string, string> = {};
        for (const name of Array.from(root.style)) {
            if (name.startsWith('--')) next[name] = root.style.getPropertyValue(name).trim();
        }
        for (const sheet of Array.from(document.styleSheets)) {
            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                continue;
            }
            for (const rule of Array.from(rules)) {
                if (!(rule instanceof CSSStyleRule)) continue;
                if (!/^:root\b/.test(rule.selectorText)) continue;
                for (const name of Array.from(rule.style)) {
                    if (name.startsWith('--') && !(name in next))
                        next[name] = computed.getPropertyValue(name).trim();
                }
            }
        }
        iframeTokens = next;
    }

    async function togglePluginSettings() {
        const next = !pluginSettingsOpen;
        if (next && !iframeAuthToken && !iframeTokenError) {
            const hostId = hostsState.activeHostId;
            if (hostId) {
                snapshotThemeTokens();
                try {
                    const tok = await fetchHostToken(hostId);
                    if (tok === null) {
                        iframeTokenError = 'Could not obtain gateway token.';
                    } else {
                        iframeAuthToken = tok;
                    }
                } catch (err) {
                    iframeTokenError = err instanceof Error ? err.message : String(err);
                }
            } else {
                iframeTokenError = 'No active host selected.';
            }
        }
        pluginSettingsOpen = next;
    }

    onMount(() => {
        void hydratePluginNav();
    });

    const summary = $derived.by(() => {
        let live = 0, paused = 0, errored = 0;
        for (const c of channels) {
            const s = deriveChannelDisplayState(c);
            if (s === 'live' || s === 'degraded') live++;
            else if (s === 'disabled') paused++;
            else if (s === 'error') errored++;
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
                <span class="text-[10px] text-muted-foreground">
                    {m.channel_summary({ live: String(summary.live), paused: String(summary.paused), error: String(summary.error) })}
                </span>
            </div>
        </div>
        <button
            type="button"
            class="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors {transportEnabled === false
                ? 'bg-muted-foreground/10 text-muted-foreground hover:bg-muted-foreground/20'
                : 'bg-success/10 text-success hover:bg-success/20'}"
            onclick={toggleTransport}
            disabled={toggling}
            title={transportEnabled === false ? m.channel_transportOff() : m.channel_transportOn()}
        >
            {#if toggling}
                <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
            {:else}
                <Power size={12} />
                {transportEnabled === false ? m.channel_transportOff() : m.channel_transportOn()}
            {/if}
        </button>
        <button
            type="button"
            class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity"
            onclick={onaddclick}
        >
            <Plus size={12} />
            {m.channel_addAccount()}
        </button>
    </header>
    <div class="p-3 space-y-1.5">
        {@render children()}
    </div>
    {#if pluginSettingsEntry && gatewayBaseUrl}
        <div class="border-t border-border/60">
            <button
                type="button"
                class="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onclick={togglePluginSettings}
                aria-expanded={pluginSettingsOpen}
            >
                <Settings2 size={12} />
                <span class="font-medium">Plugin settings</span>
                <span class="text-muted-foreground/70">— {pluginSettingsEntry.description}</span>
                <ChevronDown
                    size={12}
                    class="ml-auto transition-transform duration-200 {pluginSettingsOpen ? 'rotate-180' : ''}"
                />
            </button>
            {#if pluginSettingsOpen}
                <div class="px-2 pb-3">
                    {#if iframeTokenError}
                        <p class="px-2 py-3 text-xs text-destructive">{iframeTokenError}</p>
                    {:else if !iframeAuthToken}
                        <p class="px-2 py-3 text-xs text-muted-foreground">Loading plugin…</p>
                    {:else}
                        <div class="rounded-md border border-border/60 bg-bg2 overflow-hidden">
                            <PluginIframe
                                pluginId={pluginSettingsEntry.pluginId}
                                entrypoint={pluginSettingsEntry.entrypoint}
                                gatewayUrl={gatewayBaseUrl}
                                authToken={iframeAuthToken}
                                theme={iframeTheme}
                                tokens={iframeTokens}
                            />
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</section>
