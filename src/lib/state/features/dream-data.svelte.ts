import { sendRequest } from '$lib/services/gateway.svelte';

// ── Types ──────────────────────────────────────────────────────

export interface DreamHistoryEntry {
  timestamp: string;
  content: string;
}

export interface DreamState {
  lastConsolidatedAt: number | null;
  lastSessionScanAt: number | null;
}

export interface DreamData {
  state: DreamState;
  pendingNotes: number;
  history: DreamHistoryEntry[];
}

// ── State ──────────────────────────────────────────────────────

export const dreamState = $state({
  agentId: null as string | null,
  data: null as DreamData | null,
  loading: false,
  error: null as string | null,
});

// ── Actions ────────────────────────────────────────────────────

export async function loadDreamHistory(agentId: string) {
  dreamState.agentId = agentId;
  dreamState.loading = true;
  dreamState.error = null;

  try {
    const res = (await sendRequest('dream.history', { agentId })) as DreamData;
    dreamState.data = res;
  } catch (e) {
    dreamState.error = e instanceof Error ? e.message : 'Failed to load dream history';
  } finally {
    dreamState.loading = false;
  }
}

export function clearDreamState() {
  dreamState.agentId = null;
  dreamState.data = null;
  dreamState.loading = false;
  dreamState.error = null;
}

// ── Helpers ────────────────────────────────────────────────────

export function formatTimeSince(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const ms = Date.now() - timestamp;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}
