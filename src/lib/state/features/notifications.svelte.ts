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

export async function refreshNotifications() {
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