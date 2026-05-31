let pendingCount = $state(0);
let lastFetched = $state(0);

const notificationState = {
  get pendingCount() { return pendingCount; },
  get hasPending() { return pendingCount > 0; },

  async refresh() {
    try {
      const res = await fetch('/api/join-requests/count');
      if (res.ok) {
        const data = await res.json();
        pendingCount = data.count ?? 0;
        lastFetched = Date.now();
      }
    } catch {
      // Silently fail — notification bell just won't show a badge
    }
  },

  setCount(count: number) {
    pendingCount = count;
    lastFetched = Date.now();
  },
};

export { notificationState };
