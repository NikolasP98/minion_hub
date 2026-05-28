<script lang="ts">
    import { hostsState } from "$lib/state/features/hosts.svelte";
    import {
        installAgent,
        marketplaceState,
        parseTags,
        type MarketplaceAgent,
    } from "$lib/state/features/marketplace.svelte";
    import * as m from "$lib/paraglide/messages";
    import { Check, AlertCircle, UserPlus } from "lucide-svelte";
    import posthog from "posthog-js";

    interface Props {
        agent: MarketplaceAgent;
    }

    let { agent }: Props = $props();

    let selectedServerId = $state<string>("");
    let hireSuccess = $state(false);
    let hireError = $state<string | null>(null);
    let isHiring = $state(false);

    const tags = $derived(parseTags(agent.tags));

    $effect(() => {
        if (!selectedServerId && hostsState.hosts.length > 0) {
            selectedServerId = hostsState.hosts[0].id;
        }
    });

    async function handleHire() {
        if (!selectedServerId || !agent) return;
        hireError = null;
        hireSuccess = false;
        isHiring = true;

        const host = hostsState.hosts.find((h) => h.id === selectedServerId);
        const ok = await installAgent(
            agent.id,
            selectedServerId,
            host?.name,
            host?.url,
        );
        if (ok) {
            hireSuccess = true;
            posthog.capture('marketplace_agent_hired', {
                agent_id: agent.id,
                agent_name: agent.name,
                agent_category: agent.category,
                server_id: selectedServerId,
            });
        } else {
            hireError = marketplaceState.installError;
            posthog.capture('marketplace_agent_hire_failed', {
                agent_id: agent.id,
                agent_name: agent.name,
                error: marketplaceState.installError,
            });
        }
        isHiring = false;
    }
</script>

<!-- Quick Actions Panel -->
<div class="quick-actions-panel">
    <h2 class="panel-title">{m.marketplace_agentDetailHiringOptions()}</h2>

    <div class="action-section">
        <span class="section-label">{m.marketplace_agentDetailDeployTo()}</span>
        {#if hostsState.hosts.length === 0}
            <div class="no-servers">
                <p>{m.marketplace_agentDetailNoServers()}</p>
                <a href="/" class="connect-link"
                    >{m.marketplace_agentDetailConnectFirst()}</a
                >
            </div>
        {:else}
            <select
                bind:value={selectedServerId}
                class="server-select"
            >
                {#each hostsState.hosts as host}
                    <option value={host.id}
                        >{host.name} — {host.url}</option
                    >
                {/each}
            </select>
        {/if}
    </div>

    {#if hireSuccess}
        <div class="success-message">
            <span class="success-icon"><Check size={14} /></span>
            <div>
                <strong>{m.marketplace_agentDetailHiredSuccess()}</strong>
                <p>{m.marketplace_agentDetailHiredSuccessHint({ name: agent.name })}</p>
            </div>
        </div>
    {/if}

    {#if hireError}
        <div class="error-message">
            <span class="error-icon"><AlertCircle size={13} /></span>
            <p>{hireError}</p>
        </div>
    {/if}

    <button
        type="button"
        onclick={handleHire}
        disabled={hostsState.hosts.length === 0 ||
            isHiring ||
            hireSuccess}
        class="hire-cta-btn"
    >
        {#if isHiring}
            <span class="spinner"></span>
            <span>{m.marketplace_agentDetailHiring()}</span>
        {:else if hireSuccess}
            <span>{m.marketplace_agentDetailHired()}</span>
        {:else}
            <UserPlus size={16} />
            <span>{m.marketplace_agentDetailHireBtn({ name: agent.name })}</span>
        {/if}
    </button>

    <div class="tags-section">
        <span class="section-label">{m.marketplace_agentDetailSkillsTags()}</span>
        <div class="tags-list">
            {#each tags as tag}
                <span class="tag">{tag}</span>
            {/each}
        </div>
    </div>
</div>

<style>
    .quick-actions-panel {
        background: rgba(24, 24, 27, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 16px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .panel-title {
        font-size: 18px;
        font-weight: 700;
        color: #fafafa;
        margin: 0;
    }

    .action-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .section-label {
        font-size: 11px;
        font-weight: 600;
        color: #71717a;
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .no-servers {
        padding: 16px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px dashed rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        text-align: center;
    }

    .no-servers p {
        font-size: 13px;
        color: #a1a1aa;
        margin: 0 0 8px;
    }

    .connect-link {
        font-size: 12px;
        color: #e8547a;
        text-decoration: none;
    }

    .connect-link:hover {
        text-decoration: underline;
    }

    .server-select {
        width: 100%;
        padding: 12px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        color: #fafafa;
        font-size: 13px;
        cursor: pointer;
    }

    .server-select:focus {
        outline: none;
        border-color: rgba(232, 84, 122, 0.4);
    }

    .success-message {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid rgba(34, 197, 94, 0.2);
        border-radius: 10px;
    }

    .success-icon {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #22c55e;
        border-radius: 50%;
        color: white;
        font-size: 14px;
        font-weight: 700;
    }

    .success-message strong {
        display: block;
        color: #22c55e;
        font-size: 13px;
        margin-bottom: 2px;
    }

    .success-message p {
        margin: 0;
        font-size: 12px;
        color: #a1a1aa;
    }

    .error-message {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.2);
        border-radius: 10px;
        color: #ef4444;
        font-size: 12px;
    }

    .error-icon {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #ef4444;
        border-radius: 50%;
        color: white;
        font-size: 12px;
        font-weight: 700;
    }

    .hire-cta-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 14px 24px;
        background: linear-gradient(135deg, #e8547a, #c44d6c);
        border: none;
        border-radius: 12px;
        color: white;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 20px rgba(232, 84, 122, 0.3);
    }

    .hire-cta-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 25px rgba(232, 84, 122, 0.5);
    }

    .hire-cta-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .spinner {
        width: 18px;
        height: 18px;
        border: 2px solid transparent;
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .tags-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .tags-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    .tag {
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        font-size: 11px;
        color: #a1a1aa;
    }
</style>
