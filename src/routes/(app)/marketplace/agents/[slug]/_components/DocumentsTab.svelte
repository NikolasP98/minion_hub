<script lang="ts">
    import type { MarketplaceAgent } from "$lib/state/features/marketplace.svelte";
    import * as m from "$lib/paraglide/messages";

    type DocTab = "soul" | "identity" | "context" | "skills";

    interface Props {
        agent: MarketplaceAgent;
    }

    let { agent }: Props = $props();

    let activeDocTab = $state<DocTab>("soul");

    const docTabs: {
        id: DocTab;
        label: string;
        field: keyof MarketplaceAgent;
    }[] = [
        { id: "soul", label: "SOUL", field: "soulMd" },
        { id: "identity", label: "IDENTITY", field: "identityMd" },
        { id: "context", label: "CONTEXT", field: "contextMd" },
        { id: "skills", label: "SKILLS", field: "skillsMd" },
    ];

    // Simple markdown renderer
    function renderMd(md: string | null | undefined): string {
        if (!md)
            return `<p class="text-muted text-xs italic">${m.marketplace_agentDetailNoContent()}</p>`;
        return md
            .replace(
                /^#{3}\s+(.+)$/gm,
                '<h3 class="text-sm font-semibold text-foreground mt-4 mb-1">$1</h3>',
            )
            .replace(
                /^#{2}\s+(.+)$/gm,
                '<h2 class="text-base font-bold text-foreground mt-5 mb-2">$1</h2>',
            )
            .replace(
                /^#{1}\s+(.+)$/gm,
                '<h1 class="text-lg font-bold text-foreground mt-6 mb-2">$1</h1>',
            )
            .replace(
                /\*\*(.+?)\*\*/g,
                '<strong class="text-foreground font-semibold">$1</strong>',
            )
            .replace(/\*(.+?)\*/g, '<em class="text-muted italic">$1</em>')
            .replace(
                /`(.+?)`/g,
                '<code class="px-1 py-0.5 rounded bg-bg3 text-brand-pink text-[11px] font-mono">$1</code>',
            )
            .replace(
                /^[-*]\s+(.+)$/gm,
                '<li class="ml-4 text-xs text-foreground/80 list-disc list-outside">$1</li>',
            )
            .replace(/(<li.*<\/li>)/gs, '<ul class="my-2 space-y-1">$1</ul>')
            .replace(
                /\n{2,}/g,
                '</p><p class="text-xs text-foreground/80 leading-relaxed mb-2">',
            )
            .replace(/^(?!<[hulo])(.+)$/gm, "$1")
            .replace(/^(.+(?!\n))$/gm, (line) => {
                if (line.startsWith("<")) return line;
                return `<p class="text-xs text-foreground/80 leading-relaxed mb-2">${line}</p>`;
            });
    }
</script>

<div class="documents-section">
    <!-- Doc Tabs -->
    <div class="doc-tabs">
        {#each docTabs as dt}
            <button
                type="button"
                onclick={() => {
                    activeDocTab = dt.id;
                }}
                class="doc-tab"
                class:active={activeDocTab === dt.id}
            >
                {dt.label}
            </button>
        {/each}
    </div>

    <!-- Doc Content -->
    <div class="doc-content">
        {#each docTabs as dt}
            {#if activeDocTab === dt.id}
                <div class="markdown-content">
                    {@html renderMd(
                        agent[dt.field] as string | null,
                    )}
                </div>
            {/if}
        {/each}
    </div>
</div>

<style>
    .documents-section {
        background: rgba(24, 24, 27, 0.4);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 16px;
        overflow: hidden;
    }

    .doc-tabs {
        display: flex;
        gap: 2px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .doc-tab {
        flex: 1;
        padding: 10px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: #71717a;
        font-size: 11px;
        font-weight: 600;
        font-family: "JetBrains Mono NF", monospace;
        cursor: pointer;
        transition: all 0.2s ease;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .doc-tab:hover {
        color: #fafafa;
        background: rgba(255, 255, 255, 0.05);
    }

    .doc-tab.active {
        background: rgba(232, 84, 122, 0.15);
        color: #e8547a;
    }

    .doc-content {
        padding: 24px;
        min-height: 300px;
    }

    .markdown-content :global(p) {
        font-size: 13px;
        line-height: 1.7;
        color: #a1a1aa;
        margin-bottom: 12px;
    }

    .markdown-content :global(h1),
    .markdown-content :global(h2),
    .markdown-content :global(h3) {
        color: #fafafa;
        margin-top: 20px;
        margin-bottom: 10px;
    }

    .markdown-content :global(ul) {
        margin: 12px 0;
        padding-left: 20px;
    }

    .markdown-content :global(li) {
        font-size: 13px;
        color: #a1a1aa;
        margin-bottom: 6px;
    }

    .markdown-content :global(code) {
        background: rgba(232, 84, 122, 0.1);
        color: #e8547a;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
    }
</style>
