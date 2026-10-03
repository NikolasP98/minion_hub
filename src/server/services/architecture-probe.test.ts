import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  probeWsUpgrade: vi.fn(),
  listGateways: vi.fn(),
  telemetry: vi.fn(),
}));

vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => ({ begin: mocks.begin }) }));
vi.mock('$server/services/gateway-lease.service', () => ({
  probeWsUpgrade: mocks.probeWsUpgrade,
}));
vi.mock('./architecture-gateway-read', () => ({
  ArchitectureGatewayReadLimitError: class ArchitectureGatewayReadLimitError extends Error {},
  listArchitectureGateways: mocks.listGateways,
}));
vi.mock('./reliability-telemetry-read', () => ({
  withOwnedTelemetryRead: mocks.telemetry,
}));

import { connectedHeartbeatChannels, probeArchitecture } from './architecture.service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.begin.mockImplementation(async (_mode: string, work: (tx: unknown) => unknown) =>
    work(vi.fn(async () => [])),
  );
  mocks.telemetry.mockImplementation(async (_signal: AbortSignal, work: (tx: object) => unknown) =>
    work({ execute: vi.fn(async () => ({ rows: [] })) }),
  );
  mocks.listGateways.mockResolvedValue([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('owned architecture probes', () => {
  it('never exposes raw provider or database exceptions in the public snapshot', async () => {
    mocks.begin.mockRejectedValueOnce(new Error('SECRET_PG_DETAIL'));
    mocks.telemetry.mockRejectedValueOnce(new Error('SECRET_TURSO_DETAIL'));
    mocks.listGateways.mockRejectedValueOnce(new Error('SECRET_GATEWAY_DETAIL'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('SECRET_HTTP_DETAIL');
      }),
    );
    const snapshot = await probeArchitecture('org');
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('SECRET_');
    expect(snapshot.nodes.find((node) => node.id === 'supabase-pg')?.statusDetail).toContain(
      'unavailable',
    );
    expect(snapshot.nodes.find((node) => node.id === 'turso')?.statusDetail).toContain(
      'unavailable',
    );
  });

  it('aborts owned HTTP handles at the per-probe deadline and waits for settlement', async () => {
    vi.useFakeTimers();
    let active = 0;
    let settled = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            active++;
            init?.signal?.addEventListener(
              'abort',
              () => {
                active--;
                settled++;
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            );
          }),
      ),
    );
    const read = probeArchitecture('org');
    await Promise.resolve();
    expect(active).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    const snapshot = await read;
    expect(active).toBe(0);
    expect(settled).toBe(2);
    expect(snapshot.nodes.find((node) => node.id === 'site')?.statusDetail).toContain(
      'unavailable',
    );
  });

  it('rejects an oversized gateway set before fan-out', async () => {
    mocks.listGateways.mockResolvedValue(
      Array.from({ length: 2001 }, (_, index) => ({
        id: String(index),
        name: `gateway-${index}`,
        url: `wss://gateway-${index}.test`,
        legacyServerId: null,
        lastConnectedAt: null,
      })),
    );
    await expect(probeArchitecture('org')).rejects.toThrow(/cap/);
    expect(mocks.probeWsUpgrade).not.toHaveBeenCalled();
  });

  it('selects the newest heartbeat independently for every admitted gateway', async () => {
    const statements: string[] = [];
    const capturedAt = Date.now();
    mocks.listGateways.mockResolvedValue([
      {
        id: 'default-row',
        name: 'gateway-default',
        url: 'wss://gateway.test:18789',
        legacyServerId: 'default-server',
        lastConnectedAt: null,
      },
      {
        id: 'faces-row',
        name: 'gateway-faces',
        url: 'wss://gateway.test:18790',
        legacyServerId: 'faces-server',
        lastConnectedAt: null,
      },
    ]);
    mocks.probeWsUpgrade.mockResolvedValue(true);
    mocks.telemetry.mockImplementation(
      async (_signal: AbortSignal, work: (tx: object) => unknown) =>
        work({
          execute: vi.fn(async (statement: string | { sql: string; args?: unknown[] }) => {
            if (typeof statement === 'string') return { rows: [] };
            statements.push(statement.sql);
            const serverId = statement.args?.[0];
            return {
              rows:
                serverId === 'default-server'
                  ? [
                      {
                        serverId,
                        capturedAt,
                        uptimeMs: 10_000,
                        activeSessions: 11,
                        memoryRssMb: 101,
                        channelStatusJson: null,
                        channelStatusOverflow: 0,
                      },
                    ]
                  : [
                      {
                        serverId,
                        capturedAt,
                        uptimeMs: 20_000,
                        activeSessions: 22,
                        memoryRssMb: 202,
                        channelStatusJson: null,
                        channelStatusOverflow: 0,
                      },
                    ],
            };
          }),
        }),
    );

    const snapshot = await probeArchitecture('org');

    expect(statements).toHaveLength(2);
    expect(
      statements.every((statement) => statement.includes('order by captured_at desc,id desc')),
    ).toBe(true);
    expect(statements.every((statement) => statement.includes('limit 1'))).toBe(true);
    expect(snapshot.nodes.find((node) => node.id === 'gateway-default')?.metrics?.sessions).toBe(
      '11',
    );
    expect(snapshot.nodes.find((node) => node.id === 'gateway-faces')?.metrics?.sessions).toBe(
      '22',
    );
  });

  it('accepts only explicit connected channel states from current and legacy payloads', () => {
    expect(
      connectedHeartbeatChannels(
        JSON.stringify({
          channelAccounts: {
            whatsapp: {
              primary: { enabled: true, configured: true, running: true, connected: true },
            },
            telegram: {
              primary: { enabled: true, configured: true, running: true, connected: false },
            },
          },
        }),
      ),
    ).toEqual(['whatsapp']);
    expect(
      connectedHeartbeatChannels(
        JSON.stringify({
          connected: 'connected',
          active: { status: 'ACTIVE' },
          ok: 'ok',
          ready: 'ready',
          disconnected: 'disconnected',
          inactive: 'inactive',
          notReady: 'not ready',
          notOk: { status: 'not ok' },
        }),
      ),
    ).toEqual(['active', 'connected', 'ok', 'ready']);
  });
});
