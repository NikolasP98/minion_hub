<script lang="ts">
    import type { Channel, ChannelType } from '$lib/types/channels';
    import { CHANNEL_TYPE_LABELS, CHANNEL_FIELDS } from '$lib/types/channels';
    import { MessageSquare, Smartphone, Send, Trash2, Radio, ChevronDown, Pencil } from 'lucide-svelte';
    import ChannelAssignmentPicker from './ChannelAssignmentPicker.svelte';
    import ChannelForm from './ChannelForm.svelte';

    interface Props {
        channel: Channel;
        expanded?: boolean;
        serverId: string;
        onclick?: () => void;
        ondelete?: () => void;
        onsave?: (data: { type: ChannelType; label: string; credentials: Record<string, string>; credentialsMeta: Record<string, string> }) => Promise<void>;
    }

    let { channel, expanded = false, serverId, onclick, ondelete, onsave }: Props = $props();

    const isGateway = $derived(channel.source === 'gateway');
    let showEditForm = $state(false);

    const statusColor: Record<string, string> = {
        active: 'bg-success/20 text-success',
        inactive: 'bg-muted-foreground/20 text-muted-foreground',
        pairing: 'bg-warning/20 text-warning',
    };

    const icons = { discord: MessageSquare, whatsapp: Smartphone, telegram: Send } as const;
    const ChannelIcon = $derived(icons[channel.type]);

    const hasLiveData = $derived(
        channel.gwConnected !== undefined ||
        channel.gwEnabled !== undefined ||
        channel.gwRunning !== undefined ||
        channel.gwConfigured !== undefined
    );

    const metaEntries = $derived(
        Object.entries(channel.credentialsMeta ?? {}).filter(([, v]) => v)
    );

    const fieldDefs = $derived(CHANNEL_FIELDS[channel.type] ?? []);
    const metaFieldLabels = $derived(
        Object.fromEntries(fieldDefs.map((f) => [f.key, f.label]))
    );

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
    <div
        class="flex items-center gap-3 px-4 py-3 cursor-pointer group"
        onclick={() => onclick?.()}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onclick?.(); }}
        role="button"
        tabindex="0"
    >
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
        {#if isGateway}
            <div class="flex items-center gap-1 text-[10px] text-accent/80" title="Reported by gateway (read-only)">
                <Radio size={12} />
                <span>live</span>
            </div>
        {:else}
            <button
                type="button"
                class="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                onclick={(e) => { e.stopPropagation(); ondelete?.(); }}
                title="Delete"
            >
                <Trash2 size={14} />
            </button>
        {/if}
        <div
            class="transition-transform duration-200 text-muted-foreground"
            class:rotate-180={expanded}
        >
            <ChevronDown size={16} />
        </div>
    </div>

    <!-- Expanded accordion content -->
    <div
        class="grid transition-[grid-template-rows] duration-200 ease-out"
        style="grid-template-rows: {expanded ? '1fr' : '0fr'}"
    >
        <div class="overflow-hidden">
            <div class="px-4 pb-4 space-y-4 border-t border-border/50 pt-3">

                <!-- Live Status -->
                {#if hasLiveData}
                    <div>
                        <h4 class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Live Status</h4>
                        <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                            {#if channel.gwConnected !== undefined}
                                <div class="flex items-center gap-1.5">
                                    <span class="w-1.5 h-1.5 rounded-full {channel.gwConnected ? 'bg-success' : 'bg-destructive'}"></span>
                                    <span class="text-muted-foreground">Connected</span>
                                </div>
                            {/if}
                            {#if channel.gwRunning !== undefined}
                                <div class="flex items-center gap-1.5">
                                    <span class="w-1.5 h-1.5 rounded-full {channel.gwRunning ? 'bg-success' : 'bg-muted-foreground'}"></span>
                                    <span class="text-muted-foreground">Running</span>
                                </div>
                            {/if}
                            {#if channel.gwEnabled !== undefined}
                                <div class="flex items-center gap-1.5">
                                    <span class="w-1.5 h-1.5 rounded-full {channel.gwEnabled ? 'bg-success' : 'bg-muted-foreground'}"></span>
                                    <span class="text-muted-foreground">Enabled</span>
                                </div>
                            {/if}
                            {#if channel.gwConfigured !== undefined}
                                <div class="flex items-center gap-1.5">
                                    <span class="w-1.5 h-1.5 rounded-full {channel.gwConfigured ? 'bg-success' : 'bg-muted-foreground'}"></span>
                                    <span class="text-muted-foreground">Configured</span>
                                </div>
                            {/if}
                            {#if channel.gwReconnectAttempts !== undefined && channel.gwReconnectAttempts > 0}
                                <div class="flex items-center gap-1.5">
                                    <span class="text-muted-foreground">Reconnects:</span>
                                    <span class="text-warning font-medium">{channel.gwReconnectAttempts}</span>
                                </div>
                            {/if}
                        </div>
                        {#if channel.gwLastError}
                            <p class="text-xs text-destructive mt-1.5 break-words">{channel.gwLastError}</p>
                        {/if}
                    </div>
                {/if}

                <!-- Credentials Meta -->
                {#if metaEntries.length > 0}
                    <div>
                        <h4 class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Credentials</h4>
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

                <!-- Assignments -->
                <div>
                    <h4 class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Assignments</h4>
                    <ChannelAssignmentPicker {serverId} channelId={channel.id} />
                </div>

                <!-- Edit / Managed note -->
                {#if !isGateway}
                    <div>
                        {#if showEditForm}
                            <div class="bg-bg2 border border-border rounded-md p-3">
                                <ChannelForm
                                    {serverId}
                                    initialType={channel.type}
                                    initialLabel={channel.label}
                                    initialCredentials={channel.credentials}
                                    initialMeta={channel.credentialsMeta}
                                    channelId={channel.id}
                                    onsave={handleInlineSave}
                                    oncancel={() => { showEditForm = false; }}
                                />
                            </div>
                        {:else}
                            <button
                                type="button"
                                class="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
                                onclick={() => { showEditForm = true; }}
                            >
                                <Pencil size={12} />
                                Edit Credentials
                            </button>
                        {/if}
                    </div>
                {:else}
                    <p class="text-[10px] text-muted-foreground/60 italic">Managed by gateway — credentials are read-only.</p>
                {/if}
            </div>
        </div>
    </div>
</div>
