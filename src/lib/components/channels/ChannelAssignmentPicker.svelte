<script lang="ts">
    import type { ChannelAssignment } from '$lib/types/channels';
    import { fetchChannelAssignments, assignChannel, unassignChannel } from '$lib/state/channels';
    import { X, UserPlus } from 'lucide-svelte';
    import { Button, Select } from '$lib/components/ui';
    import * as m from '$lib/paraglide/messages';

    interface Props {
        serverId: string;
        channelId: string;
    }

    let { serverId, channelId }: Props = $props();

    let assignments = $state<ChannelAssignment[]>([]);
    let loading = $state(false);
    let errorMsg = $state<string | null>(null);
    let targetType = $state<'user' | 'session'>('user');
    let targetId = $state('');
    let adding = $state(false);

    async function load() {
        loading = true;
        errorMsg = null;
        try {
            assignments = await fetchChannelAssignments(serverId, channelId);
        } catch (e) {
            errorMsg = e instanceof Error ? e.message : 'Failed to load assignments';
        }
        loading = false;
    }

    $effect(() => {
        channelId;
        load();
    });

    async function handleAssign() {
        if (!targetId.trim()) return;
        adding = true;
        errorMsg = null;
        try {
            await assignChannel(serverId, channelId, targetType, targetId.trim());
            targetId = '';
            await load();
        } catch (e) {
            errorMsg = e instanceof Error ? e.message : 'Failed to assign';
        }
        adding = false;
    }

    async function handleRemove(assignmentId: string) {
        try {
            await unassignChannel(serverId, channelId, assignmentId);
            await load();
        } catch (e) {
            errorMsg = e instanceof Error ? e.message : 'Failed to remove assignment';
        }
    }
</script>

<div class="space-y-3">
    <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">{m.channel_assignments()}</h3>

    {#if errorMsg}
        <p class="text-xs text-destructive">{errorMsg}</p>
    {/if}

    {#if loading}
        <p class="text-xs text-muted-foreground">{m.common_loading()}</p>
    {:else if assignments.length === 0}
        <p class="text-xs text-muted-foreground italic">{m.channel_noAssignments()}</p>
    {:else}
        <div class="space-y-1">
            {#each assignments as a (a.id)}
                <div class="flex items-center gap-2 bg-bg3 rounded-md px-3 py-1.5 text-sm">
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-muted-foreground/15 text-muted-foreground uppercase">
                        {a.targetType}
                    </span>
                    <span class="text-foreground flex-1 truncate">{a.targetLabel ?? a.targetId}</span>
                    <button
                        type="button"
                        class="text-muted-foreground hover:text-destructive transition-colors"
                        onclick={() => handleRemove(a.id)}
                        title={m.common_remove()}
                    >
                        <X size={14} />
                    </button>
                </div>
            {/each}
        </div>
    {/if}

    <!-- Add assignment -->
    <form class="flex items-center gap-2" onsubmit={(e) => { e.preventDefault(); handleAssign(); }}>
        <Select bind:value={targetType} size="sm">
            <option value="user">{m.channel_assignmentUser()}</option>
            <option value="session">{m.channel_assignmentSession()}</option>
        </Select>
        <input
            type="text"
            class="flex-1 bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="{targetType === 'user' ? m.channel_assignmentUser() : m.channel_assignmentSession()} ID"
            bind:value={targetId}
        />
        <Button
            type="submit"
            variant="primary"
            size="icon"
            loading={adding}
            disabled={!targetId.trim()}
            title={m.channel_assign()}
            aria-label={m.channel_assign()}
        >
            {#snippet icon()}<UserPlus size={14} />{/snippet}
        </Button>
    </form>
</div>
