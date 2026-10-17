// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
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
