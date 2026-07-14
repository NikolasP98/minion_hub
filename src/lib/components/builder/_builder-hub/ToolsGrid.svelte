<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Trash2 } from "lucide-svelte";
    import { goto } from "$app/navigation";
    import * as m from '$lib/paraglide/messages';
    import { formatRelativeTime, toolEmoji, type UnifiedTool } from "./utils";
    import { isToolPermissionAllowed, toolPermissionLabel } from "$lib/utils/tool-permission-chip";
    import type { ToolPermission } from "$lib/types/tools";

    interface Props {
        tools: UnifiedTool[];
        isAdmin: boolean;
        /** group id → one-line description (C7), used as the group chip's tooltip. */
        groupDescriptions?: Record<string, string>;
        onDeleteCustom: (id: string, name: string) => void;
    }

    let { tools, isAdmin, groupDescriptions = {}, onDeleteCustom }: Props = $props();

    function groupLabel(g: string): string {
        return g.replace('group:', '');
    }

    function permissionTitle(perm: ToolPermission): string {
        const label = toolPermissionLabel(perm);
        return isToolPermissionAllowed(perm)
            ? m.capabilities_permissionAllowed({ perm: label })
            : m.capabilities_permissionDenied({ perm: label });
    }
</script>

<!--
  Card anatomy (UX rationale):
  · Status reads by exception — 60+ enabled tools don't shout "ENABLED";
    a quiet dot marks state, disabled cards dim. Custom tools keep their
    DRAFT/PUBLISHED pill because draft-vs-live is the decision that matters.
  · No per-card "Gateway tool"/"SERVER" filler — the section header already
    says where a tool lives.
  · One metadata line under the title (mono id, or lang · edited time);
    chips reserved for information that varies: groups, permission, MCP.
