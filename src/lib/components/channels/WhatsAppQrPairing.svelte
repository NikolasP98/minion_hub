<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import * as qrCode from '@zag-js/qr-code';
    import { useMachine, normalizeProps } from '@zag-js/svelte';
    import { requestWhatsAppPair } from '$lib/services/gateway.svelte';

    interface Props {
        channelId: string;
        serverId: string;
    }

    let { channelId, serverId }: Props = $props();

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
        api.setValue(detail.qrData);
        pairingStatus = 'waiting';
    }

    function handlePairedEvent(e: Event) {
        const detail = (e as CustomEvent<{ channelId: string }>).detail;
        if (detail.channelId === channelId) {
            pairingStatus = 'connected';
        }
    }

    onMount(() => {
        window.addEventListener('channels.whatsapp.qr', handleQrEvent);
        window.addEventListener('channels.whatsapp.paired', handlePairedEvent);
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('channels.whatsapp.qr', handleQrEvent);
            window.removeEventListener('channels.whatsapp.paired', handlePairedEvent);
        }
    });

    async function startPairing() {
        pairingStatus = 'waiting';
        errorMsg = null;
        try {
            await fetch(`/api/servers/${serverId}/channels/${channelId}/qr`, { method: 'POST' });
            await requestWhatsAppPair(channelId);
        } catch (e) {
            pairingStatus = 'error';
            errorMsg = e instanceof Error ? e.message : 'Failed to start pairing';
        }
    }
</script>

<div class="space-y-3">
    {#if pairingStatus === 'idle'}
        <button
            type="button"
            class="bg-accent text-accent-foreground rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            onclick={startPairing}
        >
            Start QR Pairing
        </button>
        <p class="text-xs text-muted-foreground">
            Scan the QR code with WhatsApp to link this channel.
        </p>
    {:else if pairingStatus === 'waiting' && qrData}
        <div class="flex flex-col items-center gap-3 p-4 bg-white rounded-lg" {...api.getRootProps()}>
            <svg {...api.getFrameProps()}>
                <path {...api.getPatternProps()} />
            </svg>
            <p class="text-xs text-gray-600">Scan with WhatsApp</p>
        </div>
    {:else if pairingStatus === 'waiting'}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
            Waiting for QR code from gateway...
        </div>
    {:else if pairingStatus === 'connected'}
        <div class="flex items-center gap-2 text-sm text-success">
            <div class="w-2 h-2 rounded-full bg-success"></div>
            WhatsApp paired successfully!
        </div>
    {:else if pairingStatus === 'error'}
        <div class="text-sm text-destructive">
            {errorMsg ?? 'Pairing failed'}
        </div>
        <button
            type="button"
            class="text-xs text-accent hover:underline"
            onclick={startPairing}
        >
            Try again
        </button>
    {/if}
</div>
