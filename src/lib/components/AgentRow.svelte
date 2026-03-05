<script lang="ts">
    import { Spring, spring } from "svelte/motion";
    import EChartsSparkline from "./EChartsSparkline.svelte";
    import { sparklineStyle } from "$lib/state/sparkline-style.svelte";
    import StatusDot from "$lib/components/decorations/StatusDot.svelte";
    import { agentActivity, agentChat, SPARK_BIN_COUNT, SPARK_BIN_MS } from "$lib/state/chat.svelte";
    import { ui } from "$lib/state/ui.svelte";
    import { gw } from "$lib/state/gateway-data.svelte";
    import type { Agent } from "$lib/types/gateway";
    import { diceBearAvatarUrl } from "$lib/utils/avatar";
    import * as m from "$lib/paraglide/messages";
    import * as tooltip from "@zag-js/tooltip";
    import { normalizeProps, useMachine } from "@zag-js/svelte";

    let {
        agent,
        selected,
        accentColor,
        onclick,
        compact = false,
    }: {
        agent: Agent;
        selected: boolean;
        accentColor: string;
        onclick: () => void;
        compact?: boolean;
    } = $props();

    const act = $derived(agentActivity[agent.id]);
    const chat = $derived(agentChat[agent.id]);

    const activeSessions = $derived(
        gw.sessions.filter((s) => {
            const sk = (s as { sessionKey?: string }).sessionKey ?? "";
            const status = ui.sessionStatus[sk];
            return (
                sk.includes(`agent:${agent.id}:`) &&
                (status === "running" || status === "thinking")
            );
        }),
    );

    const hasActive = $derived(act?.working || activeSessions.length > 0);

    const statusLabel = $derived.by(() => {
        if (act?.working) return "Working";
        if (activeSessions.length > 0) return "Active";
        if (chat?.loading) return "Loading";
        return "Idle";
    });

    const statusText = $derived.by(() => {
        if (act?.working) return m.agent_statusWorking();
        if (activeSessions.length > 0)
            return m.agent_statusActive({ count: activeSessions.length });
        if (chat?.loading) return m.agent_statusLoading();
        return m.agent_statusIdle();
    });

    const rotatedBins = $derived.by(() => {
        const raw = act?.sparkBins ?? new Array(SPARK_BIN_COUNT).fill(0);
        const currentBinIdx = Math.floor(Date.now() / SPARK_BIN_MS) % SPARK_BIN_COUNT;
        const start = (currentBinIdx + 1) % SPARK_BIN_COUNT;
        return [...raw.slice(start), ...raw.slice(0, start)];
    });

    // Spring for scale pop-in/out when hasActive changes
    const hammerScale = new Spring(0, { stiffness: 0.6, damping: 0.4 });
    $effect(() => {
        hammerScale.target = hasActive ? 1 : 0;
    });

    // Store-based spring for looping rotation — .set() returns a Promise
    const rot = spring(0, { stiffness: 0.06, damping: 0.3 });

    $effect(() => {
        if (!hasActive) {
            rot.set(0, { hard: true });
            return;
        }

        let cancelled = false;

        async function loop() {
            while (!cancelled) {
                await rot.set(25);
                if (cancelled) break;
                await rot.set(0);
            }
        }

        loop();

        return () => {
            cancelled = true;
            rot.set(0, { hard: true });
        };
    });

    // Instant tooltip for compact mode
    const tipService = useMachine(tooltip.machine, () => ({
        id: `tip-${agent.id}`,
        openDelay: 0,
        closeDelay: 0,
        positioning: {
            placement: "right" as const,
            strategy: "fixed" as const,
        },
    }));
    const tip = $derived(tooltip.connect(tipService, normalizeProps));
</script>

