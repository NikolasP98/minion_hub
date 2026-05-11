/** Agent manifest from the registry — source of truth for card rendering */
export interface RegistryAgent {
  schemaVersion?: number;
  id: string;
  name: string;
  description: string;
  categories: string[];
  source: string;
  tags: string[];
  model?: string;
  icon?: string;
  stub?: boolean;
  version?: string;
  checksum?: string;
  contentLocales?: string[];
  updatedAt?: string;
}

export const registryState = $state({
  agents: [] as RegistryAgent[],
  loading: false,
  loaded: false,
  error: null as string | null,
  search: '',
  categoryFilter: null as string | null,
  visibleCount: 48,
  hash: null as string | null,
});

// ─── IndexedDB Cache ────────────────────────────────────────

const IDB_NAME = 'minion-registry';
const IDB_STORE = 'catalog';
const IDB_VERSION = 1;

interface CachedEntry {
  key: string;
  hash: string;
  agents: RegistryAgent[];
  cachedAt: number;
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCache(): Promise<CachedEntry | null> {
  try {
    const db = await openIDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get('catalog');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeCache(hash: string, agents: RegistryAgent[]): Promise<void> {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({
      key: 'catalog',
      hash,
      agents,
      cachedAt: Date.now(),
    } satisfies CachedEntry);
  } catch {
    /* best-effort */
  }
}

// ─── Normalize agent data (v1/v2/v3 compat) ────────────────

function normalize(raw: unknown[]): RegistryAgent[] {
  return raw.map((a: any) => ({
    ...a,
    categories: a.categories ?? (a.category ? [a.category] : ['general']),
    tags: a.tags ?? [],
  }));
}

// ─── Load ───────────────────────────────────────────────────

export async function loadRegistry() {
  if (registryState.loaded || registryState.loading) return;
  registryState.loading = true;
  registryState.error = null;

  try {
    // 1. Try IndexedDB cache for instant render
    const cached = await readCache();
    if (cached && cached.agents.length > 0) {
      registryState.agents = cached.agents;
      registryState.hash = cached.hash;
      registryState.loaded = true;
      registryState.loading = false;

      // 2. Background freshness check
      checkForUpdates(cached.hash);
      return;
    }

    // 3. No cache — full fetch
    await fullFetch();
  } catch (e) {
    registryState.error = e instanceof Error ? e.message : 'Failed to load registry';
  } finally {
    registryState.loading = false;
  }
}

async function fullFetch() {
  const headers: Record<string, string> = {};
  if (registryState.hash) headers['If-None-Match'] = `"${registryState.hash}"`;

  const res = await fetch('/api/registry/catalog', { headers });

  if (res.status === 304) return; // cached version is current

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const agents = normalize(Array.isArray(data) ? data : (data.agents ?? []));
  const hash = res.headers.get('etag')?.replace(/"/g, '') ?? null;

  registryState.agents = agents;
  registryState.hash = hash;
  registryState.loaded = true;

  if (hash) writeCache(hash, agents);
}

async function checkForUpdates(cachedHash: string) {
  try {
    const res = await fetch('/api/registry/version');
    if (!res.ok) return;
    const { hash } = await res.json();
    if (hash && hash !== cachedHash) {
      // Registry updated since cache — refresh in background
      await fullFetch();
    }
  } catch {
    /* non-critical */
  }
}

// ─── Derived (exported as getters) ──────────────────────────

const _filteredAgents = $derived.by(() => {
  let agents = registryState.agents;

  if (registryState.categoryFilter) {
    const cat = registryState.categoryFilter;
    agents = agents.filter((a) => a.categories.includes(cat));
  }

  if (registryState.search) {
    const q = registryState.search.toLowerCase();
    agents = agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  return agents;
});

const _visibleAgents = $derived(_filteredAgents.slice(0, registryState.visibleCount));

const _registryCategories = $derived.by(() => {
  const counts = new Map<string, number>();
  for (const a of registryState.agents) {
    for (const c of a.categories) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
});

export const registryDerived = {
  get filteredAgents() {
    return _filteredAgents;
  },
  get visibleAgents() {
    return _visibleAgents;
  },
  get categories() {
    return _registryCategories;
  },
};

export function loadMore() {
  registryState.visibleCount += 48;
}

export function resetVisibleCount() {
  registryState.visibleCount = 48;
}

// ─── Icons ──────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  automation: '⚡',
  marketing: '📣',
  business: '💼',
  education: '🎓',
  finance: '💰',
  creative: '🎨',
  data: '🗄️',
  'data-analytics': '📊',
  engineering: '🔧',
  legal: '⚖️',
  healthcare: '❤️',
  hr: '👥',
  security: '🛡️',
  testing: '🧪',
  compliance: '📋',
  ecommerce: '🛒',
  gaming: '🎮',
  personal: '👤',
  productivity: '⏱️',
  'real-estate': '🏢',
  saas: '☁️',
  sales: '📈',
  voice: '🎙️',
  science: '⚛️',
  operations: '⚙️',
  'customer-service': '🎧',
  'customer-success': '🏆',
  communication: '💬',
  executive: '👑',
  specialist: '⭐',
  spatial: '📦',
  'project-management': '📌',
  strategy: '🎯',
  product: '📦',
  'supply-chain': '🚚',
  freelance: '🧑‍💻',
  general: '🤖',
  moltbook: '📖',
  lang: '💻',
  infra: '🖥️',
  core: '🔲',
  biz: '💼',
  dx: '✨',
  'data-ai': '🧠',
  domains: '🌐',
  quality: '✅',
  meta: '🔗',
  research: '🔍',
  review: '👁️',
  execution: '🚀',
  planning: '📐',
  verification: '☑️',
  ui: '🖼️',
};

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? '🤖';
}

export function agentIcon(agent: RegistryAgent): string {
  if (agent.icon) return agent.icon;
  return categoryIcon(agent.categories[0] ?? 'general');
}
