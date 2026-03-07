<script lang="ts">
    import type { Channel } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS } from '$lib/types/channels';
    import { MessageSquare, Smartphone, Send, Pencil, Trash2 } from 'lucide-svelte';

    interface Props {
        channel: Channel;
        selected?: boolean;
        onclick?: () => void;
        onedit?: () => void;
        ondelete?: () => void;
    }

    let { channel, selected = false, onclick, onedit, ondelete }: Props = $props();

    const statusColor: Record<string, string> = {
        active: 'bg-success/20 text-success',
        inactive: 'bg-muted-foreground/20 text-muted-foreground',
        pairing: 'bg-warning/20 text-warning',
    };

    const icons = { discord: MessageSquare, whatsapp: Smartphone, telegram: Send } as const;
    const ChannelIcon = $derived(icons[channel.type]);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="w-full text-left bg-card border rounded-lg px-4 py-3 transition-all cursor-pointer group
        {selected ? 'border-accent ring-1 ring-accent/30' : 'border-border hover:border-muted-foreground'}"
    onclick={() => onclick?.()}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onclick?.(); }}
    role="button"
    tabindex="0"
>
    <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-md bg-bg3 flex items-center justify-center shrink-0">
            <ChannelIcon size={16} class="text-muted-foreground" />
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-foreground truncate">{channel.label}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded-full {statusColor[channel.status] ?? statusColor.inactive}">
                    {channel.status}
                </span>
            </div>
            <span class="text-xs text-muted-foreground">{CHANNEL_TYPE_LABELS[channel.type]}</span>
            {#if channel.credentialsMeta?.username}
                <span class="text-xs text-muted-foreground/70"> &middot; {channel.credentialsMeta.username}</span>
            {/if}
        </div>
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
                type="button"
                class="p-1.5 rounded hover:bg-bg3 text-muted-foreground hover:text-foreground transition-colors"
                onclick={(e) => { e.stopPropagation(); onedit?.(); }}
                title="Edit"
            >
                <Pencil size={14} />
            </button>
            <button
                type="button"
                class="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                onclick={(e) => { e.stopPropagation(); ondelete?.(); }}
                title="Delete"
            >
                <Trash2 size={14} />
            </button>
        </div>
    </div>
</div>
