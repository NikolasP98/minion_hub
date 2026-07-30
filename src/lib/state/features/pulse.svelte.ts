type PulseItem = Record<string, unknown>;

let s = $state<{ pendingCount: number; items: PulseItem[] }>({ pendingCount: 0, items: [] });

async function fetchCount() {
  try {
    const r = await fetch('/api/pulse/count');
    if (r.ok) s.pendingCount = ((await r.json()).count ?? 0);
  } catch {
    /* transient */
  }
}

async function fetchItems() {
  try {
    const r = await fetch('/api/pulse/proposals');
    if (r.ok) s.items = ((await r.json()).proposals ?? []);
  } catch {
    /* transient */
  }
}

// Every consumer of `refresh` (popover open, external callers) needs the list
// and the bell badge count to agree — fetching items alone left pendingCount
// stale relative to what the popover just rendered.
async function refreshAll() {
  await Promise.all([fetchItems(), fetchCount()]);
}

async function act(id: string, action: 'approve' | 'dismiss') {
  const r = await fetch(`/api/pulse/proposals/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!r.ok) {
    console.error(`pulse ${action} failed: ${r.status}`);
    return; // leave items/pendingCount as-is — the action did not take effect
  }
  await refreshAll();
}

export const pulse = {
  get pendingCount() { return s.pendingCount; },
  get items() { return s.items; },
  refreshCount: fetchCount,
  refresh: refreshAll,
  approve: (id: string) => act(id, 'approve'),
  dismiss: (id: string) => act(id, 'dismiss'),
};
