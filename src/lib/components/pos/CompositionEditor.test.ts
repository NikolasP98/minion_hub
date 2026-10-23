// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import CompositionEditor from './CompositionEditor.svelte';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Sellable = {
  productId: string;
  code: string;
  name: string;
  unitPrice: number | null;
  kind: 'product' | 'service' | 'bundle';
  active: boolean;
};

const serviceRow: Sellable = {
  productId: 'svc-1',
  code: 'S1',
  name: 'Facial',
  unitPrice: 100,
  kind: 'service',
  active: true,
};

function mockFetch() {
  const calls: string[] = [];
  const fetchMock = vi.fn((url: string) => {
    calls.push(url);
    if (url.includes('/components')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ components: [], packageValidityDays: null }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('CompositionEditor (regression: expanding another row must not reload an already-open one)', () => {
  // Root cause: DataTable's row virtualizer re-windows on every
  // flatItems.length change (any row expand/collapse), which can transiently
  // unmount and remount an already-open row's `expandedContent` block. Before
  // the fix, remounting reset this component's local `loading` state to
  // `true` and re-issued the fetch — visually "reloading" a row that was
  // already loaded. The fix caches settled results per sellable id in a
  // module-scoped Map that survives a remount.
  it('does not show a spinner or re-fetch when the same row mounts a second time', async () => {
    const calls = mockFetch();

    const first = render(CompositionEditor, {
      props: {
        sellable: serviceRow,
        sellables: [serviceRow],
        stockItems: [],
        stockEnabled: false,
        canEdit: true,
        onChanged: () => {},
      },
    });

    await waitFor(() => {
      expect(first.container.querySelector('[data-part="spinner"]')).toBeNull();
    });
    expect(calls.filter((u) => u.includes('svc-1'))).toHaveLength(1);

    first.unmount();
    cleanup();

    // Simulate the virtualizer transiently remounting the same open row.
    const second = render(CompositionEditor, {
      props: {
        sellable: serviceRow,
        sellables: [serviceRow],
        stockItems: [],
        stockEnabled: false,
        canEdit: true,
        onChanged: () => {},
      },
    });

    // No spinner flash on remount — the cached entry seeds state synchronously.
    expect(second.container.querySelector('[data-part="spinner"]')).toBeNull();
    // No redundant fetch for the already-loaded row.
    expect(calls.filter((u) => u.includes('svc-1'))).toHaveLength(1);

    second.unmount();
  });

  it('still fetches a row that has never been loaded before', async () => {
    const calls = mockFetch();
    const other: Sellable = { ...serviceRow, productId: 'svc-2', code: 'S2' };

    const view = render(CompositionEditor, {
      props: {
        sellable: other,
        sellables: [other],
        stockItems: [],
        stockEnabled: false,
        canEdit: true,
        onChanged: () => {},
      },
    });

    await waitFor(() => {
      expect(calls.filter((u) => u.includes('svc-2'))).toHaveLength(1);
    });
    view.unmount();
  });
});

describe('CompositionEditor writes queue instead of blocking (spec 033 amendment C)', () => {
  it('keeps every input editable while a save is in flight and lands both edits', async () => {
    const patches: { consumption: { itemId: string; qtyPerUnit: number }[] }[] = [];
    let releaseFirst: () => void = () => {};
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        const ok = { ok: true, json: async () => ({}) };
        if (patches.length === 1)
          return new Promise((resolve) => (releaseFirst = () => resolve(ok)));
        return Promise.resolve(ok);
      }
      if (url.includes('/components'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ components: [], packageValidityDays: null }),
        });
      return Promise.resolve({
        ok: true,
        json: async () => [
          { itemId: 'dysport', qtyPerUnit: 1, note: null },
          { itemId: 'inibo', qtyPerUnit: 1, note: null },
        ],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = { ...serviceRow, productId: 'svc-queue', code: 'CB' };

    const view = render(CompositionEditor, {
      props: {
        sellable: svc,
        sellables: [svc],
        stockItems: [
          { id: 'dysport', code: 'D', name: 'Dysport', uom: 'u' },
          { id: 'inibo', code: 'I', name: 'INIBO', uom: 'u' },
        ],
        stockEnabled: true,
        canEdit: true,
        onChanged: () => {},
      },
    });
    const inputs = await waitFor(() => {
      const found = view.container.querySelectorAll<HTMLInputElement>('input[type="number"]');
      expect(found).toHaveLength(2);
      return found;
    });

    inputs[0].value = '0';
    await fireEvent.change(inputs[0]);
    // The first save is still pending: the other row stays editable.
    expect(inputs[1].disabled).toBe(false);
    inputs[1].value = '0';
    await fireEvent.change(inputs[1]);

    releaseFirst();
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1].consumption.map((r) => r.qtyPerUnit)).toEqual([0, 0]);
    view.unmount();
  });
});
