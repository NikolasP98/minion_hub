<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { refreshNotifications } from '$lib/state/features/notifications.svelte';
  import { toastPromise } from '$lib/state/ui/toast.svelte';
  import { Bell, Check, X } from 'lucide-svelte';
  import { Badge, Button, PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';

  let { data }: { data: PageData } = $props();

  let reviewing = $state<string | null>(null);

  async function review(id: string, status: 'approved' | 'denied') {
    reviewing = id;
    try {
      await toastPromise(
        fetch(`/api/join-requests/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
          await invalidate('app:notifications');
          refreshNotifications();
        }),
        {
          loading: status === 'approved' ? m.notif_approving() : m.notif_denying(),
          success: status === 'approved' ? m.notif_approved() : m.notif_denied(),
          error: (err: unknown) => (err instanceof Error ? err.message : m.notif_failedProcess()),
        },
      );
    } finally {
      reviewing = null;
    }
  }

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return m.notif_justNow();
    if (mins < 60) return m.notif_minsAgo({ mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return m.notif_hoursAgo({ hours: hrs });
    const days = Math.floor(hrs / 24);
    return m.notif_daysAgo({ days });
  }
</script>

<PageShell archetype="collection" scroll="page" labelledBy="notifications-title">
  <PageHeader
    titleId="notifications-title"
    title={m.notif_title()}
    subtitle="Requests that need an administrator decision"
  >
    {#snippet leading()}<Bell size={16} class="shrink-0 text-accent" />{/snippet}
  </PageHeader>

  <PageBody width="content">
    <AsyncBoundary
      state={data.requests.length === 0
        ? {
            kind: 'empty',
            title: m.notif_noNotifications(),
            description: 'Access requests will appear here when they need review.',
          }
        : { kind: 'ready' }}
    >
      <div class="notification-list" aria-live="polite">
        {#each data.requests as req (req.id)}
          <article class="notification-card">
            <div class="notification-copy">
              <div class="notification-title-row">
                <strong>{req.email}</strong>
                <time datetime={new Date(req.createdAt).toISOString()}
                  >{timeAgo(req.createdAt)}</time
                >
              </div>
              {#if req.message}
                <p>{req.message}</p>
              {/if}
              <Badge variant="semantic" value="warning" size="sm">
                {m.notif_accessRequestPending()}
              </Badge>
            </div>
            <div class="notification-actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={reviewing === req.id}
                onclick={() => review(req.id, 'approved')}
              >
                <Check size={14} />
                {m.notif_approve()}
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={reviewing === req.id}
                onclick={() => review(req.id, 'denied')}
              >
                <X size={14} />
                {m.notif_deny()}
              </Button>
            </div>
          </article>
        {/each}
      </div>
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  .notification-list {
    display: grid;
    gap: var(--space-2, 8px);
  }
  .notification-card {
    display: flex;
    min-width: 0;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4, 16px);
    padding: var(--space-4, 16px);
    border: 1px solid var(--color-border-subtle, var(--hairline));
    border-radius: var(--radius-lg);
    background: var(--color-surface-2, var(--elevation-2-bg));
    transition:
      border-color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  .notification-card:hover {
    border-color: var(--color-border-default, var(--color-border));
    background: var(--color-surface-3, var(--elevation-3-bg));
  }
  .notification-copy {
    display: grid;
    min-width: 0;
    justify-items: start;
    gap: var(--space-2, 8px);
  }
  .notification-title-row {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: var(--space-2, 8px);
  }
  .notification-title-row strong {
    overflow: hidden;
    color: var(--color-text-primary, var(--color-foreground));
    font-size: var(--font-size-body, 14px);
    line-height: var(--line-height-body, 20px);
    font-weight: var(--font-weight-semibold, 600);
    text-overflow: ellipsis;
  }
  .notification-title-row time,
  .notification-copy p {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  .notification-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  @media (max-width: 767.98px) {
    .notification-card {
      flex-direction: column;
    }
    .notification-actions {
      width: 100%;
    }
    .notification-actions :global(button) {
      flex: 1;
    }
  }
</style>
