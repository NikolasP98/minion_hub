<script lang="ts">
  import {
    AlertTriangle,
    CheckCircle2,
    Clock3,
    Database,
    FileText,
    Layers3,
    Plug,
  } from 'lucide-svelte';
  import type { SemanticValue } from '@minion-stack/ui';
  import { Badge, Card, EmptyState, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { BrainKnowledgeOverviewDTO } from '$lib/types/brains';

  let { overview }: { overview: BrainKnowledgeOverviewDTO } = $props();

  const healthValue = (status: string): SemanticValue => {
    if (status === 'ready' || status === 'active') return 'success';
    if (status === 'failed' || status === 'error') return 'error';
    if (status === 'degraded') return 'warning';
    return 'info';
  };

  const formatDate = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(value),
        )
      : m.brains_never_synced();
</script>

<div class="overview-stack">
  <div class="coverage-note">
    {#if overview.brain.includeAllSources}
      <CheckCircle2 size={iconSizes.md} aria-hidden="true" />
      <span>{m.brains_coverage_all()}</span>
    {:else}
      <Layers3 size={iconSizes.md} aria-hidden="true" />
      <span>{m.brains_coverage_selected()}</span>
    {/if}
  </div>

  <dl class="metric-grid">
    <div>
      <dt><Database size={iconSizes.md} aria-hidden="true" /> {m.brains_metric_sources()}</dt>
      <dd>{overview.stats.sourceCount.toLocaleString()}</dd>
    </div>
    <div>
      <dt><FileText size={iconSizes.md} aria-hidden="true" /> {m.brains_metric_documents()}</dt>
      <dd>{overview.stats.documentCount.toLocaleString()}</dd>
    </div>
    <div>
      <dt><Layers3 size={iconSizes.md} aria-hidden="true" /> {m.brains_metric_chunks()}</dt>
      <dd>{overview.stats.chunkCount.toLocaleString()}</dd>
    </div>
    <div>
      <dt><Clock3 size={iconSizes.md} aria-hidden="true" /> {m.brains_metric_pending()}</dt>
      <dd class:attention={overview.stats.pendingCount > 0}>
        {overview.stats.pendingCount.toLocaleString()}
      </dd>
    </div>
  </dl>

  <section aria-labelledby="connector-health-title">
    <div class="section-heading">
      <div>
        <h2 id="connector-health-title">{m.brains_connector_health()}</h2>
        <p>{m.brains_section_master_desc()}</p>
      </div>
      {#if overview.stats.failedSourceCount > 0}
        <Badge variant="semantic" value="error" size="sm" dot>
          {overview.stats.failedSourceCount.toLocaleString()}
          {m.brains_status_failed()}
        </Badge>
      {/if}
    </div>

    {#if overview.connectors.length === 0}
      <EmptyState title={m.brains_sources_empty()} compact />
    {:else}
      <div class="connector-grid">
        {#each overview.connectors as connector (connector.connector)}
          <Card>
            <div class="connector-card">
              <div class="connector-topline">
                <div class="connector-name">
                  <Plug size={iconSizes.md} aria-hidden="true" />
                  <strong>{connector.connector}</strong>
                </div>
                <Badge variant="semantic" value={healthValue(connector.status)} size="sm" dot>
                  {connector.status}
                </Badge>
              </div>
              <p>{m.brains_connector_sources({ count: connector.sourceCount })}</p>
              <p class="freshness">
                <span>{m.brains_last_synced()}</span>
                <time datetime={connector.lastSyncedAt ?? undefined}
                  >{formatDate(connector.lastSyncedAt)}</time
                >
              </p>
              {#if connector.lastError}
                <p class="connector-error" title={connector.lastError}>
                  <AlertTriangle size={iconSizes.sm} aria-hidden="true" />
                  <span>{connector.lastError}</span>
                </p>
              {/if}
            </div>
          </Card>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .overview-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .coverage-note {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-lg);
    color: var(--color-accent);
    background: var(--color-surface-2);
    font-size: var(--font-size-body);
    line-height: var(--line-height-body);
  }

  .metric-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .metric-grid > div {
    padding: var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }

  .metric-grid dt {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .metric-grid dd {
    margin: var(--space-2) 0 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-page-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  .metric-grid dd.attention {
    color: var(--color-warning-fg);
  }

  .section-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .section-heading h2 {
    color: var(--color-text-primary);
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
  }

  .section-heading p {
    margin-top: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
  }

  .connector-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .connector-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .connector-topline,
  .connector-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .connector-topline {
    justify-content: space-between;
  }

  .connector-name {
    min-width: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    line-height: var(--line-height-compact);
  }

  .connector-card > p {
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
  }

  .freshness {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .freshness span {
    color: var(--color-text-tertiary);
  }

  .connector-card .connector-error {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-danger-fg);
  }

  .connector-error span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 767.98px) {
    .metric-grid,
    .connector-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