{#if compact}
    <button
        {...tip.getTriggerProps() as Record<string, unknown>}
        type="button"
        class="w-full flex flex-col items-center justify-center py-2 px-1 border-l-3 border-b border-b-[rgba(42,53,72,0.5)] cursor-pointer transition-[background] duration-120 hover:bg-white/3 bg-transparent text-inherit {selected
            ? 'bg-bg3'
            : 'border-l-transparent'}"
        style:border-left-color={selected ? accentColor : undefined}
        {onclick}
    >
            {#if agent.emoji}
                <span class="text-base leading-none">{agent.emoji}</span>
            {:else}
                <img
                    src={diceBearAvatarUrl(agent.name ?? agent.id)}
                    alt=""
                    class="w-6 h-6 rounded-full"
                />
            {/if}
            <div class="mt-1">
                {#if hasActive}
                    <span
                        class="text-[9px] leading-none inline-block"
                        style:transform="scale({hammerScale.current}) rotate({$rot}deg)"
                        style:transform-origin="bottom right">🔨</span
                    >
                {:else}
                    <StatusDot status="idle" size="sm" />
                {/if}
            </div>
        </button>

    {#if tip.open}
        <div {...tip.getPositionerProps()} class="!z-[9999]">
            <div
                {...tip.getContentProps()}
                class="bg-bg2 border border-border rounded px-2.5 py-1.5 shadow-lg whitespace-nowrap"
            >
                <div class="text-xs font-semibold text-foreground">
                    {agent.name ?? agent.id}
                </div>
                <div class="text-[10px] text-muted mt-0.5">{statusText}</div>
            </div>
        </div>
    {/if}
{:else}
    <!-- Full row -->
    <button
        type="button"
        class="w-full flex flex-col px-2.5 py-1.5 gap-1.5 border-l-3 border-b border-b-[rgba(42,53,72,0.5)] cursor-pointer transition-[background] duration-120 hover:bg-white/3 bg-transparent text-inherit {selected
            ? 'bg-bg3'
            : 'border-l-transparent'}"
        style:border-left-color={selected ? accentColor : undefined}
        title={statusText}
        {onclick}
    >
        <!-- Row 1: status indicator + agent name -->
        <div class="flex items-center gap-2 min-w-0">
            {#if hasActive}
                <span
                    class="text-[11px] leading-none shrink-0 inline-block"
                    style:transform="scale({hammerScale.current}) rotate({$rot}deg)"
                    style:transform-origin="bottom right">🔨</span
                >
            {:else}
                <StatusDot status="idle" size="sm" />
            {/if}

            <span class="flex items-center gap-1.5 min-w-0 overflow-hidden">
                {#if agent.emoji}
                    <span class="leading-none shrink-0 text-[13px]">{agent.emoji}</span>
                {:else}
                    <img
                        src={diceBearAvatarUrl(agent.name ?? agent.id)}
                        alt=""
                        class="w-5 h-5 rounded-full inline-block shrink-0"
                    />
                {/if}
                <span class="text-[13px] font-semibold text-foreground truncate">{agent.name ?? agent.id}</span>
            </span>
        </div>

        <!-- Row 2: 2-column — left KPIs + right activity chart -->
        <div class="flex items-end gap-2">

            <!-- Left: textual status KPIs (~56px) -->
            <div class="flex flex-col gap-0.5 w-14 shrink-0">
                <!-- Status dot + label -->
                <div class="flex items-center gap-1">
                    <div
                        class="w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-200"
                        style:background-color={hasActive
                            ? "var(--color-success)"
                            : chat?.loading
                              ? "var(--color-accent)"
                              : "var(--color-border)"}
                    ></div>
                    <span
                        class="text-[10px] font-medium leading-none truncate transition-colors duration-200"
                        style:color={hasActive
                            ? "var(--color-success)"
                            : chat?.loading
                              ? "var(--color-accent)"
                              : "var(--color-muted-foreground)"}
                    >
                        {statusLabel}
                    </span>
                </div>

                <!-- Sub-label: session count or gateway status -->
                {#if activeSessions.length > 0}
                    <span class="text-[9px] text-muted-foreground/50 pl-2.5 leading-none">
                        {activeSessions.length}
                        {activeSessions.length === 1 ? "session" : "sessions"}
                    </span>
                {:else if agent.status}
                    <span class="text-[9px] text-muted-foreground/50 pl-2.5 leading-none truncate" title={agent.status}>
                        {agent.status}
                    </span>
                {/if}
            </div>

            <!-- Right: ECharts sparkline (flex-1) -->
            <div class="flex-1 h-5">
                <EChartsSparkline
                    bins={rotatedBins}
                    color={accentColor}
                    glow={hasActive}
                    chartStyle={sparklineStyle.current}
                />
            </div>
        </div>
    </button>
{/if}
