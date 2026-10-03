import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLAN_OPERATION_MAX_BYTES,
  PlanOpenPersistence,
  PlanPersistenceError,
  freezePlanCart,
  observePendingPlanOperation,
  pendingPlanOperationBytes,
  serializePendingPlanOperation,
  type PendingPlanOperation,
  type LegacyPlanOpenIntent,
  type PlanOpenContinuation,
  type PlanOpenIntent,
  type PlanOperationIdentity,
} from './plan-open-persistence';

const IDENTITY: PlanOperationIdentity = { actorId: 'actor-1', orgId: 'org-1' };
const OPERATION_ID = '11111111-1111-4111-8111-111111111111';

class MemoryStorage {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];
  throwGet = false;
  throwSet = false;
  throwRemove = false;
  mismatchedReadback = false;

  getItem(key: string): string | null {
    this.calls.push('get');
    if (this.throwGet) throw new Error('get failed');
    const value = this.values.get(key) ?? null;
    return this.mismatchedReadback && value !== null ? value + 'x' : value;
  }

  setItem(key: string, value: string): void {
    this.calls.push('set');
    if (this.throwSet) throw new Error('set failed');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.calls.push('remove');
    if (this.throwRemove) throw new Error('remove failed');
    this.values.delete(key);
  }
}

class LockHarness {
  readonly calls: string[] = [];
  #tails = new Map<string, Promise<void>>();

  async request<T>(
    name: string,
    options: { mode: 'exclusive'; signal: AbortSignal },
    callback: () => T | PromiseLike<T>,
  ): Promise<T> {
    this.calls.push(name);
    const previous = this.#tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(
      name,
      previous.then(() => current),
    );
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        if (options.signal.aborted) reject(options.signal.reason);
        else
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
      }),
    ]);
    if (options.signal.aborted) throw options.signal.reason;
    try {
      return await callback();
    } finally {
      release();
      if (this.#tails.get(name) === current) this.#tails.delete(name);
    }
  }
}

function intent(overrides: Partial<PlanOpenIntent> = {}): PlanOpenIntent {
  return {
    clientKey: 'party:party-1',
    partyId: 'party-1',
    crmContactId: null,
    bookingId: null,
    productId: null,
    title: 'Treatment plan',
    totalAmount: 100,
    currency: { kind: 'omitted' },
    dueSchedule: null,
    note: null,
    ...overrides,
  };
}

function legacyIntent(overrides: Partial<LegacyPlanOpenIntent> = {}): LegacyPlanOpenIntent {
  const { clientKey: _clientKey, ...legacy } = intent();
  return { ...legacy, ...overrides };
}

function accountContinuation(): PlanOpenContinuation {
  return { kind: 'account', clientKey: 'party:party-1' };
}

function sellContinuation(count = 1): PlanOpenContinuation {
  return {
    kind: 'sell',
    partyId: 'party-1',
    bookingId: null,
    preCart: Array.from({ length: count }, (_, index) => ({
      productId: 'product-' + index,
      kind: 'service' as const,
      qty: '1',
      unitPrice: '10.00',
      discount: '0',
      bookingId: null,
      redemptionId: null,
      planId: null,
    })),
    postCart: null,
  };
}

function persistence(
  storage = new MemoryStorage(),
  locks = new LockHarness(),
  overrides: Record<string, unknown> = {},
) {
  return {
    storage,
    locks,
    value: new PlanOpenPersistence({
      storage,
      locks,
      randomUUID: () => OPERATION_ID,
      ...overrides,
    }),
  };
}

