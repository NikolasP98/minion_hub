<script lang="ts">
    import type { ChannelType, ChannelStatus } from '$lib/types/channels';
    import { CHANNEL_FIELDS, CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { MessageSquare, Smartphone, Send, Eye, EyeOff } from 'lucide-svelte';
    import WhatsAppQrPairing from './WhatsAppQrPairing.svelte';

    interface Props {
        serverId: string;
        initialType?: ChannelType;
        initialLabel?: string;
        initialCredentials?: Record<string, string>;
        initialMeta?: Record<string, string>;
        channelId?: string;
        onsave?: (data: { type: ChannelType; label: string; credentials: Record<string, string>; credentialsMeta: Record<string, string> }) => void;
        oncancel?: () => void;
    }

    let {
        serverId,
        initialType = 'discord',
        initialLabel = '',
        initialCredentials = {},
        initialMeta = {},
        channelId,
        onsave,
        oncancel,
    }: Props = $props();

    let type = $state<ChannelType>(initialType);
    let label = $state(initialLabel);
    let credentials = $state<Record<string, string>>({ ...initialCredentials });
    let meta = $state<Record<string, string>>({ ...initialMeta });
    let revealedFields = $state<Set<string>>(new Set());

    const fields = $derived(CHANNEL_FIELDS[type]);
    const typeOptions: { value: ChannelType; label: string; icon: typeof MessageSquare }[] = [
        { value: 'discord', label: 'Discord', icon: MessageSquare },
        { value: 'whatsapp', label: 'WhatsApp', icon: Smartphone },
        { value: 'telegram', label: 'Telegram', icon: Send },
    ];

    function handleSubmit() {
        // Separate non-sensitive fields into meta
        const sensitiveKeys = new Set(
            CHANNEL_FIELDS[type].filter((f) => f.type === 'password').map((f) => f.key),
        );
        const metaKeys = CHANNEL_FIELDS[type].filter((f) => f.type === 'text').map((f) => f.key);
        const creds: Record<string, string> = {};
        const metaOut: Record<string, string> = { ...meta };

        for (const [k, v] of Object.entries(credentials)) {
            if (v) {
                if (sensitiveKeys.has(k)) {
                    creds[k] = v;
                } else {
                    metaOut[k] = v;
                }
            }
        }

        onsave?.({ type, label, credentials: creds, credentialsMeta: metaOut });
    }

    function toggleReveal(key: string) {
        if (revealedFields.has(key)) revealedFields.delete(key);
        else revealedFields.add(key);
        revealedFields = new Set(revealedFields);
    }
</script>

<form class="space-y-4" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
    <!-- Type selector -->
    <div>
        <label class="text-xs font-semibold text-foreground uppercase tracking-wider block mb-2">
            Channel Type
        </label>
        <div class="flex gap-2">
            {#each typeOptions as opt}
                <button
                    type="button"
                    class="flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-all
                        {type === opt.value
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border bg-bg text-muted-foreground hover:border-muted-foreground'}"
                    onclick={() => { type = opt.value; credentials = {}; }}
                >
                    <opt.icon size={14} />
                    {opt.label}
                </button>
            {/each}
        </div>
    </div>

    <!-- Label -->
    <div>
        <label for="channel-label" class="text-xs font-medium text-muted-foreground block mb-1">
            Label
        </label>
        <input
            id="channel-label"
            type="text"
            class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="e.g. Main {CHANNEL_TYPE_LABELS[type]} Bot"
            bind:value={label}
            required
        />
    </div>

    <!-- Credential fields -->
    {#each fields as field (field.key)}
        {#if field.type === 'qr'}
            {#if channelId}
                <WhatsAppQrPairing {channelId} {serverId} />
            {:else}
                <p class="text-xs text-muted-foreground italic">
                    Save the channel first, then pair via QR code.
                </p>
            {/if}
        {:else}
            <div>
                <label for="field-{field.key}" class="text-xs font-medium text-muted-foreground block mb-1">
                    {field.label}
                    {#if field.required}<span class="text-destructive">*</span>{/if}
                </label>
                <div class="relative">
                    <input
                        id="field-{field.key}"
                        type={field.type === 'password' && !revealedFields.has(field.key) ? 'password' : 'text'}
                        class="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent {field.type === 'password' ? 'pr-9' : ''}"
                        placeholder={field.placeholder ?? ''}
                        value={credentials[field.key] ?? ''}
                        oninput={(e) => { credentials[field.key] = e.currentTarget.value; }}
                        required={field.required}
                    />
                    {#if field.type === 'password'}
                        <button
                            type="button"
                            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onclick={() => toggleReveal(field.key)}
                            tabindex={-1}
                        >
                            {#if revealedFields.has(field.key)}
                                <EyeOff size={14} />
                            {:else}
                                <Eye size={14} />
                            {/if}
                        </button>
                    {/if}
                </div>
                {#if field.help}
                    <p class="text-[10px] text-muted-foreground/70 mt-0.5">{field.help}</p>
                {/if}
            </div>
        {/if}
    {/each}

    <!-- Actions -->
    <div class="flex gap-2 pt-2">
        <button
            type="submit"
            class="bg-accent text-accent-foreground rounded-md px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
            {channelId ? 'Update' : 'Create'} Channel
        </button>
        {#if oncancel}
            <button
                type="button"
                class="bg-bg3 text-foreground border border-border rounded-md px-4 py-2 text-sm font-medium hover:border-muted-foreground transition-colors"
                onclick={() => oncancel?.()}
            >
                Cancel
            </button>
        {/if}
    </div>
</form>
