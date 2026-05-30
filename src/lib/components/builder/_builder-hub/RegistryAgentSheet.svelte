<script lang="ts">
    import { goto } from "$app/navigation";
    import posthog from "posthog-js";
    import * as m from '$lib/paraglide/messages';
    import { categoryIcon, agentIcon, type RegistryAgent } from "$lib/state/builder";

    interface Props {
        agent: RegistryAgent;
        onClose: () => void;
    }

    let { agent, onClose }: Props = $props();

    async function useAsTemplate() {
        const res = await fetch('/api/builder/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: agent.name,
                emoji: agentIcon(agent),
                description: agent.description,
                model: agent.model || null,
            }),
        });
        if (res.ok) {
            const { id } = await res.json();
            onClose();
            posthog.capture('registry_agent_imported', { registry_id: agent.id });
            goto(`/agents/builder/${id}`);
        }
    }
</script>

<div class="confirm-overlay" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}>
    <div class="detail-sheet">
        <div class="detail-header">
            <span class="detail-emoji">{agentIcon(agent)}</span>
            <div class="detail-title-block">
                <h2 class="detail-name">{agent.name}</h2>
                <div class="detail-meta">
                    {#each agent.categories as cat}
                        <span class="detail-category">{categoryIcon(cat)} {cat}</span>
                    {/each}
                    {#if agent.model}
                        <span class="detail-model">{agent.model}</span>
                    {/if}
                </div>
            </div>
            <button type="button" class="detail-close" onclick={onClose}>
                &times;
            </button>
        </div>
        <div class="detail-body">
            <p class="detail-desc">{agent.description}</p>
            <div class="detail-info-grid">
                <div class="detail-info">
                    <span class="detail-label">{m.builder_source()}</span>
                    <span class="detail-value">{agent.source}</span>
                </div>
                <div class="detail-info">
                    <span class="detail-label">{m.builder_id()}</span>
                    <span class="detail-value font-mono">{agent.id}</span>
                </div>
                {#if agent.tags.length > 0}
                    <div class="detail-info">
                        <span class="detail-label">{m.builder_tags()}</span>
                        <span class="detail-value">{agent.tags.join(', ')}</span>
                    </div>
                {/if}
            </div>
        </div>
        <div class="detail-actions">
            <button type="button" class="detail-btn primary" onclick={useAsTemplate}>
                {m.builder_useAsTemplate()}
            </button>
            <button type="button" class="detail-btn secondary" onclick={onClose}>
                {m.common_close()}
            </button>
        </div>
    </div>
</div>

<style>
    .confirm-overlay {
        position: fixed;
        inset: 0;
        z-index: 1100;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(2px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .font-mono {
        font-family: var(--font-mono, monospace);
    }

    .detail-sheet {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        max-width: 480px;
        width: 100%;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        max-height: 80vh;
        overflow-y: auto;
    }

    .detail-header {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1.25rem 1.5rem;
        border-bottom: 1px solid var(--color-border);
    }

    .detail-emoji {
        font-size: 1.75rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .detail-title-block {
        flex: 1;
        min-width: 0;
    }

    .detail-name {
        font-size: 0.9375rem;
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 0.25rem;
    }

    .detail-meta {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex-wrap: wrap;
    }

    .detail-category {
        font-size: 0.625rem;
        color: var(--color-muted);
        font-family: var(--font-mono, monospace);
    }

    .detail-model {
        font-size: 0.5625rem;
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 0.25rem;
        margin-left: 0.25rem;
    }

    .detail-close {
        font-family: inherit;
        font-size: 1.25rem;
        line-height: 1;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
    }

    .detail-close:hover {
        color: var(--color-foreground);
    }

    .detail-body {
        padding: 1.25rem 1.5rem;
    }

    .detail-desc {
        font-size: 0.8125rem;
        color: var(--color-foreground);
        line-height: 1.6;
        margin: 0 0 1rem;
    }

    .detail-info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
    }

    .detail-info {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    .detail-label {
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
    }

    .detail-value {
        font-size: 0.75rem;
        color: var(--color-foreground);
    }

    .detail-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        padding: 1rem 1.5rem;
        border-top: 1px solid var(--color-border);
    }

    .detail-btn {
        font-family: inherit;
        font-size: 0.75rem;
        font-weight: 600;
        padding: 0.4375rem 1rem;
        border-radius: 0.4375rem;
        cursor: pointer;
        transition: all 0.15s ease;
        border: none;
    }

    .detail-btn.primary {
        background: var(--color-accent);
        color: white;
    }

    .detail-btn.primary:hover {
        filter: brightness(1.1);
    }

    .detail-btn.secondary {
        background: var(--color-bg2);
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }

    .detail-btn.secondary:hover {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }
</style>
