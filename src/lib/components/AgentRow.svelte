<script lang="ts">
    import { Spring, spring } from "svelte/motion";
    import Sparkline from "./Sparkline.svelte";
    import StatusDot from "$lib/components/decorations/StatusDot.svelte";
    import { agentActivity, agentChat } from "$lib/state/chat.svelte";
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

    const statusText = $derived.by(() => {
        if (act?.working) return m.agent_statusWorking();
        if (activeSessions.length > 0)
            return m.agent_statusActive({ count: activeSessions.length });
        if (chat?.loading) return m.agent_statusLoading();
        return m.agent_statusIdle();
    });

    const hasActive = $derived(act?.working || activeSessions.length > 0);

    // Spring for scale pop-in/out when hasActive changes
    const hammerScale = new Spring(0, { stiffness: 0.6, damping: 0.4 });
    $effect(() => {
        hammerScale.target = hasActive ? 1 : 0;
    });

    // Store-based spring for looping rotation — .set() returns a Promise
    // so we can await settle then reverse direction indefinitely
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
    <!-- Tooltip trigger wraps the compact row -->
    <span
        {...tip.getTriggerProps() as Record<string, unknown>}
        class="contents"
    >
        <button
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
    </span>

    {#if tip.open}
        <div {...tip.getPositionerProps()} style="position:fixed;z-index:9999;">
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
        class="w-full flex flex-col px-2.5 py-1.5 gap-1 border-l-3 border-b border-b-[rgba(42,53,72,0.5)] cursor-pointer transition-[background] duration-120 hover:bg-white/3 bg-transparent text-inherit {selected
            ? 'bg-bg3'
            : 'border-l-transparent'}"
        style:border-left-color={selected ? accentColor : undefined}
        title={statusText}
        {onclick}
    >
        <!-- Row 1: status indicator + agent name -->
        <div class="flex items-center gap-2">
            {#if hasActive}
                <!-- Single span: scale from hammerScale spring, rotate from rot spring -->
                <span
                    class="text-[11px] leading-none shrink-0 inline-block"
                    style:transform="scale({hammerScale.current}) rotate({$rot}deg)"
                    style:transform-origin="bottom right">🔨</span
                >
            {:else}
                <StatusDot status="idle" size="sm" />
            {/if}

            <!-- Agent avatar + name -->
            <span
                class="text-[13px] font-semibold text-foreground whitespace-nowrap shrink-0 flex items-center gap-1.5"
            >
                {#if agent.emoji}
                    <span class="leading-none">{agent.emoji}</span>
                {:else}
                    <img
                        src={diceBearAvatarUrl(agent.name ?? agent.id)}
                        alt=""
                        class="w-5 h-5 rounded-full inline-block shrink-0"
                    />
                {/if}
                {agent.name ?? agent.id}
            </span>
        </div>

        <!-- Row 2: sparkline full width -->
        <div class="w-full h-5">
            <Sparkline
                bins={act?.sparkBins ?? new Array(30).fill(0)}
                color={accentColor}
                glow={hasActive}
            />
        </div>
    </button>
{/if}
