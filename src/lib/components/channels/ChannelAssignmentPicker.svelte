<script lang="ts">
    import { onMount } from 'svelte';
    import type { ChannelAssignment } from '$lib/types/channels';
    import { fetchChannelAssignments, assignChannel, unassignChannel } from '$lib/state/channels';
    import { X, UserPlus } from 'lucide-svelte';

    interface Props {
        serverId: string;
        channelId: string;
    }

    let { serverId, channelId }: Props = $props();

    let assignments = $state<ChannelAssignment[]>([]);
    let loading = $state(false);
    let targetType = $state<'user' | 'session'>('user');
    let targetId = $state('');
    let adding = $state(false);

    async function load() {
        loading = true;
        try {
            assignments = await fetchChannelAssignments(serverId, channelId);
        } catch { /* ignore */ }
        loading = false;
    }

    onMount(load);

    async function handleAssign() {
        if (!targetId.trim()) return;
        adding = true;
        try {
            await assignChannel(serverId, channelId, targetType, targetId.trim());
            targetId = '';
            await load();
        } catch { /* ignore */ }
        adding = false;
    }

    async function handleRemove(assignmentId: string) {
        await unassignChannel(serverId, channelId, assignmentId);
        await load();
    }
</script>

<div class="space-y-3">
    <h3 class="text-xs font-semibold text-foreground uppercase tracking-wider">Assignments</h3>

    {#if loading}
        <p class="text-xs text-muted-foreground">Loading...</p>
    {:else if assignments.length === 0}
        <p class="text-xs text-muted-foreground italic">No assignments yet.</p>
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
                        title="Remove"
                    >
                        <X size={14} />
                    </button>
                </div>
            {/each}
        </div>
    {/if}

    <!-- Add assignment -->
    <form class="flex items-center gap-2" onsubmit={(e) => { e.preventDefault(); handleAssign(); }}>
        <select
            class="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
            bind:value={targetType}
        >
            <option value="user">User</option>
            <option value="session">Session</option>
        </select>
        <input
            type="text"
            class="flex-1 bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="{targetType === 'user' ? 'User' : 'Session'} ID"
            bind:value={targetId}
        />
        <button
            type="submit"
            class="p-1.5 rounded-md bg-accent text-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
            disabled={adding || !targetId.trim()}
            title="Assign"
        >
            <UserPlus size={14} />
        </button>
    </form>
</div>
