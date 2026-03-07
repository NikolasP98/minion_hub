<script lang="ts">
    import { Brain, Bot, Radio, MessageSquare, Shield, Server, Palette, HardDrive } from "lucide-svelte";
    import { isAdmin } from "$lib/state/features/user.svelte";

    interface Props {
        activeTab: string;
        onselect: (id: string) => void;
    }

    let { activeTab, onselect }: Props = $props();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ICON_MAP: Record<string, any> = {
        Brain, Bot, Radio, MessageSquare, Shield, Server, Palette, HardDrive,
    };

    const ALL_TABS: { id: string; label: string; icon: string }[] = [
        { id: 'hosts',      label: 'Hosts',      icon: 'HardDrive' },
        { id: 'ai',         label: 'AI',         icon: 'Brain'   },
        { id: 'agents',     label: 'Agents',     icon: 'Bot'     },
        { id: 'comms',      label: 'Comms',      icon: 'Radio'   },
        { id: 'channels',   label: 'Channels',  icon: 'MessageSquare' },
        { id: 'security',   label: 'Security',   icon: 'Shield'  },
        { id: 'system',     label: 'System',     icon: 'Server'  },
        { id: 'appearance', label: 'Appearance', icon: 'Palette' },
    ];

    const USER_TABS = new Set(['appearance']);

    const tabs = $derived(
        isAdmin.value ? ALL_TABS : ALL_TABS.filter((t) => USER_TABS.has(t.id))
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

                <!-- Active underline indicator -->
                {#if isActive}
                    <div class="absolute bottom-0 left-2 right-2 h-[2px] bg-accent rounded-t-full"></div>
                {/if}
            </button>
        {/each}
    </div>
</div>
