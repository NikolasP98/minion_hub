<script lang="ts">
  import { ArrowUpRight, Globe, Lock } from 'lucide-svelte';
  import type { SemanticValue } from '@minion-stack/ui';
  import { Badge, Card, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { BrainWithKnowledgeStatsDTO } from '$lib/types/brains';
  import { diceBearAvatarUrl } from '$lib/utils/avatar';

  let { brain }: { brain: BrainWithKnowledgeStatsDTO } = $props();

  const detailHref = $derived(`/brains/${encodeURIComponent(brain.id)}`);
  const avatarUrl = $derived(diceBearAvatarUrl(brain.id, 'brain'));

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

<article class:master={brain.kind === 'master'}>
  <Card interactive>
    <div class="brain-card">
      <header>
        <img src={avatarUrl} alt="" class="brain-avatar" loading="lazy" />
        <div class="brain-heading">
          <div class="name-row">
            <a href={detailHref}>
              <span>{brain.name}</span>
              <ArrowUpRight size={iconSizes.xs} aria-hidden="true" />
            </a>
            <Badge
              variant={brain.kind === 'master' ? 'semantic' : 'neutral'}
              value={brain.kind === 'master' ? 'accent' : undefined}
              size="sm"
            >
              {brain.kind === 'master' ? m.brains_kind_master() : m.brains_kind_focused()}
            </Badge>
          </div>
          <p class="visibility">
            {#if brain.visibility === 'private'}
              <Lock size={iconSizes.xs} aria-hidden="true" /> {m.brains_visibility_private()}
            {:else}
              <Globe size={iconSizes.xs} aria-hidden="true" /> {m.brains_visibility_org()}
            {/if}
          </p>
        </div>
        {#if brain.icon}
          <span class="brain-icon" aria-hidden="true">{brain.icon}</span>
        {/if}
      </header>

      {#if brain.description}
        <p class="description">{brain.description}</p>
      {/if}

      <dl class="stats">
        <div>
          <dt>{m.brains_metric_sources()}</dt>
          <dd>{brain.stats.sourceCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{m.brains_metric_documents()}</dt>
          <dd>{brain.stats.documentCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{m.brains_metric_chunks()}</dt>
          <dd>{brain.stats.chunkCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>{m.brains_metric_pending()}</dt>
          <dd class:attention={brain.stats.pendingCount > 0}>{brain.stats.pendingCount.toLocaleString()}</dd>
        </div>
      </dl>

      <footer>
        <div class="connector-list" aria-label={m.brains_connector_health()}>
          {#each brain.connectors.slice(0, 3) as connector (connector.connector)}
            <Badge variant="semantic" value={healthValue(connector.status)} size="sm" dot>
              {connector.connector}
            </Badge>
          {/each}
        </div>
        <p class="freshness">
          <span>{m.brains_last_synced()}</span>
          <time datetime={brain.lastSyncedAt ?? undefined}>{formatDate(brain.lastSyncedAt)}</time>
        </p>
      </footer>
    </div>
  </Card>
</article>

<style>
  article.master :global(.card) {
    border-color: var(--color-accent);
  }

  .brain-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .brain-avatar {
    width: var(--control-height-touch);
    height: var(--control-height-touch);
    flex: none;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }

  .brain-heading {
    min-width: 0;
    flex: 1;
  }

  .name-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .name-row a {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
    text-decoration: none;
  }

  .name-row a:hover {
    text-decoration: underline;
  }

  .name-row a span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .visibility {
    display: inline-flex;
    margin-top: var(--space-0-5);
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .brain-icon {
    flex: none;
    font-size: var(--font-size-page-title);
    line-height: var(--line-height-heading);
  }

  .description {
    display: -webkit-box;
    overflow: hidden;
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
  }

  .stats div {
    min-width: 0;
    padding: var(--space-2);
    border-inline-end: 1px solid var(--color-border-subtle);
  }

  .stats div:last-child {
    border-inline-end: 0;
  }

  .stats dt {
    overflow: hidden;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stats dd {
    margin: var(--space-0-5) 0 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    line-height: var(--line-height-compact);
    font-weight: var(--font-weight-semibold);
    font-variant-numeric: tabular-nums;
  }

  .stats dd.attention {
    color: var(--color-warning-fg);
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .connector-list {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .freshness {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .freshness time {
    color: var(--color-text-secondary);
  }

  @media (max-width: 767.98px) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .stats div:nth-child(2) {
      border-inline-end: 0;
    }

    .stats div:nth-child(-n + 2) {
      border-block-end: 1px solid var(--color-border-subtle);
    }
  }
</style>
