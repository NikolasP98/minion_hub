/**
 * State module for the reliability/plugins page.
 *
 * Calls the gateway `reliability.plugins` RPC, which returns one entry per
 * INSTALLED plugin: load status + declared capabilities (from the live plugin
 * registry) enriched with reliability telemetry attributed to that plugin
 * (events, errors, last activity, top failure modes). This is reliability data,
 * distinct from a plugin's own dashboard metrics.
 */

import { sendRequest } from '$lib/services/gateway.svelte';
import { createAsyncResource, messageError } from '../async.svelte';

export interface PluginCapabilities {
  tools: number;
  hooks: number;
  channels: number;
  providers: number;
  gatewayMethods: number;
  httpHandlers: number;
  cliCommands: number;
  services: number;
  commands: number;
  flowNodes: number;
  flows: number;
}

export interface PluginTelemetry {
  totalEvents: number;
  bySeverity: Record<string, number>;
  errors: number;
  lastActivityAt: number | null;
  lastError: { event: string; message: string; timestamp: number } | null;
  topFailureModes: { event: string; failureMode: string; count: number }[];
}

export interface PluginHealthEntry {
  pluginId: string;
  name: string;
  version?: string;
  description?: string;
  icon?: string;
  origin: string;
  source: string;
  status: 'loaded' | 'disabled' | 'error';
  enabled: boolean;
  configEnabled: boolean;
  error?: string;
  capabilities: PluginCapabilities;
  channelIds: string[];
  providerIds: string[];
  toolNames: string[];
  telemetry: PluginTelemetry;
}

export interface PluginHealthSnapshot {
  plugins: PluginHealthEntry[];
  capturedAt: number;
  period: { start: number; end: number };
}

const EMPTY_CAPS: PluginCapabilities = {
  tools: 0,
  hooks: 0,
  channels: 0,
  providers: 0,
  gatewayMethods: 0,
  httpHandlers: 0,
  cliCommands: 0,
  services: 0,
  commands: 0,
  flowNodes: 0,
  flows: 0,
};

const EMPTY_TELEMETRY: PluginTelemetry = {
  totalEvents: 0,
  bySeverity: {},
  errors: 0,
  lastActivityAt: null,
  lastError: null,
  topFailureModes: [],
};

function normalizeEntry(raw: Record<string, unknown>): PluginHealthEntry {
  const caps = (raw.capabilities ?? {}) as Partial<PluginCapabilities>;
  const tel = (raw.telemetry ?? {}) as Partial<PluginTelemetry>;
  return {
    pluginId: String(raw.pluginId ?? 'unknown'),
    name: String(raw.name ?? raw.pluginId ?? 'unknown'),
    version: typeof raw.version === 'string' ? raw.version : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    origin: String(raw.origin ?? 'unknown'),
    source: String(raw.source ?? ''),
    status: (raw.status as PluginHealthEntry['status']) ?? 'loaded',
    enabled: raw.enabled !== false,
    configEnabled: raw.configEnabled !== false,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    capabilities: { ...EMPTY_CAPS, ...caps },
    channelIds: Array.isArray(raw.channelIds) ? (raw.channelIds as string[]) : [],
    providerIds: Array.isArray(raw.providerIds) ? (raw.providerIds as string[]) : [],
    toolNames: Array.isArray(raw.toolNames) ? (raw.toolNames as string[]) : [],
    telemetry: {
      ...EMPTY_TELEMETRY,
      ...tel,
      bySeverity: (tel.bySeverity as Record<string, number>) ?? {},
      topFailureModes: Array.isArray(tel.topFailureModes) ? tel.topFailureModes : [],
    },
  };
}

export function createPluginHealthState() {
  const resource = createAsyncResource<PluginHealthSnapshot, [string, number, number]>(
    async (_serverId: string, from: number, to: number) => {
      const data = (await sendRequest('reliability.plugins', {
        since: from,
        until: to,
      })) as {
        plugins?: Record<string, unknown>[];
        capturedAt?: number;
        period?: { start: number; end: number };
      } | null;

      const plugins = (data?.plugins ?? []).map(normalizeEntry);
      return {
        plugins,
        capturedAt: data?.capturedAt ?? Date.now(),
        period: data?.period ?? { start: from, end: to },
      };
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
