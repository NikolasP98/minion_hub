<script lang="ts">
  import { AlertTriangle, Database, Globe2, RefreshCw } from 'lucide-svelte';
  import type { SemanticValue } from '@minion-stack/ui';
  import { Badge, EmptyState, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { BrainDTO, BrainKnowledgeSourceDTO } from '$lib/types/brains';

  let { brain, sources }: { brain: BrainDTO; sources: BrainKnowledgeSourceDTO[] } = $props();

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

<section aria-labelledby="knowledge-sources-title">
  <div class="section-heading">
    <div>
      <h2 id="knowledge-sources-title">{m.brains_sources_title()}</h2>
      <p>
        {brain.includeAllSources ? m.brains_coverage_all() : m.brains_coverage_selected()}
      </p>
    </div>
    <Badge variant="neutral" size="sm">{m.brains_connector_sources({ count: sources.length })}</Badge>
  </div>

  {#if brain.kind === 'master'}
    <div class="master-note">
      <Globe2 size={iconSizes.md} aria-hidden="true" />
      <span>{m.brains_master_managed()}</span>
    </div>
  {/if}

  {#if sources.length === 0}
    <EmptyState title={m.brains_sources_empty()} compact />
  {:else}
    <div class="source-list">
      {#each sources as source (source.id)}
        <article class="source-row">
          <div class="source-icon" aria-hidden="true"><Database size={iconSizes.md} /></div>
          <div class="source-copy">
            <div class="source-title-row">
              <h3>{source.name}</h3>
              <Badge variant="semantic" value={healthValue(source.status)} size="sm" dot>
                {source.status}
              </Badge>
              <Badge variant="neutral" size="sm">{source.connector}</Badge>
            </div>
            <p class="external-key" title={source.externalKey}>{source.externalKey}</p>
            <dl class="source-metrics">
              <div>
                <dt>{m.brains_metric_documents()}</dt>
                <dd>{source.documentCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{m.brains_metric_chunks()}</dt>
                <dd>{source.chunkCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{m.brains_metric_pending()}</dt>
                <dd>{source.pendingCount.toLocaleString()}</dd>
              </div>
            </dl>
          </div>
          <div class="source-sync">
            <p><RefreshCw size={iconSizes.xs} aria-hidden="true" /> {source.syncMode}</p>
            <time datetime={source.lastSyncedAt ?? undefined}>{formatDate(source.lastSyncedAt)}</time>
            {#if source.lastError}
              <p class="source-error" title={source.lastError}>
                <AlertTriangle size={iconSizes.xs} aria-hidden="true" />
                <span>{source.lastError}</span>
              </p>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
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

  .master-note {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--color-info-border);
    border-radius: var(--radius-lg);
    color: var(--color-info-fg);
    background: var(--color-info-surface);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
  }

  .source-list {
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-xl);
    background: var(--color-surface-1);
  }

  .source-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .source-row:last-child {
    border-bottom: 0;
  }

  .source-icon {
    display: grid;
    width: var(--control-height-sm);
    height: var(--control-height-sm);
    place-items: center;
    border-radius: var(--radius-lg);
    color: var(--color-accent);
    background: var(--color-surface-2);
  }

  .source-copy {
    min-width: 0;
  }

  .source-title-row {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .source-title-row h3 {
    overflow: hidden;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .external-key {
    overflow: hidden;
    margin-top: var(--space-1);
    color: var(--color-text-tertiary);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .source-metrics div {
    display: flex;
    gap: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .source-metrics dd {
    margin: 0;
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);
    font-variant-numeric: tabular-nums;
  }

  .source-sync {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
    text-align: end;
  }

  .source-sync p {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .source-sync .source-error {
    max-width: 100%;
    color: var(--color-danger-fg);
  }

  .source-error span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 767.98px) {
    .source-row {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .source-sync {
      grid-column: 2;
      max-width: none;
      align-items: flex-start;
      text-align: start;
    }
  }
</style>
