// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import CheckoutDraftHarness from './__fixtures__/CheckoutDraftHarness.svelte';
import PaymentPanel from './PaymentPanel.svelte';
import PlanOpenForm from './PlanOpenForm.svelte';
import { PlanOpenPersistence } from './plan-open-persistence';
import { PlanContinuationError } from './plan-open-operation.svelte';

const PARTY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARTY_TWO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIENT_KEY = `party:${PARTY_ID}`;
const PARTY_TWO_KEY = `party:${PARTY_TWO_ID}`;
const CANONICAL_IDENTITY = {
  partyId: PARTY_ID,
  crmContactId: null,
  clientKey: CLIENT_KEY,
  identityStatus: 'active',
} as const;

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
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

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: immediateLocks,
  });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('mounted POS money drafts', () => {
  it('keeps unresolved methods visible but disabled and treats an id named credit by explicit policy', async () => {
    const view = render(PaymentPanel, {
      props: {
        total: 10,
        payments: [],
        methods: [
          {
            id: 'credit',
            label: 'External credit provider',
            takesTendered: false,
            drawsOnCredit: false,
            requiresCreditDecision: false,
          },
          {
            id: 'legacy',
            label: 'Legacy method',
            takesTendered: false,
            drawsOnCredit: null,
            requiresCreditDecision: true,
          },
        ],
      },
    });
    const external = view.getByRole('button', { name: /External credit provider/ });
    const unresolved = view.getByRole('button', { name: /Legacy method/ });

    expect((external as HTMLButtonElement).disabled).toBe(false);
    expect((unresolved as HTMLButtonElement).disabled).toBe(true);
    expect(unresolved.textContent).toContain('needs a stored-value decision');

    await fireEvent.click(external);
    const amount = view.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement;
    expect(amount.value).toBe('10');
  });

  it('retains an excessive or sub-cent discount and disables checkout until corrected', async () => {
    const view = render(CheckoutDraftHarness);
    await fireEvent.click(view.getByRole('button', { name: 'Discount' }));
    const input = view.getByRole('textbox', { name: 'Discount' }) as HTMLInputElement;
    const submit = view.getByRole('button', { name: 'Submit cart' });

    await fireEvent.input(input, { target: { value: '1.02' } });
    expect(input.value).toBe('1.02');
    expect(view.getByRole('alert').textContent).toContain('does not exceed');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.input(input, { target: { value: '0.001' } });
    expect(input.value).toBe('0.001');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.input(input, { target: { value: '1.01' } });
    await waitFor(() => expect(view.queryByText(/does not exceed/)).toBeNull());
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('retains invalid payment and tender text and blocks settlement', async () => {
    const view = render(CheckoutDraftHarness);
    const amount = view.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement;
    const tendered = view.getByRole('textbox', { name: 'Tendered' }) as HTMLInputElement;
    const submit = view.getByRole('button', { name: 'Submit payment' });

    await fireEvent.input(amount, { target: { value: 'not-money' } });
    expect(amount.value).toBe('not-money');
    expect(view.getByText('Enter a valid positive amount.')).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.input(amount, { target: { value: '1.01' } });
    await fireEvent.input(tendered, { target: { value: '1.00' } });
    expect(tendered.value).toBe('1.00');
    expect(view.getByText(/cash tendered/)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.input(tendered, { target: { value: '1.01' } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  });

  it('keeps a manual overpayment visible until the cart total itself changes', async () => {
    const view = render(CheckoutDraftHarness);
    const amount = view.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement;
    const tendered = view.getByRole('textbox', { name: 'Tendered' }) as HTMLInputElement;
    const submit = view.getByRole('button', { name: 'Submit payment' });

    await fireEvent.input(amount, { target: { value: '1.02' } });
    await fireEvent.input(tendered, { target: { value: '1.02' } });
    await tick();
    expect(amount.value).toBe('1.02');
    expect(tendered.value).toBe('1.02');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.click(view.getByRole('button', { name: 'Discount' }));
    const discount = view.getByRole('textbox', { name: 'Discount' });
    await fireEvent.input(discount, { target: { value: '0.01' } });
    await waitFor(() => expect(amount.value).toBe('1'));
  });

  it('quantizes a valid raw plan principal once and keeps a committed plan non-replayable', async () => {
    const transport = vi.fn().mockResolvedValueOnce(jsonResponse({ plan: { id: 'plan-1' } }, 201));
    installPlanFetch(transport);
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated: vi.fn().mockRejectedValue(new Error('refresh failed')),
        oncancel: vi.fn(),
      },
    });
    const title = view.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement;
    const amount = view.getByRole('textbox', { name: 'Total amount' }) as HTMLInputElement;
    const note = view.getByRole('textbox', { name: 'Note' }) as HTMLInputElement;
    const submit = view.getByRole('button', { name: 'Open plan' });

    await fireEvent.input(amount, { target: { value: 'invalid' } });
    expect(amount.value).toBe('invalid');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.input(amount, { target: { value: '1.005' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.input(title, { target: { value: 'x'.repeat(501) } });
    expect(title.value).toBe('x'.repeat(501));
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText(/500 characters or fewer/)).toBeTruthy();
    await fireEvent.input(title, { target: { value: 'Treatment plan' } });
    await fireEvent.input(note, { target: { value: 'x'.repeat(2_001) } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText(/2,000 characters or fewer/)).toBeTruthy();
    await fireEvent.input(note, { target: { value: '' } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(submit);

    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    const request = transport.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      operationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      totalAmount: 1.01,
    });
    expect(await view.findByText(/was created, but this view could not refresh/)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(submit);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps the captured owner current through refresh and completes only after releasing it', async () => {
    const transport = vi.fn().mockResolvedValueOnce(jsonResponse({ plan: { id: 'plan-1' } }, 201));
    installPlanFetch(transport);
    const lifecycle: string[] = [];
    let ownerCurrent: (() => boolean) | undefined;
    const oncreated = vi.fn(async (_plan, owner) => {
      ownerCurrent = owner.isCurrent;
      lifecycle.push(`created:${owner.isCurrent()}`);
      await Promise.resolve();
      lifecycle.push(`created-settled:${owner.isCurrent()}`);
    });
    const oncompleted = vi.fn(() => lifecycle.push(`completed:${ownerCurrent?.()}`));
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated,
        oncompleted,
        oncancel: vi.fn(),
      },
    });

    await fireEvent.input(view.getByRole('textbox', { name: 'Total amount' }), {
      target: { value: '100' },
    });
    const submit = view.getByRole('button', { name: 'Open plan' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await fireEvent.click(submit);

    await waitFor(() => expect(oncompleted).toHaveBeenCalledTimes(1));
    expect(oncreated).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(['created:true', 'created-settled:true', 'completed:false']);
    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('retains and reconciles an unknown plan without replaying its POST', async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(operationReceipt('plan-unknown'));
    installPlanFetch(transport);
    const oncreated = vi.fn();
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated,
        oncancel: vi.fn(),
      },
    });
    const amount = view.getByRole('textbox', { name: 'Total amount' }) as HTMLInputElement;
    const submit = view.getByRole('button', { name: 'Open plan' });

    await fireEvent.input(amount, { target: { value: '100' } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(submit);

    expect(await view.findByText(/could not be confirmed/)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(amount.disabled).toBe(true);
    await fireEvent.click(submit);
    expect(transport).toHaveBeenCalledTimes(1);
    const submission = JSON.parse(String((transport.mock.calls[0]?.[1] as RequestInit).body)) as {
      operationId: string;
    };

    await fireEvent.click(view.getByRole('button', { name: 'Check account' }));
    await waitFor(() => expect(oncreated).toHaveBeenCalledTimes(1));
    expect(oncreated.mock.calls[0]?.[0]).toEqual({ id: 'plan-unknown' });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1]?.[0]).toBe(
      '/api/pos/plans/operations/' + submission.operationId,
    );
    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('keeps a lookup-absent request locked and exposes the explicit cancellation path', async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    installPlanFetch(transport);
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated: vi.fn(),
        oncancel: vi.fn(),
      },
    });
    const amount = view.getByRole('textbox', { name: 'Total amount' });
    const submit = view.getByRole('button', { name: 'Open plan' });
    await fireEvent.input(amount, { target: { value: '100' } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(submit);
    await view.findByText(/could not be confirmed/);

    await fireEvent.click(view.getByRole('button', { name: 'Check account' }));

    expect(await view.findByText(/not visible yet/)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByRole('button', { name: 'Cancel unresolved request' })).toBeTruthy();
    expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('confirms a cancelled unresolved request once and unlocks a fresh form', async () => {
    const cancelResponse = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(cancelResponse.promise);
    vi.stubGlobal('fetch', fetchMock);
    const durable = new PlanOpenPersistence();
    const admitted = await durable.admit(
      { actorId: 'actor-1', orgId: 'org-1' },
      {
        clientKey: CLIENT_KEY,
        partyId: PARTY_ID,
        crmContactId: null,
        bookingId: null,
        productId: null,
        title: 'Frozen treatment',
        totalAmount: 100,
        currency: { kind: 'omitted' },
        dueSchedule: null,
        note: null,
      },
      { kind: 'account', clientKey: CLIENT_KEY },
      new AbortController().signal,
    );
    const oncompleted = vi.fn();
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Current treatment',
        oncreated: vi.fn(),
        oncompleted,
        oncancel: vi.fn(),
      },
    });
    const launch = await view.findByRole('button', { name: 'Cancel unresolved request' });
    await fireEvent.click(launch);
    const dialog = await view.findByRole('dialog', { name: 'Cancel unresolved request' });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel unresolved request' });

    await fireEvent.click(confirm);
    await fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((view.getByRole('textbox', { name: 'Total amount' }) as HTMLInputElement).disabled).toBe(
      true,
    );
    cancelResponse.resolve(jsonResponse({ status: 'cancelled' }));

    expect(await view.findByText(/was cancelled/)).toBeTruthy();
    await waitFor(() =>
      expect(
        (view.getByRole('textbox', { name: 'Total amount' }) as HTMLInputElement).disabled,
      ).toBe(false),
    );
    expect(oncompleted).toHaveBeenCalledTimes(1);
    expect(
      await durable.read({ actorId: 'actor-1', orgId: 'org-1' }, new AbortController().signal),
    ).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/pos/plans/operations/' + admitted.record.operationId + '/cancel',
    );
  });

  it('keeps failed cancellation retryable and repairs a create that won the race', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'temporarily unavailable' }, 503))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'committed', plan: { id: 'plan-cancel-race' } }),
      )
      .mockResolvedValueOnce(operationReceipt('plan-cancel-race'));
    vi.stubGlobal('fetch', fetchMock);
    const durable = new PlanOpenPersistence();
    await durable.admit(
      { actorId: 'actor-1', orgId: 'org-1' },
      {
        clientKey: CLIENT_KEY,
        partyId: PARTY_ID,
        crmContactId: null,
        bookingId: null,
        productId: null,
        title: 'Frozen treatment',
        totalAmount: 100,
        currency: { kind: 'omitted' },
        dueSchedule: null,
        note: null,
      },
      { kind: 'account', clientKey: CLIENT_KEY },
      new AbortController().signal,
    );
    const oncreated = vi.fn();
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Current treatment',
        oncreated,
        oncancel: vi.fn(),
      },
    });

    for (const attempt of [1, 2]) {
      const launch = (
        await view.findAllByRole('button', { name: 'Cancel unresolved request' })
      ).find((candidate) => candidate.closest('dialog') === null);
      if (!launch) throw new Error('missing cancellation launcher');
      await fireEvent.click(launch);
      const dialog = await view.findByRole('dialog', { name: 'Cancel unresolved request' });
      await fireEvent.click(
        within(dialog).getByRole('button', { name: 'Cancel unresolved request' }),
      );
      if (attempt === 1) {
        expect(await view.findByText(/cancellation could not be confirmed/)).toBeTruthy();
        expect(
          (view.getByRole('textbox', { name: 'Total amount' }) as HTMLInputElement).disabled,
        ).toBe(true);
      }
    }

    await waitFor(() => expect(oncreated).toHaveBeenCalledTimes(1));
    expect(oncreated).toHaveBeenCalledWith(
      { id: 'plan-cancel-race' },
      expect.objectContaining({ operationId: expect.any(String) }),
    );
    expect(await view.findByText(/confirmed in this account/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      await durable.read({ actorId: 'actor-1', orgId: 'org-1' }, new AbortController().signal),
    ).toBeNull();
  });

  it('requires an explicit confirmed restore for a third sell-cart state', async () => {
    const identity = { actorId: 'actor-1', orgId: 'org-1' };
    const preCart = [
      {
        productId: 'service-1',
        kind: 'service' as const,
        qty: '1',
        unitPrice: '100',
        discount: '0',
        bookingId: null,
        redemptionId: null,
        planId: null,
      },
    ];
    const postCart = [
      {
        productId: 'plan:plan-restore',
        kind: 'service' as const,
        qty: 1,
        unitPrice: 50,
        discount: 0,
        bookingId: null,
        redemptionId: null,
        planId: 'plan-restore',
      },
    ];
    const continuation = {
      kind: 'sell' as const,
      partyId: PARTY_ID,
      bookingId: null,
      preCart,
      postCart,
    };
    const durable = new PlanOpenPersistence();
    const admission = await durable.admit(
      identity,
      {
        clientKey: CLIENT_KEY,
        partyId: PARTY_ID,
        crmContactId: null,
        bookingId: null,
        productId: null,
        title: 'Frozen treatment',
        totalAmount: 100,
        currency: { kind: 'omitted' },
        dueSchedule: null,
        note: null,
      },
      continuation,
      new AbortController().signal,
    );
    await durable.update(
      identity,
      admission.record.operationId,
      new AbortController().signal,
      (record) => ({
        ...record,
        planId: 'plan-restore',
        stage: 'continuation_pending',
      }),
    );
    const oncreated = vi.fn(async (_plan, owner) => {
      if (!owner.allowCartReplace) throw new PlanContinuationError('cart_restore_required');
    });
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: identity.actorId,
        orgId: identity.orgId,
        continuation,
        defaultTitle: 'Current treatment',
        oncreated,
        oncancel: vi.fn(),
      },
    });

    await fireEvent.click(await view.findByRole('button', { name: 'Check account' }));
    expect(await view.findByText(/current cart differs/)).toBeTruthy();
    await fireEvent.click(view.getByRole('button', { name: 'Restore pending sale' }));
    const dialog = await view.findByRole('dialog', { name: 'Restore pending sale' });
    expect(within(dialog).getByText(/replaces the current cart/)).toBeTruthy();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Restore pending sale' }));

    await waitFor(() => expect(oncreated).toHaveBeenCalledTimes(2));
    expect(oncreated.mock.calls.map(([, owner]) => owner.allowCartReplace)).toEqual([false, true]);
    expect(await view.findByText(/confirmed in this account/)).toBeTruthy();
    expect(await durable.read(identity, new AbortController().signal)).toBeNull();
  });

  it('hydrates the frozen request after unmount and remount without another POST', async () => {
    const durable = new PlanOpenPersistence();
    await durable.admit(
      { actorId: 'actor-1', orgId: 'org-1' },
      {
        clientKey: CLIENT_KEY,
        partyId: PARTY_ID,
        crmContactId: null,
        bookingId: null,
        productId: null,
        title: 'Frozen treatment',
        totalAmount: 120,
        currency: { kind: 'omitted' },
        dueSchedule: [
          { dueOn: '2027-01-01', amount: 60 },
          { dueOn: '2027-02-01', amount: 60 },
        ],
        note: 'Frozen note',
      },
      { kind: 'account', clientKey: CLIENT_KEY },
      new AbortController().signal,
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const props = {
      partyId: PARTY_ID,
      mutationScope: 'pos:org-1',
      actorId: 'actor-1',
      orgId: 'org-1',
      continuation: { kind: 'account' as const, clientKey: CLIENT_KEY },
      defaultTitle: 'Current default',
      oncreated: vi.fn(),
      oncancel: vi.fn(),
    };

    const first = render(PlanOpenForm, { props });
    await waitFor(() =>
      expect((first.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement).value).toBe(
        'Frozen treatment',
      ),
    );
    expect((first.getByRole('textbox', { name: 'Total amount' }) as HTMLInputElement).value).toBe(
      '120',
    );
    expect((first.getByRole('textbox', { name: 'Instalments' }) as HTMLInputElement).value).toBe(
      '2',
    );
    expect((first.getByRole('textbox', { name: 'Note' }) as HTMLInputElement).value).toBe(
      'Frozen note',
    );
    first.unmount();

    const second = render(PlanOpenForm, { props });
    const amount = second.getByRole('textbox', { name: 'Total amount' }) as HTMLInputElement;
    await waitFor(() => expect(amount.value).toBe('120'));
    expect(amount.disabled).toBe(true);
    expect(second.getByRole('button', { name: 'Check account' })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed with recovery guidance when the durable record is corrupt', async () => {
    const durable = new PlanOpenPersistence();
    localStorage.setItem(durable.storageKey({ actorId: 'actor-1', orgId: 'org-1' }), '{corrupt');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Current treatment',
        oncreated: vi.fn(),
        oncancel: vi.fn(),
      },
    });

    expect(await view.findByText(/recovery data cannot be verified/)).toBeTruthy();
    expect((view.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(durable.storageKey({ actorId: 'actor-1', orgId: 'org-1' }))).toBe(
      '{corrupt',
    );
  });

  it('freezes a second mounted draft on same-tab admission without overwriting it', async () => {
    const transport = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    installPlanFetch(transport);
    const common = {
      mutationScope: 'pos:org-1',
      actorId: 'actor-1',
      orgId: 'org-1',
      oncreated: vi.fn(),
      oncancel: vi.fn(),
    };
    const first = render(PlanOpenForm, {
      props: {
        ...common,
        partyId: PARTY_ID,
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'First treatment',
      },
    });
    const second = render(PlanOpenForm, {
      props: {
        ...common,
        partyId: PARTY_TWO_ID,
        continuation: { kind: 'account', clientKey: PARTY_TWO_KEY },
        defaultTitle: 'Second draft',
      },
    });
    const firstView = within(first.container);
    const secondView = within(second.container);
    const firstAmount = firstView.getByRole('textbox', { name: 'Total amount' });
    const firstSubmit = firstView.getByRole('button', { name: 'Open plan' }) as HTMLButtonElement;
    const secondAmount = secondView.getByRole('textbox', {
      name: 'Total amount',
    }) as HTMLInputElement;
    await fireEvent.input(firstAmount, { target: { value: '100' } });
    await fireEvent.input(secondAmount, { target: { value: '77' } });
    await waitFor(() => expect(firstSubmit.disabled).toBe(false));
    await fireEvent.click(firstSubmit);

    await waitFor(() => expect(secondAmount.disabled).toBe(true));
    expect(secondAmount.value).toBe('77');
    expect((secondView.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement).value).toBe(
      'Second draft',
    );
    await waitFor(() => expect(secondView.getByText(/another client/)).toBeTruthy());
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('freezes plan replay when a successful POST has a malformed body', async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    installPlanFetch(transport);
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated: vi.fn(),
        oncancel: vi.fn(),
      },
    });
    const amount = view.getByRole('textbox', { name: 'Total amount' });
    const submit = view.getByRole('button', { name: 'Open plan' });

    await fireEvent.input(amount, { target: { value: '100' } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(submit);

    expect(await view.findByText(/could not be confirmed/)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(submit);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('dispatches directly for create-only roles and retains an unproven 403 for repair', async () => {
    const transport = vi.fn().mockResolvedValue(jsonResponse({ error: 'not allowed' }, 403));
    installPlanFetch(transport);
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated: vi.fn(),
        oncancel: vi.fn(),
      },
    });
    const amount = view.getByRole('textbox', { name: 'Total amount' });
    const submit = view.getByRole('button', { name: 'Open plan' });

    await fireEvent.input(amount, { target: { value: '100' } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(submit);

    expect(await view.findByText(/not allowed/)).toBeTruthy();
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByRole('button', { name: 'Check account' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Cancel unresolved request' })).toBeTruthy();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[0]).toBe('/api/pos/plans');
  });

  it('settles a never-ending dispatched POST at the deadline and blocks replay', async () => {
    vi.useFakeTimers();
    try {
      const transport = vi.fn().mockReturnValueOnce(new Promise<Response>(() => {}));
      installPlanFetch(transport);
      const view = render(PlanOpenForm, {
        props: {
          partyId: PARTY_ID,
          mutationScope: 'pos:org-1',
          actorId: 'actor-1',
          orgId: 'org-1',
          continuation: { kind: 'account', clientKey: CLIENT_KEY },
          defaultTitle: 'Treatment plan',
          oncreated: vi.fn(),
          oncancel: vi.fn(),
        },
      });
      const amount = view.getByRole('textbox', { name: 'Total amount' });
      const submit = view.getByRole('button', { name: 'Open plan' });

      await fireEvent.input(amount, { target: { value: '100' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      await fireEvent.click(submit);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(transport).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_001);
      });
      expect(view.getByText(/could not be confirmed/)).toBeTruthy();
      expect((submit as HTMLButtonElement).disabled).toBe(true);
      expect(transport.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('suppresses a late POST result after unmount', async () => {
    const pending = deferred<Response>();
    const transport = vi.fn().mockReturnValueOnce(pending.promise);
    installPlanFetch(transport);
    const oncreated = vi.fn();
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated,
        oncancel: vi.fn(),
      },
    });
    await fireEvent.input(view.getByRole('textbox', { name: 'Total amount' }), {
      target: { value: '100' },
    });
    const submit = view.getByRole('button', { name: 'Open plan' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await fireEvent.click(submit);
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

    view.unmount();
    pending.resolve(jsonResponse({ plan: { id: 'late-plan' } }, 201));
    await tick();
    await Promise.resolve();
    expect(oncreated).not.toHaveBeenCalled();
  });

  it('suppresses a late POST result after the plan owner scope changes', async () => {
    const pending = deferred<Response>();
    const transport = vi.fn().mockReturnValueOnce(pending.promise);
    installPlanFetch(transport);
    const oncreated = vi.fn();
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated,
        oncancel: vi.fn(),
      },
    });
    await fireEvent.input(view.getByRole('textbox', { name: 'Total amount' }), {
      target: { value: '100' },
    });
    const submit = view.getByRole('button', { name: 'Open plan' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await fireEvent.click(submit);
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

    await view.rerender({
      partyId: PARTY_TWO_ID,
      mutationScope: 'pos:org-2',
      actorId: 'actor-1',
      orgId: 'org-2',
      continuation: { kind: 'account', clientKey: PARTY_TWO_KEY },
      defaultTitle: 'Other treatment',
      oncreated,
      oncancel: vi.fn(),
    });
    pending.resolve(jsonResponse({ plan: { id: 'old-plan' } }, 201));
    await tick();
    await Promise.resolve();

    expect(oncreated).not.toHaveBeenCalled();
    expect((view.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement).value).toBe(
      'Other treatment',
    );
  });

  it('detaches an in-flight owner when the authenticated actor changes in the same org', async () => {
    const pending = deferred<Response>();
    const transport = vi.fn().mockReturnValueOnce(pending.promise);
    installPlanFetch(transport);
    const oncreated = vi.fn();
    const view = render(PlanOpenForm, {
      props: {
        partyId: PARTY_ID,
        mutationScope: 'pos:org-1',
        actorId: 'actor-1',
        orgId: 'org-1',
        continuation: { kind: 'account', clientKey: CLIENT_KEY },
        defaultTitle: 'Treatment plan',
        oncreated,
        oncancel: vi.fn(),
      },
    });
    await fireEvent.input(view.getByRole('textbox', { name: 'Total amount' }), {
      target: { value: '100' },
    });
    const submit = view.getByRole('button', { name: 'Open plan' }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    await fireEvent.click(submit);
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));

    await view.rerender({
      partyId: PARTY_ID,
      mutationScope: 'pos:org-1',
      actorId: 'actor-2',
      orgId: 'org-1',
      continuation: { kind: 'account', clientKey: CLIENT_KEY },
      defaultTitle: 'Actor two treatment',
      oncreated,
      oncancel: vi.fn(),
    });
    pending.resolve(jsonResponse({ plan: { id: 'old-actor-plan' } }, 201));
    await tick();
    await Promise.resolve();

    expect(oncreated).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((view.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement).value).toBe(
        'Actor two treatment',
      ),
    );
    const durable = new PlanOpenPersistence();
    expect(
      await durable.read({ actorId: 'actor-1', orgId: 'org-1' }, new AbortController().signal),
    ).toMatchObject({ stage: 'prepared' });
    expect(
      await durable.read({ actorId: 'actor-2', orgId: 'org-1' }, new AbortController().signal),
    ).toBeNull();
  });
});
