/**
 * State module for plugin health data.
 *
 * Fetches reliability events related to plugin loading (plugin_load_success,
 * plugin_load_failure, plugins_loaded_summary) via the gateway WebSocket and
 * presents them as a structured view for the PluginHealthPanel.
 */

import { sendRequest } from '$lib/services/gateway.svelte';
import { createAsyncResource, messageError } from '../async.svelte';

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
  const resource = createAsyncResource<PluginHealthSnapshot, [string]>(
    async (_serverId: string) => {
      // Fetch recent gateway-category events via WS (last 24h, generous window)
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const data = (await sendRequest('reliability.events', {
        category: 'gateway',
        since,
        limit: 200,
      })) as {
        events?: Array<{
          event: string;
          message: string;
          metadata?: Record<string, unknown>;
          timestamp: number;
        }>;
      } | null;
      const events = data?.events ?? [];

      // Find the latest summary event (= latest gateway boot)
      const summaryEvents = events.filter((e) => e.event === 'plugins_loaded_summary');
      if (summaryEvents.length === 0) {
        return { summary: null, plugins: [] };
      }

      const latestSummary = summaryEvents.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
      const meta = latestSummary.metadata ?? {};

      const summary: PluginSummary = {
        total: typeof meta.total === 'number' ? meta.total : 0,
        loaded: typeof meta.loaded === 'number' ? meta.loaded : 0,
        failed: typeof meta.failed === 'number' ? meta.failed : 0,
        loadTimeMs: typeof meta.loadTimeMs === 'number' ? meta.loadTimeMs : undefined,
        failedPlugins: Array.isArray(meta.failedPlugins) ? (meta.failedPlugins as string[]) : [],
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

      return { summary, plugins };
    },
    { initialLoading: true, formatError: messageError },
  );

  return {
    get snapshot() {
      return resource.data;
    },
    get loading() {
      return resource.loading;
    },
    get error() {
      return resource.error;
    },
    load: resource.load,
  };
}
