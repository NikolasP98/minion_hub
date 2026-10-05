// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import SellSessionHarness from './__fixtures__/SellSessionHarness.svelte';
import {
  createSellChargeHandoff,
  dispatchSellChargeHandoff,
  sellChargeStorageKey,
  type SellChargeHandoffInput,
} from './sell-charge-handoff';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function cartRow(productId: 'service-a' | 'service-b') {
  return {
    productId,
    kind: 'service',
    qty: '1',
    unitPrice: productId === 'service-a' ? '20' : '30',
    discount: '0',
    bookingId: null,
    redemptionId: null,
    planId: null,
  };
}

function planCartRow(planId: string, amount: number) {
  return {
    productId: `plan:${planId}`,
    kind: 'service',
    qty: 1,
    unitPrice: amount,
    discount: 0,
    bookingId: null,
    redemptionId: null,
    planId,
  };
}

function customer(partyId: string) {
  return JSON.stringify({
    partyId,
    customerName: partyId,
    customerPhone: null,
    customerDocNumber: null,
  });
}

function account(
  partyId: string,
  plans: Array<{
    plan: {
      id: string;
      title: string;
      productId: string | null;
      currency: string;
      status: string;
    };
    remaining: number;
    nextDue: { dueOn: string; amount: number } | null;
    scheduleIssue: null;
  }> = [],
) {
  return {
    clientKey: `party:${partyId}`,
    balance: 0,
    grants: [],
    plans,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  const writes: Array<{ key: string; value: string | null }> = [];
  const storage: StorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
      writes.push({ key, value });
    },
    removeItem: (key) => {
      values.delete(key);
      writes.push({ key, value: null });
    },
  };
  return { storage, values, writes };
}

const IDENTITY = { actorId: 'actor-a', orgId: 'org-a' };

