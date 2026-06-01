export const notifications = $state({
  pendingCount: 0,
  lastFetched: 0,
  get hasPending() {
    return this.pendingCount > 0;
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
}