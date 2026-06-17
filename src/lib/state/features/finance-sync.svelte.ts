type SyncState = {
  active: boolean;
  status: string | null;
  total: number | null;
  processed: number;
  error: string | null;
};

let s = $state<SyncState>({ active: false, status: null, total: null, processed: 0, error: null });
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

const POLL_MS = 1500;

async function fetchStatus(provider: string): Promise<void> {
  try {
    const res = await fetch(`/api/finances/sync/status?provider=${encodeURIComponent(provider)}`);
    if (!res.ok) return;
    const d = (await res.json()) as Partial<SyncState>;
    s.active = d.active ?? false;
    s.status = d.status ?? null;
    s.total = d.total ?? null;
    s.processed = d.processed ?? 0;
    s.error = d.error ?? null;
  } catch {
    /* transient; keep last state */
  }
}

function schedule(provider: string): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await fetchStatus(provider);
    if (s.active && polling) schedule(provider);
    else stop();
  }, POLL_MS);
}

function stop(): void {
  polling = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

export const financeSync = {
  get active() { return s.active; },
  get status() { return s.status; },
  get total() { return s.total; },
  get processed() { return s.processed; },
  get error() { return s.error; },
  get percent() { return s.total && s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0; },

  /** One-shot status read (e.g. on app load to detect an in-flight sync). Starts polling if active. */
  async refresh(provider = 'susii') {
    await fetchStatus(provider);
    if (s.active && !polling) { polling = true; schedule(provider); }
  },

  /** Trigger a sync and begin polling. */
  async start(provider = 'susii') {
    await fetch('/api/finances/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
    s.active = true; s.status = 'running';
    if (!polling) { polling = true; schedule(provider); }
    await fetchStatus(provider);
  },

  async cancel(provider = 'susii') {
    await fetch('/api/finances/sync/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
    await fetchStatus(provider);
  },

  stop,
};
