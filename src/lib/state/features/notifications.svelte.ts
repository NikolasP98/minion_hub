import { updateState } from '$lib/state/gateway/update-state.svelte';
import { pulse } from './pulse.svelte';

export const notifications = $state({
  pendingCount: 0,
  lastFetched: 0,
  /** Total bell badge count — join requests + pulse proposals + a pending gateway update (max 1). */
  get badgeCount() {
    return this.pendingCount + pulse.pendingCount + (updateState.pending ? 1 : 0);
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

/** Reference-counted shell polling. Topbar and DynamicIsland are both mounted
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
