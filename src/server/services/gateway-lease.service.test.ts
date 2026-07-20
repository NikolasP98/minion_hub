/**
 * Lease resolver + balancer (spec 2026-07-19 §WP-F).
 *
 * The three things that must not regress, in the order they matter:
 *   1. fail CLOSED on authorization (no row for the channel ⇒ null, always),
 *   2. SINGLE WRITER (the lease is the mutex; a live lease is never stolen),
 *   3. fail OPEN on health, loudly (nothing healthy ⇒ still an endpoint, but
 *      flagged, and never a silent claim that state moved).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const candidates = vi.fn();
vi.mock('./gateway.pg.service', () => ({
  listChannelCandidates: (...args: unknown[]) => candidates(...args),
}));

/** Minimal stand-in for the pg driver: each `execute` pops a queued result, and
 *  every statement is recorded so the mutex predicate can be asserted. */
const sqlLog: string[] = [];
let results: unknown[] = [];
vi.mock('$server/db/pg-client', () => ({
  getCoreDb: () => ({
    execute: (q: { queryChunks?: unknown[] } | unknown) => {
      sqlLog.push(JSON.stringify(q));
      const next = results.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ rows: next ?? [] });
    },
  }),
}));

const probe = vi.fn();
vi.mock('ws', () => ({
  WebSocket: class {
    constructor(public url: string) {
      queueMicrotask(() => {
        const ok = probe(this.url);
        for (const fn of ok ? (this.h.open ?? []) : (this.h.error ?? [])) fn();
      });
    }
    h: Record<string, (() => void)[]> = {};
    on(evt: string, fn: () => void) {
      (this.h[evt] ??= []).push(fn);
    }
    close() {}
  },
}));

const A = {
  gatewayId: '11111111-1111-1111-1111-111111111111',
  serverId: 'srv-a',
  name: 'a',
  url: 'wss://a',
  token: 't',
};
const B = {
  gatewayId: '22222222-2222-2222-2222-222222222222',
  serverId: 'srv-b',
  name: 'b',
  url: 'wss://b',
  token: 't',
};
const ORG = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  sqlLog.length = 0;
  results = [];
  probe.mockReturnValue(true);
});

describe('resolveChannelEndpoint — fail closed', () => {
  it('returns null when the org has no row for the channel', async () => {
    candidates.mockResolvedValue([]);
    const { resolveChannelEndpoint } = await import('./gateway-lease.service');
    expect(await resolveChannelEndpoint(ORG, 'dev')).toBeNull();
  });

  it('returns null without touching the DB when there is no active org', async () => {
    const { resolveChannelEndpoint } = await import('./gateway-lease.service');
    expect(await resolveChannelEndpoint(null, 'prd')).toBeNull();
    expect(candidates).not.toHaveBeenCalled();
  });
});

describe('resolveChannelEndpoint — lease is authority', () => {
  it('honours a live lease instead of the first candidate', async () => {
    candidates.mockResolvedValue([A, B]);
    results = [[{ gateway_id: B.gatewayId, live: true, healthy: true }]];
    const { resolveChannelEndpoint } = await import('./gateway-lease.service');
    const r = await resolveChannelEndpoint(ORG, 'prd');
    expect(r?.serverId).toBe('srv-b');
    // A live lease must not trigger an acquire — that is the single-writer rule.
    expect(sqlLog).toHaveLength(1);
  });

  it('ignores a lease pointing at a row the org no longer has', async () => {
    candidates.mockResolvedValue([A]);
    results = [
      [{ gateway_id: B.gatewayId, live: true, healthy: true }],
      [{ gateway_id: A.gatewayId }],
    ];
    const { resolveChannelEndpoint } = await import('./gateway-lease.service');
    expect((await resolveChannelEndpoint(ORG, 'prd'))?.serverId).toBe('srv-a');
  });

  it('acquires with a predicate that only beats an EXPIRED incumbent', async () => {
    candidates.mockResolvedValue([A, B]);
    results = [[], [{ gateway_id: A.gatewayId }]];
    const { resolveChannelEndpoint } = await import('./gateway-lease.service');
    await resolveChannelEndpoint(ORG, 'prd');
    expect(sqlLog[1]).toContain('expires_at <= now()');
  });

  it('yields to the winner when it loses the acquire race', async () => {
    candidates.mockResolvedValue([A, B]);
    results = [
      [], // no lease
      [], // acquire returned 0 rows -> someone else holds it
      [{ gateway_id: B.gatewayId, live: true, healthy: null }], // re-read
    ];
    const { resolveChannelEndpoint } = await import('./gateway-lease.service');
    expect((await resolveChannelEndpoint(ORG, 'prd'))?.serverId).toBe('srv-b');
  });

  it('degrades to deterministic ordering when gateway_lease does not exist yet', async () => {
    candidates.mockResolvedValue([A, B]);
    results = [new Error('relation "gateway_lease" does not exist'), new Error('same')];
    const { resolveChannelEndpoint } = await import('./gateway-lease.service');
    expect((await resolveChannelEndpoint(ORG, 'prd'))?.serverId).toBe('srv-a');
  });
});

