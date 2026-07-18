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

async function act(id: string, action: 'approve' | 'dismiss') {
  await fetch(`/api/pulse/proposals/${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  await Promise.all([fetchItems(), fetchCount()]);
}

export const pulse = {
  get pendingCount() { return s.pendingCount; },
  get items() { return s.items; },
  refreshCount: fetchCount,
  refresh: fetchItems,
  approve: (id: string) => act(id, 'approve'),
  dismiss: (id: string) => act(id, 'dismiss'),
};
