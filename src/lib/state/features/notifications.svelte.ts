import { updateState } from '$lib/state/gateway/update-state.svelte';
import * as m from '$lib/paraglide/messages';
import { toastInfo } from '$lib/state/ui/toast.svelte';
import { kindLabel } from '$lib/inbox/feed';
import { pulse } from './pulse.svelte';

export const notifications = $state({
  pendingCount: 0,
  /** Unread inbox count (scope-resolved app_notifications) — `/api/inbox/count`. */
  inboxUnreadCount: 0,
  /** POS Accounts side-menu badge. Polled with the shell counts so the badge
   *  survives leaving /pos, where its layout load no longer runs. `null` =
   *  not known yet or not permitted, which renders no badge at all (never 0). */
  posPendingWork: null as number | null,
  lastFetched: 0,
  /** Total bell badge count — join requests + pulse proposals + a pending gateway update (max 1) + inbox unread. */
  get badgeCount() {
    return (
      this.pendingCount + pulse.pendingCount + (updateState.pending ? 1 : 0) + this.inboxUnreadCount
    );
  },
  get hasPending() {
    return this.badgeCount > 0;
  },
});

let refreshInFlight: Promise<void> | null = null;
/** False until the first inbox count lands, so page load never toasts the backlog. */
let inboxPrimed = false;

/** A poll tick saw the unread count grow: surface the newest row as a toast
 *  (the bell badge alone is easy to miss on a busy screen). */
async function announceNewestUnread(): Promise<void> {
  try {
    const res = await fetch('/api/inbox?limit=1');
    if (!res.ok) return;
    const data = await res.json();
    const row = data.items?.[0] as
      | { id: string; kind: string; title: string; href: string | null; readAt: string | null }
      | undefined;
    if (!row || row.readAt) return;
    toastInfo(row.title, kindLabel(row.kind), {
      duration: 8000,
      action: {
        label: m.inbox_open(),
        onClick: () => {
          void fetch(`/api/inbox/${row.id}/read`, { method: 'POST' });
          window.location.assign(row.href ?? '/notifications');
        },
      },
    });
  } catch {
    // toast is best-effort
  }
}
let pollSubscribers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** One request instead of three (`/api/join-requests/count` + `/api/inbox/count`
 *  + `/api/pulse/count`) — see `/api/shell/counts`. */
async function runRefreshNotifications() {
  const publishPulseCount = pulse.beginCountRead();
  try {
    const res = await fetch('/api/shell/counts');
    if (res.ok) {
      const data = await res.json();
      notifications.pendingCount = data.joinRequests ?? 0;
      const next = data.inbox ?? 0;
      const grew = inboxPrimed && next > notifications.inboxUnreadCount;
      notifications.inboxUnreadCount = next;
      inboxPrimed = true;
      if (grew) void announceNewestUnread();
      publishPulseCount(data.pulse ?? 0);
      notifications.posPendingWork = typeof data.posPending === 'number' ? data.posPending : null;
      notifications.lastFetched = Date.now();
    }
  } catch {
    // Silently fail — shell badges just won't update this tick
  }
}

/** Coalesce callers so shell surfaces never duplicate the same two requests. */
export function refreshNotifications(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = runRefreshNotifications().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** The daily feed's knock — client-side, once per org-local day (owner decision
 * 2026-10-10): the app shell calls this on mount/org-switch; the localStorage
 * key is a cheap per-browser skip, the server's dedupe_key is the real guard.
 * TODO(handoff): the guard key uses the BROWSER's local date, not the org's
 * timezone — a user working near midnight near their org's tz boundary could
 * call this twice in the same org-local day (harmless: the server still
 * dedupes), or skip a call across devices. Upgrade if that's ever observed. */
export async function maybeRequestDailyKnock(orgId: string): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const storageKey = `inbox:daily:${orgId}:${date}`;
  try {
    if (localStorage.getItem(storageKey)) return;
  } catch {
    // private window / blocked storage — fall through, server dedupe still guards
  }
  try {
    await fetch('/api/inbox/daily', { method: 'POST' });
  } catch {
    return;
  }
  try {
    localStorage.setItem(storageKey, '1');
  } catch {
    // ignore — nothing to persist the skip for next time
  }
}

const POLL_INTERVAL_MS = 120_000;

function handleVisibilityChange() {
  if (!document.hidden) void refreshNotifications();
}

/** Reference-counted shell polling. Topbar and SidebarUtilities are both mounted
 * at every breakpoint even though CSS hides one, so they share one timer. A
 * background tab skips the tick entirely (no idle-tab request at all) and
 * gets an immediate refresh the moment it becomes visible again. */
export function subscribeNotificationsPolling(): () => void {
  pollSubscribers += 1;
  if (pollSubscribers === 1) {
    void refreshNotifications();
    pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshNotifications();
    }, POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
  }
  return () => {
    pollSubscribers = Math.max(0, pollSubscribers - 1);
    if (pollSubscribers === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    }
  };
}