-->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
    {#each tools as tool (tool.source + ':' + tool.id)}
        <div
            class="item-card"
            class:dimmed={tool.source === 'gateway' && tool.enabled === false}
            role="button"
            tabindex="0"
            aria-label={tool.displayTitle ?? tool.name}
            onclick={() => goto(`/tools/${tool.id}`)}
            onkeydown={(e) => { if (e.key === 'Enter') goto(`/tools/${tool.id}`); }}
        >
            <div class="item-card-inner">
                <div class="item-card-header">
                    <span class="item-emoji">{tool.source === 'gateway' ? (tool.emoji ?? toolEmoji(tool)) : '🔧'}</span>
                    <span class="item-title-stack">
                        {#if tool.source === 'gateway'}
                            <span class="item-name" class:font-mono={!tool.displayTitle}>{tool.displayTitle ?? tool.id}</span>
                            {#if tool.displayTitle}
                                <span class="item-meta font-mono">{tool.id}</span>
                            {/if}
                        {:else}
                            <span class="item-name">{tool.name}</span>
                            <span class="item-meta">
                                {tool.scriptLang ?? 'javascript'}{#if tool.updatedAt}&nbsp;· {formatRelativeTime(tool.updatedAt).replace('edited ', '')}{/if}
                            </span>
                        {/if}
                    </span>
                    {#if tool.source === 'gateway'}
                        <span
                            class="status-dot {tool.enabled ? 'on' : 'off'}"
                            title={tool.enabled ? m.tools_enabled() : m.tools_disabled()}
                        ></span>
                    {:else}
                        {#if isAdmin}
                            <Button variant="ghost" type="button" class="item-delete" onclick={(e) => { e.stopPropagation(); onDeleteCustom(tool.id, tool.name); }} title="Delete tool">
                                <Trash2 size={12} />
                            </Button>
                        {/if}
                        <span class="status-badge {tool.status}">{tool.status}</span>
                    {/if}
                </div>
                {#if tool.description}
                    <span class="item-desc">{tool.description}</span>
                {/if}
                {#if tool.source === 'gateway' && (tool.groups?.length || tool.permission || tool.mcpExport || tool.multi || tool.optional)}
                    <div class="chips-row">
                        {#each tool.groups ?? [] as g (g)}
                            <span class="chip" title={groupDescriptions[g]}>{groupLabel(g)}</span>
                        {/each}
                        {#if tool.permission}
                            {@const allowed = isToolPermissionAllowed(tool.permission)}
                            <span class="chip perm" class:allowed class:denied={!allowed} title={permissionTitle(tool.permission)}>
                                {toolPermissionLabel(tool.permission)}
                            </span>
                        {/if}
                        {#if tool.mcpExport}
                            <span class="chip accent" title="Exported over MCP">MCP</span>
                        {/if}
                        {#if tool.multi}
                            <span class="chip">multi</span>
                        {/if}
                        {#if tool.optional}
                            <span class="chip">opt</span>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    {/each}
</div>

<style>
    .item-card {
        display: flex;
        align-items: stretch;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
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
        transform: translateY(-1px);
    }

    .item-card:focus-visible {
        outline: 2px solid var(--color-accent);
        outline-offset: 2px;
    }

    /* Disabled tools recede instead of shouting — state by exception. */
    .item-card.dimmed {
        opacity: 0.55;
    }

    .item-card.dimmed:hover {
        opacity: 0.85;
    }

    .item-card-inner {
        display: flex;
        flex-direction: column;
        width: 100%;
        padding: var(--space-3) var(--space-4);
        gap: var(--space-2);
        min-width: 0;
    }

    .item-card-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
    }

    .item-emoji {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: var(--radius-md);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        font-size: var(--font-size-page-title);
        line-height: 1;
        flex-shrink: 0;
    }

    .item-title-stack {
        display: flex;
        flex-direction: column;
        gap: var(--space-0-5);
        min-width: 0;
        flex: 1;
    }

    .item-name {
        font-size: var(--font-size-body);
        font-weight: 600;
        color: var(--color-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .item-meta {
        font-size: var(--font-size-telemetry);
        color: var(--color-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .font-mono {
        font-family: var(--font-mono, monospace);
    }

    .status-dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: var(--radius-full);
        flex-shrink: 0;
        align-self: flex-start;
        margin-top: var(--space-1);
    }

    .status-dot.on {
        background: var(--color-success, var(--color-success-fg));
        box-shadow: var(--shadow-status-glow);
    }

    .status-dot.off {
        background: var(--color-muted);
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        align-self: flex-start;
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-full);
        font-size: var(--font-size-telemetry);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .status-badge.draft {
        background: color-mix(in srgb, var(--color-muted) 15%, transparent);
        color: var(--color-muted);
    }

    .status-badge.published {
        background: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 14%, transparent);
        color: var(--color-success, var(--color-success-fg));
    }

    .item-desc {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        line-height: 1.4;
        overflow: hidden;
        display: -webkit-box;
        line-clamp: 2;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .chips-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        margin-top: auto;
    }

    .chip {
        font-size: var(--font-size-telemetry);
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
    }

    .chip.accent {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    .chip.perm.allowed {
        color: var(--color-success, var(--color-success-fg));
        border-color: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 30%, transparent);
        background: color-mix(in srgb, var(--color-success, var(--color-success-fg)) 10%, transparent);
    }

    .chip.perm.denied {
        color: var(--color-danger-fg);
        border-color: var(--color-danger-border);
        background: var(--color-danger-surface);
    }

    .item-delete {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.25rem;
        height: 1.25rem;
        border-radius: var(--radius-sm);
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        opacity: 0;
        transition: all var(--duration-instant) var(--ease-standard);
        flex-shrink: 0;
        font-family: inherit;
    }

    .item-card:hover .item-delete,
    .item-card:focus-within .item-delete {
        opacity: 1;
    }

    .item-delete:hover {
        color: var(--color-danger-fg);
        background: var(--color-danger-surface);
    }
</style>
