<script lang="ts">
    import { Brain, Bot, Radio, Shield, Server, Palette, HardDrive, DatabaseBackup } from "lucide-svelte";
    import { isAdmin } from "$lib/state/features/user.svelte";
    import { TABS } from "$lib/utils/config-schema";

    interface Props {
        activeTab: string;
        onselect: (id: string) => void;
        dirtyTabIds?: Set<string>;
    }

    let { activeTab, onselect, dirtyTabIds = new Set<string>() }: Props = $props();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ICON_MAP: Record<string, any> = {
        Brain, Bot, Radio, Shield, Server, Palette, HardDrive, DatabaseBackup,
    };

    const USER_TABS = new Set(['appearance']);

    const tabs = $derived(
        isAdmin.value ? TABS : TABS.filter((t) => USER_TABS.has(t.id))
    );
</script>

<div class="shrink-0 border-b border-border bg-bg/80 backdrop-blur-sm" role="tablist">
    <div class="flex items-center gap-0.5 px-4 overflow-x-auto">
        {#each tabs as tab (tab.id)}
            {@const Icon = ICON_MAP[tab.icon]}
            {@const isActive = activeTab === tab.id}
            <button
                type="button"
                role="tab"
                aria-selected={isActive}
                class="relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors bg-transparent border-none cursor-pointer font-[inherit] whitespace-nowrap
                    {isActive
                    ? 'text-accent'
                    : 'text-muted-foreground hover:text-foreground'}"
                onclick={() => onselect(tab.id)}
            >
                {#if Icon}
                    <Icon size={14} />
                {/if}
                <span class="hidden lg:inline">{tab.label}</span>

                <!-- Dirty dot indicator (only visible when not active) -->
                {#if dirtyTabIds.has(tab.id) && !isActive}
                    <span
                        class="absolute top-1.5 right-1 w-1.5 h-1.5 rounded-full bg-accent"
                        aria-hidden="true"
                    ></span>
                {/if}

                <!-- Active underline indicator -->
                {#if isActive}
                    <div class="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t-full"></div>
                {/if}
            </button>
        {/each}
    </div>
</div>
