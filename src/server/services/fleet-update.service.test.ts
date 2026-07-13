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
  leaseUntil: number | null;
};

let rows: Row[] = [];
let transactionTail = Promise.resolve();

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
      where: (whereFn: (r: Row) => boolean) => {
        const execute = () => {
          const matched = rows.filter((r) => matches(r, whereFn));
          rows = rows.map((r) => (matches(r, whereFn) ? { ...r, ...patch } : r));
          return matched.map((r) => ({ ...r, ...patch }));
        };
        return {
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(execute()).then(resolve, reject),
          returning: async () => execute(),
        };
      },
    }),
  }),
  transaction: async <T>(fn: (tx: typeof mockDb) => Promise<T>, _config?: unknown) => {
    const previous = transactionTail;
    let release!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn(mockDb);
    } finally {
      release();
    }
  },
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
    leaseUntil: 'leaseUntil',
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
  isNull: (col: string) => (r: Row) => (r as unknown as Record<string, unknown>)[col] == null,
  lt: (col: string, val: number) => (r: Row) => Number((r as unknown as Record<string, unknown>)[col]) < val,
  or:
    (...fns: ((r: Row) => boolean)[]) =>
    (r: Row) =>
      fns.some((f) => f(r)),
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
  transactionTail = Promise.resolve();
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

  test('an instance on a NEWER build than the target is done, not a downgrade candidate', async () => {
    // Stale-target trap: retrying an old target against instances already on a
    // newer build must NOT try to "reach" (downgrade to) it — it would just
    // time out. Both instances on 20260711212523 (> target 20260711050417).
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date(100) },
      { id: 'b', name: 'B', url: 'ws://b', authMode: 'token', createdAt: new Date(200) },
    ]);
    mockGetCreds.mockImplementation(async (id: string) => ({ url: `ws://${id}`, token: `tok-${id}` }));
    mockCallToInstance.mockResolvedValue({
      current: '2026.7.11-dev.20260711212523',
      connections: 0,
    });

    const job = await startFleetUpdate(TENANT, 'user1', '2026.7.10-dev.20260711050417');
    expect(job.instances.every((i) => i.state === 'done')).toBe(true);
    // All done → the job is immediately complete, never a running rollout.
    expect(job.status).toBe('done');
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

  test('concurrent starts create exactly one active fleet job', async () => {
    mockListGateways.mockResolvedValue([
      { id: 'a', name: 'A', url: 'ws://a', authMode: 'token', createdAt: new Date() },
    ]);
    mockGetCreds.mockResolvedValue({ url: 'ws://a', token: 'tok' });
    mockCallToInstance.mockResolvedValue({ current: 'old', connections: 0 });

    const results = await Promise.allSettled([
      startFleetUpdate(TENANT, 'user1', '2.0.0'),
      startFleetUpdate(TENANT, 'user2', '2.0.0'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(rows.filter((row) => row.type === 'fleet_update' && row.status === 'running')).toHaveLength(1);
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

  test('missing `connections` field is null (unknown) and sorts after known load', async () => {
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
    // Unknown is not a safe canary signal, even when the known peer is busy.
    expect(job.instances.map((i) => i.gatewayId)).toEqual(['b', 'a']);
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

  test('concurrent advances claim the step once and dispatch one update.run', async () => {
    await seedJob();
    let releaseRun!: () => void;
    const runBlocked = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    mockCallToInstance.mockImplementation(async (_url, _token, method) => {
      if (method === 'update.run') return runBlocked;
      if (method === 'update.status') return { current: '2.0.0' };
      throw new Error('unexpected');
    });

    vi.useFakeTimers();
    try {
      const first = advanceFleetUpdate(TENANT);
      await vi.advanceTimersByTimeAsync(0);
      const second = advanceFleetUpdate(TENANT);
      await vi.advanceTimersByTimeAsync(0);
      expect(mockCallToInstance.mock.calls.filter((call) => call[2] === 'update.run')).toHaveLength(1);

      releaseRun();
      await vi.advanceTimersByTimeAsync(5000);
      await Promise.all([first, second]);
      expect(mockCallToInstance.mock.calls.filter((call) => call[2] === 'update.run')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('abort remains terminal when an in-flight advance later succeeds', async () => {
    await seedJob();
    let releaseRun!: () => void;
    const runBlocked = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    mockCallToInstance.mockImplementation(async (_url, _token, method) => {
      if (method === 'update.run') return runBlocked;
      if (method === 'update.status') return { current: '2.0.0' };
      throw new Error('unexpected');
    });

    vi.useFakeTimers();
    try {
      const advancing = advanceFleetUpdate(TENANT);
      await vi.advanceTimersByTimeAsync(0);
      const aborted = await abortFleetUpdate(TENANT);
      expect(aborted?.status).toBe('cancelled');

      releaseRun();
      await vi.advanceTimersByTimeAsync(5000);
      const final = await advancing;
      expect(final?.status).toBe('cancelled');
      expect(rows.find((row) => row.type === 'fleet_update')?.status).toBe('cancelled');
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

  // ── round-5: prod incident — minion-2's install SUCCEEDED but the step
  // was recorded as failed on a WS-handshake "Unexpected server response:
  // 502" from the Tailscale funnel mid-restart. ──────────────────────────

  test('round-5: a connection-level 502 during poll-verify is retried, not fatal', async () => {
    await seedJob();
    let statusCalls = 0;
    mockCallToInstance.mockImplementation(async (_url: string, _token: string, method: string) => {
      if (method === 'update.run') return { ok: true };
      if (method === 'update.status') {
        statusCalls += 1;
        // First two polls hit the restarting gateway through the funnel proxy.
        if (statusCalls <= 2) throw new Error('Unexpected server response: 502');
        return { current: '2.0.0' };
      }
      throw new Error('unexpected');
    });

    vi.useFakeTimers();
    try {
      const pending = advanceFleetUpdate(TENANT);
      await vi.advanceTimersByTimeAsync(5000); // poll 1: 502
      await vi.advanceTimersByTimeAsync(5000); // poll 2: 502
      await vi.advanceTimersByTimeAsync(5000); // poll 3: on target
      const job = await pending;
      expect(job?.instances[0].state).toBe('done');
      expect(job?.instances[0].error).toBeUndefined();
      expect(job?.status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  test('round-5: update.run dying mid-flight (connection drop) does not fail — verify decides', async () => {
    await seedJob();
    mockCallToInstance.mockImplementation(async (_url: string, _token: string, method: string) => {
      if (method === 'update.run') {
        // No "failed:" substring — a transport-level throw, not an explicit
        // application rejection (matches gateway-rpc.ts's ws 'error'/'close'/
        // timeout wording).
        throw new Error('gateway WS closed before response (request sent)');
      }
      if (method === 'update.status') return { current: '2.0.0' };
      throw new Error('unexpected');
    });

    vi.useFakeTimers();
    try {
      const pending = advanceFleetUpdate(TENANT);
      await vi.advanceTimersByTimeAsync(5000);
      const job = await pending;
      expect(job?.instances[0].state).toBe('done');
      expect(job?.status).toBe('running');
    } finally {
      vi.useRealTimers();
    }
  });

  test('round-5: an explicit update.run error response still fails immediately (no poll-verify)', async () => {
    await seedJob();
    mockCallToInstance.mockImplementation(async (_url: string, _token: string, method: string) => {
      if (method === 'update.run') {
        throw new Error('gateway update.run failed: {"code":"INTERNAL","message":"disk full"}');
      }
      throw new Error('unexpected');
    });
    mockCallToInstance.mockClear(); // drop seedJob()'s snapshot calls

    const job = await advanceFleetUpdate(TENANT);
    expect(job?.instances[0].state).toBe('failed');
    expect(job?.status).toBe('failed');
    expect(job?.instances[0].error).toContain('disk full');
    // Only the single (failed) update.run call — never reached poll-verify.
    expect(mockCallToInstance).toHaveBeenCalledTimes(1);
  });

  test('round-5: reconcile-to-truth — version match at verify marks done even with a stale prior error', async () => {
    const started = await seedJob();
    // Simulate a stale `error` field on the current instance left over from
    // some earlier bookkeeping — verify must override it once it observes
    // the target version, per the reconcile-to-truth contract.
    rows = rows.map((r) => {
      if (r.id !== started.id) return r;
      const cursor = JSON.parse(r.cursor ?? '{}');
      cursor.instances[cursor.currentIndex].error = 'stale from a previous glitch';
      return { ...r, cursor: JSON.stringify(cursor) };
    });

    mockCallToInstance.mockImplementation(async (_url: string, _token: string, method: string) => {
      if (method === 'update.run') return { ok: true };
      if (method === 'update.status') return { current: '2.0.0' };
      throw new Error('unexpected');
    });

    vi.useFakeTimers();
    try {
      const pending = advanceFleetUpdate(TENANT);
      await vi.advanceTimersByTimeAsync(5000);
      const job = await pending;
      expect(job?.instances[0].state).toBe('done');
      expect(job?.instances[0].error).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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

  function seedFailedJob(target: string, instances: { gatewayId: string; name: string; url: string }[]) {
    rows.push({
      id: 'ghost',
      tenantId: TENANT,
      userId: 'user1',
      type: 'fleet_update',
      refId: null,
      status: 'failed',
      cursor: JSON.stringify({
        targetVersion: target,
        currentIndex: 0,
        instances: instances.map((i) => ({
          ...i,
          state: 'failed',
          connections: null,
          fromVersion: null,
          toVersion: target,
          error: `did not reach ${target} within 240s`,
        })),
      }),
      error: `did not reach ${target} within 240s`,
      attempts: 0,
      createdAt: 1000,
      updatedAt: 1000,
      startedAt: 1000,
      finishedAt: 1000,
    });
  }

  test('retires a failed job the fleet has already rolled PAST (superseded → cancelled)', async () => {
    // The prod phantom: a failed rollout to an ancient target while every
    // instance now runs a newer build. It must stop resurfacing.
    seedFailedJob('2026.7.10-dev.20260711050417', [
      { gatewayId: 'a', name: 'minion-2', url: 'ws://a' },
      { gatewayId: 'b', name: 'minion-1', url: 'ws://b' },
    ]);
    mockGetCreds.mockImplementation(async (id: string) => ({ url: `ws://${id}`, token: `tok-${id}` }));
    mockCallToInstance.mockImplementation(async (url: string) => ({
      current:
        url === 'ws://a' ? '2026.7.11-dev.20260711212523' : '2026.7.11-dev.20260711055010',
    }));

    const view = await getFleetUpdateStatus(TENANT);
    expect(view?.status).toBe('cancelled');
    expect(view?.active).toBe(false);
    // Persisted: a second read hits the flipped row and skips the RPC path.
    mockCallToInstance.mockClear();
    const again = await getFleetUpdateStatus(TENANT);
    expect(again?.status).toBe('cancelled');
    expect(mockCallToInstance).not.toHaveBeenCalled();
  });

  test('keeps showing a failed rollback (instances still BEHIND the target)', async () => {
    // A genuine recent failure: rolled back to an older build than the target.
    // Not superseded — stays 'failed' so the card can offer a real Retry.
    seedFailedJob('2026.7.11-dev.20260711212523', [
      { gatewayId: 'a', name: 'minion-2', url: 'ws://a' },
    ]);
    mockGetCreds.mockResolvedValue({ url: 'ws://a', token: 'tok-a' });
    mockCallToInstance.mockResolvedValue({ current: '2026.7.11-dev.20260711055010' });

    const view = await getFleetUpdateStatus(TENANT);
    expect(view?.status).toBe('failed');
  });

  test('does not retire when the only instance is unreachable (no confirmation)', async () => {
    seedFailedJob('2026.7.10-dev.20260711050417', [
      { gatewayId: 'a', name: 'minion-2', url: 'ws://a' },
    ]);
    mockGetCreds.mockResolvedValue({ url: 'ws://a', token: 'tok-a' });
    mockCallToInstance.mockRejectedValue(new Error('Unexpected server response: 502'));

    const view = await getFleetUpdateStatus(TENANT);
    expect(view?.status).toBe('failed');
  });
});
