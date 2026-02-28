<script lang="ts">
    import { conn } from "$lib/state/connection.svelte";
    import {
        Palette,
        SlidersHorizontal,
        Users,
        Link2,
        Server,
    } from "lucide-svelte";

    type Section =
        | "appearance"
        | "config"
        | "team"
        | "bindings"
        | "gateways";

    interface Props {
        activeSection: Section;
        onselect: (s: Section) => void;
    }

    let { activeSection, onselect }: Props = $props();

    const USER_SECTIONS = [
        { id: "appearance" as Section, label: "Appearance", icon: Palette },
    ];

    const GATEWAY_SECTIONS = [
        {
            id: "config" as Section,
            label: "Config",
            icon: SlidersHorizontal,
        },
        { id: "team" as Section, label: "Team", icon: Users },
        { id: "bindings" as Section, label: "Bindings", icon: Link2 },
        { id: "gateways" as Section, label: "Gateways", icon: Server },
    ];
</script>

<aside
    class="shrink-0 w-48 border-r border-border bg-bg/50 flex flex-col overflow-y-auto py-4"
>
    <!-- USER group -->
    <div class="mb-4">
        <div
            class="px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60"
        >
            User
        </div>
        {#each USER_SECTIONS as section (section.id)}
            <button
                type="button"
                class="w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-100 cursor-pointer bg-transparent border-none font-[inherit] text-left
                    {activeSection === section.id
                    ? 'text-accent bg-accent/8 font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-bg3'}"
                onclick={() => onselect(section.id)}
            >
                <section.icon
                    size={15}
                    class={activeSection === section.id
                        ? "text-accent"
                        : "text-muted-foreground/70"}
                />
                {section.label}
            </button>
        {/each}
    </div>

    <!-- Divider -->
    <div class="h-px bg-border/60 mx-4 mb-4"></div>

    <!-- GATEWAY group -->
    <div>
        <div
            class="px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60"
        >
            Gateway
        </div>
        {#each GATEWAY_SECTIONS as section (section.id)}
            <button
                type="button"
                class="w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-100 cursor-pointer bg-transparent border-none font-[inherit] text-left
                    {activeSection === section.id
                    ? 'text-accent bg-accent/8 font-medium'
                    : conn.connected
                      ? 'text-muted-foreground hover:text-foreground hover:bg-bg3'
                      : 'text-muted-foreground/40 cursor-not-allowed'}"
                onclick={() => conn.connected && onselect(section.id)}
                title={!conn.connected
                    ? "Connect to a gateway first"
                    : undefined}
            >
                <section.icon
                    size={15}
                    class={activeSection === section.id
                        ? "text-accent"
                        : conn.connected
                          ? "text-muted-foreground/70"
                          : "text-muted-foreground/30"}
                />
                {section.label}
                {#if !conn.connected}
                    <span
                        class="ml-auto text-[9px] text-muted-foreground/40"
                        >—</span
                    >
                {/if}
            </button>
        {/each}
    </div>
</aside>
