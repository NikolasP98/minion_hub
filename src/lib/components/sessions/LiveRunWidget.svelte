<script lang="ts">
  import { Button } from '$lib/components/ui';
    import { gw, visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
    import { conn } from '$lib/state/gateway/connection.svelte';
    import { ui } from '$lib/state/ui/ui.svelte';
    import { agentActivity } from '$lib/state/chat/chat.svelte';
    import { fmtTokens } from '$lib/utils/format';
    import StatusBadge from '$lib/components/agents/StatusBadge.svelte';
    import { ChevronDown, ChevronUp, Zap } from 'lucide-svelte';
    import * as m from '$lib/paraglide/messages';

    let collapsed = $state(false);

    interface ActiveRun {
        agentId: string;
        agentName: string;
        status: 'running' | 'thinking' | 'idle' | 'error' | 'paused';
        sessionKey: string | null;
        elapsedMs: number;
    }

    // Tick every second for live timer
    let now = $state(Date.now());
    let interval: ReturnType<typeof setInterval> | undefined;

    $effect(() => {
        interval = setInterval(() => { now = Date.now(); }, 1000);
        return () => clearInterval(interval);
    });

    const activeRuns: ActiveRun[] = $derived.by(() => {
        if (!conn.connected) return [];

        return visibleAgents.value
            .filter((a) => a.status === 'running' || a.status === 'thinking')
            .map((a) => {
                const activity = agentActivity[a.id];
                const lastEvent = activity?.lastEventAt ?? now;
                return {
                    agentId: a.id,
                    agentName: a.name ?? a.id,
                    status: (a.status ?? 'idle') as ActiveRun['status'],
                    sessionKey: ui.selectedSessionKey,
                    elapsedMs: now - lastEvent,
                };
            });
    });

    const hasActiveRuns = $derived(activeRuns.length > 0);

    function fmtElapsed(ms: number): string {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`;
        return `${sec}s`;
    }
</script>

{#if hasActiveRuns}
    <div class="fixed bottom-0 left-0 right-0 z-[var(--layer-modal)] border-t border-border bg-bg2/95 backdrop-blur-md transition-all duration-[var(--duration-fast)]">
        <!-- Header bar (always visible) -->
        <Button
            variant="ghost"
            class="!h-auto !w-full !justify-between !px-4 !py-2"
            onclick={() => { collapsed = !collapsed; }}
            aria-expanded={!collapsed}
            aria-controls="live-runs-panel"
        >
            <span class="flex items-center gap-2">
                <Zap size={14} class="text-accent animate-pulse" />
                <span class="text-xs font-semibold text-foreground">
                    {activeRuns.length === 1 ? m.session_activeRunSingular({ count: activeRuns.length }) : m.session_activeRunPlural({ count: activeRuns.length })}
                </span>
            </span>
            <span class="flex items-center gap-2 text-muted">
                {#if collapsed}
                    <ChevronUp size={14} />
                {:else}
                    <ChevronDown size={14} />
                {/if}
            </span>
        </Button>

        <!-- Expanded content -->
        {#if !collapsed}
            <div id="live-runs-panel" class="px-4 pb-3 flex flex-wrap gap-3">
                {#each activeRuns as run (run.agentId)}
                    <div class="surface-2 flex items-center gap-3 rounded-lg px-3 py-2 min-w-56">
                        <StatusBadge status={run.status} size="sm" />
                        <div class="flex-1 min-w-0">
                            <div class="text-xs font-medium text-foreground truncate">
                                {run.agentName}
                            </div>
                            <div class="text-xs text-muted-foreground font-mono mt-0.5">
                                {run.status === 'thinking' ? m.session_statusThinking() : m.session_statusProcessing()}
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <div class="text-xs font-mono text-accent tabular-nums">
                                {fmtElapsed(run.elapsedMs)}
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{/if}
