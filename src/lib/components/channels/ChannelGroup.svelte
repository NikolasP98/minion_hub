<script lang="ts">
    import type { Snippet } from 'svelte';
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { Plus, Power } from 'lucide-svelte';
    import ChannelBrandIcon from './ChannelBrandIcon.svelte';
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
</section>
