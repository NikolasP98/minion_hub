/**
 * State module for plugin health data.
 *
 * Fetches reliability events related to plugin loading (plugin_load_success,
 * plugin_load_failure, plugins_loaded_summary) and presents them as a
 * structured view for the PluginHealthPanel.
 */

export interface PluginEntry {
  pluginId: string;
  status: 'loaded' | 'failed';
  source?: string;
  origin?: string;
  version?: string;
  error?: string;
  channels?: string[];
  tools?: number;
  occurredAt: number;
}

export interface PluginSummary {
  total: number;
  loaded: number;
  failed: number;
  loadTimeMs?: number;
  failedPlugins: string[];
  capturedAt: number;
}

export interface PluginHealthSnapshot {
  summary: PluginSummary | null;
  plugins: PluginEntry[];
}

export function createPluginHealthState() {
  let snapshot = $state<PluginHealthSnapshot | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load(serverId: string) {
    loading = true;
    error = null;
    try {
      // Fetch recent gateway-category events (last 24h, generous window)
      const from = Date.now() - 24 * 60 * 60 * 1000;
      const res = await globalThis.fetch(
        `/api/reliability/events?serverId=${encodeURIComponent(serverId)}&category=gateway&from=${from}&limit=200`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const events: Array<{
        event: string;
        message: string;
        metadata?: Record<string, unknown>;
        timestamp: number;
      }> = data.events ?? [];

      // Find the latest summary event (= latest gateway boot)
      const summaryEvents = events.filter((e) => e.event === 'plugins_loaded_summary');
      if (summaryEvents.length === 0) {
        snapshot = { summary: null, plugins: [] };
        return;
      }

      const latestSummary = summaryEvents.reduce((a, b) =>
        a.timestamp > b.timestamp ? a : b,
      );
      const meta = latestSummary.metadata ?? {};

      const summary: PluginSummary = {
        total: typeof meta.total === 'number' ? meta.total : 0,
        loaded: typeof meta.loaded === 'number' ? meta.loaded : 0,
        failed: typeof meta.failed === 'number' ? meta.failed : 0,
        loadTimeMs: typeof meta.loadTimeMs === 'number' ? meta.loadTimeMs : undefined,
        failedPlugins: Array.isArray(meta.failedPlugins)
          ? (meta.failedPlugins as string[])
          : [],
        capturedAt: latestSummary.timestamp,
      };

      // Collect per-plugin events from same boot (timestamp >= summary - 5s tolerance)
      const bootWindow = latestSummary.timestamp - 5000;
      const pluginEvents = events.filter(
        (e) =>
          (e.event === 'plugin_load_success' || e.event === 'plugin_load_failure') &&
          e.timestamp >= bootWindow &&
          e.timestamp <= latestSummary.timestamp + 1000,
      );

      const plugins: PluginEntry[] = pluginEvents.map((e) => {
        const m = e.metadata ?? {};
        return {
          pluginId: typeof m.pluginId === 'string' ? m.pluginId : 'unknown',
          status: e.event === 'plugin_load_success' ? 'loaded' : 'failed',
          source: typeof m.source === 'string' ? m.source : undefined,
          origin: typeof m.origin === 'string' ? m.origin : undefined,
          version: typeof m.version === 'string' ? m.version : undefined,
          error: typeof m.error === 'string' ? m.error : undefined,
          channels: Array.isArray(m.channels) ? (m.channels as string[]) : undefined,
          tools: typeof m.tools === 'number' ? m.tools : undefined,
          occurredAt: e.timestamp,
        };
      });

      snapshot = { summary, plugins };
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  return {
    get snapshot() {
      return snapshot;
    },
    get loading() {
      return loading;
    },
    get error() {
      return error;
    },
    load,
  };
}
