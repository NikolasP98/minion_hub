<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { canClient, canViewPath } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';
  import { Bell, ArrowRight, Download, Check, CheckCheck, X } from 'lucide-svelte';
  import { afterNavigate } from '$lib/navigation';
  import { updateState } from '$lib/state/gateway/update-state.svelte';
  import { Button, Popover, Spinner, Tooltip, iconSizes } from '$lib/components/ui';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { pulse } from '$lib/state/features/pulse.svelte';
  import { notifications, refreshNotifications } from '$lib/state/features/notifications.svelte';
  import { kindLabel, timeAgo } from '$lib/inbox/feed';
  import PulseReceipt from '$lib/components/pulse/PulseReceipt.svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  const actions = tryUseActions();
  $effect(() => {
    if (conn.connectedAt && canViewPath('/pulse')) untrack(() => void pulse.recover(undefined));
  });

  interface PendingRequest {
    id: string;
    email: string;
    message: string | null;
    createdAt: number;
  }

  interface InboxRow {
    id: string;
    kind: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    href: string | null;
    createdAt: string;
    readAt: string | null;
  }

  let {
    open = $bindable(false),
    trigger,
    placement = 'bottom-end',
  }: {
    open?: boolean;
    trigger: Snippet;
    placement?: 'top' | 'bottom' | 'left' | 'right' | 'bottom-end';
  } = $props();

  let refreshGeneration = 0;
  let requests = $state<PendingRequest[]>([]);
  let inboxRows = $state<InboxRow[]>([]);
  let loading = $state(false);
  let pulseBusyId = $state<string | null>(null);

  const pulseItems = $derived(pulse.items);
  // Unread first so a fresh reminder is never pushed below yesterday's read rows.
  const orderedInbox = $derived(
    [...inboxRows].sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt))),
  );
  // Rows rendered — read inbox rows included — drives the empty state only.
  const total = $derived(
    requests.length + pulseItems.length + inboxRows.length + pulse.receipts.length,
  );

  async function fetchRequests(generation = refreshGeneration) {
    loading = true;
    try {
      const res = await fetch('/api/join-requests/pending');
      if (res.ok) {
        const data = await res.json();
        if (generation === refreshGeneration) requests = data.requests ?? [];
      }
    } catch {
      // silent
    } finally {
      if (generation === refreshGeneration) loading = false;
    }
  }

  async function fetchInboxRows(generation = refreshGeneration) {
    try {
      const res = await fetch('/api/inbox?limit=8');
      if (res.ok) {
        const data = await res.json();
        if (generation === refreshGeneration) inboxRows = data.items ?? [];
      }
    } catch {
      // silent — the inbox section just stays empty this open
    }
  }

  function openInboxRow(row: InboxRow) {
    close();
    if (row.readAt) return;
    row.readAt = new Date().toISOString();
    // The server also marks every other unread row with the same href (e.g.
    // five release notes that all link to /changelog) — sync those locally
    // from the returned ids instead of refetching the whole list.
    void fetch(`/api/inbox/${row.id}/read`, { method: 'POST' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { ids?: string[] } | null) => {
        const now = new Date().toISOString();
        for (const id of body?.ids ?? []) {
          const other = inboxRows.find((item) => item.id === id);
          if (other) other.readAt ??= now;
        }
        void refreshNotifications();
      });
  }

  async function markAllRead() {
    await fetch('/api/inbox/read-all', { method: 'POST' });
    const now = new Date().toISOString();
    for (const row of inboxRows) row.readAt ??= now;
    void refreshNotifications();
  }

  async function pulseAct(id: string, revision: number, action: 'approve' | 'dismiss') {
    if (pulseBusyId || pulse.recovery || pulse.receipt(id)) return;
    pulseBusyId = id;
    try {
      // pulse.act() already re-fetches items + count internally, and
      // notifications.badgeCount reads pulse.pendingCount reactively — the
      // bell badge updates on its own, no extra refresh call needed.
      await (action === 'approve'
        ? pulse.approve(id, revision, { actions })
        : pulse.dismiss(id, revision, { actions }));
    } finally {
      pulseBusyId = null;
    }
  }

  // Refresh only for intentional open/identity/access changes. Receipt publication is
  // an output of these reads and must not become another refresh dependency.
  $effect(() => {
    pulse.syncScope(actions?.scopeVersion);
    const pulseAllowed = canViewPath('/pulse');
    const reviewAllowed = canClient('users:manage');
    const isOpen = open;
    const generation = ++refreshGeneration;
    untrack(() => {
      requests = [];
      inboxRows = [];
      pulseBusyId = null;
      if (!isOpen) {
        loading = false;
        return;
      }
      if (reviewAllowed) void fetchRequests(generation);
      else loading = false;
      void fetchInboxRows(generation);
      if (pulseAllowed) void pulse.refresh();
      void refreshNotifications();
    });
  });

  // Belt-and-suspenders close: the Popover already dismisses on outside
  // click / Escape (Zag), but an in-panel link click navigates the app
  // without necessarily going through `close()` synchronously first.
  afterNavigate(() => {
    open = false;
  });

  function close() {
    open = false;
  }
