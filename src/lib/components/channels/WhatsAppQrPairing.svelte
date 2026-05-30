<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import * as qrCode from '@zag-js/qr-code';
    import { useMachine, normalizeProps } from '@zag-js/svelte';
    import { requestWhatsAppPair } from '$lib/services/gateway.svelte';
    import { Button } from '$lib/components/ui';
    import * as m from '$lib/paraglide/messages';

    interface Props {
        channelId: string;
        serverId: string;
        /** Optional explicit WhatsApp accountId; defaults to deriving from channelId. */
        accountId?: string;
        onpaired?: (phone: string) => void;
    }

    let { channelId, serverId, accountId, onpaired }: Props = $props();
    // svelte-ignore state_referenced_locally
    void serverId; // QR pairing now runs over the active gateway WS connection, not a per-server REST route.

    let qrData = $state('');
    let pairingStatus = $state<'idle' | 'waiting' | 'scanning' | 'connected' | 'error'>('idle');
    let errorMsg = $state<string | null>(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = useMachine(qrCode.machine as any, () => ({
        id: `qr-${channelId}`,
        value: qrData,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = $derived(qrCode.connect(service as any, normalizeProps));

    function handleQrEvent(e: Event) {
        const detail = (e as CustomEvent<{ qrData: string; expiresIn?: number }>).detail;
        qrData = detail.qrData;
        pairingStatus = 'waiting';
    }

    // `channelId === 'pending'` is a wizard sentinel (no account exists yet) — accept any matching event.
    function isForThisChannel(eventChannelId: string) {
        return channelId === 'pending' || eventChannelId === channelId;
    }

    function handlePairedEvent(e: Event) {
        const detail = (e as CustomEvent<{ channelId: string; phone?: string }>).detail;
        if (isForThisChannel(detail.channelId)) {
            pairingStatus = 'connected';
            if (detail.phone) onpaired?.(detail.phone);
        }
    }

    function handlePairFailedEvent(e: Event) {
        const detail = (e as CustomEvent<{ channelId: string; message?: string }>).detail;
        if (isForThisChannel(detail.channelId)) {
            pairingStatus = 'error';
            errorMsg = detail.message ?? 'Pairing failed';
        }
    }

    onMount(() => {
        window.addEventListener('channels.whatsapp.qr', handleQrEvent);
        window.addEventListener('channels.whatsapp.paired', handlePairedEvent);
        window.addEventListener('channels.whatsapp.pairFailed', handlePairFailedEvent);
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('channels.whatsapp.qr', handleQrEvent);
            window.removeEventListener('channels.whatsapp.paired', handlePairedEvent);
            window.removeEventListener('channels.whatsapp.pairFailed', handlePairFailedEvent);
        }
    });

    async function startPairing() {
        pairingStatus = 'waiting';
        errorMsg = null;
        try {
            // QR generation is driven entirely over the gateway WS connection: the
            // gateway starts a web login, then pushes `channels.whatsapp.qr` and the
            // terminal paired/pairFailed events. No per-server REST precondition.
            const res = await requestWhatsAppPair(channelId, accountId);
            if (!res.ok) {
                pairingStatus = 'error';
                errorMsg = res.alreadyLinked
                    ? (res.message ?? 'This WhatsApp account is already linked.')
                    : (res.message ?? 'Failed to start pairing');
            }
            // On success we stay in `waiting` until the qr event arrives.
        } catch (e) {
            pairingStatus = 'error';
            errorMsg = e instanceof Error ? e.message : 'Failed to start pairing';
        }
    }
</script>

<div class="space-y-3">
    {#if pairingStatus === 'idle'}
        <Button type="button" variant="primary" onclick={startPairing}>
            {m.channel_startQrPairing()}
        </Button>
        <p class="text-xs text-muted-foreground">
            {m.channel_scanQrInstruction()}
        </p>
    {:else if pairingStatus === 'waiting' && qrData}
        <div class="flex flex-col items-center gap-3 p-4 bg-white rounded-lg w-fit mx-auto" {...api.getRootProps()}>
            <svg class="h-48 w-48" {...api.getFrameProps()}>
                <path {...api.getPatternProps()} />
            </svg>
            <p class="text-xs text-gray-600">{m.channel_scanWithWhatsApp()}</p>
        </div>
    {:else if pairingStatus === 'waiting'}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
            {m.channel_waitingQr()}
        </div>
    {:else if pairingStatus === 'connected'}
        <div class="flex items-center gap-2 text-sm text-success">
            <div class="w-2 h-2 rounded-full bg-success"></div>
            {m.channel_pairedSuccessfully()}
        </div>
    {:else if pairingStatus === 'error'}
        <div class="text-sm text-destructive">
            {errorMsg ?? m.channel_pairingFailed()}
        </div>
        <button
            type="button"
            class="text-xs text-accent hover:underline"
            onclick={startPairing}
        >
            {m.common_retry()}
        </button>
    {/if}
</div>
