/** Strict, owner-fenced state for the gateway `reliability.plugins` method. */
import type { GatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
import { createAsyncResource } from '../async.svelte';
import {
  boolean,
  countMap,
  integer,
  nullableNumber,
  optionalString,
  record,
  rows,
  string,
} from './decode-primitives';
import { createReadFailureMonitor } from './read-monitor';

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

const CAPABILITY_KEYS = [
  'tools',
  'hooks',
  'channels',
  'providers',
  'gatewayMethods',
  'httpHandlers',
  'cliCommands',
  'services',
  'commands',
  'flowNodes',
  'flows',
] as const;

function stringRows(raw: unknown): string[] {
  return rows(raw, (value) => string(value), 2000);
}

function decodeCapabilities(raw: unknown): PluginCapabilities {
  const value = record(raw);
  return Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, integer(value[key])]),
  ) as unknown as PluginCapabilities;
}

function decodeTelemetry(raw: unknown): PluginTelemetry {
  const value = record(raw);
  const totalEvents = integer(value.totalEvents);
  const errors = integer(value.errors);
  if (errors > totalEvents) throw new Error('Invalid plugin telemetry totals');
  const lastError =
    value.lastError === null
      ? null
      : (() => {
          const last = record(value.lastError);
          return {
            event: string(last.event),
            message: string(last.message, 16_384),
            timestamp: integer(last.timestamp),
          };
        })();
  return {
    totalEvents,
    bySeverity: countMap(value.bySeverity),
    errors,
    lastActivityAt: nullableNumber(value.lastActivityAt),
    lastError,
    topFailureModes: rows(
      value.topFailureModes,
      (rawMode) => {
        const mode = record(rawMode);
        return {
          event: string(mode.event),
          failureMode: string(mode.failureMode),
          count: integer(mode.count),
        };
      },
      256,
    ),
  };
}

function decodeEntry(raw: unknown): PluginHealthEntry {
  const value = record(raw);
  const status = string(value.status);
  if (status !== 'loaded' && status !== 'disabled' && status !== 'error') {
    throw new Error('Invalid plugin status');
  }
  return {
    pluginId: string(value.pluginId),
    name: string(value.name),
    version: optionalString(value.version),
    description: optionalString(value.description, 16_384),
    icon: optionalString(value.icon),
    origin: string(value.origin),
    source: string(value.source, 16_384),
    status,
    enabled: boolean(value.enabled),
    configEnabled: boolean(value.configEnabled),
    error: optionalString(value.error, 16_384),
    capabilities: decodeCapabilities(value.capabilities),
    channelIds: stringRows(value.channelIds),
    providerIds: stringRows(value.providerIds),
    toolNames: stringRows(value.toolNames),
    telemetry: decodeTelemetry(value.telemetry),
  };
}

export function decodePluginHealthSnapshot(
  raw: unknown,
  expected: { from: number; to: number },
): PluginHealthSnapshot {
  const value = record(raw);
  if (value.error !== undefined) throw new Error('Plugin registry unavailable');
  const period = record(value.period);
  const start = integer(period.start);
  const end = integer(period.end);
  if (start > end || start !== expected.from || end !== expected.to) {
    throw new Error('Invalid plugin period');
  }
  const plugins = rows(value.plugins, decodeEntry, 2000);
  if (new Set(plugins.map((plugin) => plugin.pluginId)).size !== plugins.length) {
    throw new Error('Duplicate plugin id');
  }
  return { plugins, capturedAt: integer(value.capturedAt), period: { start, end } };
}

export function createPluginHealthState(owner: () => GatewaySessionOwner | null) {
  const monitor = createReadFailureMonitor('pluginHealth');
  let last: [string, number, number] | null = null;
  const resource = createAsyncResource<
    PluginHealthSnapshot,
    [GatewaySessionOwner | null, string, number, number]
  >(
    async (captured, _serverId, from, to) => {
      if (!captured) throw new Error('Plugin health unavailable');
      let phase: 'transport' | 'decode' = 'transport';
      try {
        const raw = await captured.request('reliability.plugins', { since: from, until: to });
        phase = 'decode';
        const snapshot = decodePluginHealthSnapshot(raw, { from, to });
        return snapshot;
      } catch (error) {
        if (captured.current()) monitor.failed(captured.token, phase);
        throw error;
      }
    },
    {
      initialLoading: true,
      formatError: () => 'Plugin health could not be refreshed.',
      owner: (captured) => captured,
      key: (_captured, serverId, from, to) => JSON.stringify([serverId, from, to]),
      admit: (captured) => {
        const gateway = captured as GatewaySessionOwner;
        if (!gateway.methods) return 'unavailable';
        return gateway.methods.includes('reliability.plugins') ? null : 'unsupported';
      },
      beforePublish: (_snapshot, captured) => captured && monitor.ready(),
    },
  );

  async function load(serverId: string, from: number, to: number): Promise<void> {
    last = [serverId, from, to];
    await resource.load(owner(), serverId, from, to);
  }

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
    get status() {
      return resource.status;
    },
    load,
    retry: () => (last ? load(...last) : Promise.resolve()),
    reset: resource.reset,
  };
}
