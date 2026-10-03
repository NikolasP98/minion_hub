<script lang="ts">
  import { Badge, Button, Card } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type {
    NotificationHealthAge,
    NotificationHealthState,
  } from '$lib/notifications/worker-health';
  import type { NotificationHealthController } from './notification-health.svelte';

  let { health }: { health: NotificationHealthController } = $props();

  const value = $derived(health.value);
  const status = $derived(health.status);

  function stateLabel(state: NotificationHealthState): string {
    switch (state) {
      case 'runnable':
        return m.notif_healthRunnable();
      case 'stale':
        return m.notif_healthStale();
      case 'absent':
        return m.notif_healthAbsent();
      case 'catalog_invalid':
        return m.notif_healthCatalogInvalid();
      case 'catalog_mismatch':
        return m.notif_healthCatalogMismatch();
      case 'projection_unavailable':
        return m.notif_healthProjectionUnavailable();
      case 'build_unavailable':
        return m.notif_healthBuildUnavailable();
      case 'startup_failed':
        return m.notif_healthStartupFailed();
    }
  }

  function stateDescription(state: NotificationHealthState): string {
    switch (state) {
      case 'runnable':
        return m.notif_healthRunnableDetail();
      case 'stale':
        return m.notif_healthStaleDetail();
      case 'absent':
        return m.notif_healthAbsentDetail();
      case 'catalog_invalid':
        return m.notif_healthCatalogInvalidDetail();
      case 'catalog_mismatch':
        return m.notif_healthCatalogMismatchDetail();
      case 'projection_unavailable':
        return m.notif_healthProjectionUnavailableDetail();
      case 'build_unavailable':
        return m.notif_healthBuildUnavailableDetail();
      case 'startup_failed':
        return m.notif_healthStartupFailedDetail();
    }
  }

  function badgeValue(state: NotificationHealthState): 'success' | 'warning' | 'error' {
    if (state === 'runnable') return 'success';
    if (state === 'stale' || state === 'absent' || state === 'projection_unavailable') {
      return 'warning';
    }
    return 'error';
  }

  function ageLabel(age: NotificationHealthAge): string {
    if (age.futureTimestamp) return m.notif_healthFutureTimestamp();
    if (age.ageMs === null) return m.notif_healthNever();
    if (age.ageMs < 60_000) return m.notif_justNow();
    const minutes = Math.floor(age.ageMs / 60_000);
    if (minutes < 60) return m.notif_minsAgo({ mins: String(minutes) });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return m.notif_hoursAgo({ hours: String(hours) });
    return m.notif_daysAgo({ days: String(Math.floor(hours / 24)) });
  }

  function queueCount(count: number, lowerBound: boolean): string {
    return lowerBound
      ? m.notif_healthCountAtLeast({ count: String(count) })
      : count.toLocaleString();
  }
</script>

