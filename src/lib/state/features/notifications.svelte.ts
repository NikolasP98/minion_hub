import { updateState } from '$lib/state/gateway/update-state.svelte';
import { pulse } from './pulse.svelte';

export const notifications = $state({
  pendingCount: 0,
  /** Unread inbox count (scope-resolved app_notifications) — `/api/inbox/count`. */
  inboxUnreadCount: 0,
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
let pollSubscribers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function runRefreshNotifications() {
  try {
    const res = await fetch('/api/join-requests/count');
    if (res.ok) {
      const data = await res.json();
      notifications.pendingCount = data.count ?? 0;
      notifications.lastFetched = Date.now();
    }
  } catch {
    // Silently fail — notification bell just won't show a badge
  }
  try {
    const res = await fetch('/api/inbox/count');
    if (res.ok) {
      const data = await res.json();
      notifications.inboxUnreadCount = data.count ?? 0;
    }
  } catch {
    // Silently fail — inbox badge just won't update this tick
  }
  await pulse.refreshCount();
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

/** Reference-counted shell polling. Topbar and SidebarUtilities are both mounted
 * at every breakpoint even though CSS hides one, so they share one timer. */
export function subscribeNotificationsPolling(): () => void {
  pollSubscribers += 1;
  if (pollSubscribers === 1) {
    void refreshNotifications();
    pollTimer = setInterval(() => void refreshNotifications(), 60_000);
  }
  return () => {
    pollSubscribers = Math.max(0, pollSubscribers - 1);
    if (pollSubscribers === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
