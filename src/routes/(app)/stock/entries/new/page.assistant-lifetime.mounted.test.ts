// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { flushSync, tick, type ComponentProps } from 'svelte';
import StockEntry from './+page.svelte';
import { page } from '../../../../../../tests/fixtures/pending-submission/page.svelte';
import { executeTool, hasTool } from '$lib/assistant/model-context';
import {
  createAcceptedSurface,
  registerSubmittedRun,
  isRunCurrent,
  resetAcceptedRuns,
} from '$lib/assistant/accepted-runs';
import { createPendingSubmissions } from '$lib/assistant/pending-submission';
import { getPageContextRevision } from '$lib/assistant/page-context';
import { bindEffectLease } from '$lib/assistant/effect-lease';
import { decisionEvents } from '$lib/assistant/decision-events';
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock(
  '$app/state',
  async () => import('../../../../../../tests/fixtures/pending-submission/page.svelte'),
);
vi.mock('$lib/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true, canViewPath: () => true }));
const data = {
  items: [
    {
      id: 'item-a',
      code: 'STOCK-A',
      name: 'Probe stock item',
      uom: 'unit',
      defaultSupplierPartyId: 'supplier-a',
    },
  ],
  warehouses: [{ id: 'warehouse-a', name: 'Probe warehouse', isDefault: true }],
  bins: [],
  purchases: [],
  fx: { currency: 'PEN', base: 'USD', quote: 'PEN', rate: 3.8 },
} as unknown as ComponentProps<typeof StockEntry>['data'];
beforeEach(() => {
  flushSync(() => {
    page.url = new URL('http://localhost/stock/entries/new?type=receipt');
    page.data.user.id = 'actor-a';
    page.data.activeOrgId = 'org-a';
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  if (!Element.prototype.animate)
    Element.prototype.animate = (() => ({
      cancel() {},
      finished: Promise.resolve(),
    })) as unknown as typeof Element.prototype.animate;
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  resetAcceptedRuns();
  decisionEvents.setOwner({ actorId: '', orgId: '' });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each(['current', 'stop', 'expiry'] as const)(
  'actual stock item supplier autofill honors %s accepted lease',
  async (mode) => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn((url: RequestInfo | URL) =>
      String(url) === '/api/crm/parties/supplier-a'
        ? new Promise<Response>((resolve) => (release = resolve))
        : Promise.resolve(Response.json([])),
    );
    vi.stubGlobal('fetch', fetcher);
    const view = render(StockEntry, { data });
    await waitFor(() => expect(hasTool('fill_stock_entry')).toBe(true));
    const scope = {
      actorId: 'actor-a',
      orgId: 'org-a',
      agentId: 'agent-a',
      sessionKey: 'agent:agent-a:main',
    };
    const surface = createAcceptedSurface({ readScope: () => scope, followUp: async () => true });
    const pending = createPendingSubmissions();
    pending.setScope(scope);
    const turn = pending.begin(0, getPageContextRevision());
    const binding = registerSubmittedRun(turn.submissionId, { surface, pending: turn })!;
    const lease = bindEffectLease({ signal: binding.controller.signal }, () =>
      isRunCurrent(binding),
    );
    try {
      const running = executeTool(
        'fill_stock_entry',
        { item: 'Probe stock item', qty: 1, rate: 2 },
        { signal: binding.controller.signal, lease },
      );
      await waitFor(() => expect(release).toBeDefined());
      if (mode === 'stop') surface.stop();
      if (mode === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(binding.expiresAt + 1);
      release(
        Response.json({
          id: 'supplier-a',
          name: 'LATE SUPPLIER SHOULD NOT LAND',
          type: 'company',
          docNumber: '20123456789',
        }),
      );
      await running;
      for (let i = 0; i < 12; i++) await Promise.resolve();
      await tick();
      const selected = view.queryByDisplayValue('LATE SUPPLIER SHOULD NOT LAND');
      if (mode === 'current') expect(selected).not.toBeNull();
      else expect(selected).toBeNull();
      expect(
        fetcher.mock.calls.filter(([url]) => String(url) === '/api/crm/parties/supplier-a'),
      ).toHaveLength(1);
    } finally {
      surface.dispose();
    }
  },
);

function acceptedLease() {
  const scope = {
    actorId: 'actor-a',
    orgId: 'org-a',
    agentId: 'agent-a',
    sessionKey: 'agent:agent-a:main',
  };
  const surface = createAcceptedSurface({ readScope: () => scope, followUp: async () => true });
  const pending = createPendingSubmissions();
  pending.setScope(scope);
  const turn = pending.begin(0, getPageContextRevision());
  const binding = registerSubmittedRun(turn.submissionId, { surface, pending: turn })!;
  return {
    surface,
    binding,
    lease: bindEffectLease({ signal: binding.controller.signal }, () => isRunCurrent(binding)),
  };
}
const supplier = {
  id: 'supplier-a',
  name: 'Default supplier',
  type: 'company',
  docNumber: '20123456789',
};
const rowNumbers = (view: { container: HTMLElement }, index = 0) =>
  [
    ...view.container
      .querySelectorAll<HTMLTableRowElement>('table.mini-table tbody tr')
      [index].querySelectorAll<HTMLInputElement>('input[type="number"]'),
  ].map((input) => input.value);

it.each(['current', 'stop', 'expiry'] as const)(
  'supplier body parsing remains inside %s accepted lifetime',
  async (mode) => {
    let body!: (party: typeof supplier) => void;
    const json = vi.fn(
      () =>
        new Promise<typeof supplier>((resolve) => {
          body = resolve;
        }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url) === '/api/crm/parties/supplier-a'
          ? ({ ok: true, json } as unknown as Response)
          : Response.json([]),
      ),
    );
    const view = render(StockEntry, { data });
    await waitFor(() => expect(hasTool('fill_stock_entry')).toBe(true));
    const { surface, binding, lease } = acceptedLease();
    try {
      let finished = false;
      const running = executeTool(
        'fill_stock_entry',
        { item: 'Probe stock item', qty: 4, rate: 2 },
        { signal: binding.controller.signal, lease },
      ).then((result) => {
        finished = true;
        return JSON.parse(result);
      });
      await waitFor(() => expect(body).toBeDefined());
      expect(finished).toBe(false);
      expect(rowNumbers(view)).toEqual(['1', '']);
      if (mode === 'stop') surface.stop();
      if (mode === 'expiry') vi.spyOn(Date, 'now').mockReturnValue(binding.expiresAt + 1);
      body(supplier);
      const result = await running;
      await tick();
      expect(json).toHaveBeenCalledTimes(1);
      if (mode === 'current') {
        expect(view.queryByDisplayValue(supplier.name)).not.toBeNull();
        expect(rowNumbers(view)).toEqual(['4', '2']);
        expect(result.error).toBeUndefined();
      } else {
        expect(view.queryByDisplayValue(supplier.name)).toBeNull();
        expect(rowNumbers(view)).toEqual(['1', '']);
        expect(result).toEqual({ error: 'canceled' });
      }
    } finally {
      surface.dispose();
    }
  },
);

it.each(['fetch', 'http', 'body'] as const)(
  'optional supplier %s failure preserves the added line without retry',
  async (failure) => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) !== '/api/crm/parties/supplier-a') return Response.json([]);
      if (failure === 'fetch') throw Error('fixture fetch failure');
      if (failure === 'http') return new Response('', { status: 404 });
      return {
        ok: true,
        json: async () => {
          throw Error('fixture invalid body');
        },
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetcher);
    const view = render(StockEntry, { data });
    await waitFor(() => expect(hasTool('fill_stock_entry')).toBe(true));
    const { surface, binding, lease } = acceptedLease();
    try {
      const result = JSON.parse(
        await executeTool(
          'fill_stock_entry',
          { item: 'Probe stock item', qty: 4, rate: 2 },
          { signal: binding.controller.signal, lease },
        ),
      );
      await tick();
      expect(result.error).toBeUndefined();
      expect(rowNumbers(view)).toEqual(['4', '2']);
      expect(view.queryByDisplayValue(supplier.name)).toBeNull();
      await executeTool('fill_stock_entry', { item: 'Probe stock item' });
      expect(
        fetcher.mock.calls.filter(([url]) => String(url) === '/api/crm/parties/supplier-a'),
      ).toHaveLength(1);
    } finally {
      surface.dispose();
    }
  },
);

it('manual item preselection still performs the one-shot supplier lookup without an accepted lease', async () => {
  page.url = new URL('http://localhost/stock/entries/new?type=receipt&item=item-a');
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    Response.json(String(url) === '/api/crm/parties/supplier-a' ? supplier : []),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = render(StockEntry, { data });
  await waitFor(() => expect(view.queryByDisplayValue(supplier.name)).not.toBeNull());
  expect(rowNumbers(view)).toEqual(['1', '']);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url) === '/api/crm/parties/supplier-a'),
  ).toHaveLength(1);
});

