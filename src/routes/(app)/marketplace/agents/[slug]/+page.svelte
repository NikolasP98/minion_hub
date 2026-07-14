<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { createQuery } from '@tanstack/svelte-query';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import { loadAgent } from '$lib/state/features/marketplace.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Search, FileText, Info, ArrowLeft } from 'lucide-svelte';
  import { Button, PageHeader } from '$lib/components/ui';
  import posthog from 'posthog-js';
  import IdBadgeCard from './_components/IdBadgeCard.svelte';
  import HiringPanel from './_components/HiringPanel.svelte';
  import OverviewTab from './_components/OverviewTab.svelte';
  import DocumentsTab from './_components/DocumentsTab.svelte';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

  const slug = $derived($page.params.slug as string);
  const initialTab = $derived(
    ($page.url.searchParams.get('tab') === 'documents' ? 'documents' : 'overview') as Tab,
  );

  type Tab = 'overview' | 'documents';

  let activeTab = $state<Tab>('overview');
  let trackedAgentId: string | null = null;

  const agentQuery = createQuery(() => ({
    queryKey: ['marketplace', 'agent', slug],
    queryFn: () => loadAgent(slug),
  }));

  const agent = $derived(agentQuery.data ?? null);
  const loading = $derived(agentQuery.isPending);

  $effect(() => {
    if (agent && trackedAgentId !== agent.id) {
      trackedAgentId = agent.id;
      posthog.capture('marketplace_agent_viewed', {
        agent_id: agent.id,
        agent_name: agent.name,
        agent_category: agent.category,
      });
    }
  });

  onMount(() => {
    activeTab = initialTab;
    // Touch hostsState early so HiringPanel can pick a default once it's
    // mounted with an agent.
    void hostsState.hosts.length;
  });

  const back = createBackNav('/marketplace/agents', m.marketplace_agentDetailBack);
</script>

<PageShell archetype="record-detail" scroll="region" labelledBy="marketplace-agent-title">
  <PageHeader titleId="marketplace-agent-title" title={agent?.name ?? 'Agent'}>
    {#snippet leading()}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onclick={back.go}
        aria-label={m.marketplace_agentDetailBack()}
        class="flex items-center text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
      >
        <ArrowLeft size={16} class="text-accent shrink-0" />
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody padding="none" scroll="region">
    <div class="agent-detail-page">
      {#if loading}
        <!-- Loading State -->
        <div class="loading-state">
          <div
            class="w-6 h-6 border-2 border-[var(--color-brand-pink)] border-t-transparent rounded-full animate-spin"
          ></div>
          <p class="loading-text">{m.marketplace_agentDetailLoading()}</p>
        </div>
      {:else if !agent}
        <!-- Not Found -->
        <div class="not-found">
          <Search size={40} class="text-muted-strong mb-2" />
          <h2>{m.marketplace_agentDetailNotFound()}</h2>
          <p>{m.marketplace_agentDetailNotFoundHint()}</p>
          <Button variant="secondary" type="button" onclick={back.go} class="back-btn">
            {m.marketplace_agentDetailBack()}
          </Button>
        </div>
      {:else}
        <!-- Hero Section - Corporate ID Style -->
        <div class="agent-hero">
          <IdBadgeCard {agent} />
          <div class="hiring-panel-wrap">
            <HiringPanel {agent} />
          </div>
        </div>

        <!-- Tab Navigation -->
        <div class="tab-bar">
          {#each ['overview', 'documents'] as const as tab (tab)}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onclick={() => {
                activeTab = tab;
              }}
              class="tab-btn {activeTab === tab ? 'active' : ''}"
            >
              {#if tab === 'documents'}
                <FileText size={13} />
                <span>{m.marketplace_agentDetailTabDocuments()}</span>
              {:else}
                <Info size={13} />
                <span>{m.marketplace_agentDetailTabOverview()}</span>
              {/if}
            </Button>
          {/each}
        </div>

        <!-- Tab Content -->
        <div class="tab-content">
          {#if activeTab === 'overview'}
            <OverviewTab {agent} />
          {:else if activeTab === 'documents'}
            <DocumentsTab {agent} />
          {/if}
        </div>
      {/if}
    </div>
  </PageBody>
</PageShell>

<style>
  .agent-detail-page {
    max-width: 1000px;
    margin: 0 auto;
    padding: var(--space-section) var(--space-page-gutter) calc(var(--space-section) * 2);
    min-height: 100%;
  }

  /* Loading State */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: calc(var(--space-section) * 4) var(--space-card);
    gap: var(--space-3);
  }

  .loading-text {
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
  }

  /* Not Found */
  .not-found {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: calc(var(--space-section) * 4) var(--space-card);
    text-align: center;
    gap: var(--space-2);
  }

  .not-found h2 {
    font-size: var(--font-size-page-title, 24px);
    font-weight: 700;
    color: var(--color-foreground);
    margin: 0 0 var(--space-2);
  }

  .not-found p {
    font-size: var(--font-size-body, 14px);
    color: var(--color-muted-foreground);
    margin: 0 0 var(--space-section);
  }

  :global(.back-btn) {
    padding: var(--space-2) var(--space-card);
    background: var(--elevation-2-bg);
    border: 1px solid var(--elevation-2-border);
    border-radius: var(--radius-lg);
    color: var(--color-muted);
    font-size: var(--font-size-body, 14px);
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease-standard);
  }

  :global(.back-btn:hover) {
    background: var(--elevation-3-bg);
    color: var(--color-foreground);
  }

  /* Hero Section */
  .agent-hero {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: var(--space-page-gutter);
    margin-bottom: var(--space-page-section);
  }

  /* Tab Bar */
  .tab-bar {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--elevation-2-bg);
    border: 1px solid var(--elevation-2-border);
    border-radius: var(--radius-xl);
    margin-bottom: var(--space-page-section);
    width: fit-content;
  }

  :global(.tab-btn) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-card);
    background: transparent;
    border: none;
    border-radius: var(--radius-lg);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-body, 14px);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--duration-normal) var(--ease-standard);
  }

  :global(.tab-btn:hover) {
    color: var(--color-foreground);
    background: var(--elevation-3-bg);
  }

  :global(.tab-btn.active) {
    background: color-mix(in srgb, var(--color-brand-pink) 15%, transparent);
    color: var(--color-brand-pink);
  }

  /* Tab Content */
  .tab-content {
    min-height: 300px;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .agent-hero {
      grid-template-columns: 1fr;
      max-width: 400px;
      margin: 0 auto var(--space-page-section);
    }

    .hiring-panel-wrap {
      order: -1;
    }
  }

  @media (max-width: 640px) {
    .agent-detail-page {
      padding: var(--space-card);
    }

    :global(.tab-btn) {
      padding: var(--space-2) var(--space-3);
      font-size: var(--font-size-caption, 12px);
    }
  }
</style>
