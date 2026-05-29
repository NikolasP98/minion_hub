<script lang="ts">
    import { gw, visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
    import { conn } from '$lib/state/gateway/connection.svelte';
    import { ui } from '$lib/state/ui/ui.svelte';
    import { reliability } from '$lib/state/reliability/reliability.svelte';
    import { fmtTokens, fmtUptime } from '$lib/utils/format';
    import CornerAccent from '$lib/components/decorations/CornerAccent.svelte';
    import * as m from '$lib/paraglide/messages';

    const agents = $derived(visibleAgents.value);

    const activeAgentCount = $derived(
        agents.filter((a) => a.status === 'running' || a.status === 'thinking').length,
    );

    const totalAgentCount = $derived(agents.length);

    const sessionsToday = $derived.by(() => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const ts = todayStart.getTime();
        return gw.sessions.filter((s) => (s.createdAt ?? s.updatedAt ?? 0) >= ts).length;
    });

    const errorRate = $derived.by(() => {
        const summary = reliability.summary;
        if (!summary || summary.total === 0) return '0%';
        const errors = summary.bySeverity?.['error'] ?? 0;
        const pct = ((errors / summary.total) * 100).toFixed(1);
        return `${pct}%`;
    });

    const uptimeStr = $derived.by(() => {
        const snap = gw.hello?.snapshot;
        if (!snap?.uptimeMs) return '-';
        return fmtUptime(snap.uptimeMs);
    });

    interface MetricCard {
        label: string;
        value: string;
        color: string;
        icon: string;
    }

    const cards: MetricCard[] = $derived([
        {
            label: m.dashboard_activeAgents(),
            value: conn.connected ? `${activeAgentCount}/${totalAgentCount}` : '-',
            color: '--color-accent',
            icon: '\u{1F916}',
        },
        {
            label: m.dashboard_sessionsToday(),
            value: conn.connected ? String(sessionsToday) : '-',
            color: '--color-accent',
            icon: '\u{1F4AC}',
        },
        {
            label: m.dashboard_totalSessions(),
            value: conn.connected ? String(gw.sessions.length) : '-',
            color: '--color-accent',
            icon: '\u{1F4CA}',
        },
        {
            label: m.dashboard_errorRate(),
            value: conn.connected ? errorRate : '-',
            color: '--color-destructive',
            icon: '\u{26A0}\u{FE0F}',
        },
        {
            label: m.dashboard_uptime(),
            value: conn.connected ? uptimeStr : '-',
            color: '--color-success',
            icon: '\u{23F1}\u{FE0F}',
        },
    ]);
</script>

<div class="flex gap-3 overflow-x-auto pb-1">
    {#each cards as card (card.label)}
        <div
            class="relative bg-card border border-border rounded-lg min-w-40 p-0 overflow-hidden flex transition-shadow duration-300 hover:shadow-[0_0_12px_var(--color-accent)]/10"
            style:--kpi-color="var({card.color})"
        >
            <CornerAccent position="top-right" />
            <div class="w-1 shrink-0 border-l-4 rounded-l-lg" style:border-left-color="var({card.color})"></div>
            <div class="p-4 flex flex-col gap-2 flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                    <span class="text-sm leading-none">{card.icon}</span>
                    <span class="text-xs text-muted font-medium tracking-wide uppercase whitespace-nowrap overflow-hidden text-ellipsis">
                        {card.label}
                    </span>
                </div>
                <div class="text-2xl font-bold text-foreground leading-tight">
                    {card.value}
                </div>
            </div>
        </div>
    {/each}
</div>
