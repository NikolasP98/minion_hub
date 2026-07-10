import { sendRequest } from '$lib/services/gateway.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
import type { ToolStatusEntry, ToolsStatusReport } from '$lib/types/tools';

/**
 * Lightweight, load-once-per-session cache of the gateway's tool catalog
 * (name → entry, incl. `permission`), keyed by tool id. Chat surfaces
 * (ChatBlocks) read this to show a tool-use row's permission provenance
 * without prop-drilling the full `tools.status` report through ChatTurn.
 * Reuses the same RPC `/capabilities` already calls — no new server plumbing.
 */
export const toolCatalog = $state({
  byId: {} as Record<string, ToolStatusEntry>,
  groupDescriptions: {} as Record<string, string>,
  loaded: false,
});

let inFlight: Promise<void> | null = null;

/** Fetch once per session; fail-silent (older gateways lack `permission`/`groupDescriptions`). */
export function ensureToolCatalogLoaded(): Promise<void> {
  if (toolCatalog.loaded) return Promise.resolve();
  if (inFlight) return inFlight;
  if (!conn.connected) return Promise.resolve();
  inFlight = sendRequest('tools.status', {})
    .then((res) => {
      const report = res as ToolsStatusReport;
      const byId: Record<string, ToolStatusEntry> = {};
      for (const t of report.tools ?? []) byId[t.id] = t;
      toolCatalog.byId = byId;
      toolCatalog.groupDescriptions = report.groupDescriptions ?? {};
      toolCatalog.loaded = true;
    })
    .catch(() => {
      // fail-silent — permission badges just stay absent
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
