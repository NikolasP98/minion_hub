<script lang="ts">
    import { Trash2 } from "lucide-svelte";
    import { goto } from "$app/navigation";
    import * as m from '$lib/paraglide/messages';
    import { formatRelativeTime, toolEmoji, type UnifiedTool } from "./utils";

    interface Props {
        tools: UnifiedTool[];
        isAdmin: boolean;
        onDeleteCustom: (id: string, name: string) => void;
    }

    let { tools, isAdmin, onDeleteCustom }: Props = $props();
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each tools as tool (tool.source + ':' + tool.id)}
        <div class="item-card" role="button" tabindex="0" onclick={() => goto(`/tools/${tool.id}`)} onkeydown={(e) => { if (e.key === 'Enter') goto(`/tools/${tool.id}`); }}>
            <div class="item-card-inner">
                <div class="item-card-header">
                    {#if tool.source === 'gateway'}
                        <span class="item-emoji">{toolEmoji(tool)}</span>
                        <span class="item-name font-mono">{tool.id}</span>
                    {:else}
                        <span class="item-emoji">🔧</span>
                        <span class="item-name">{tool.name}</span>
                        {#if isAdmin}
                            <button type="button" class="item-delete" onclick={(e) => { e.stopPropagation(); onDeleteCustom(tool.id, tool.name); }} title="Delete tool">
                                <Trash2 size={12} />
                            </button>
                        {/if}
                    {/if}
                </div>
                {#if tool.description}
                    <span class="item-desc">{tool.description}</span>
                {/if}
                <div class="item-footer">
                    {#if tool.source === 'gateway'}
                        <span class="status-badge {tool.enabled ? 'published' : 'draft'}">
                            {tool.enabled ? m.builder_enabled() : m.builder_disabled()}
                        </span>
                        {#if tool.mcpExport}
                            <span class="tool-flag accent">MCP</span>
                        {/if}
                        {#if tool.multi}
                            <span class="tool-flag">multi</span>
                        {/if}
                        {#if tool.optional}
                            <span class="tool-flag">opt</span>
                        {/if}
                    {:else}
                        <span class="status-badge {tool.status}">{tool.status}</span>
                        {#if tool.scriptLang}
                            <span class="tool-flag">{tool.scriptLang}</span>
                        {/if}
                        {#if tool.updatedAt}
                            <span class="item-time">{formatRelativeTime(tool.updatedAt)}</span>
                        {/if}
                    {/if}
                    <span class="source-chip {tool.source}">{tool.source === "gateway" ? m.builder_gatewaySource() : m.builder_customSource()}</span>
                </div>
            </div>
        </div>
    {/each}
</div>

<style>
    .item-card {
        display: flex;
        align-items: stretch;
        min-height: 7rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        background: var(--color-bg2);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        padding: 0;
        font-family: inherit;
        width: 100%;
        color: inherit;
        text-align: left;
    }

    .item-card:hover {
        background: var(--color-bg3);
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    }

    .item-card-inner {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: 1rem 1.25rem;
        gap: 0.5rem;
    }

    .item-card-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .item-emoji {
        font-size: 1.125rem;
        line-height: 1;
    }

    .item-name {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .status-badge.draft {
        background: color-mix(in srgb, var(--color-muted) 15%, transparent);
        color: var(--color-muted);
    }

    .status-badge.published {
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        color: var(--color-accent);
    }

    .item-desc {
        font-size: 0.6875rem;
        color: var(--color-muted);
        line-height: 1.4;
        overflow: hidden;
        display: -webkit-box;
        line-clamp: 2;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .item-footer {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-top: auto;
    }

    .item-time {
        font-size: 0.6875rem;
        color: var(--color-muted);
    }

    .tool-flag {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
        border: 1px solid var(--color-border);
    }

    .tool-flag.accent {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    .font-mono {
        font-family: var(--font-mono, monospace);
    }

    .source-chip {
        font-size: 0.5625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
        font-family: var(--font-mono, monospace);
        margin-left: auto;
    }

    .source-chip.gateway {
        color: var(--color-muted);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
    }

    .source-chip.custom {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    .item-delete {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: 0.25rem;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0;
        transition: all var(--duration-instant) var(--ease-standard);
        margin-left: auto;
        flex-shrink: 0;
        font-family: inherit;
    }

    .item-card:hover .item-delete {
        opacity: 1;
    }

    .item-delete:hover {
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 12%, transparent);
    }
</style>