</script>

{#snippet triggerContent()}
  {@render trigger()}
{/snippet}

<Popover
  bind:open
  {placement}
  bare
  class="w-80 bg-bg2 border border-border rounded-xl shadow-xl overflow-hidden"
  trigger={triggerContent}
>
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--hairline)]">
    <div class="flex items-center gap-2">
      <h3 class="text-sm font-semibold text-foreground">{m.notificationsPopup_title()}</h3>
      {#if notifications.badgeCount > 0}
        <span
          class="text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded-full bg-accent/15 text-accent"
        >
          {notifications.badgeCount}
        </span>
      {/if}
    </div>
    {#if notifications.inboxUnreadCount > 0}
      <Tooltip label={m.inbox_markAllRead()}>
        <Button
          variant="ghost"
          shape="icon"
          size="xs"
          onclick={markAllRead}
          aria-label={m.inbox_markAllRead()}
        >
          <CheckCheck size={iconSizes.xs} />
        </Button>
      </Tooltip>
    {/if}
  </div>

  <!-- List -->
  <div class="max-h-80 overflow-y-auto">
    {#each orderedInbox as row (row.id)}
      <a
        href={row.href ?? '/notifications'}
        onclick={() => openInboxRow(row)}
        class="flex items-start gap-2 px-4 py-3 border-b border-[var(--hairline)] hover:bg-bg3/50 transition-colors duration-[var(--duration-fast)] no-underline text-foreground"
        class:bg-accent-soft={!row.readAt}
      >
        <span
          class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
          class:bg-destructive={row.severity === 'critical'}
          class:bg-warning={row.severity === 'warning'}
          class:bg-accent={row.severity === 'info'}
          class:opacity-40={Boolean(row.readAt)}
        ></span>
        <div class="flex flex-col min-w-0 flex-1">
          <span
            class="text-sm truncate"
            class:font-semibold={!row.readAt}
            class:text-muted-foreground={Boolean(row.readAt)}
          >
            {row.title}
          </span>
          <span class="text-[length:var(--font-size-telemetry)] text-muted-foreground truncate">
            {kindLabel(row.kind)} · {timeAgo(row.createdAt)}
          </span>
        </div>
      </a>
    {/each}
    {#if updateState.pending}
      <a
        href="/settings/gateways"
        onclick={close}
        class="flex items-center gap-2 px-4 py-3 border-b border-[var(--hairline)] hover:bg-bg3/50 transition-colors duration-[var(--duration-fast)] no-underline text-foreground"
      >
        <Download size={iconSizes.sm} class="text-accent shrink-0" />
        <span class="text-xs font-medium truncate">
          {m.gateway_update_bellRow({ version: updateState.pending.version })}
        </span>
      </a>
    {/if}
    {#if pulse.error}<p class="t-caption" role="alert">{pulse.error}</p>{/if}
    {#if pulse.recovery}<Button
        variant="secondary"
        loading={pulse.busy}
        onclick={() => pulse.recover()}>{m.asyncAction_reload()}</Button
      >{/if}
    {#each pulse.receipts as receipt (receipt.proposalId)}<PulseReceipt {receipt} />{/each}
    {#if loading}
      <div class="flex items-center justify-center py-8">
        <Spinner size="md" />
      </div>
    {:else if total === 0}
      <div class="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
        <Bell size={24} class="opacity-40" />
        <p class="text-xs">{m.inbox_allCaughtUp()}</p>
      </div>
    {:else}
      {#if pulseItems.length > 0}
        <a
          href="/pulse"
          onclick={close}
          class="flex items-center justify-between px-4 py-1.5 border-b border-[var(--hairline)] text-[length:var(--font-size-telemetry)] font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground no-underline"
        >
          {m.nav_pulse()}
        </a>
        {#each pulseItems as p (p.id)}
          <div
            class="flex flex-col px-4 py-3 border-b border-[var(--hairline)] hover:bg-bg3/50 transition-colors duration-[var(--duration-fast)]"
          >
            <span class="text-sm font-medium text-foreground truncate">{p.title}</span>
            <span class="t-caption">{m.pulse_revision({ revision: p.revision })}</span>
            {#if p.summary}
              <p class="text-xs text-muted mt-0.5 line-clamp-2">{p.summary}</p>
            {/if}
            <div class="flex items-center gap-2 mt-1.5">
              <Button
                variant="ghost"
                size="xs"
                loading={pulseBusyId === p.id}
                disabled={pulseBusyId !== null ||
                  pulse.recovery !== null ||
                  pulse.receipt(p.id) !== undefined}
                onclick={() => pulseAct(p.id, p.revision, 'approve')}
              >
                <Check size={iconSizes.xs} />
                {m.notif_approve()}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                loading={pulseBusyId === p.id}
                disabled={pulseBusyId !== null ||
                  pulse.recovery !== null ||
                  pulse.receipt(p.id) !== undefined}
                onclick={() => pulseAct(p.id, p.revision, 'dismiss')}
              >
                <X size={iconSizes.xs} />
                {m.common_dismiss()}
              </Button>
            </div>
          </div>
        {/each}
      {/if}
      {#if requests.length > 0}
        <a
          href="/notifications"
          onclick={close}
          class="flex items-center justify-between px-4 py-1.5 border-b border-[var(--hairline)] text-[length:var(--font-size-telemetry)] font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground no-underline"
        >
          {m.inbox_requestsHeading()}
        </a>
      {/if}
      {#each requests as req (req.id)}
        <div
          class="flex flex-col px-4 py-3 border-b border-[var(--hairline)] last:border-b-0 hover:bg-bg3/50 transition-colors duration-[var(--duration-fast)]"
        >
          <div class="flex items-start justify-between gap-2">
            <span class="text-sm font-medium text-foreground truncate">{req.email}</span>
            <span class="text-[length:var(--font-size-telemetry)] text-muted-foreground shrink-0"
              >{timeAgo(req.createdAt)}</span
            >
          </div>
          {#if req.message}
            <p class="text-xs text-muted mt-0.5 line-clamp-2">{req.message}</p>
          {/if}
          <span class="text-[length:var(--font-size-telemetry)] text-accent mt-1 font-medium"
            >{m.notificationsPopup_pending()}</span
          >
        </div>
      {/each}
    {/if}
  </div>

  <!-- Footer -->
  <a
    href="/notifications"
    onclick={close}
    class="flex items-center justify-center gap-1.5 px-4 py-2.5 border-t border-[var(--hairline)] text-xs font-medium text-accent hover:bg-bg3 transition-colors duration-[var(--duration-fast)] no-underline"
  >
    {m.notificationsPopup_seeAll()}
    <ArrowRight size={iconSizes.xs} />
  </a>
</Popover>

<style>
  .bg-accent-soft {
    background: color-mix(in srgb, var(--color-accent) 6%, transparent);
  }

  /* tailwind line-clamp fallback */
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