describe('revalidateChannelLease — health', () => {
  it('renews the lease when the holder still accepts a WS upgrade', async () => {
    candidates.mockResolvedValue([A, B]);
    results = [[{ gateway_id: A.gatewayId, live: true, healthy: null }], [{ gateway_id: A.gatewayId }]];
    const { revalidateChannelLease } = await import('./gateway-lease.service');
    const r = await revalidateChannelLease(ORG, 'prd');
    expect(r).toMatchObject({ serverId: 'srv-a', healthy: true, stateMoved: false });
  });

  it('flips to a healthy instance when the holder refuses the upgrade', async () => {
    candidates.mockResolvedValue([A, B]);
    probe.mockImplementation((url: string) => url === 'wss://b');
    results = [
      [{ gateway_id: A.gatewayId, live: true, healthy: true }], // read
      [], // expire
      [{ gateway_id: B.gatewayId }], // acquire
    ];
    const { revalidateChannelLease } = await import('./gateway-lease.service');
    const r = await revalidateChannelLease(ORG, 'prd');
    expect(r?.serverId).toBe('srv-b');
    expect(sqlLog[1]).toContain('expires_at = now()');
  });

  it('never claims state followed the failover', async () => {
    candidates.mockResolvedValue([A, B]);
    probe.mockImplementation((url: string) => url === 'wss://b');
    results = [[{ gateway_id: A.gatewayId, live: true, healthy: true }], [], [{ gateway_id: B.gatewayId }]];
    const { revalidateChannelLease } = await import('./gateway-lease.service');
    expect((await revalidateChannelLease(ORG, 'prd'))?.stateMoved).toBe(false);
  });

  it('fails OPEN on health: returns the holder flagged unhealthy, not null', async () => {
    candidates.mockResolvedValue([A, B]);
    probe.mockReturnValue(false);
    results = [[{ gateway_id: A.gatewayId, live: true, healthy: true }], []];
    const { revalidateChannelLease } = await import('./gateway-lease.service');
    const r = await revalidateChannelLease(ORG, 'prd');
    // "you have no gateways" would read as a permissions bug; "DEV is down" is the truth.
    expect(r).toMatchObject({ serverId: 'srv-a', healthy: false });
  });

  it('still fails CLOSED on authorization, however unhealthy things are', async () => {
    candidates.mockResolvedValue([]);
    probe.mockReturnValue(false);
    const { revalidateChannelLease } = await import('./gateway-lease.service');
    expect(await revalidateChannelLease(ORG, 'dev')).toBeNull();
  });
});

describe('probeWsUpgrade', () => {
  it('is true only on a completed upgrade — an HTTP 200 is not evidence', async () => {
    const { probeWsUpgrade } = await import('./gateway-lease.service');
    probe.mockReturnValue(true);
    expect(await probeWsUpgrade('wss://ok')).toBe(true);
    probe.mockReturnValue(false);
    expect(await probeWsUpgrade('wss://serves-health-200-but-refuses-upgrade')).toBe(false);
  });
});
