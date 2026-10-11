<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { refreshNotifications } from '$lib/state/features/notifications.svelte';
  import { pulse } from '$lib/state/features/pulse.svelte';
  import { toastPromise } from '$lib/state/ui/toast.svelte';
  import { Bell, Check, X } from 'lucide-svelte';
  import { Badge, Button, PageHeader, SegmentedControl, iconSizes } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';

  interface InboxItem {
    id: string;
    scope: string;
    kind: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    body: string | null;
    href: string | null;
    // The server load hands back Date objects (devalue); the refetch path
    // (plain fetch + JSON) hands back ISO strings — both render the same way.
    createdAt: string | Date;
    resolvedAt: string | Date | null;
    readAt: string | Date | null;
    dismissedAt: string | Date | null;
  }

  let { data }: { data: PageData } = $props();

  let reviewing = $state<string | null>(null);
  let pulseBusyId = $state<string | null>(null);

  // svelte-ignore state_referenced_locally -- seeding editable list state once
  // from the load prop (mutated locally after read/dismiss); re-seeded by
  // refetchInbox(), never by $derived (that would wipe local mutations).
  let inboxItems = $state<InboxItem[]>(data.inboxItems as InboxItem[]);
  let kindFilter = $state<string | null>(null);
  let showResolved = $state(false);
  let inboxBusyId = $state<string | null>(null);

  const kinds = $derived(Array.from(new Set(inboxItems.map((i) => i.kind))));
  const visibleInbox = $derived(inboxItems.filter((i) => !kindFilter || i.kind === kindFilter));

  async function refetchInbox() {
    const params = new URLSearchParams();
    if (showResolved) params.set('includeResolved', '1');
    const res = await fetch(`/api/inbox?${params.toString()}`);
    if (res.ok) {
      const body = await res.json();
      inboxItems = body.items ?? [];
    }
  }

  async function markInboxRead(item: InboxItem) {
    if (item.readAt) return;
    inboxBusyId = item.id;
    try {
      await fetch(`/api/inbox/${item.id}/read`, { method: 'POST' });
      item.readAt = new Date().toISOString();
      refreshNotifications();
    } finally {
      inboxBusyId = null;
    }
  }

  async function dismissInbox(item: InboxItem) {
    inboxBusyId = item.id;
    try {
      await fetch(`/api/inbox/${item.id}/dismiss`, { method: 'POST' });
      inboxItems = inboxItems.filter((i) => i.id !== item.id);
      refreshNotifications();
    } finally {
      inboxBusyId = null;
    }
  }

  async function markAllInboxRead() {
    await fetch('/api/inbox/read-all', { method: 'POST' });
    await refetchInbox();
    refreshNotifications();
  }

  function toggleShowResolved() {
    showResolved = !showResolved;
    void refetchInbox();
  }

  async function decidePulse(id: string, action: 'approve' | 'dismiss') {
    pulseBusyId = id;
    try {
      await (action === 'approve' ? pulse.approve(id) : pulse.dismiss(id));
      await invalidate('app:notifications');
    } finally {
      pulseBusyId = null;
    }
  }

  async function review(id: string, status: 'approved' | 'denied', organizationId: string) {
    reviewing = id;
    try {
      // approve/deny are the ONE approve implementation (the Turso-era
      // hardcoded-role /api/join-requests/[id] path was removed) — grants a
      // real RBAC role (default staff) instead of always 'user'.
      const req =
        status === 'approved'
          ? fetch(`/api/join-requests/${id}/approve`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ organizationId }),
            })
          : fetch(`/api/join-requests/${id}/deny`, { method: 'POST' });
      await toastPromise(
        req.then(async (res) => {
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
      state={data.requests.length === 0 && data.pulseProposals.length === 0
        ? {
            kind: 'empty',
            title: m.notif_noNotifications(),
            description: 'Access requests will appear here when they need review.',
          }
        : { kind: 'ready' }}
    >
      <div class="notification-list" aria-live="polite">
        {#each data.pulseProposals as p (p.id)}
          <article class="notification-card">
            <div class="notification-copy">
              <div class="notification-title-row">
                <strong>{p.title}</strong>
              </div>
              {#if p.summary}
                <p>{p.summary}</p>
              {/if}
              <Badge variant="neutral" size="sm">{m.nav_pulse()}</Badge>
            </div>
            <div class="notification-actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={pulseBusyId === p.id}
                onclick={() => decidePulse(p.id, 'approve')}
              >
                <Check size={iconSizes.sm} />
                {m.notif_approve()}
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={pulseBusyId === p.id}
                onclick={() => decidePulse(p.id, 'dismiss')}
              >
                <X size={iconSizes.sm} />
                {m.common_dismiss()}
              </Button>
            </div>
          </article>
        {/each}
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
                onclick={() => review(req.id, 'approved', req.organizationId)}
              >
                <Check size={14} />
                {m.notif_approve()}
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={reviewing === req.id}
                onclick={() => review(req.id, 'denied', req.organizationId)}
              >
                <X size={14} />
                {m.notif_deny()}
              </Button>
            </div>
          </article>
        {/each}
      </div>
    </AsyncBoundary>

    <section class="inbox-section">
      <div class="inbox-toolbar">
        <SegmentedControl
          aria-label={m.inbox_kindAll()}
          size="sm"
          items={[
            { value: '__all__', label: m.inbox_kindAll() },
            ...kinds.map((kind) => ({ value: kind, label: kind })),
          ]}
          value={kindFilter ?? '__all__'}
          onValueChange={(v) => (kindFilter = v === '__all__' ? null : v)}
        />
        <div class="inbox-toolbar-actions">
          <label class="inbox-toggle">
            <input type="checkbox" checked={showResolved} onchange={toggleShowResolved} />
            {m.inbox_showResolved()}
          </label>
          <Button variant="secondary" size="sm" onclick={markAllInboxRead}>
            {m.inbox_markAllRead()}
          </Button>
        </div>
      </div>

      {#if visibleInbox.length === 0}
        <p class="inbox-empty">{m.inbox_empty()}</p>
      {:else}
        <div class="notification-list" aria-live="polite">
          {#each visibleInbox as item (item.id)}
            <article class="notification-card inbox-card">
              <a
                href={item.href ?? '#'}
                class="inbox-card-link"
                onclick={() => markInboxRead(item)}
              >
                <span
                  class="inbox-dot"
                  class:bg-destructive={item.severity === 'critical'}
                  class:bg-warning={item.severity === 'warning'}
                  class:bg-accent={item.severity === 'info'}
                ></span>
                <div class="notification-copy">
                  <div class="notification-title-row">
                    <strong>{item.title}</strong>
                  </div>
                  {#if item.body}
                    <p>{item.body}</p>
                  {/if}
                </div>
              </a>
              <div class="notification-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={inboxBusyId === item.id}
                  onclick={() => dismissInbox(item)}
                >
                  <X size={iconSizes.sm} />
                  {m.common_dismiss()}
                </Button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </PageBody>
</PageShell>

<style>
  .inbox-section {
    display: grid;
    gap: var(--space-3, 12px);
    margin-top: var(--space-6, 24px);
  }
  .inbox-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
  }
  .inbox-toolbar-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
  }
  .inbox-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-text-secondary, var(--color-muted-foreground));
  }
  .inbox-empty {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
  }
  .inbox-card-link {
    display: flex;
    min-width: 0;
    gap: var(--space-2, 8px);
    color: inherit;
    text-decoration: none;
  }
  .inbox-dot {
    margin-top: 6px;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
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
