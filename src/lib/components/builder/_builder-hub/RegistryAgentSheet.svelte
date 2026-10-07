<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { Dialog } from '$lib/components/ui/foundations';
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

<!-- HC-028: mounted by the parent `{#if selectedRegistryAgent}`; the shared
     native <dialog> contract owns modality, Escape, backdrop dismissal and focus return. -->
<Dialog open={true} labelledBy="registry-agent-name" size="md" onclose={onClose}>
    {#snippet header()}
        <div class="detail-header">
            <span class="detail-emoji">{agentIcon(agent)}</span>
            <div class="detail-title-block">
                <h2 class="detail-name" id="registry-agent-name">{agent.name}</h2>
                <div class="detail-meta">
                    {#each agent.categories as cat}
                        <span class="detail-category">{categoryIcon(cat)} {cat}</span>
                    {/each}
                    {#if agent.model}
                        <span class="detail-model">{agent.model}</span>
                    {/if}
                </div>
            </div>
        </div>
    {/snippet}
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
    {#snippet footer()}
        <Button variant="ghost" type="button" class="detail-btn primary" onclick={useAsTemplate}>
            {m.builder_useAsTemplate()}
        </Button>
        <Button variant="ghost" type="button" class="detail-btn secondary" onclick={onClose}>
            {m.common_close()}
        </Button>
    {/snippet}
</Dialog>

<style>
    .font-mono {
        font-family: var(--font-mono, monospace);
    }

    .detail-header {
        display: flex;
        align-items: flex-start;
        gap: var(--space-3);
    }

    .detail-emoji {
        font-size: var(--font-size-display);
        line-height: 1;
        flex-shrink: 0;
    }

    .detail-title-block {
        flex: 1;
        min-width: 0;
    }

    .detail-name {
        font-size: var(--font-size-page-title);
        font-weight: 700;
        color: var(--color-foreground);
        margin: 0 0 var(--space-1);
    }

    .detail-meta {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        flex-wrap: wrap;
    }

    .detail-category {
        font-size: var(--font-size-telemetry);
        color: var(--color-muted);
        font-family: var(--font-mono, monospace);
    }

    .detail-model {
        font-size: var(--font-size-telemetry);
        font-family: var(--font-mono, monospace);
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: var(--space-0-5) var(--space-2);
        border-radius: var(--radius-sm);
        margin-left: var(--space-1);
    }

    .detail-desc {
        font-size: var(--font-size-body);
        color: var(--color-foreground);
        line-height: 1.6;
        margin: 0 0 var(--space-4);
    }

    .detail-info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-3);
    }

    .detail-info {
        display: flex;
        flex-direction: column;
        gap: var(--space-0-5);
    }

    .detail-label {
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
    }

    .detail-value {
        font-size: var(--font-size-caption);
        color: var(--color-foreground);
    }

    :global(.detail-btn) {
        font-family: inherit;
        font-size: var(--font-size-caption);
        font-weight: 600;
        padding: var(--space-2) var(--space-4);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        border: none;
    }

    :global(.detail-btn.primary) {
        background: var(--color-accent);
        color: white;
    }

    :global(.detail-btn.primary:hover) {
        filter: brightness(1.1);
    }

    :global(.detail-btn.secondary) {
        background: var(--color-bg2);
        color: var(--color-muted);
        border: 1px solid var(--color-border);
    }

    :global(.detail-btn.secondary:hover) {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }
</style>
