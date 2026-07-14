<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Lock, type Icon as IconType } from "lucide-svelte";

    type TabId = "skills" | "agents" | "tools";

    interface TabDef {
        id: TabId;
        label: string;
        icon: typeof IconType;
        locked: boolean;
    }

    interface Props {
        tabs: TabDef[];
        activeTab: TabId;
        onSelect: (id: TabId) => void;
    }

    let { tabs, activeTab, onSelect }: Props = $props();
</script>

<div class="tab-bar">
    {#each tabs as tab (tab.id)}
        <Button variant="ghost"
            type="button"
            class="tab-pill {activeTab === tab.id ? 'active' : ''} {tab.locked ? 'locked' : ''}"
            onclick={() => { if (!tab.locked) onSelect(tab.id); }}
            disabled={tab.locked}
        >
            <tab.icon size={14} />
            <span>{tab.label}</span>
            {#if tab.locked}
                <Lock size={11} class="lock-icon" />
            {/if}
        </Button>
    {/each}
</div>

<style>
    .tab-bar {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-1);
        border-radius: var(--radius-lg);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        width: fit-content;
    }

    .tab-pill {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        font-size: var(--font-size-body);
        font-weight: 500;
        color: var(--color-muted);
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        position: relative;
        font-family: inherit;
    }

    .tab-pill:hover:not(:disabled) {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .tab-pill.active {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
        box-shadow: var(--shadow-elevation-1);
    }

    .tab-pill.active::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: 25%;
        right: 25%;
        height: 2px;
        background: var(--color-accent);
        border-radius: var(--radius-xs);
    }

    .tab-pill.locked {
        opacity: 0.5;
        cursor: not-allowed;
    }

    :global(.lock-icon) {
        opacity: 0.6;
    }
</style>
