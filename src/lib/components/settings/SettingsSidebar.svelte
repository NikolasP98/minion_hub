<script lang="ts">
    import { conn } from "$lib/state/connection.svelte";
    import { META_GROUPS, getMetaGroupId } from "$lib/utils/config-schema";
    import {
        Palette,
        SlidersHorizontal,
        Brain,
        Zap,
        Database,
        Radio,
        Plug,
        Monitor,
        MoreHorizontal,
        Users,
        Link2,
        Server,
        Lock,
    } from "lucide-svelte";

    type Section =
        | "appearance"
        | "config-setup"
        | "config-ai"
        | "config-automation"
        | "config-data"
        | "config-comms"
        | "config-integrations"
        | "config-system"
        | "config-other"
        | "team"
        | "bindings"
        | "gateways";

    interface Props {
        activeSection: Section;
        onselect: (s: Section) => void;
        /** Meta-group IDs that have at least one group in the loaded config */
        loadedMetaIds?: string[];
        /** Whether there are groups not claimed by any meta-group */
        hasOther?: boolean;
    }

    let { activeSection, onselect, loadedMetaIds = [], hasOther = false }: Props = $props();

    const META_ICONS: Record<string, typeof Palette> = {
        setup:        SlidersHorizontal,
        ai:           Brain,
        automation:   Zap,
        data:         Database,
        comms:        Radio,
        integrations: Plug,
        system:       Monitor,
        other:        MoreHorizontal,
    };

    const USER_SECTIONS = [
        { id: "appearance" as Section, label: "Appearance", icon: Palette },
    ];

    const GATEWAY_BOTTOM = [
        { id: "team"     as Section, label: "Team",     icon: Users  },
        { id: "bindings" as Section, label: "Bindings", icon: Link2  },
        { id: "gateways" as Section, label: "Gateways", icon: Server },
    ];

    // When config is loaded (loadedMetaIds non-empty), show only meta-groups
    // that have at least one group. Before load, show all.
    const visibleMeta = $derived.by(() => {
        const all = [
            ...META_GROUPS,
            ...(hasOther ? [{ id: "other", label: "Other", minOrder: -1, maxOrder: -1 }] : []),
        ];
        if (loadedMetaIds.length === 0) return all;
        return all.filter((m) =>
            m.id === "other" ? hasOther : loadedMetaIds.includes(m.id),
        );
    });
</script>

<aside
    class="shrink-0 w-48 border-r border-border bg-bg/50 flex flex-col overflow-y-auto py-4"
>
    <!-- USER group -->
    <div class="mb-4">
        <div
            class="px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80"
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
    <div class="flex-1">
        <div
            class="px-4 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80"
        >
            Gateway
        </div>

        <!-- Config meta-groups (filtered to loaded groups when connected) -->
        {#each visibleMeta as meta (meta.id)}
            {@const sectionId = `config-${meta.id}` as Section}
            {@const Icon = META_ICONS[meta.id]}
            {@const disabled = !conn.connected}
            <button
                type="button"
                class="w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-100 bg-transparent border-none font-[inherit] text-left
                    {activeSection === sectionId
                    ? 'text-accent bg-accent/8 font-medium cursor-pointer'
                    : disabled
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-muted-foreground hover:text-foreground hover:bg-bg3 cursor-pointer'}"
                onclick={() => conn.connected && onselect(sectionId)}
                title={disabled ? "Connect to a gateway first" : undefined}
            >
                <Icon
                    size={15}
                    class={activeSection === sectionId
                        ? "text-accent"
                        : disabled
                          ? "text-muted-foreground/30"
                          : "text-muted-foreground/70"}
                />
                <span class="flex-1">{meta.label}</span>
                {#if disabled}
                    <Lock size={10} class="text-muted-foreground/30 shrink-0" />
                {/if}
            </button>
        {/each}

        <!-- Spacer before Team/Bindings/Gateways -->
        <div class="h-px bg-border/40 mx-4 my-3"></div>

        {#each GATEWAY_BOTTOM as section (section.id)}
            {@const disabled = !conn.connected && section.id !== 'gateways'}
            <button
                type="button"
                class="w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors duration-100 bg-transparent border-none font-[inherit] text-left
                    {activeSection === section.id
                    ? 'text-accent bg-accent/8 font-medium cursor-pointer'
                    : disabled
                      ? 'text-muted-foreground/40 cursor-not-allowed'
                      : 'text-muted-foreground hover:text-foreground hover:bg-bg3 cursor-pointer'}"
                onclick={() => {
                    if (section.id === 'gateways' || conn.connected) onselect(section.id);
                }}
                title={disabled ? "Connect to a gateway first" : undefined}
            >
                <section.icon
                    size={15}
                    class={activeSection === section.id
                        ? "text-accent"
                        : disabled
                          ? "text-muted-foreground/30"
                          : "text-muted-foreground/70"}
                />
                <span class="flex-1">{section.label}</span>
                {#if disabled}
                    <Lock size={10} class="text-muted-foreground/30 shrink-0" />
                {/if}
            </button>
        {/each}
    </div>
</aside>
