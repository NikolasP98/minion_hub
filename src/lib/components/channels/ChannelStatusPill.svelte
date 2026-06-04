<script lang="ts">
    import type { Channel } from '$lib/types/channels';
    import { deriveChannelDisplayState, type ChannelDisplayState } from '$lib/utils/channel-display-state';
    import { CircleCheck, CircleX, AlertTriangle, Loader, Smartphone, PowerOff, Link2Off, UserX } from 'lucide-svelte';
    import * as tooltip from '@zag-js/tooltip';
    import { normalizeProps, useMachine } from '@zag-js/svelte';
    import * as m from '$lib/paraglide/messages';

    interface Props { channel: Channel; size?: 'sm' | 'md'; }
    let { channel, size = 'md' }: Props = $props();
    const state = $derived(deriveChannelDisplayState(channel));

    const styles: Record<ChannelDisplayState, { bg: string; text: string; dot: string; label: () => string; pulse: boolean; Icon: typeof CircleCheck }> = {
        disabled:        { bg: 'bg-muted-foreground/10', text: 'text-muted-foreground',  dot: 'bg-muted-foreground', label: m.channelState_disabled,      pulse: false, Icon: PowerOff },
        'pending-config':{ bg: 'bg-warning/15',          text: 'text-warning',            dot: 'bg-warning',           label: m.channelState_pendingConfig, pulse: false, Icon: AlertTriangle },
        'not-linked':    { bg: 'bg-muted-foreground/10',  text: 'text-muted-foreground',   dot: 'bg-muted-foreground',  label: m.channelState_notLinked,     pulse: false, Icon: Link2Off },
        'identity-mismatch':{ bg: 'bg-warning/15',        text: 'text-warning',            dot: 'bg-warning',           label: m.channelState_identityMismatch, pulse: false, Icon: UserX },
        starting:        { bg: 'bg-accent/15',           text: 'text-accent-foreground',  dot: 'bg-accent',            label: m.channelState_starting,      pulse: true,  Icon: Loader },
        pairing:         { bg: 'bg-warning/15',          text: 'text-warning',            dot: 'bg-warning',           label: m.channelState_pairing,       pulse: true,  Icon: Smartphone },
        live:            { bg: 'bg-success/15',          text: 'text-success',            dot: 'bg-success',           label: m.channelState_live,          pulse: false, Icon: CircleCheck },
        degraded:        { bg: 'bg-warning/15',          text: 'text-warning',            dot: 'bg-warning',           label: m.channelState_degraded,      pulse: false, Icon: AlertTriangle },
        error:           { bg: 'bg-destructive/15',      text: 'text-destructive',        dot: 'bg-destructive',       label: m.channelState_error,         pulse: false, Icon: CircleX },
    };
    const s = $derived(styles[state]);
    const padding = $derived(size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs');
    const iconSize = $derived(size === 'sm' ? 10 : 12);

    const service = useMachine(tooltip.machine, () => ({
        id: `chpill-${channel.id}`,
        openDelay: 150,
        closeDelay: 80,
        positioning: { placement: 'top' as const, strategy: 'fixed' as const },
    }));
    const tip = $derived(tooltip.connect(service, normalizeProps));

    type RowState = 'on' | 'off' | 'unknown';
    function flagState(v: boolean | undefined): RowState {
        if (v === true) return 'on';
        if (v === false) return 'off';
        return 'unknown';
    }
    const rows = $derived([
        { label: 'Enabled',    state: flagState(channel.gwEnabled) },
        { label: 'Configured', state: flagState(channel.gwConfigured) },
        { label: 'Linked',     state: flagState(channel.gwLinked) },
        { label: 'Running',    state: flagState(channel.gwRunning) },
        { label: 'Connected',  state: flagState(channel.gwConnected) },
    ]);
    const linkedNumber = $derived(channel.credentialsMeta?.phone);
    const expectedNumber = $derived(channel.gwExpectedIdentity ?? undefined);
    const dotForRow: Record<RowState, string> = {
        on:      'bg-success',
        off:     'bg-destructive/70',
        unknown: 'bg-muted-foreground/40',
    };
    const reconnects = $derived(channel.gwReconnectAttempts ?? 0);
</script>

<button
    type="button"
    {...tip.getTriggerProps()}
    class="inline-flex items-center gap-1 rounded-full font-medium {s.bg} {s.text} {padding} cursor-default focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    aria-label={s.label()}
>
    <s.Icon size={iconSize} class={s.pulse ? 'animate-pulse' : ''} />
    {s.label()}
</button>

{#if tip.open}
    <div {...tip.getPositionerProps()} class="!z-[9999]">
        <div
            {...tip.getContentProps()}
            class="min-w-[200px] rounded-md border border-border bg-bg2 px-3 py-2.5 shadow-lg"
        >
            <div class="flex items-center gap-1.5 mb-2 pb-2 border-b border-border/60">
                <span class="w-1.5 h-1.5 rounded-full {s.dot} {s.pulse ? 'animate-pulse' : ''}"></span>
                <span class="text-xs font-semibold text-foreground">{s.label()}</span>
            </div>
            <dl class="space-y-1 text-[11px]">
                {#each rows as row}
                    <div class="flex items-center justify-between gap-3">
                        <dt class="text-muted-foreground">{row.label}</dt>
                        <dd class="flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full {dotForRow[row.state]}"></span>
                            <span class="text-foreground tabular-nums">
                                {row.state === 'unknown' ? '—' : row.state === 'on' ? 'yes' : 'no'}
                            </span>
                        </dd>
                    </div>
                {/each}
                {#if reconnects > 0}
                    <div class="flex items-center justify-between gap-3 pt-1 mt-1 border-t border-border/60">
                        <dt class="text-muted-foreground">Reconnects</dt>
                        <dd class="text-warning font-medium tabular-nums">{reconnects}</dd>
                    </div>
                {/if}
            </dl>
            {#if state === 'identity-mismatch'}
                <div class="mt-2 pt-2 border-t border-border/60 text-[10px] text-warning break-words max-w-[260px]">
                    <div>Linked: <span class="font-medium tabular-nums">{linkedNumber ?? 'unknown'}</span></div>
                    {#if expectedNumber}
                        <div>Expected: <span class="font-medium tabular-nums">{expectedNumber}</span></div>
                    {/if}
                    <div class="mt-1 text-muted-foreground">Re-link this account with the correct phone.</div>
                </div>
            {:else if state === 'not-linked'}
                <p class="mt-2 pt-2 border-t border-border/60 text-[10px] text-muted-foreground break-words max-w-[260px]">
                    No device linked. Connect and scan the QR to pair a phone.
                </p>
            {:else if channel.gwLastError}
                <p class="mt-2 pt-2 border-t border-border/60 text-[10px] text-destructive break-words max-w-[260px]">
                    {channel.gwLastError}
                </p>
            {/if}
        </div>
    </div>
{/if}