function handoffRaw(input: SellChargeHandoffInput, identity = IDENTITY): string {
  const handoff = createSellChargeHandoff(identity, input);
  if (!handoff) throw new Error('invalid test handoff');
  return JSON.stringify(handoff);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mounted sell session ownership', () => {
  it.each([
    {
      name: 'authenticated actor',
      next: { actorId: 'actor-b', orgId: 'org-a' },
    },
    {
      name: 'organization',
      next: { actorId: 'actor-a', orgId: 'org-b' },
    },
  ])('rejects decoded account data from an old $name generation', async ({ next }) => {
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([cartRow('service-a')]),
      'pos-customer-org-a': customer('party-a'),
      'pos-cart-org-b': JSON.stringify([cartRow('service-b')]),
      'pos-customer-org-b': customer('party-b'),
    });
    const oldJson = deferred<ReturnType<typeof account>>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => oldJson.promise } as Response)
      .mockResolvedValueOnce(jsonResponse(account(next.orgId === 'org-b' ? 'party-b' : 'party-a')));
    vi.stubGlobal('fetch', fetchMock);

    const view = render(SellSessionHarness, {
      props: { actorId: 'actor-a', orgId: 'org-a', storage: store.storage },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await view.rerender({ ...next, storage: store.storage });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const expectedParty = next.orgId === 'org-b' ? 'party-b' : 'party-a';
    await waitFor(() =>
      expect(view.getByTestId('account').textContent).toBe(`party:${expectedParty}`),
    );
    const expectedCart = next.orgId === 'org-b' ? 'service-b' : 'service-a';
    expect(view.getByTestId('cart').textContent).toBe(expectedCart);

    oldJson.resolve(account('party-a'));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.getByTestId('account').textContent).toBe(`party:${expectedParty}`);
    expect(view.getByTestId('cart').textContent).toBe(expectedCart);
  });

  it('rejects a delayed JSON body after the selected customer changes', async () => {
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([cartRow('service-a')]),
      'pos-customer-org-a': customer('party-a'),
    });
    const oldJson = deferred<ReturnType<typeof account>>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => oldJson.promise } as Response)
      .mockResolvedValueOnce(jsonResponse(account('party-b')));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(SellSessionHarness, {
      props: { actorId: 'actor-a', orgId: 'org-a', storage: store.storage },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await fireEvent.click(view.getByRole('button', { name: 'Choose party B' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.getByTestId('account').textContent).toBe('party:party-b'));
    oldJson.resolve(account('party-a'));
    await Promise.resolve();
    await Promise.resolve();

    expect(view.getByTestId('party').textContent).toBe('party-b');
    expect(view.getByTestId('account').textContent).toBe('party:party-b');
  });

  it('rehydrates the new org and never writes its cart through the old key', async () => {
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([cartRow('service-a')]),
      'pos-cart-org-b': JSON.stringify([cartRow('service-b')]),
    });
    vi.stubGlobal('fetch', vi.fn());
    const view = render(SellSessionHarness, {
      props: { actorId: 'actor-a', orgId: 'org-a', storage: store.storage },
    });
    await waitFor(() => expect(view.getByTestId('cart').textContent).toBe('service-a'));
    const writesBeforeSwitch = store.writes.length;

    await view.rerender({ actorId: 'actor-a', orgId: 'org-b', storage: store.storage });
    await waitFor(() => expect(view.getByTestId('cart').textContent).toBe('service-b'));
    await fireEvent.click(view.getByRole('button', { name: 'Add service B' }));
    await waitFor(() => expect(view.getByTestId('cart').textContent).toBe('service-b,service-b'));

    const switchedWrites = store.writes.slice(writesBeforeSwitch);
    expect(switchedWrites.some((entry) => entry.key === 'pos-cart-org-b')).toBe(true);
    expect(switchedWrites.some((entry) => entry.key === 'pos-cart-org-a')).toBe(false);
    expect(JSON.parse(store.values.get('pos-cart-org-a') ?? '[]')).toEqual([cartRow('service-a')]);
  });

  it('blocks visibly and does not erase a cart when initial storage reads throw', async () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem,
      removeItem,
    };
    vi.stubGlobal('fetch', vi.fn());
    const view = render(SellSessionHarness, {
      props: { actorId: 'actor-a', orgId: 'org-a', storage },
    });

    expect((await view.findByRole('alert')).textContent).toContain('storage is unavailable');
    expect(view.getByTestId('cart').textContent).toBe('empty');
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('keeps the in-memory draft and the saved bytes when persistence throws', async () => {
    const original = JSON.stringify([cartRow('service-a')]);
    const values = new Map<string, string>([['pos-cart-org-a', original]]);
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (key === 'pos-cart-org-a') throw new Error('quota');
        values.set(key, value);
      },
      removeItem: (key) => values.delete(key),
    };
    vi.stubGlobal('fetch', vi.fn());
    const view = render(SellSessionHarness, {
      props: { actorId: 'actor-a', orgId: 'org-a', storage },
    });
    await waitFor(() => expect(view.getByTestId('cart').textContent).toBe('service-a'));
    expect((await view.findByRole('alert')).textContent).toContain('storage is unavailable');

    await fireEvent.click(view.getByRole('button', { name: 'Add service B' }));
    await waitFor(() => expect(view.getByTestId('cart').textContent).toBe('service-a,service-b'));
    expect(values.get('pos-cart-org-a')).toBe(original);
  });

  it('contains a throwing storage accessor and exposes a recovery blocker', async () => {
    const fallback = memoryStorage();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const view = render(SellSessionHarness, {
      props: {
        actorId: 'actor-a',
        orgId: 'org-a',
        storage: fallback.storage,
        storageFactory: () => {
          throw new DOMException('Access is denied', 'SecurityError');
        },
      },
    });

    expect((await view.findByRole('alert')).textContent).toContain('storage is unavailable');
    expect(view.getByTestId('hydrated').textContent).toBe('no');
    expect(view.getByTestId('cart').textContent).toBe('empty');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fallback.writes).toEqual([]);
  });

  it('hydrates first, then durably replaces the restored cart with a booking handoff', async () => {
    const key = sellChargeStorageKey(IDENTITY);
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([cartRow('service-b')]),
      'pos-customer-org-a': customer('party-old'),
      [key]: handoffRaw({
        bookingId: 'booking-a',
        productId: 'service-a',
        partyId: 'party-a',
        customerName: 'Party A',
        phone: '555-1000',
      }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const partyId = String(input).split('party:')[1] ?? '';
        return jsonResponse(account(partyId));
      }),
    );

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage },
    });
    await waitFor(() => expect(view.getByTestId('handoff').textContent).toBe('loaded'));

    expect(view.getByTestId('hydrated').textContent).toBe('yes');
    expect(view.getByTestId('cart').textContent).toBe('service-a');
    expect(view.getByTestId('party').textContent).toBe('party-a');
    expect(store.values.has(key)).toBe(false);
    expect(JSON.parse(store.values.get('pos-cart-org-a') ?? '[]')).toEqual([
      {
        productId: 'service-a',
        kind: 'service',
        qty: 1,
        unitPrice: 20,
        discount: 0,
        bookingId: 'booking-a',
        redemptionId: null,
        planId: null,
      },
    ]);
    expect(JSON.parse(store.values.get('pos-customer-org-a') ?? '{}')).toMatchObject({
      partyId: 'party-a',
      customerName: 'Party A',
      customerPhone: '555-1000',
    });
  });

  it('retires an old synthetic projection before adopting an ordinary booking', async () => {
    const key = sellChargeStorageKey(IDENTITY);
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([planCartRow('plan-old', 25)]),
      'pos-customer-org-a': customer('party-old'),
      [key]: handoffRaw({
        bookingId: 'booking-new',
        productId: 'service-a',
        partyId: 'party-new',
        customerName: 'Party New',
      }),
    });
    const oldResponse = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(jsonResponse(account('party-new')));
    vi.stubGlobal('fetch', fetchMock);

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage },
    });
    await waitFor(() => expect(view.getByTestId('handoff').textContent).toBe('loaded'));
    await waitFor(() => expect(view.getByTestId('account').textContent).toBe('party:party-new'));
    expect(view.getByTestId('cart').textContent).toBe('service-a');
    expect(view.queryByTestId('projection-error')).toBeNull();
    expect(store.values.has(key)).toBe(false);

    oldResponse.resolve(
      jsonResponse(
        account('party-old', [
          {
            plan: {
              id: 'plan-old',
              title: 'Old plan',
              productId: null,
              currency: 'PEN',
              status: 'open',
            },
            remaining: 25,
            nextDue: { dueOn: '2026-10-05', amount: 25 },
            scheduleIssue: null,
          },
        ]),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(view.getByTestId('cart').textContent).toBe('service-a');
    expect(view.getByTestId('account').textContent).toBe('party:party-new');
  });

  it('starts one fresh account read for an ordinary same-party handoff', async () => {
    const key = sellChargeStorageKey(IDENTITY);
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([cartRow('service-b')]),
      'pos-customer-org-a': customer('party-a'),
      [key]: handoffRaw({
        bookingId: 'booking-new',
        productId: 'service-a',
        partyId: 'party-a',
        customerName: 'Party A',
      }),
    });
    const oldResponse = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(jsonResponse({ ...account('party-a'), balance: 42 }));
    vi.stubGlobal('fetch', fetchMock);

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.getByTestId('handoff').textContent).toBe('loaded'));
    expect(view.getByTestId('cart').textContent).toBe('service-a');
    await waitFor(() => expect(view.getByTestId('account-balance').textContent).toBe('42'));
    expect(store.values.has(key)).toBe(false);

    oldResponse.resolve(jsonResponse({ ...account('party-a'), balance: 7 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.getByTestId('cart').textContent).toBe('service-a');
    expect(view.getByTestId('account-balance').textContent).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['pos-cart-org-a', 'pos-customer-org-a'])(
    'keeps the post-navigation handoff when staging %s fails',
    async (failingKey) => {
      const key = sellChargeStorageKey(IDENTITY);
      const raw = handoffRaw({
        bookingId: 'booking-a',
        productId: 'service-a',
        partyId: 'party-a',
      });
      const values = new Map<string, string>([
        ['pos-cart-org-a', JSON.stringify([cartRow('service-b')])],
        [key, raw],
      ]);
      const removeItem = vi.fn((storageKey: string) => values.delete(storageKey));
      const storage: StorageLike = {
        getItem: (storageKey) => values.get(storageKey) ?? null,
        setItem: (storageKey, value) => {
          if (storageKey === failingKey) throw new DOMException('Quota', 'QuotaExceededError');
          values.set(storageKey, value);
        },
        removeItem,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(account('party-a'))),
      );

      const view = render(SellSessionHarness, {
        props: { ...IDENTITY, storage },
      });
      await waitFor(() => expect(view.getByTestId('cart').textContent).toBe('service-a'));
      expect((await view.findByRole('alert')).textContent).toContain('storage is unavailable');

      expect(values.get(key)).toBe(raw);
      expect(removeItem).not.toHaveBeenCalledWith(key);
    },
  );

  it('defers a plan handoff during durable recovery, then installs its projected line', async () => {
    const key = sellChargeStorageKey(IDENTITY);
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([cartRow('service-b')]),
      'pos-customer-org-a': customer('party-old'),
      [key]: handoffRaw({
        bookingId: 'booking-plan',
        productId: null,
        partyId: 'party-a',
        customerName: 'Party A',
        planId: 'plan-a',
      }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const partyId = String(input).split('party:')[1] ?? '';
        return jsonResponse(
          account(
            partyId,
            partyId === 'party-a'
              ? [
                  {
                    plan: {
                      id: 'plan-a',
                      title: 'Plan A',
                      productId: null,
                      currency: 'PEN',
                      status: 'open',
                    },
                    remaining: 50,
                    nextDue: { dueOn: '2026-10-04', amount: 12 },
                    scheduleIssue: null,
                  },
                ]
              : [],
          ),
        );
      }),
    );

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage, hold: true },
    });
    await waitFor(() => expect(view.getByTestId('hydrated').textContent).toBe('yes'));
    expect(view.getByTestId('cart').textContent).toBe('service-b');
    expect(store.values.has(key)).toBe(true);

    await view.rerender({ ...IDENTITY, storage: store.storage, hold: false });
    await waitFor(() => expect(view.getByTestId('handoff').textContent).toBe('loaded'));
    expect(view.getByTestId('cart').textContent).toBe('plan:plan-a');
    expect(view.getByTestId('pending-plan').textContent).toBe('none');
    expect(store.values.has(key)).toBe(false);
    expect(JSON.parse(store.values.get('pos-cart-org-a') ?? '[]')).toEqual([
      expect.objectContaining({
        productId: 'plan:plan-a',
        unitPrice: 12,
        planId: 'plan-a',
      }),
    ]);
  });

  it('keeps a plan handoff blocked and retryable when its plan is missing', async () => {
    const key = sellChargeStorageKey(IDENTITY);
    const store = memoryStorage({
      [key]: handoffRaw({
        bookingId: 'booking-plan',
        productId: null,
        partyId: 'party-a',
        planId: 'plan-missing',
      }),
    });
    const fetchMock = vi.fn(async () => jsonResponse(account('party-a')));
    vi.stubGlobal('fetch', fetchMock);

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage },
    });
    expect((await view.findByTestId('projection-error')).textContent).toContain(
      'Saved plan cart could not be restored.',
    );
    expect(view.getByTestId('cart').textContent).toBe('empty');
    expect(store.values.has(key)).toBe(true);

    await fireEvent.click(view.getByRole('button', { name: 'Retry plan projection' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(store.values.has(key)).toBe(true);
  });

  it('retires an old deferred plan projection and retries the adopted handoff projection', async () => {
    const key = sellChargeStorageKey(IDENTITY);
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([planCartRow('plan-old', 25)]),
      'pos-customer-org-a': customer('party-old'),
      [key]: handoffRaw({
        bookingId: 'booking-new',
        productId: null,
        partyId: 'party-new',
        customerName: 'Party New',
        planId: 'plan-new',
      }),
    });
    const oldResponse = deferred<Response>();
    const failedNewResponse = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(failedNewResponse.promise)
      .mockResolvedValueOnce(
        jsonResponse(
          account('party-new', [
            {
              plan: {
                id: 'plan-new',
                title: 'New plan',
                productId: null,
                currency: 'PEN',
                status: 'open',
              },
              remaining: 40,
              nextDue: { dueOn: '2026-10-05', amount: 20 },
              scheduleIssue: null,
            },
          ]),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(view.getByTestId('pending').textContent).toBe('pending');
    expect(view.queryByTestId('projection-error')).toBeNull();
    expect(store.values.has(key)).toBe(true);

    failedNewResponse.resolve(new Response(null, { status: 503 }));
    expect((await view.findByTestId('projection-error')).textContent).toContain(
      'Saved plan cart could not be restored.',
    );
    expect(view.getByTestId('cart').textContent).toBe('empty');
    expect(store.values.has(key)).toBe(true);

    await fireEvent.click(view.getByRole('button', { name: 'Retry plan projection' }));
    await waitFor(() => expect(view.getByTestId('handoff').textContent).toBe('loaded'));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(view.getByTestId('cart').textContent).toBe('plan:plan-new');
    expect(store.values.has(key)).toBe(false);

    oldResponse.resolve(jsonResponse(account('party-old')));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.getByTestId('cart').textContent).toBe('plan:plan-new');
    expect(view.getByTestId('account').textContent).toBe('party:party-new');
  });

  it('replaces a same-party plan projection with one fresh read for the handoff plan', async () => {
    const key = sellChargeStorageKey(IDENTITY);
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([planCartRow('plan-old', 25)]),
      'pos-customer-org-a': customer('party-a'),
      [key]: handoffRaw({
        bookingId: 'booking-new',
        productId: null,
        partyId: 'party-a',
        customerName: 'Party A',
        planId: 'plan-new',
      }),
    });
    const oldResponse = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(
        jsonResponse(
          account('party-a', [
            {
              plan: {
                id: 'plan-new',
                title: 'New plan',
                productId: null,
                currency: 'PEN',
                status: 'open',
              },
              remaining: 40,
              nextDue: { dueOn: '2026-10-05', amount: 20 },
              scheduleIssue: null,
            },
          ]),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.getByTestId('handoff').textContent).toBe('loaded'));
    expect(view.getByTestId('cart').textContent).toBe('plan:plan-new');
    expect(store.values.has(key)).toBe(false);

    oldResponse.resolve(
      jsonResponse(
        account('party-a', [
          {
            plan: {
              id: 'plan-old',
              title: 'Old plan',
              productId: null,
              currency: 'PEN',
              status: 'open',
            },
            remaining: 25,
            nextDue: { dueOn: '2026-10-05', amount: 25 },
            scheduleIssue: null,
          },
        ]),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(view.getByTestId('cart').textContent).toBe('plan:plan-new');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not claim another actor handoff from the same organization', async () => {
    const foreign = { actorId: 'actor-b', orgId: 'org-a' };
    const foreignKey = sellChargeStorageKey(foreign);
    const foreignRaw = handoffRaw(
      { bookingId: 'booking-b', productId: 'service-b', partyId: 'party-b' },
      foreign,
    );
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([cartRow('service-a')]),
      [foreignKey]: foreignRaw,
    });
    vi.stubGlobal('fetch', vi.fn());

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage },
    });
    await waitFor(() => expect(view.getByTestId('hydrated').textContent).toBe('yes'));

    expect(view.getByTestId('cart').textContent).toBe('service-a');
    expect(view.getByTestId('handoff').textContent).toBe('none');
    expect(store.values.get(foreignKey)).toBe(foreignRaw);
  });

  it('preserves an old organization-only handoff and asks for a safe reopen', async () => {
    const legacyKey = 'pos-charge-org-a';
    const legacyRaw = JSON.stringify({ bookingId: 'legacy', productId: 'service-b' });
    const store = memoryStorage({
      'pos-cart-org-a': JSON.stringify([cartRow('service-a')]),
      [legacyKey]: legacyRaw,
    });
    vi.stubGlobal('fetch', vi.fn());

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage: store.storage },
    });
    await waitFor(() => expect(view.getByTestId('handoff').textContent).toBe('reopen'));

    expect(view.getByTestId('cart').textContent).toBe('service-a');
    expect(store.values.get(legacyKey)).toBe(legacyRaw);
    expect(store.writes.some((entry) => entry.key === legacyKey)).toBe(false);
  });

  it('leaves a newer replacement handoff untouched when bytes change after staging', async () => {
    const key = sellChargeStorageKey(IDENTITY);
    const original = handoffRaw({
      bookingId: 'booking-old',
      productId: 'service-a',
      partyId: 'party-a',
    });
    const replacement = handoffRaw(
      { bookingId: 'booking-new', productId: 'service-b', partyId: 'party-b' },
      { actorId: 'actor-b', orgId: 'org-a' },
    );
    const values = new Map<string, string>([
      ['pos-cart-org-a', JSON.stringify([cartRow('service-b')])],
      [key, original],
    ]);
    let handoffReads = 0;
    const removeItem = vi.fn((storageKey: string) => values.delete(storageKey));
    const storage: StorageLike = {
      getItem: (storageKey) => {
        if (storageKey === key) {
          handoffReads += 1;
          if (handoffReads === 3) values.set(key, replacement);
        }
        return values.get(storageKey) ?? null;
      },
      setItem: (storageKey, value) => values.set(storageKey, value),
      removeItem,
    };
    vi.stubGlobal('fetch', vi.fn());

    const view = render(SellSessionHarness, {
      props: { ...IDENTITY, storage },
    });
    await waitFor(() => expect(view.getByTestId('handoff').textContent).toBe('reopen'));

    expect(values.get(key)).toBe(replacement);
    expect(removeItem).not.toHaveBeenCalledWith(key);
  });
});

