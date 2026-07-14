<script lang="ts">
    import { Spring, spring } from "svelte/motion";
    import EChartsSparkline from "$lib/components/charts/EChartsSparkline.svelte";
    import { sparklineStyle } from "$lib/state/ui/sparkline-style.svelte";
    import StatusDot from "$lib/components/decorations/StatusDot.svelte";
    import { agentActivity, agentChat, SPARK_BIN_COUNT, SPARK_BIN_MS } from "$lib/state/chat/chat.svelte";
    import { ui } from "$lib/state/ui/ui.svelte";
    import { gw } from "$lib/state/gateway/gateway-data.svelte";
    import type { Agent } from "@minion-stack/shared";
    import { agentDisplayName, agentAvatarUrl } from "$lib/utils/agent-display";
    import * as m from "$lib/paraglide/messages";
    import { Tooltip, Button } from '$lib/components/ui';

    let {
        agent,
        selected,
        accentColor,
        onclick,
        compact = false,
        groupId = null,
    }: {
        agent: Agent;
        selected: boolean;
        accentColor: string;
        onclick: () => void;
        compact?: boolean;
        groupId?: string | null;
    } = $props();

    let dragging = $state(false);

    function handleDragStart(e: DragEvent) {
        dragging = true;
        e.dataTransfer?.setData(
            'application/agent-move',
            JSON.stringify({ agentId: agent.id, fromGroupId: groupId }),
        );
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    }

    function handleDragEnd() {
        dragging = false;
    }

    function handleClick() {
        if (!dragging) onclick();
    }

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
        if (act?.working) return m.agent_statusWorking();
        if (activeSessions.length > 0) return m.agent_statusActive({ count: activeSessions.length });
        if (chat?.loading) return m.agent_statusLoading();
        return m.agent_statusIdle();
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

</script>

{#if compact}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div draggable="true" ondragstart={handleDragStart} ondragend={handleDragEnd} role="listitem">
    <Tooltip id={`tip-${agent.id}`} placement="right" openDelay={0}>
    <Button variant="ghost"
        type="button"
        class="w-full flex flex-col items-center justify-center py-2 px-1 border-l-3 border-b border-b-[color-mix(in srgb, var(--color-surface-3) 50%, transparent)] cursor-pointer transition-[background] duration-[var(--duration-fast)] hover:bg-[var(--color-text-primary)]/3 bg-transparent text-inherit {selected
            ? 'bg-bg3'
            : 'border-l-transparent'}"
        style={selected ? `border-left-color: ${accentColor}` : undefined}
        onclick={handleClick}
    >
            {#if agent.emoji}
                <span class="text-base leading-none">{agent.emoji}</span>
            {:else}
                <img
                    src={agentAvatarUrl(agent.id)}
                    alt=""
                    class="w-6 h-6 rounded-full"
                />
            {/if}
            <div class="mt-1">
                {#if hasActive}
                    <span
                        class="text-[length:var(--font-size-telemetry)] leading-none inline-block"
                        style:transform="scale({hammerScale.current}) rotate({$rot}deg)"
                        style:transform-origin="bottom right">🔨</span
                    >
                {:else}
                    <StatusDot status="idle" size="sm" />
                {/if}
            </div>
        </Button>
        {#snippet content()}
            <div class="text-xs font-semibold text-foreground">
                {agentDisplayName(agent)}
            </div>
            <div class="text-[length:var(--font-size-telemetry)] text-muted mt-0.5">{statusText}</div>
        {/snippet}
    </Tooltip>
    </div>
{:else}
    <!-- Compact full row: single line — status dot + avatar + name + sparkline -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div draggable="true" ondragstart={handleDragStart} ondragend={handleDragEnd} role="listitem">
    <Button variant="ghost"
        type="button"
        class="group w-full h-8 flex items-center gap-2 px-2.5 border-l-2 cursor-pointer transition-[background] duration-[var(--duration-fast)] hover:bg-[var(--color-text-primary)]/3 bg-transparent text-inherit {selected
            ? 'bg-bg3'
            : 'border-l-transparent'}"
        style={selected ? `border-left-color: ${accentColor}` : undefined}
        title={statusText}
        onclick={handleClick}
    >
        <!-- Status indicator (hammer when active, dot when idle) -->
        <span class="shrink-0 flex items-center justify-center w-3">
            {#if hasActive}
                <span
                    class="text-[length:var(--font-size-caption)] leading-none inline-block"
                    style:transform="scale({hammerScale.current}) rotate({$rot}deg)"
                    style:transform-origin="bottom right">🔨</span
                >
            {:else}
                <span
                    class="w-1.5 h-1.5 rounded-full transition-colors duration-[var(--duration-normal)]"
                    style:background-color={chat?.loading
                        ? "var(--color-accent)"
                        : "var(--color-border)"}
                ></span>
            {/if}
        </span>

        <!-- Avatar -->
        {#if agent.emoji}
            <span class="leading-none shrink-0 text-[length:var(--font-size-body)]">{agent.emoji}</span>
        {:else}
            <img
                src={agentAvatarUrl(agent.id)}
                alt=""
                class="w-5 h-5 rounded-full shrink-0"
            />
        {/if}

        <!-- Name -->
        <span class="text-[length:var(--font-size-body)] font-medium text-foreground truncate flex-1 text-left">{agentDisplayName(agent)}</span>

        <!-- Sparkline: only takes layout space when active or hovered, so the
             agent name renders in full width otherwise. Toggling `display`
             (not opacity) is what frees the reserved width. -->
        <div
            class="w-12 h-4 shrink-0 {hasActive
                ? 'block opacity-100'
                : 'hidden group-hover:block opacity-60'}"
        >
            <EChartsSparkline
                bins={rotatedBins}
                color={accentColor}
                glow={hasActive}
                chartStyle={sparklineStyle.current}
            />
        </div>

        <!-- Active session badge -->
        {#if activeSessions.length > 0}
            <span class="text-[length:var(--font-size-telemetry)] tabular-nums text-success font-semibold shrink-0">
                {activeSessions.length}
            </span>
        {/if}
    </Button>
    </div>
{/if}
