<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Activity, FileText, Wrench, ArrowRight } from 'lucide-svelte';
    import EChartsSparkline from '$lib/components/charts/EChartsSparkline.svelte';
    import { sparklineStyle } from '$lib/state/ui/sparkline-style.svelte';
    import { agentActivity, agentChat, SPARK_BIN_COUNT, SPARK_BIN_MS } from '$lib/state/chat/chat.svelte';
    import { gw } from '$lib/state/gateway/gateway-data.svelte';
    import { ui } from '$lib/state/ui/ui.svelte';
    import { reliability } from '$lib/state/reliability/reliability.svelte';
    import { agentToolsState, loadAgentTools } from '$lib/state/agents/agent-tools.svelte';
    import { agentSkillsState, loadAgentSkills } from '$lib/state/agents/agent-skills.svelte';
    import { sendRequest } from '$lib/services/gateway.svelte';
    import { conn } from '$lib/state/gateway/connection.svelte';
    import type { Agent } from '@minion-stack/shared';
    import { agentDisplayName } from '$lib/utils/agent-display';

    let { agentId, agent }: { agentId: string; agent: Agent } = $props();

    // ─── Lazy-fetched counts (root-level only, fast) ─────────────────────────
    let fileCount = $state<number | null>(null);
    let fileError = $state(false);

    async function loadFileCount(id: string) {
        fileCount = null;
        fileError = false;
        try {
            const res = (await sendRequest('agents.files.list', { agentId: id })) as {
                files?: Array<{ name: string; isDir?: boolean; missing?: boolean }>;
            };
            // Count non-missing entries at root (dirs + files)
            fileCount = (res.files ?? []).filter((f) => !f.missing).length;
        } catch {
            fileError = true;
        }
    }

    $effect(() => {
        if (!conn.connected) return;
        loadAgentTools(agentId);
        loadAgentSkills(agentId);
        loadFileCount(agentId);
    });

    const toolsTotal = $derived(agentToolsState.tools.length);
    const toolsEnabled = $derived(agentToolsState.tools.filter((t) => t.enabled).length);
    const skillsTotal = $derived(agentSkillsState.skills.length);
    const skillsEnabled = $derived(
        agentSkillsState.skills.filter((s) => !s.disabled && s.agentEnabled !== false).length,
    );

    type AgentTab = typeof ui.activeAgentTab;

    const act = $derived(agentActivity[agentId]);
    const chat = $derived(agentChat[agentId]);

    // Activity card data
    const rotatedBins = $derived.by(() => {
        const raw = act?.sparkBins ?? new Array(SPARK_BIN_COUNT).fill(0);
        const currentBinIdx = Math.floor(Date.now() / SPARK_BIN_MS) % SPARK_BIN_COUNT;
        const start = (currentBinIdx + 1) % SPARK_BIN_COUNT;
        return [...raw.slice(start), ...raw.slice(0, start)];
    });

    const sessionsForAgent = $derived(
        gw.sessions.filter((s) => s.agentId === agentId || s.sessionKey?.includes(`agent:${agentId}:`))
    );
    const sessionsToday = $derived.by(() => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const ts = todayStart.getTime();
        return sessionsForAgent.filter((s) => (s.createdAt ?? s.updatedAt ?? 0) >= ts).length;
    });
    const activeCount = $derived(
        sessionsForAgent.filter((s) => {
            const status = ui.sessionStatus[s.sessionKey];
            return status === 'running' || status === 'thinking';
        }).length
    );
    const errorCount = $derived(reliability.summary?.bySeverity?.['error'] ?? 0);
    const recentSessions = $derived(
        [...sessionsForAgent]
            .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
            .slice(0, 3)
    );

    // Knowledge card data — best-effort from available state; falls back to dashes
    const chatMsgCount = $derived(chat?.messages?.length ?? 0);

    // Capabilities card data
    const totalSessions = $derived(sessionsForAgent.length);

    function go(tab: AgentTab) {
        ui.activeAgentTab = tab;
    }

    function fmtAgo(ts: number | null | undefined): string {
        if (!ts) return '—';
        const diff = Date.now() - ts;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'now';
        if (mins < 60) return `${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h`;
        return `${Math.floor(hrs / 24)}d`;
    }
</script>

