<script lang="ts">
    import type { Channel } from '$lib/types/channels';
    import { deriveChannelDisplayState, type ChannelDisplayState } from '$lib/utils/channel-display-state';
    import { CircleCheck, CircleX, AlertTriangle, Loader, Smartphone, PowerOff } from 'lucide-svelte';
    import * as m from '$lib/paraglide/messages';

    interface Props { channel: Channel; size?: 'sm' | 'md'; }
    let { channel, size = 'md' }: Props = $props();
    const state = $derived(deriveChannelDisplayState(channel));

    const styles: Record<ChannelDisplayState, { bg: string; text: string; label: () => string; pulse: boolean; Icon: typeof CircleCheck }> = {
        disabled:        { bg: 'bg-muted-foreground/10',  text: 'text-muted-foreground',   label: m.channelState_disabled,      pulse: false, Icon: PowerOff },
        'pending-config':{ bg: 'bg-warning/15',           text: 'text-warning',             label: m.channelState_pendingConfig, pulse: false, Icon: AlertTriangle },
        starting:        { bg: 'bg-accent/15',            text: 'text-accent-foreground',   label: m.channelState_starting,      pulse: true,  Icon: Loader },
        pairing:         { bg: 'bg-warning/15',           text: 'text-warning',             label: m.channelState_pairing,       pulse: true,  Icon: Smartphone },
        live:            { bg: 'bg-success/15',           text: 'text-success',             label: m.channelState_live,          pulse: false, Icon: CircleCheck },
        degraded:        { bg: 'bg-warning/15',           text: 'text-warning',             label: m.channelState_degraded,      pulse: false, Icon: AlertTriangle },
        error:           { bg: 'bg-destructive/15',       text: 'text-destructive',         label: m.channelState_error,         pulse: false, Icon: CircleX },
    };
    const s = $derived(styles[state]);
    const tooltip = $derived(
        `enabled=${channel.gwEnabled ?? '—'} configured=${channel.gwConfigured ?? '—'} running=${channel.gwRunning ?? '—'} connected=${channel.gwConnected ?? '—'} reconnects=${channel.gwReconnectAttempts ?? 0}`,
    );
    const padding = $derived(size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs');
    const iconSize = $derived(size === 'sm' ? 10 : 12);
</script>

<span
    class="inline-flex items-center gap-1 rounded-full font-medium {s.bg} {s.text} {padding}"
    title={tooltip}
    role="status"
    aria-label={s.label()}
>
    <s.Icon size={iconSize} class={s.pulse ? 'animate-pulse' : ''} />
    {s.label()}
</span>