function code(error: unknown): string | undefined {
  return error instanceof PlanPersistenceError ? error.code : undefined;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlanOpenPersistence bounds and privacy', () => {
  it('round-trips the strict minimal record without presentation or tender fields', async () => {
    const { value } = persistence();
    const admission = await value.admit(
      IDENTITY,
      intent({ note: 'internal note' }),
      accountContinuation(),
      new AbortController().signal,
    );

    expect(admission.created).toBe(true);
    const raw = serializePendingPlanOperation(admission.record);
    expect(JSON.parse(raw)).toEqual(admission.record);
    for (const forbidden of [
      'customerName',
      'docNumber',
      'phone',
      'email',
      'productLabel',
      'tender',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('admits 365 due rows and 250 cart rows, then blocks either next row before UUID', async () => {
    const dueSchedule = Array.from({ length: 365 }, (_, index) => ({
      dueOn: '2027-01-01',
      amount: 1,
    }));
    const randomUUID = vi.fn(() => OPERATION_ID);
    const accepted = persistence(new MemoryStorage(), new LockHarness(), { randomUUID }).value;
    await expect(
      accepted.admit(
        IDENTITY,
        intent({ totalAmount: 365, dueSchedule }),
        sellContinuation(250),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ created: true });

    for (const [invalidIntent, invalidContinuation] of [
      [
        intent({ totalAmount: 366, dueSchedule: [...dueSchedule, dueSchedule[0]] }),
        accountContinuation(),
      ],
      [intent(), sellContinuation(251)],
    ] as const) {
      randomUUID.mockClear();
      const candidate = persistence(new MemoryStorage(), new LockHarness(), { randomUUID }).value;
      await expect(
        candidate.admit(IDENTITY, invalidIntent, invalidContinuation, new AbortController().signal),
      ).rejects.toSatisfy((error: unknown) => code(error) === 'record_invalid');
      expect(randomUUID).not.toHaveBeenCalled();
    }
  });

  it('blocks a lossy principal or invalid schedule before UUID and storage', async () => {
    for (const invalidIntent of [
      intent({ totalAmount: 1.005 }),
      intent({
        dueSchedule: [{ dueOn: '2027-01-01', amount: 99.99 }],
      }),
      intent({
        dueSchedule: [{ dueOn: '2027-01-01', amount: 100.001 }],
      }),
      intent({
        dueSchedule: [
          { dueOn: '2027-02-01', amount: 50 },
          { dueOn: '2027-01-01', amount: 50 },
        ],
      }),
    ]) {
      const storage = new MemoryStorage();
      const randomUUID = vi.fn(() => OPERATION_ID);
      const candidate = persistence(storage, new LockHarness(), { randomUUID }).value;

      await expect(
        candidate.admit(
          IDENTITY,
          invalidIntent,
          accountContinuation(),
          new AbortController().signal,
        ),
      ).rejects.toSatisfy((error: unknown) => code(error) === 'record_invalid');
      expect(randomUUID).not.toHaveBeenCalled();
      expect(storage.calls).toEqual([]);
    }
  });

  it('uses UTF-8 bytes and accepts the configured edge but blocks the next byte before UUID', async () => {
    expect(PLAN_OPERATION_MAX_BYTES).toBe(131_072);
    const probe: PendingPlanOperation = {
      version: 2,
      actorId: IDENTITY.actorId,
      orgId: IDENTITY.orgId,
      operationId: OPERATION_ID,
      stage: 'prepared',
      intent: intent({ note: 'ñ' }),
      planId: null,
      continuation: accountContinuation(),
    };
    const bytes = pendingPlanOperationBytes(probe);
    expect(bytes).toBeGreaterThan(JSON.stringify(probe).length);

    const exact = persistence(new MemoryStorage(), new LockHarness(), { maxBytes: bytes }).value;
    await expect(
      exact.admit(IDENTITY, probe.intent, probe.continuation, new AbortController().signal),
    ).resolves.toMatchObject({ created: true });

    const randomUUID = vi.fn(() => OPERATION_ID);
    const over = persistence(new MemoryStorage(), new LockHarness(), {
      maxBytes: bytes - 1,
      randomUUID,
    }).value;
    await expect(
      over.admit(IDENTITY, probe.intent, probe.continuation, new AbortController().signal),
    ).rejects.toSatisfy((error: unknown) => code(error) === 'record_too_large');
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('retains byte-compatible legacy records for recovery while new admission writes version 2', async () => {
    const legacy: PendingPlanOperation = {
      version: 1,
      actorId: IDENTITY.actorId,
      orgId: IDENTITY.orgId,
      operationId: OPERATION_ID,
      stage: 'unknown',
      intent: legacyIntent(),
      planId: null,
      continuation: accountContinuation(),
    };
    const storage = new MemoryStorage();
    const { value } = persistence(storage);
    const raw = JSON.stringify(legacy);
    storage.values.set(value.storageKey(IDENTITY), raw);

    await expect(value.read(IDENTITY, new AbortController().signal)).resolves.toEqual(legacy);
    expect(storage.values.get(value.storageKey(IDENTITY))).toBe(raw);

    storage.values.clear();
    await expect(
      value.admit(IDENTITY, intent(), accountContinuation(), new AbortController().signal),
    ).resolves.toMatchObject({ record: { version: 2, intent: { clientKey: 'party:party-1' } } });
  });

  it('freezes only the bounded cart identity and raw money fields', () => {
    expect(
      freezePlanCart([
        {
          sellable: { productId: 'product-1', kind: 'service' },
          qty: '2',
          unitPrice: '10.25',
          discount: '0.50',
          bookingId: 'booking-1',
        },
      ]),
    ).toEqual([
      {
        productId: 'product-1',
        kind: 'service',
        qty: '2',
        unitPrice: '10.25',
        discount: '0.50',
        bookingId: 'booking-1',
        redemptionId: null,
        planId: null,
      },
    ]);
  });
});

describe('PlanOpenPersistence ownership', () => {
  it('publishes same-tab slot admission and clearing through bounded locked reads', async () => {
    const durable = persistence();
    const observations: Array<string | null> = [];
    const stop = observePendingPlanOperation(
      IDENTITY,
      (observation) =>
        observations.push(
          observation.status === 'blocked' ? 'blocked' : (observation.record?.operationId ?? null),
        ),
      { persistence: durable.value, deadlineMs: 1_000 },
    );

    await vi.waitFor(() => expect(observations).toEqual([null]));
    await durable.value.admit(
      IDENTITY,
      intent(),
      accountContinuation(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(observations.at(-1)).toBe(OPERATION_ID));
    await durable.value.clear(IDENTITY, OPERATION_ID, new AbortController().signal);
    await vi.waitFor(() => expect(observations.at(-1)).toBeNull());

    stop();
  });

  it('serializes simultaneous admission to one UUID and one stored record', async () => {
    const storage = new MemoryStorage();
    const locks = new LockHarness();
    const firstUUID = vi.fn(() => OPERATION_ID);
    const secondUUID = vi.fn(() => '22222222-2222-4222-8222-222222222222');
    const first = new PlanOpenPersistence({ storage, locks, randomUUID: firstUUID });
    const second = new PlanOpenPersistence({ storage, locks, randomUUID: secondUUID });

    const [left, right] = await Promise.all([
      first.admit(IDENTITY, intent(), accountContinuation(), new AbortController().signal),
      second.admit(IDENTITY, intent(), accountContinuation(), new AbortController().signal),
    ]);

    expect([left.created, right.created].sort()).toEqual([false, true]);
    expect(left.record.operationId).toBe(OPERATION_ID);
    expect(right.record.operationId).toBe(OPERATION_ID);
    expect(firstUUID).toHaveBeenCalledTimes(1);
    expect(secondUUID).not.toHaveBeenCalled();
  });

  it('retains corrupt, version-mismatched and wrong-owner records without rewriting them', async () => {
    for (const raw of [
      '{broken',
      JSON.stringify({ version: 3 }),
      JSON.stringify({
        version: 1,
        actorId: 'other',
        orgId: IDENTITY.orgId,
        operationId: OPERATION_ID,
      }),
    ]) {
      const storage = new MemoryStorage();
      const { value } = persistence(storage);
      const key = value.storageKey(IDENTITY);
      storage.values.set(key, raw);
      await expect(value.read(IDENTITY, new AbortController().signal)).rejects.toSatisfy(
        (error: unknown) => code(error) === 'record_invalid',
      );
      expect(storage.values.get(key)).toBe(raw);
      expect(storage.calls).not.toContain('set');
      expect(storage.calls).not.toContain('remove');
    }
  });

  it('fails closed on storage write and byte readback errors', async () => {
    const writeFailure = new MemoryStorage();
    writeFailure.throwSet = true;
    await expect(
      persistence(writeFailure).value.admit(
        IDENTITY,
        intent(),
        accountContinuation(),
        new AbortController().signal,
      ),
    ).rejects.toSatisfy((error: unknown) => code(error) === 'storage_write');

    const readbackFailure = new MemoryStorage();
    readbackFailure.mismatchedReadback = true;
    await expect(
      persistence(readbackFailure).value.admit(
        IDENTITY,
        intent(),
        accountContinuation(),
        new AbortController().signal,
      ),
    ).rejects.toSatisfy((error: unknown) => code(error) === 'storage_readback');
  });

  it('aborts a held lock and denies its deliberately late callback', async () => {
    let lateCallback: (() => unknown) | undefined;
    const storage = new MemoryStorage();
    const locks = {
      async request<T>(
        _name: string,
        options: { mode: 'exclusive'; signal: AbortSignal },
        callback: () => T | PromiseLike<T>,
      ): Promise<T> {
        return new Promise<T>((_resolve, reject) => {
          lateCallback = callback;
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true,
          });
        });
      },
    };
    const value = new PlanOpenPersistence({ storage, locks, randomUUID: () => OPERATION_ID });
    const controller = new AbortController();
    const admission = value.admit(IDENTITY, intent(), accountContinuation(), controller.signal);
    controller.abort(new DOMException('deadline', 'TimeoutError'));

    await expect(admission).rejects.toSatisfy(
      (error: unknown) => code(error) === 'owner_cancelled',
    );
    await expect(Promise.resolve(lateCallback?.())).rejects.toSatisfy(
      (error: unknown) => code(error) === 'owner_cancelled',
    );
    expect(storage.calls).toEqual([]);
  });

  it('updates and clears only the matching operation ID', async () => {
    const { value } = persistence();
    await value.admit(IDENTITY, intent(), accountContinuation(), new AbortController().signal);
    const updated = await value.update(
      IDENTITY,
      OPERATION_ID,
      new AbortController().signal,
      (record) => ({ ...record, stage: 'unknown' }),
    );
    expect(updated.stage).toBe('unknown');

    expect(
      await value.clear(
        IDENTITY,
        '22222222-2222-4222-8222-222222222222',
        new AbortController().signal,
      ),
    ).toBe(false);
    expect(await value.read(IDENTITY, new AbortController().signal)).not.toBeNull();
    expect(await value.clear(IDENTITY, OPERATION_ID, new AbortController().signal)).toBe(true);
    expect(await value.read(IDENTITY, new AbortController().signal)).toBeNull();
  });
});
