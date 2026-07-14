<script lang="ts">
  import type { MarketplaceAgent } from '$lib/state/features/marketplace.svelte';
  import * as m from '$lib/paraglide/messages';
  import { AlignLeft, ClipboardList, BarChart2 } from 'lucide-svelte';

  interface Props {
    agent: MarketplaceAgent;
  }

  let { agent }: Props = $props();

  function formatInstallCount(n: number | null): string {
    const count = n ?? 0;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
  }
</script>

<div class="overview-grid">
  <!-- About Card -->
  <div class="info-card">
    <div class="card-header">
      <AlignLeft size={16} class="text-[var(--color-brand-pink)] shrink-0" />
      <h3>{m.marketplace_agentDetailAbout()}</h3>
    </div>
    <p class="card-body">{agent.description}</p>
  </div>

  <!-- Details Card -->
  <div class="info-card">
    <div class="card-header">
      <ClipboardList size={16} class="text-[var(--color-brand-pink)] shrink-0" />
      <h3>{m.marketplace_agentDetailDetails()}</h3>
    </div>
    <div class="details-list">
      <div class="detail-row">
        <span class="detail-label">{m.marketplace_agentDetailCategory()}</span>
        <span class="detail-value capitalize">{agent.category}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">{m.marketplace_agentDetailVersion()}</span>
        <span class="detail-value">{agent.version}</span>
      </div>
      {#if agent.model}
        <div class="detail-row">
          <span class="detail-label">{m.marketplace_agentDetailModel()}</span>
          <span class="detail-value model-tag">{agent.model}</span>
        </div>
      {/if}
      <div class="detail-row">
        <span class="detail-label">{m.marketplace_agentDetailSource()}</span>
        <span class="detail-value truncate max-w-[200px]">{agent.githubPath}</span>
      </div>
    </div>
  </div>

  <!-- Quick Stats -->
  <div class="info-card stats-card">
    <div class="card-header">
      <BarChart2 size={16} class="text-[var(--color-brand-pink)] shrink-0" />
      <h3>{m.marketplace_agentDetailPerformance()}</h3>
    </div>
    <div class="performance-stats">
      <div class="perf-stat">
        <div class="perf-value">
          {formatInstallCount(agent.installCount)}
        </div>
        <div class="perf-label">{m.marketplace_agentDetailTotalHires()}</div>
      </div>
      <div class="perf-stat">
        <div class="perf-value">
          {new Date(agent.createdAt).toLocaleDateString()}
        </div>
        <div class="perf-label">{m.marketplace_agentDetailJoined()}</div>
      </div>
      <div class="perf-stat">
        <div class="perf-value">
          {new Date(agent.syncedAt).toLocaleDateString()}
        </div>
        <div class="perf-label">{m.marketplace_agentDetailLastUpdated()}</div>
      </div>
    </div>
  </div>
</div>

<style>
  .overview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-card);
  }

  .info-card {
    background: var(--elevation-2-bg);
    border: 1px solid var(--elevation-2-border);
    border-radius: var(--radius-xl);
    padding: var(--space-card);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-card);
  }

  .card-header h3 {
    font-size: var(--font-size-body, 14px);
    font-weight: 700;
    color: var(--color-foreground);
    margin: 0;
  }

  .card-body {
    font-size: var(--font-size-body, 14px);
    line-height: 1.7;
    color: var(--color-muted);
    margin: 0;
  }

  .details-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--hairline);
  }

  .detail-row:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }

  .detail-label {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
  }

  .detail-value {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-foreground);
    font-weight: 500;
  }

  .model-tag {
    padding: var(--space-0-5) var(--space-2);
    background: color-mix(in srgb, var(--color-cyan) 10%, transparent);
    color: var(--color-cyan);
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--color-cyan) 20%, transparent);
  }

  .performance-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-card);
  }

  .perf-stat {
    text-align: center;
  }

  .perf-value {
    font-size: var(--font-size-section-title, 16px);
    font-weight: 700;
    color: var(--color-foreground);
    margin-bottom: var(--space-1);
    font-family: 'JetBrains Mono NF', monospace;
  }

  .perf-label {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  @media (max-width: 640px) {
    .performance-stats {
      grid-template-columns: 1fr;
      gap: var(--space-3);
    }

    .perf-stat {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  }
</style>
