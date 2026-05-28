<script lang="ts">
    import { Trash2 } from "lucide-svelte";
    import { goto } from "$app/navigation";
    import { builderState } from "$lib/state/builder";
    import { formatRelativeTime } from "./utils";

    interface Props {
        onDelete: (id: string, name: string) => void;
    }

    let { onDelete }: Props = $props();
</script>

<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each builderState.agents as agent (agent.id)}
        <div class="item-card" role="button" tabindex="0" onclick={() => goto(`/agents/builder/${agent.id}`)} onkeydown={(e) => { if (e.key === 'Enter') goto(`/agents/builder/${agent.id}`); }}>
            <div class="item-card-inner">
                <div class="item-card-header">
                    <span class="item-emoji">{agent.emoji || '🤖'}</span>
                    <span class="item-name">{agent.name}</span>
                    <button type="button" class="item-delete" onclick={(e) => { e.stopPropagation(); onDelete(agent.id, agent.name); }} title="Delete agent">
                        <Trash2 size={12} />
                    </button>
                </div>
                {#if agent.description}
                    <span class="item-desc">{agent.description}</span>
                {/if}
                <div class="item-footer">
                    <span class="status-badge {agent.status}">{agent.status}</span>
                    {#if agent.model}
                        <span class="item-model">{agent.model}</span>
                    {/if}
                    <span class="item-time">{formatRelativeTime(agent.updatedAt)}</span>
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
        transition: all 0.15s ease;
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

    .item-model {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
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
        transition: all 0.1s ease;
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
