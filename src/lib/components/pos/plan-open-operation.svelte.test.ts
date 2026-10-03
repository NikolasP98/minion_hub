import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
import { PlanOpenPersistence } from './plan-open-persistence';
import {
  PlanOpenOperation,
  type PlanCreatedCallback,
  type PlanOpenBinding,
  type PlanOpenSubmission,
} from './plan-open-operation.svelte';

const IDENTITY = { actorId: 'actor-1', orgId: 'org-1' };
const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const PARTY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_KEY = `party:${PARTY_ID}`;
const CANONICAL_IDENTITY = {
  partyId: PARTY_ID,
  crmContactId: null,
  clientKey: CLIENT_KEY,
  identityStatus: 'active',
} as const;

class MemoryStorage {
  readonly values = new Map<string, string>();
  throwRemove = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.throwRemove) throw new Error('remove failed');
    this.values.delete(key);
  }
}

const immediateLocks = {
  async request<T>(
    _name: string,
    options: { mode: 'exclusive'; signal: AbortSignal },
    callback: () => T | PromiseLike<T>,
  ): Promise<T> {
    if (options.signal.aborted) throw options.signal.reason;
    return callback();
  },
};

function persistence(storage = new MemoryStorage()) {
  return {
    storage,
    value: new PlanOpenPersistence({
      storage,
      locks: immediateLocks,
      events: null,
      randomUUID: () => OPERATION_ID,
    }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function operationReceipt(id: string): Response {
  return jsonResponse({ plan: { id, clientKey: CLIENT_KEY, identityVersion: 2 } });
}

function installPlanFetch(
  transport: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith('/api/pos/plans/identity?')) {
      return Promise.resolve(jsonResponse(CANONICAL_IDENTITY));
    }
    return transport(input, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function binding(
  afterCreated: PlanOpenSubmission['afterCreated'],
  afterCompleted: PlanOpenSubmission['afterCompleted'] = vi.fn(),
): PlanOpenBinding {
  return {
    scope: 'pos:org-1',
    identity: IDENTITY,
    continuation: { kind: 'account', clientKey: CLIENT_KEY },
    afterCreated,
    afterCompleted,
  };
}

function submission(
  afterCreated: PlanOpenSubmission['afterCreated'],
  afterCompleted: PlanOpenSubmission['afterCompleted'] = vi.fn(),
): PlanOpenSubmission {
  return {
    ...binding(afterCreated, afterCompleted),
    partyId: PARTY_ID,
    crmContactId: null,
    bookingId: null,
    title: 'Treatment plan',
    totalAmount: 100,
    dueSchedule: null,
    note: null,
  };
}

function sellSubmission(afterCreated: PlanCreatedCallback): PlanOpenSubmission {
  return {
    ...submission(afterCreated),
    continuation: {
      kind: 'sell',
      partyId: PARTY_ID,
      bookingId: null,
      preCart: [
        {
          productId: 'service-1',
          kind: 'service',
          qty: '1',
          unitPrice: '100',
          discount: '0',
          bookingId: null,
          redemptionId: null,
          planId: null,
        },
      ],
      postCart: null,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PlanOpenOperation durable action repair', () => {
  it('requires the exact canonical identity response before allocating durable operation state', async () => {
    const durable = persistence();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ identity: CANONICAL_IDENTITY }));
    vi.stubGlobal('fetch', fetchMock);
    const operation = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });

    await operation.submit(submission(vi.fn()));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/pos/plans/identity?partyId=${PARTY_ID}`);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(await durable.value.read(IDENTITY, new AbortController().signal)).toBeNull();
    expect(operation.locked).toBe(false);
    operation.dispose();
  });

  it('clears the durable slot after the server proves a canonical identity change had no effect', async () => {
    const durable = persistence();
    const transport = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: 'Wallet identity changed.', code: 'wallet_identity_changed' }, 409),
      );
    installPlanFetch(transport);
    const operation = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });

    await operation.submit(submission(vi.fn()));

    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(await durable.value.read(IDENTITY, new AbortController().signal)).toBeNull();
    expect(operation.locked).toBe(false);
    operation.dispose();
  });

  it('persists the acknowledged plan before callback and clears only after callback succeeds', async () => {
    const runtime = createActionRuntime();
    const durable = persistence();
    const transport = vi.fn().mockResolvedValue(jsonResponse({ plan: { id: 'plan-1' } }, 201));
    installPlanFetch(transport);
    const observedStages: string[] = [];
    const afterCreated = vi.fn(async (): Promise<void> => {
      const record = await durable.value.read(IDENTITY, new AbortController().signal);
      observedStages.push(record?.stage ?? 'missing');
      throw new Error('projection unavailable');
    });
    const afterCompleted = vi.fn();
    const operation = new PlanOpenOperation({
      actions: runtime,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });

    await operation.submit(submission(afterCreated, afterCompleted));

    expect(observedStages).toEqual(['committed_refresh']);
    expect(operation.locked).toBe(true);
    expect(runtime.attentionRequired).toBe(1);
    expect(runtime.attention[0]?.status).toBe('committed-refreshing');
    expect(afterCompleted).not.toHaveBeenCalled();

    afterCreated.mockResolvedValueOnce(undefined);
    await operation.reconcile();

    expect(runtime.attentionRequired).toBe(0);
    expect(afterCreated).toHaveBeenCalledTimes(2);
    expect(afterCompleted).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await durable.value.read(IDENTITY, new AbortController().signal)).toBeNull();
    operation.dispose();
    runtime.dispose();
  });

  it('uses the exact operation lookup after an unknown response and never replays create', async () => {
    const runtime = createActionRuntime();
    const durable = persistence();
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(operationReceipt('plan-unknown'));
    installPlanFetch(transport);
    const afterCreated = vi.fn();
    const operation = new PlanOpenOperation({
      actions: runtime,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });

    await operation.submit(submission(afterCreated));
    expect(runtime.attentionRequired).toBe(1);
    expect(runtime.attention[0]?.status).toBe('unknown');

    const body = JSON.parse(String((transport.mock.calls[0]?.[1] as RequestInit).body)) as {
      operationId: string;
      clientKey: string;
    };
    await operation.reconcile();

    expect(body.operationId).toBe(OPERATION_ID);
    expect(body.clientKey).toBe(CLIENT_KEY);
    expect(transport.mock.calls[1]?.[0]).toBe('/api/pos/plans/operations/' + OPERATION_ID);
    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(afterCreated).toHaveBeenCalledWith(
      { id: 'plan-unknown' },
      expect.objectContaining({ scope: 'pos:org-1', operationId: OPERATION_ID }),
    );
    expect(runtime.attentionRequired).toBe(0);
    operation.dispose();
    runtime.dispose();
  });

  it('keeps lookup absence locked and cancels with the same durable identity', async () => {
    const runtime = createActionRuntime();
    const durable = persistence();
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ status: 'cancelled' }));
    installPlanFetch(transport);
    const afterCompleted = vi.fn();
    const operation = new PlanOpenOperation({
      actions: runtime,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });

    await operation.submit(submission(vi.fn(), afterCompleted));
    await operation.reconcile();

    expect(operation.locked).toBe(true);
    expect(operation.canCancel).toBe(true);
    expect(operation.message).toContain('not visible yet');
    expect(runtime.attentionRequired).toBe(1);

    await operation.cancel();

    expect(transport.mock.calls[2]?.[0]).toBe(
      '/api/pos/plans/operations/' + OPERATION_ID + '/cancel',
    );
    expect(operation.locked).toBe(false);
    expect(runtime.attentionRequired).toBe(0);
    expect(afterCompleted).toHaveBeenCalledTimes(1);
    operation.dispose();
    runtime.dispose();
  });

  it('treats only the operation-cancelled tombstone response as safe to clear', async () => {
    const cancelled = persistence();
    installPlanFetch(
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'cancelled', code: 'operation_cancelled' }, 409)),
    );
    const first = new PlanOpenOperation({
      actions: null,
      persistence: cancelled.value,
      currentScope: () => 'pos:org-1',
    });
    await first.submit(submission(vi.fn()));
    expect(first.locked).toBe(false);
    expect(await cancelled.value.read(IDENTITY, new AbortController().signal)).toBeNull();
    first.dispose();

    const conflict = persistence();
    installPlanFetch(
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'conflict', code: 'operation_conflict' }, 409)),
    );
    const second = new PlanOpenOperation({
      actions: null,
      persistence: conflict.value,
      currentScope: () => 'pos:org-1',
    });
    await second.submit(submission(vi.fn()));
    expect(second.locked).toBe(true);
    expect(await conflict.value.read(IDENTITY, new AbortController().signal)).toMatchObject({
      operationId: OPERATION_ID,
      stage: 'unknown',
    });
    second.dispose();
  });

  it('adopts the durable operation after remount without a second create POST', async () => {
    const durable = persistence();
    const transport = vi.fn().mockRejectedValueOnce(new Error('lost response'));
    installPlanFetch(transport);
    const first = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    await first.submit(submission(vi.fn()));
    first.dispose();

    const second = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    const restored = await second.initialize(binding(vi.fn()));

    expect(restored).toMatchObject({ title: 'Treatment plan', totalAmount: 100 });
    expect(second.locked).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
    second.dispose();
  });

  it('repairs a byte-compatible version 1 operation only through its exact receipt', async () => {
    const durable = persistence();
    const legacy = {
      version: 1,
      actorId: IDENTITY.actorId,
      orgId: IDENTITY.orgId,
      operationId: OPERATION_ID,
      stage: 'unknown',
      intent: {
        partyId: PARTY_ID,
        crmContactId: null,
        bookingId: null,
        productId: null,
        title: 'Legacy treatment',
        totalAmount: 100,
        currency: { kind: 'omitted' },
        dueSchedule: null,
        note: null,
      },
      planId: null,
      continuation: { kind: 'account', clientKey: CLIENT_KEY },
    } as const;
    durable.storage.values.set(durable.value.storageKey(IDENTITY), JSON.stringify(legacy));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ plan: { id: 'legacy-plan', clientKey: CLIENT_KEY, identityVersion: 1 } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const afterCreated = vi.fn();
    const operation = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });

    await operation.initialize(binding(afterCreated));
    await operation.reconcile();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/pos/plans/operations/' + OPERATION_ID);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(afterCreated).toHaveBeenCalledWith(
      { id: 'legacy-plan' },
      expect.objectContaining({ operationId: OPERATION_ID }),
    );
    expect(await durable.value.read(IDENTITY, new AbortController().signal)).toBeNull();
    operation.dispose();
  });

  it('keeps a failed or unknown cancellation durable for an idempotent retry', async () => {
    const durable = persistence();
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost create'))
      .mockRejectedValueOnce(new Error('lost cancel'))
      .mockResolvedValueOnce(jsonResponse({ status: 'cancelled' }));
    installPlanFetch(transport);
    const operation = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    await operation.submit(submission(vi.fn()));

    await operation.cancel();
    expect(operation.locked).toBe(true);
    expect(await durable.value.read(IDENTITY, new AbortController().signal)).not.toBeNull();

    await operation.cancel();
    expect(operation.locked).toBe(false);
    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3);
    operation.dispose();
  });

  it('repairs a create that wins the cancel race instead of abandoning it', async () => {
    const durable = persistence();
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost create'))
      .mockResolvedValueOnce(jsonResponse({ status: 'committed', plan: { id: 'plan-1' } }))
      .mockResolvedValueOnce(operationReceipt('plan-1'));
    installPlanFetch(transport);
    const afterCreated = vi.fn();
    const operation = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    await operation.submit(submission(afterCreated));

    await operation.cancel();

    expect(afterCreated).toHaveBeenCalledWith(
      { id: 'plan-1' },
      expect.objectContaining({ operationId: OPERATION_ID }),
    );
    expect(operation.locked).toBe(false);
    operation.dispose();
  });

  it('does not apply a recovered operation in another continuation context', async () => {
    const durable = persistence();
    installPlanFetch(vi.fn().mockRejectedValueOnce(new Error('lost create')));
    const first = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    await first.submit(submission(vi.fn()));
    first.dispose();

    const transport = vi.fn().mockResolvedValue(operationReceipt('plan-1'));
    installPlanFetch(transport);
    const afterCreated = vi.fn();
    const second = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    await second.initialize({
      ...binding(afterCreated),
      continuation: { kind: 'account', clientKey: 'party:other' },
    });
    await second.reconcile();

    expect(afterCreated).not.toHaveBeenCalled();
    expect(second.locked).toBe(true);
    expect(second.message).toContain('another client');
    second.dispose();
  });

  it('admits one durable operation across simultaneous controllers and sends one create POST', async () => {
    const storage = new MemoryStorage();
    const locks = immediateLocks;
    const firstPersistence = new PlanOpenPersistence({
      storage,
      locks,
      events: null,
      randomUUID: () => OPERATION_ID,
    });
    const secondPersistence = new PlanOpenPersistence({
      storage,
      locks,
      events: null,
      randomUUID: () => '22222222-2222-4222-8222-222222222222',
    });
    const create = new Promise<Response>((resolve) => {
      queueMicrotask(() => resolve(jsonResponse({ plan: { id: 'plan-1' } }, 201)));
    });
    const transport = vi.fn().mockReturnValue(create);
    installPlanFetch(transport);
    const first = new PlanOpenOperation({
      actions: null,
      persistence: firstPersistence,
      currentScope: () => 'pos:org-1',
    });
    const second = new PlanOpenOperation({
      actions: null,
      persistence: secondPersistence,
      currentScope: () => 'pos:org-1',
    });

    await Promise.all([first.submit(submission(vi.fn())), second.submit(submission(vi.fn()))]);

    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(first.success || second.success).toBe(true);
    first.dispose();
    second.dispose();
  });

  it('resumes a continuation-pending sell repair without replaying create', async () => {
    const durable = persistence();
    const transport = vi.fn().mockResolvedValue(jsonResponse({ plan: { id: 'plan-1' } }, 201));
    installPlanFetch(transport);
    const postCart = [
      {
        productId: 'plan:plan-1',
        kind: 'service' as const,
        qty: 1,
        unitPrice: 100,
        discount: 0,
        bookingId: null,
        redemptionId: null,
        planId: 'plan-1',
      },
    ];
    const crashingCallback = vi.fn<PlanCreatedCallback>(async (_plan, owner) => {
      await owner.prepareSellContinuation(postCart);
      throw new Error('crash after continuation_pending');
    });
    const first = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });

    await first.submit(sellSubmission(crashingCallback));

    expect(await durable.value.read(IDENTITY, new AbortController().signal)).toMatchObject({
      planId: 'plan-1',
      stage: 'continuation_pending',
      continuation: { kind: 'sell', postCart },
    });
    first.dispose();

    const repairedCallback = vi.fn<PlanCreatedCallback>(async (_plan, owner) => {
      await owner.prepareSellContinuation(postCart);
    });
    const nextSubmission = sellSubmission(repairedCallback);
    const second = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    await second.initialize(nextSubmission);
    await second.reconcile();

    expect(repairedCallback).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(await durable.value.read(IDENTITY, new AbortController().signal)).toBeNull();
    second.dispose();
  });

  it('recognizes continuation-applied after a delete crash and retries only deletion', async () => {
    const durable = persistence();
    const transport = vi.fn().mockResolvedValue(jsonResponse({ plan: { id: 'plan-1' } }, 201));
    installPlanFetch(transport);
    const afterCreated = vi.fn();
    const first = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    durable.storage.throwRemove = true;

    await first.submit(submission(afterCreated));

    expect(afterCreated).toHaveBeenCalledTimes(1);
    expect(await durable.value.read(IDENTITY, new AbortController().signal)).toMatchObject({
      planId: 'plan-1',
      stage: 'continuation_applied',
    });
    first.dispose();
    durable.storage.throwRemove = false;

    const second = new PlanOpenOperation({
      actions: null,
      persistence: durable.value,
      currentScope: () => 'pos:org-1',
    });
    await second.initialize(binding(afterCreated));
    await second.reconcile();

    expect(afterCreated).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await durable.value.read(IDENTITY, new AbortController().signal)).toBeNull();
    second.dispose();
  });
});