<div class="flex-1 min-h-0 overflow-y-auto p-6 @container">
    <!-- Greeting strip -->
    <div class="mb-6 flex items-baseline justify-between gap-4">
        <div>
            <h1 class="text-lg font-semibold text-foreground">
                {agentDisplayName(agent) || agentId}
            </h1>
            <p class="text-xs text-muted-foreground mt-0.5">
                {activeCount > 0 ? `${activeCount} active session${activeCount === 1 ? '' : 's'}` : 'idle'} ·
                {totalSessions} total ·
                {errorCount} error{errorCount === 1 ? '' : 's'} today
            </p>
        </div>
        <Button variant="ghost"
            type="button"
            onclick={() => go('chat')}
            class="text-[length:var(--font-size-caption)] px-3 py-1.5 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
        >
            Open chat →
        </Button>
    </div>

    <!-- 3-card grid -->
    <div class="grid grid-cols-1 @[540px]:grid-cols-3 gap-4">
        <!-- Card 1: Activity -->
        <div
            role="button"
            tabindex="0"
            onclick={() => go('monitor')}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('monitor'); } }}
            class="group cursor-pointer text-left bg-card border border-border rounded-xl p-4 hover:border-accent/40 hover:bg-bg3 transition-all"
        >
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Activity size={13} />
                    Activity
                </div>
                <span class="text-[length:var(--font-size-telemetry)] text-muted-strong group-hover:text-accent transition-colors">
                    Monitor <ArrowRight size={10} class="inline" />
                </span>
            </div>

            <div class="h-10 mb-3 -mx-1">
                <EChartsSparkline bins={rotatedBins} color="var(--color-accent)" glow={activeCount > 0} chartStyle={sparklineStyle.current} />
            </div>

            <div class="text-[length:var(--font-size-caption)] text-muted-foreground mb-2 tabular-nums">
                <span class="text-foreground font-semibold">{activeCount}</span> active ·
                <span class="text-foreground font-semibold">{sessionsToday}</span> today ·
                <span class={errorCount > 0 ? 'text-destructive font-semibold' : 'text-foreground font-semibold'}>{errorCount}</span> errors
            </div>

            <div class="border-t border-border/60 pt-2 mt-2 space-y-1">
                {#if recentSessions.length === 0}
                    <div class="text-[length:var(--font-size-caption)] text-muted-strong italic">No sessions yet</div>
                {:else}
                    {#each recentSessions as s}
                        <div class="flex items-center justify-between gap-2 text-[length:var(--font-size-caption)]">
                            <span class="truncate text-foreground/80">{s.label || s.sessionKey?.split(':').pop() || 'session'}</span>
                            <span class="text-muted-strong tabular-nums shrink-0">{fmtAgo(s.updatedAt ?? s.createdAt)}</span>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>

        <!-- Card 2: Knowledge -->
        <div
            role="button"
            tabindex="0"
            onclick={() => go('files')}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('files'); } }}
            class="group cursor-pointer text-left bg-card border border-border rounded-xl p-4 hover:border-accent/40 hover:bg-bg3 transition-all"
        >
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <FileText size={13} />
                    Knowledge
                </div>
                <span class="text-[length:var(--font-size-telemetry)] text-muted-strong group-hover:text-accent transition-colors">
                    Files <ArrowRight size={10} class="inline" />
                </span>
            </div>

            <!-- Two-up stat row -->
            <div class="grid grid-cols-2 gap-3 mb-3">
                <div>
                    <div class="text-lg font-semibold text-foreground tabular-nums">
                        {fileError ? '—' : (fileCount ?? '·')}
                    </div>
                    <div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wider text-muted-foreground">Files</div>
                </div>
                <div>
                    <div class="text-lg font-semibold text-foreground tabular-nums">{chatMsgCount}</div>
                    <div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wider text-muted-foreground">Messages</div>
                </div>
            </div>

            <!-- Sub-links to memory + prompt -->
            <div class="border-t border-border/60 pt-2 mt-2 flex gap-3">
                <Button variant="ghost"
                    type="button"
                    onclick={(e) => { e.stopPropagation(); go('memory'); }}
                    class="text-[length:var(--font-size-caption)] text-muted-foreground hover:text-accent transition-colors"
                >
                    Memory →
                </Button>
                <Button variant="ghost"
                    type="button"
                    onclick={(e) => { e.stopPropagation(); go('prompt'); }}
                    class="text-[length:var(--font-size-caption)] text-muted-foreground hover:text-accent transition-colors"
                >
                    Prompt →
                </Button>
            </div>
        </div>

        <!-- Card 3: Capabilities -->
        <div
            role="button"
            tabindex="0"
            onclick={() => go('capabilities')}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('capabilities'); } }}
            class="group cursor-pointer text-left bg-card border border-border rounded-xl p-4 hover:border-accent/40 hover:bg-bg3 transition-all"
        >
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Wrench size={13} />
                    Capabilities
                </div>
                <span class="text-[length:var(--font-size-telemetry)] text-muted-strong group-hover:text-accent transition-colors">
                    Tools <ArrowRight size={10} class="inline" />
                </span>
            </div>

            <div class="grid grid-cols-2 gap-3 mb-3">
                <div>
                    <div class="text-lg font-semibold text-foreground tabular-nums">
                        {agentToolsState.loading && toolsTotal === 0 ? '·' : `${toolsEnabled}/${toolsTotal}`}
                    </div>
                    <div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wider text-muted-foreground">Tools</div>
                </div>
                <div>
                    <div class="text-lg font-semibold text-foreground tabular-nums">
                        {agentSkillsState.loading && skillsTotal === 0 ? '·' : `${skillsEnabled}/${skillsTotal}`}
                    </div>
                    <div class="text-[length:var(--font-size-telemetry)] uppercase tracking-wider text-muted-foreground">Skills</div>
                </div>
            </div>

            <!-- Pi-Agent status row -->
            <div class="border-t border-border/60 pt-2 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button variant="ghost"
                    type="button"
                    onclick={(e) => { e.stopPropagation(); go('capabilities'); }}
                    class="text-[length:var(--font-size-caption)] text-muted-foreground hover:text-accent transition-colors whitespace-nowrap"
                >
                    Capabilities →
                </Button>
                <span class="text-muted-strong">·</span>
                <Button variant="ghost"
                    type="button"
                    onclick={(e) => { e.stopPropagation(); go('orchestration'); }}
                    class="text-[length:var(--font-size-caption)] text-muted-foreground hover:text-accent transition-colors flex items-center gap-1.5 whitespace-nowrap"
                >
                    <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"></span>
                    Orchestration →
                </Button>
            </div>
        </div>
    </div>
</div>