<Card elevation={2} padding="lg" class="notification-health-card">
  {#snippet header()}
    <div class="health-header">
      <div class="health-heading">
        <h2 class="t-title">{m.notif_healthTitle()}</h2>
        <p class="t-caption text-muted">{m.notif_healthSubtitle()}</p>
      </div>
      <div class="health-actions">
        {#if value}
          <Badge variant="semantic" value={badgeValue(value.state)} size="sm" dot>
            {stateLabel(value.state)}
          </Badge>
        {:else}
          <Badge variant="semantic" value="error" size="sm" dot>
            {m.notif_healthUnavailable()}
          </Badge>
        {/if}
        <Button
          variant="outline"
          size="sm"
          class="health-refresh"
          loading={status === 'loading'}
          onclick={() => void health.refresh()}
        >
          {status === 'loading'
            ? m.notif_healthRefreshing()
            : status === 'failed' || status === 'unavailable'
              ? m.common_retry()
              : m.notif_healthRefresh()}
        </Button>
      </div>
    </div>
  {/snippet}

  {#if status === 'failed' || status === 'unavailable'}
    <div class="health-alert" role="alert">
      <strong>{m.notif_healthRefreshFailed()}</strong>
      <span>
        {value ? m.notif_healthRefreshFailedStale() : m.notif_healthRefreshFailedEmpty()}
      </span>
    </div>
  {/if}

  {#if value}
    <p class="health-state-detail">{stateDescription(value.state)}</p>
    <div class="health-grid" aria-label={m.notif_healthQueue()}>
      <div class="health-metric">
        <span class="t-caption text-muted">{m.notif_healthPending()}</span>
        <strong>{queueCount(value.queue.pending.count, value.queue.pending.lowerBound)}</strong>
        <span class="t-caption text-muted">
          {m.notif_healthOldest({ age: ageLabel(value.queue.pending.oldest) })}
        </span>
      </div>
      <div class="health-metric">
        <span class="t-caption text-muted">{m.notif_healthProcessing()}</span>
        <strong
          >{queueCount(value.queue.processing.count, value.queue.processing.lowerBound)}</strong
        >
        <span class="t-caption text-muted">
          {m.notif_healthOldest({ age: ageLabel(value.queue.processing.oldest) })}
        </span>
      </div>
    </div>

    <dl class="health-details">
      <div>
        <dt>{m.notif_healthLastCompleted()}</dt>
        <dd>{ageLabel(value.organization.lastCompleted)}</dd>
      </div>
      <div>
        <dt>{m.notif_healthLastSuccess()}</dt>
        <dd>{ageLabel(value.organization.lastSuccess)}</dd>
      </div>
      <div>
        <dt>{m.notif_healthChecked()}</dt>
        <dd>
          <time datetime={value.checkedAt}>{new Date(value.checkedAt).toLocaleString()}</time>
        </dd>
      </div>
    </dl>

    {#if value.organization.failureStreak > 0}
      <p class="health-warning" role="status">
        {m.notif_healthFailureStreak({ count: String(value.organization.failureStreak) })}
      </p>
    {/if}
    {#if value.queue.unsupportedCatalogPending}
      <p class="health-warning" role="status">{m.notif_healthUnsupportedCatalog()}</p>
    {/if}
  {:else if status === 'loading'}
    <p class="text-muted">{m.notif_healthRefreshing()}</p>
  {/if}
</Card>

<style>
  .health-header,
  .health-actions,
  .health-details > div {
    display: flex;
    align-items: center;
  }

  .health-header {
    justify-content: space-between;
    gap: var(--space-3);
  }

  .health-heading {
    min-width: 0;
  }

  .health-heading h2,
  .health-heading p,
  .health-state-detail,
  .health-warning {
    margin: var(--space-0);
  }

  .health-actions {
    flex: 0 0 auto;
    gap: var(--space-2);
  }

  .health-alert,
  .health-warning {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: var(--hairline) solid var(--color-warning-border);
    border-radius: var(--radius-sm);
    background: var(--color-warning-surface);
    color: var(--color-warning-fg);
  }

  .health-state-detail {
    color: var(--color-text-secondary);
  }

  .health-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .health-metric {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-3);
    border: var(--hairline) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
  }

  .health-metric strong {
    font-size: var(--font-size-section-title);
  }

  .health-details {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    margin: var(--space-3) var(--space-0);
  }

  .health-details > div {
    align-items: flex-start;
    flex-direction: column;
    min-width: 0;
  }

  .health-details dt {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }

  .health-details dd {
    margin: var(--space-0);
    overflow-wrap: anywhere;
  }

  .health-warning {
    margin-top: var(--space-2);
    margin-bottom: var(--space-0);
  }

  @media (max-width: 767.98px), (pointer: coarse) {
    .health-header,
    .health-actions {
      align-items: stretch;
      flex-direction: column;
    }

    .health-grid,
    .health-details {
      grid-template-columns: minmax(0, 1fr);
    }

    :global(.health-refresh) {
      min-height: var(--control-height-touch);
    }
  }
</style>
