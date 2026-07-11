import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── in-memory bg_jobs stand-in (drives the same select/insert/update shapes
// the real drizzle client exposes, without a real DB) ──────────────────────
type Row = {
  id: string;
  tenantId: string;
  userId: string | null;
  type: string;
  refId: string | null;
  status: string;
  cursor: string | null;
  error: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

let rows: Row[] = [];

function matches(row: Row, whereFn: (r: Row) => boolean) {
  return whereFn(row);
}

const mockDb = {
  select: () => ({
    from: () => ({
      where: (whereFn: (r: Row) => boolean) => ({
        orderBy: () => ({
          limit: async (n: number) =>
            rows
              .filter((r) => matches(r, whereFn))
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, n),
        }),
        limit: async (n: number) => rows.filter((r) => matches(r, whereFn)).slice(0, n),
      }),
    }),
  }),
  insert: () => ({
    values: async (v: Partial<Row>) => {
      rows.push(v as Row);
    },
  }),
  update: () => ({
    set: (patch: Partial<Row>) => ({
      where: async (whereFn: (r: Row) => boolean) => {
        rows = rows.map((r) => (matches(r, whereFn) ? { ...r, ...patch } : r));
      },
    }),
  }),
};

vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => mockDb }));

vi.mock('$server/db/pg-schema/bg-jobs', () => ({
  bgJobs: {
    id: 'id',
    tenantId: 'tenantId',
    userId: 'userId',
    type: 'type',
    refId: 'refId',
    status: 'status',
    cursor: 'cursor',
    error: 'error',
    attempts: 'attempts',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    startedAt: 'startedAt',
    finishedAt: 'finishedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => (r: Row) => (r as unknown as Record<string, unknown>)[col] === val,
  and:
    (...fns: ((r: Row) => boolean)[]) =>
    (r: Row) =>
      fns.every((f) => f(r)),
  desc: (col: string) => col,
  inArray: (col: string, vals: unknown[]) => (r: Row) => vals.includes((r as unknown as Record<string, unknown>)[col]),
}));

// ── mock gateway.pg.service (fleet snapshot + per-row credentials) ─────────
const mockListGateways = vi.fn();
const mockGetCreds = vi.fn();
vi.mock('./gateway.pg.service', () => ({
  listGatewaysForAdmin: () => mockListGateways(),
  getGatewayCredentialsById: (id: string) => mockGetCreds(id),
}));

// ── mock gateway-rpc (per-instance calls) ───────────────────────────────────
const mockCallToInstance = vi.fn();
vi.mock('$lib/server/gateway-rpc', () => ({
  gatewayCallToInstance: (...args: unknown[]) => mockCallToInstance(...args),
}));

import {
  startFleetUpdate,
  advanceFleetUpdate,
  getFleetUpdateStatus,
  abortFleetUpdate,
} from './fleet-update.service';

const TENANT = 't1';

beforeEach(() => {
  rows = [];
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('startFleetUpdate', () => {
  test('orders least-connections-first, ties by created_at', async () => {
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date(200) },
      { id: 'b', name: 'B', url: 'ws://b', authMode: 'token', createdAt: new Date(100) },
      { id: 'c', name: 'C', url: 'ws://c', authMode: 'token', createdAt: new Date(300) },
    ]);
    mockGetCreds.mockImplementation(async (id: string) => ({ url: `ws://${id}`, token: `tok-${id}` }));
    mockCallToInstance.mockImplementation(async (_url, _token, method, _params) => {
      if (method !== 'update.status') throw new Error('unexpected method');
      const conns: Record<string, number> = { a: 5, b: 5, c: 0 };
      return { current: '1.0.0', connections: conns[_token.replace('tok-', '')] };
    });

    const job = await startFleetUpdate(TENANT, 'user1', '2.0.0');

    expect(job.instances.map((i) => i.gatewayId)).toEqual(['c', 'b', 'a']);
    expect(job.status).toBe('running');
    expect(job.currentIndex).toBe(0);
  });

  test('instances already on target are marked done and skipped', async () => {
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date(100) },
      { id: 'b', name: 'B', url: 'ws://b', authMode: 'token', createdAt: new Date(200) },
    ]);
    mockGetCreds.mockImplementation(async (id: string) => ({ url: `ws://${id}`, token: `tok-${id}` }));
    mockCallToInstance.mockImplementation(async (url: string) => ({
      current: url === 'ws://a' ? '2.0.0' : '1.0.0',
      connections: 0,
    }));

    const job = await startFleetUpdate(TENANT, 'user1', '2.0.0');
    const a = job.instances.find((i) => i.gatewayId === 'a')!;
    expect(a.state).toBe('done');
    // currentIndex should point at the first non-done instance.
    expect(job.instances[job.currentIndex].gatewayId).toBe('b');
  });

  test('refuses when a fleet job is already active', async () => {
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date() },
    ]);
    mockGetCreds.mockResolvedValue({ url: 'ws://a', token: 'tok' });
    mockCallToInstance.mockResolvedValue({ current: 'old', connections: 0 });

    await startFleetUpdate(TENANT, 'user1', '2.0.0');
    await expect(startFleetUpdate(TENANT, 'user1', '2.0.0')).rejects.toThrow(/already in progress/);
  });

  test('permits a new job once the prior one is terminal (failed/cancelled/done)', async () => {
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date() },
    ]);
    mockGetCreds.mockResolvedValue({ url: 'ws://a', token: 'tok' });
    mockCallToInstance.mockResolvedValue({ current: 'old', connections: 0 });

    const first = await startFleetUpdate(TENANT, 'user1', '2.0.0');
    // Simulate the job having failed (as advanceFleetUpdate would leave it).
    rows = rows.map((r) => (r.id === first.id ? { ...r, status: 'failed' } : r));

    await expect(startFleetUpdate(TENANT, 'user1', '2.0.1')).resolves.toMatchObject({
      targetVersion: '2.0.1',
    });
  });

  test('missing `connections` field is null (unknown), sorts as least-loaded (0)', async () => {
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date(100) },
      { id: 'b', name: 'B', url: 'ws://b', authMode: 'token', createdAt: new Date(200) },
    ]);
    mockGetCreds.mockImplementation(async (id: string) => ({ url: `ws://${id}`, token: `tok-${id}` }));
    mockCallToInstance.mockImplementation(async (_url: string, token: string, method: string) => {
      if (method !== 'update.status') throw new Error('unexpected method');
      // 'a' is on an old build that never reports `connections` at all.
      if (token === 'tok-a') return { current: '1.0.0' };
      return { current: '1.0.0', connections: 3 };
    });

    const job = await startFleetUpdate(TENANT, 'user1', '2.0.0');

    const a = job.instances.find((i) => i.gatewayId === 'a')!;
    const b = job.instances.find((i) => i.gatewayId === 'b')!;
    expect(a.connections).toBeNull();
    expect(b.connections).toBe(3);
    // unknown (sorted as 0) comes before b's real 3 connections.
    expect(job.instances.map((i) => i.gatewayId)).toEqual(['a', 'b']);
  });
});