it('a preselected supplier prevents the later item default from replacing it', async () => {
  const selected = { ...supplier, id: 'manual', name: 'Chosen supplier' };
  const fetcher = vi.fn(async () => Response.json([selected]));
  vi.stubGlobal('fetch', fetcher);
  const view = render(StockEntry, { data });
  await waitFor(() => expect(hasTool('fill_stock_entry')).toBe(true));
  await executeTool('fill_stock_entry', { party: 'Chosen supplier' });
  await executeTool('fill_stock_entry', { item: 'Probe stock item', qty: 4, rate: 2 });
  await tick();
  expect(view.queryByDisplayValue(selected.name)).not.toBeNull();
  expect(fetcher.mock.calls).toHaveLength(1);
});

it.each(['append', 'remove', 'party'] as const)(
  'supplier wait retains its exact row and preserves a concurrent %s',
  async (mutation) => {
    let release!: (response: Response) => void;
    const chosen = { ...supplier, id: 'manual', name: 'Chosen supplier' };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) =>
        String(url) === '/api/crm/parties/supplier-a'
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(Response.json([chosen])),
      ),
    );
    const items = [
      ...data.items,
      {
        ...data.items[0],
        id: 'item-b',
        code: 'STOCK-B',
        name: 'Other stock item',
        defaultSupplierPartyId: null,
      },
    ];
    const view = render(StockEntry, { data: { ...data, items } });
    await waitFor(() => expect(hasTool('fill_stock_entry')).toBe(true));
    const { surface, binding, lease } = acceptedLease();
    try {
      const running = executeTool(
        'fill_stock_entry',
        { item: 'Probe stock item', qty: 4, rate: 2 },
        { signal: binding.controller.signal, lease },
      );
      await waitFor(() => expect(release).toBeDefined());
      await executeTool('fill_stock_entry', { item: 'Other stock item', qty: 7, rate: 9 });
      if (mutation === 'remove')
        await fireEvent.click(view.container.querySelector('table.mini-table tbody tr .rm-btn')!);
      if (mutation === 'party') await executeTool('fill_stock_entry', { party: 'Chosen supplier' });
      release(Response.json(supplier));
      const result = JSON.parse(await running);
      await tick();
      if (mutation === 'remove') {
        expect(view.container.querySelectorAll('table.mini-table tbody tr')).toHaveLength(1);
        expect(rowNumbers(view)).toEqual(['7', '9']);
        expect(result.rejected.map((entry: { key: string }) => entry.key)).toEqual(['qty', 'rate']);
        expect(view.queryByDisplayValue(supplier.name)).toBeNull();
      } else {
        expect(rowNumbers(view, 0)).toEqual(['4', '2']);
        expect(rowNumbers(view, 1)).toEqual(['7', '9']);
        expect(
          view.queryByDisplayValue(mutation === 'party' ? chosen.name : supplier.name),
        ).not.toBeNull();
      }
    } finally {
      surface.dispose();
    }
  },
);
