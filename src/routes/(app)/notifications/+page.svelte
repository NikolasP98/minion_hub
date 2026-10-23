<script lang="ts">
  import { untrack } from 'svelte';
  import { rememberView } from '$lib/shell/remember-view.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import { tryUseActions } from '$lib/services/actions/context';
  import PulseReceipt from '$lib/components/pulse/PulseReceipt.svelte';
  import { invalidate } from '$app/navigation';
  import { refreshNotifications } from '$lib/state/features/notifications.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { pulse } from '$lib/state/features/pulse.svelte';
  import { toastPromise } from '$lib/state/ui/toast.svelte';
  import { dayGroupLabel, groupByDay, kindLabel, timeAgo } from '$lib/inbox/feed';
  import { Bell, Check, CheckCheck, Megaphone, Sun, X } from 'lucide-svelte';
  import {
    Badge,
    Button,
    PageHeader,
    SegmentedControl,
    Toggle,
    iconSizes,
  } from '$lib/components/ui';
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

  const actions = tryUseActions();
  $effect(() => {
    pulse.syncScope(actions?.scopeVersion);
  });
  $effect(() => {
    if (conn.connectedAt) untrack(() => void pulse.recover(refreshPulseNotifications));
  });
  let reviewing = $state<string | null>(null);
  let pulseBusyId = $state<string | null>(null);

  // svelte-ignore state_referenced_locally -- seeding editable list state once
  // from the load prop (mutated locally after read/dismiss); re-seeded by
  // refetchInbox(), never by $derived (that would wipe local mutations).
  let inboxItems = $state<InboxItem[]>(data.inboxItems as InboxItem[]);
  let kindFilter = $state<string | null>(null);
  let unreadOnly = $state(false);
  let showResolved = $state(false);
  let inboxBusyId = $state<string | null>(null);

  const kinds = $derived(Array.from(new Set(inboxItems.map((i) => i.kind))));
  const unread = $derived(inboxItems.filter((i) => !i.readAt).length);
  const visibleInbox = $derived(
    inboxItems.filter((i) => (!kindFilter || i.kind === kindFilter) && (!unreadOnly || !i.readAt)),
  );
  const groups = $derived(groupByDay(visibleInbox));
  const requestCount = $derived(data.requests.length + data.pulseProposals.length);

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
      const res = await fetch(`/api/inbox/${item.id}/read`, { method: 'POST' });
      // The server also marks every other unread row sharing this item's href
      // (e.g. five release notes that all link to /changelog) — sync those
      // locally from the returned ids instead of refetching the whole list.
      const body: { ids?: string[] } = res.ok ? await res.json() : {};
      const now = new Date().toISOString();
      for (const id of body.ids ?? [item.id]) {
        const other = inboxItems.find((i) => i.id === id);
        if (other) other.readAt ??= now;
      }
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

  function toggleShowResolved(next: boolean) {
    showResolved = next;
    void refetchInbox();
  }

  async function refreshPulseNotifications() {
    await checkedRefresh(
      () => invalidate('app:notifications'),
      () => page,
    );
  }
  async function decidePulse(id: string, revision: number, action: 'approve' | 'dismiss') {
    if (pulseBusyId || pulse.recovery || pulse.receipt(id)) return;
    pulseBusyId = id;
    try {
      const options = { actions, refresh: refreshPulseNotifications };
      await (action === 'approve'
        ? pulse.approve(id, revision, options)
        : pulse.dismiss(id, revision, options));
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

  rememberView(
    'notifications',
    () => ({ kindFilter, unreadOnly, showResolved }),
    (saved) => {
      kindFilter = saved.kindFilter;
      unreadOnly = saved.unreadOnly;
      showResolved = saved.showResolved;
    },
  );
</script>

<PageShell archetype="collection" scroll="page" labelledBy="notifications-title">
  <PageHeader
    titleId="notifications-title"
    title={m.notif_title()}
    subtitle={unread > 0 ? m.inbox_unreadCount({ count: unread }) : m.inbox_pageSubtitle()}
  >
    {#snippet leading()}<Bell size={iconSizes.md} class="shrink-0 text-accent" />{/snippet}
    {#snippet actions()}
      <Button variant="ghost" size="sm" href="/notifications/daily">
        <Sun size={iconSizes.sm} />
        {m.inbox_daily_title()}
      </Button>
      <Button variant="ghost" size="sm" href="/changelog">
        <Megaphone size={iconSizes.sm} />
        {m.changelog_title()}
      </Button>
      <Button variant="secondary" size="sm" disabled={unread === 0} onclick={markAllInboxRead}>
        <CheckCheck size={iconSizes.sm} />
        {m.inbox_markAllRead()}
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody width="content">
    {#if pulse.error}<p class="t-caption" role="alert">{pulse.error}</p>{/if}
    {#if pulse.recovery}<Button
        variant="secondary"
        loading={pulse.busy}
        onclick={() => pulse.recover(refreshPulseNotifications)}>{m.asyncAction_reload()}</Button
      >{/if}
    {#each pulse.receipts as receipt (receipt.proposalId)}<PulseReceipt {receipt} />{/each}

    <div class="inbox-toolbar">
      <SegmentedControl
        aria-label={m.inbox_kindAll()}
        size="sm"
        items={[
          { value: '__all__', label: m.inbox_kindAll() },
          ...kinds.map((kind) => ({ value: kind, label: kindLabel(kind) })),
        ]}
        value={kindFilter ?? '__all__'}
        onValueChange={(v) => (kindFilter = v === '__all__' ? null : v)}
      />
      <div class="inbox-toolbar-actions">
        <Toggle size="sm" bind:checked={unreadOnly} label={m.inbox_unreadOnly()} />
        <Toggle
          size="sm"
          checked={showResolved}
          onchange={toggleShowResolved}
          label={m.inbox_showResolved()}
        />
      </div>
    </div>

    <AsyncBoundary
      state={visibleInbox.length === 0
        ? {
            kind: 'empty',
            title: m.inbox_allCaughtUp(),
            description: m.inbox_empty(),
          }
        : { kind: 'ready' }}
    >
      {#each groups as group (group.group)}
        <section class="inbox-group" aria-label={dayGroupLabel(group.group)}>
          <h2 class="inbox-group-title">{dayGroupLabel(group.group)}</h2>
          <div class="notification-list" aria-live="polite">
            {#each group.items as item (item.id)}
              <article class="notification-card inbox-card" class:is-unread={!item.readAt}>
                <a
                  href={item.href ?? '/notifications'}
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
                      <time datetime={new Date(item.createdAt).toISOString()}
                        >{timeAgo(item.createdAt)}</time
                      >
                    </div>
                    {#if item.body}
                      <p>{item.body}</p>
                    {/if}
                    <Badge variant="neutral" size="sm">{kindLabel(item.kind)}</Badge>
                  </div>
                </a>
                <div class="notification-actions">
                  {#if !item.readAt}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={inboxBusyId === item.id}
                      onclick={() => markInboxRead(item)}
                    >
                      <Check size={iconSizes.sm} />
                      {m.inbox_markRead()}
                    </Button>
                  {/if}
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
        </section>
      {/each}
    </AsyncBoundary>

    {#if requestCount > 0}
      <section class="inbox-group requests-section" aria-labelledby="requests-title">
        <h2 id="requests-title" class="inbox-group-title">{m.inbox_requestsHeading()}</h2>
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
                <span class="t-caption">{m.pulse_revision({ revision: p.revision })}</span>
              </div>
              <div class="notification-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pulseBusyId !== null ||
                    pulse.recovery !== null ||
                    pulse.receipt(p.id) !== undefined}
                  onclick={() => decidePulse(p.id, p.revision, 'approve')}
                >
                  <Check size={iconSizes.sm} />
                  {m.notif_approve()}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={pulseBusyId === p.id}
                  disabled={pulseBusyId !== null ||
                    pulse.recovery !== null ||
                    pulse.receipt(p.id) !== undefined}
                  onclick={() => decidePulse(p.id, p.revision, 'dismiss')}
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
                  <Check size={iconSizes.sm} />
                  {m.notif_approve()}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={reviewing === req.id}
                  onclick={() => review(req.id, 'denied', req.organizationId)}
                >
                  <X size={iconSizes.sm} />
                  {m.notif_deny()}
                </Button>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/if}
  </PageBody>
</PageShell>

<style>
  .inbox-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
    margin-bottom: var(--space-4, 16px);
  }
  .inbox-toolbar-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4, 16px);
  }
  .inbox-group {
    display: grid;
    gap: var(--space-2, 8px);
    margin-bottom: var(--space-6, 24px);
  }
  .requests-section {
    margin-top: var(--space-6, 24px);
  }
  .inbox-group-title {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
    font-size: var(--font-size-caption, 12px);
    font-weight: var(--font-weight-semibold, 600);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .inbox-card-link {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: var(--space-2, 8px);
    color: inherit;
    text-decoration: none;
  }
  .inbox-dot {
    margin-top: var(--space-1, 4px);
    width: var(--space-2, 8px);
    height: var(--space-2, 8px);
    border-radius: var(--radius-full);
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
  /* Read rows recede; unread rows keep the full-contrast title + accent edge. */
  .inbox-card:not(.is-unread) .notification-title-row strong {
    color: var(--color-text-secondary, var(--color-muted-foreground));
    font-weight: var(--font-weight-medium, 500);
  }
  .inbox-card.is-unread {
    border-left: 3px solid var(--color-accent);
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
  .notification-title-row time {
    flex-shrink: 0;
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
