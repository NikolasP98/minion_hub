<script lang="ts">
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import {
    installAgent,
    marketplaceState,
    parseTags,
    type MarketplaceAgent,
  } from '$lib/state/features/marketplace.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Check, AlertCircle, UserPlus } from 'lucide-svelte';
  import posthog from 'posthog-js';
  import { Button, Select } from '$lib/components/ui';

  interface Props {
    agent: MarketplaceAgent;
  }

  let { agent }: Props = $props();

  let selectedServerId = $state<string>('');
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
    const ok = await installAgent(agent.id, selectedServerId, host?.name, host?.url);
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
        <a href="/" class="connect-link">{m.marketplace_agentDetailConnectFirst()}</a>
      </div>
    {:else}
      <Select bind:value={selectedServerId} class="server-select">
        {#each hostsState.hosts as host}
          <option value={host.id}>{host.name} — {host.url}</option>
        {/each}
      </Select>
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

  <Button
    type="button"
    variant="primary"
    size="lg"
    onclick={handleHire}
    disabled={hostsState.hosts.length === 0 || isHiring || hireSuccess}
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
  </Button>

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
    background: var(--elevation-2-bg);
    border: 1px solid var(--elevation-2-border);
    border-radius: var(--radius-xl);
    padding: var(--space-page-section);
    display: flex;
    flex-direction: column;
    gap: var(--space-card);
  }

  .panel-title {
    font-size: var(--font-size-section-title, 16px);
    font-weight: 700;
    color: var(--color-foreground);
    margin: 0;
  }

  .action-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .section-label {
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .no-servers {
    padding: var(--space-card);
    background: var(--elevation-1-bg);
    border: 1px dashed var(--elevation-2-border);
    border-radius: var(--radius-lg);
    text-align: center;
  }

  .no-servers p {
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted);
    margin: 0 0 var(--space-2);
  }

  .connect-link {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-brand-pink);
    text-decoration: none;
  }

  .connect-link:hover {
    text-decoration: underline;
  }

  :global(.server-select) {
    width: 100%;
    padding: var(--space-3);
    background: var(--color-bg);
    border: 1px solid var(--elevation-3-border);
    border-radius: var(--radius-lg);
    color: var(--color-foreground);
    font-size: var(--font-size-body, 14px);
    cursor: pointer;
  }

  :global(.server-select:focus) {
    outline: none;
    border-color: color-mix(in srgb, var(--color-brand-pink) 40%, transparent);
  }

  .success-message {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: color-mix(in srgb, var(--color-success) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-success) 20%, transparent);
    border-radius: var(--radius-lg);
  }

  .success-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-success);
    border-radius: var(--radius-full);
    color: var(--color-accent-foreground);
    font-size: var(--font-size-body, 14px);
    font-weight: 700;
  }

  .success-message strong {
    display: block;
    color: var(--color-success);
    font-size: var(--font-size-body, 14px);
    margin-bottom: var(--space-0-5);
  }

  .success-message p {
    margin: 0;
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted);
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    background: color-mix(in srgb, var(--color-destructive) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-destructive) 20%, transparent);
    border-radius: var(--radius-lg);
    color: var(--color-destructive);
    font-size: var(--font-size-caption, 12px);
  }

  .error-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-destructive);
    border-radius: var(--radius-full);
    color: var(--color-accent-foreground);
    font-size: var(--font-size-caption, 12px);
    font-weight: 700;
  }

  :global(.hire-cta-btn) {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-page-section);
    background: linear-gradient(
      135deg,
      var(--color-brand-pink),
      color-mix(in srgb, var(--color-brand-pink) 82%, var(--color-bg))
    );
    border: none;
    border-radius: var(--radius-xl);
    color: var(--color-accent-foreground);
    font-size: var(--font-size-body, 14px);
    font-weight: 700;
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease-standard);
    box-shadow: var(--shadow-md);
  }

  :global(.hire-cta-btn:hover:not(:disabled)) {
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
  }

  :global(.hire-cta-btn:disabled) {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid transparent;
    border-top-color: var(--color-accent-foreground);
    border-radius: var(--radius-full);
    animation: spin var(--duration-slow) linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .tags-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .tags-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .tag {
    padding: var(--space-2) var(--space-3);
    background: var(--elevation-3-bg);
    border: 1px solid var(--elevation-3-border);
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted);
  }
</style>