describe('advanceFleetUpdate', () => {
  async function seedJob() {
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date(100) },
      { id: 'b', name: 'B', url: 'ws://b', authMode: 'token', createdAt: new Date(200) },
    ]);
    mockGetCreds.mockImplementation(async (id: string) => ({ url: `ws://${id}`, token: `tok-${id}` }));
    mockCallToInstance.mockImplementation(async (_url, _token, method) => {
      if (method === 'update.status') return { current: '1.0.0', connections: 0 };
      return {};
    });
    return startFleetUpdate(TENANT, 'user1', '2.0.0');
  }

  test('a successful step marks the instance done and moves the index forward', async () => {
    await seedJob();
    mockCallToInstance.mockImplementation(async (_url, _token, method) => {
      if (method === 'update.run') return { ok: true };
      if (method === 'update.status') return { current: '2.0.0' }; // already on target post-restart
      throw new Error('unexpected');
    });

    // The poll-verify loop sleeps 5s between update.status checks — fake
    // timers so the test doesn't burn 5 real seconds on one poll cycle.
    vi.useFakeTimers();
    try {
      const pending = advanceFleetUpdate(TENANT);
      await vi.advanceTimersByTimeAsync(5000);
      const job = await pending;
      expect(job?.instances[0].state).toBe('done');
      expect(job?.currentIndex).toBe(1);
      expect(job?.status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a failed instance stops the rollout (status=failed, index unchanged)', async () => {
    await seedJob();
    mockCallToInstance.mockImplementation(async (_url, _token, method) => {
      if (method === 'update.run') throw new Error('update.run failed: boom');
      throw new Error('unexpected');
    });

    const job = await advanceFleetUpdate(TENANT);
    expect(job?.instances[0].state).toBe('failed');
    expect(job?.status).toBe('failed');
    expect(job?.currentIndex).toBe(0);

    // A second advance() call is a no-op — the job is terminal.
    const again = await advanceFleetUpdate(TENANT);
    expect(again?.status).toBe('failed');
    expect(mockCallToInstance).toHaveBeenCalledTimes(3); // update.run + no further calls
  });

  test('advance() with no active job is a no-op returning current status', async () => {
    const view = await advanceFleetUpdate(TENANT);
    expect(view).toBeNull();
  });

  test('INVALID_REQUEST "drain" is retried without drain and the step proceeds', async () => {
    await seedJob();
    let runCalls = 0;
    mockCallToInstance.mockImplementation(
      async (_url: string, _token: string, method: string, params: Record<string, unknown>) => {
        if (method === 'update.run') {
          runCalls += 1;
          if (params?.drain) {
            throw new Error(
              'gateway update.run failed: {"code":"INVALID_REQUEST","message":"invalid update.run params: at root: unexpected property \'drain\'"}',
            );
          }
          return { ok: true };
        }
        if (method === 'update.status') return { current: '2.0.0' };
        throw new Error('unexpected');
      },
    );

    vi.useFakeTimers();
    try {
      const pending = advanceFleetUpdate(TENANT);
      await vi.advanceTimersByTimeAsync(5000);
      const job = await pending;
      // First call (with drain) rejected, retried once without it.
      expect(runCalls).toBe(2);
      expect(job?.instances[0].state).toBe('done');
      expect(job?.instances[0].drainSupported).toBe(false);
      expect(job?.status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  test('a non-drain error still fails the step (no blind retry)', async () => {
    await seedJob();
    mockCallToInstance.mockImplementation(async (_url: string, _token: string, method: string) => {
      if (method === 'update.run') {
        throw new Error(
          'gateway update.run failed: {"code":"INVALID_REQUEST","message":"invalid update.run params: at root: unexpected property \'restartDelayMs\'"}',
        );
      }
      throw new Error('unexpected');
    });

    mockCallToInstance.mockClear(); // drop seedJob()'s snapshot calls
    const job = await advanceFleetUpdate(TENANT);
    expect(job?.instances[0].state).toBe('failed');
    expect(job?.status).toBe('failed');
    // Only the single (failed) update.run call — no retry for a non-drain error.
    expect(mockCallToInstance).toHaveBeenCalledTimes(1);
  });
});

describe('abortFleetUpdate', () => {
  test('marks the job cancelled; a later advance() no-ops', async () => {
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date() },
    ]);
    mockGetCreds.mockResolvedValue({ url: 'ws://a', token: 'tok' });
    mockCallToInstance.mockResolvedValue({ current: 'old', connections: 0 });
    await startFleetUpdate(TENANT, 'user1', '2.0.0');

    const aborted = await abortFleetUpdate(TENANT);
    expect(aborted?.status).toBe('cancelled');
    expect(aborted?.active).toBe(false);

    mockCallToInstance.mockClear();
    const after = await advanceFleetUpdate(TENANT);
    expect(after?.status).toBe('cancelled');
    expect(mockCallToInstance).not.toHaveBeenCalled();
  });
});

describe('getFleetUpdateStatus', () => {
  test('returns null when nothing was ever started', async () => {
    expect(await getFleetUpdateStatus(TENANT)).toBeNull();
  });
});
