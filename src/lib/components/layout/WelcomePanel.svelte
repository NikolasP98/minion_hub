<script lang="ts">
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { ui } from "$lib/state/ui/ui.svelte";
    import { hostsState } from "$lib/state/features/hosts.svelte";
    import MinionLogo from "./MinionLogo.svelte";
    import { Plus, Zap, Plug, Server } from "lucide-svelte";
    import * as m from "$lib/paraglide/messages";
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
            <div class="flex items-center gap-3">
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
        </div>

        <!-- Primary action: add an agent -->
        <div class="flex justify-center">
            <button
                onclick={() => (ui.agentAddOpen = true)}
                class="group flex flex-col items-center gap-2 p-4 w-40 rounded-xl border transition-all duration-200 bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
            >
                <Plus size={20} class="text-accent" />
                <span class="text-xs font-medium">{m.agent_add()}</span>
            </button>
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
