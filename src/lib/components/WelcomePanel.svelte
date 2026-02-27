<script lang="ts">
    import { conn } from "$lib/state/connection.svelte";
    import { gw } from "$lib/state/gateway-data.svelte";
    import { ui } from "$lib/state/ui.svelte";
    import { hostsState } from "$lib/state/hosts.svelte";
    import MinionLogo from "./MinionLogo.svelte";
    import {
        Plus,
        Store,
        Activity,
        Users,
        Zap,
        Plug,
        Server,
    } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";

    const hasAgents = $derived(gw.agents.length > 0);
    const hasHosts = $derived(hostsState.hosts.length > 0);

    const quickActions = $derived([
        {
            icon: Plus,
            label: m.agent_add(),
            description: m.welcome_actionAddAgentDesc(),
            action: () => (ui.agentAddOpen = true),
            primary: true,
        },
        {
            icon: Store,
            label: m.nav_marketplace(),
            description: m.welcome_actionMarketplaceDesc(),
            href: "/marketplace",
            primary: false,
        },
        {
            icon: Users,
            label: m.nav_users(),
            description: m.welcome_actionUsersDesc(),
            href: "/users",
            primary: false,
        },
        {
            icon: Activity,
            label: m.nav_reliability(),
            description: m.welcome_actionReliabilityDesc(),
            href: "/reliability",
            primary: false,
        },
    ]);

    const connectionSteps = $derived([
        { label: m.welcome_step1(), done: hasHosts },
        { label: m.welcome_step2(), done: conn.connected },
        { label: m.welcome_step3(), done: hasAgents },
    ]);
</script>

<div
    class="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden"
>
    <!-- Background decoration -->
    <div class="absolute inset-0 pointer-events-none">
        <div
            class="absolute top-1/4 left-1/4 w-64 h-64 bg-accent/5 rounded-full blur-3xl"
        ></div>
        <div
            class="absolute bottom-1/4 right-1/4 w-96 h-96 bg-brand-pink/5 rounded-full blur-3xl"
        ></div>
    </div>

    <div class="relative z-10 max-w-2xl w-full text-center space-y-8">
        <!-- Logo and welcome -->
        <div class="space-y-4">
            <div class="flex justify-center">
                <MinionLogo size="lg" />
            </div>
            <div>
                <h1 class="text-2xl font-bold text-foreground mb-2">
                    {m.welcome_heading()}
                </h1>
                <p class="text-muted-foreground max-w-md mx-auto">
                    {m.welcome_subtitle()}
                </p>
            </div>
        </div>

        <!-- Connection status card -->
        <div
            class="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-6 max-w-md mx-auto"
        >
            <div class="flex items-center gap-3 mb-4">
                <div
                    class="w-10 h-10 rounded-lg bg-bg3 flex items-center justify-center"
                >
                    <Server
                        size={20}
                        class={conn.connected
                            ? "text-success"
                            : "text-muted-foreground"}
                    />
                </div>
                <div class="text-left">
                    <div class="font-semibold text-foreground">
                        {conn.connected
                            ? m.welcome_connectedStatus()
                            : m.welcome_notConnected()}
                    </div>
                    <div class="text-xs text-muted-foreground">
                        {#if conn.connected}
                            {hostsState.hosts.find(
                                (h) => h.id === hostsState.activeHostId,
                            )?.name ?? "Unknown host"}
                        {:else if conn.connecting}
                            {m.conn_connecting()}
                        {:else}
                            {m.welcome_addHost()}
                        {/if}
                    </div>
                </div>
                {#if !conn.connected}
                    <button
                        class="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                        onclick={() => (ui.overlayOpen = true)}
                    >
                        <Plug size={12} />
                        {m.hosts_connect()}
                    </button>
                {/if}
            </div>

            <!-- Progress steps -->
            <div class="space-y-2">
                {#each connectionSteps as step, i}
                    <div class="flex items-center gap-3 text-sm">
                        <div
                            class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
              {step.done
                                ? 'bg-success/20 text-success'
                                : 'bg-bg3 text-muted-foreground'}"
                        >
                            {#if step.done}
                                ✓
                            {:else}
                                {i + 1}
                            {/if}
                        </div>
                        <span
                            class={step.done
                                ? "text-foreground"
                                : "text-muted-foreground"}
                        >
                            {step.label}
                        </span>
                    </div>
                {/each}
            </div>
        </div>

        <!-- Quick actions grid -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto">
            {#each quickActions as action}
                {#if action.href}
                    <a
                        href={action.href}
                        class="group flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200
              {action.primary
                            ? 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20'
                            : 'bg-card border-border text-foreground hover:border-muted-foreground hover:bg-bg3'}"
                    >
                        <action.icon
                            size={20}
                            class={action.primary
                                ? "text-accent"
                                : "text-muted-foreground group-hover:text-foreground"}
                        />
                        <span class="text-xs font-medium">{action.label}</span>
                    </a>
                {:else}
                    <button
                        onclick={action.action}
                        class="group flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200
              {action.primary
                            ? 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20'
                            : 'bg-card border-border text-foreground hover:border-muted-foreground hover:bg-bg3'}"
                    >
                        <action.icon
                            size={20}
                            class={action.primary
                                ? "text-accent"
                                : "text-muted-foreground group-hover:text-foreground"}
                        />
                        <span class="text-xs font-medium">{action.label}</span>
                    </button>
                {/if}
            {/each}
        </div>

        <!-- Tip -->
        <div
            class="flex items-center justify-center gap-2 text-xs text-muted-foreground"
        >
            <Zap size={12} class="text-warning" />
            <span>{m.welcome_tip()}</span>
        </div>
    </div>
</div>