describe('appointment handoff writer', () => {
  it('verifies the scoped draft before navigating and leaves it for the destination', () => {
    const store = memoryStorage();
    const navigate = vi.fn();
    const fail = vi.fn();
    expect(
      dispatchSellChargeHandoff({
        storage: () => store.storage,
        identity: IDENTITY,
        input: { bookingId: 'booking-a', productId: 'service-a', partyId: 'party-a' },
        navigate,
        onStorageFailure: fail,
      }),
    ).toBe(true);

    const key = sellChargeStorageKey(IDENTITY);
    expect(navigate).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(store.values.get(key)).toBeTruthy();
  });

  it('stays on the appointment when the storage accessor throws', () => {
    const navigate = vi.fn();
    const fail = vi.fn();
    expect(
      dispatchSellChargeHandoff({
        storage: () => {
          throw new DOMException('Access is denied', 'SecurityError');
        },
        identity: IDENTITY,
        input: { bookingId: 'booking-a', productId: 'service-a' },
        navigate,
        onStorageFailure: fail,
      }),
    ).toBe(false);

    expect(navigate).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });

  it('stays on the appointment when the scoped draft cannot be written', () => {
    const navigate = vi.fn();
    const fail = vi.fn();
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      removeItem: vi.fn(),
    };
    expect(
      dispatchSellChargeHandoff({
        storage: () => storage,
        identity: IDENTITY,
        input: { bookingId: 'booking-a', productId: 'service-a' },
        navigate,
        onStorageFailure: fail,
      }),
    ).toBe(false);

    expect(navigate).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });
});
