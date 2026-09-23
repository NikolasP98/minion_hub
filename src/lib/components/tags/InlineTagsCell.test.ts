// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import InlineTagsCell from './InlineTagsCell.svelte';

const manual = { id: 'manual-1', name: 'Manual', color: '#3b82f6' };
const automatic = { id: 'auto-1', name: 'Automatic', color: '#6b7280' };
const inherited = { id: 'stock-1', name: 'Ingredient', color: '#10b981' };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InlineTagsCell', () => {
  it('submits only selected manual registry ids and keeps derived tags visible', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tags: [manual] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const saved = vi.fn();
    const view = render(InlineTagsCell, {
      props: {
        scope: 'catalog',
        kind: 'product',
        entityId: 'product-1',
        registry: [manual],
        selected: [],
        readonly: [automatic],
        inherited: [inherited],
        onsaved: saved,
      },
    });

    expect(view.getByText('Automatic')).toBeTruthy();
    expect(view.getAllByText('Ingredient').length).toBeGreaterThan(0);
    await fireEvent.click(view.getByRole('button', { name: /add tag/i }));
    await fireEvent.click(view.getByRole('button', { name: /^manual$/i }));

    await waitFor(() => expect(saved).toHaveBeenCalledWith([manual]));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ tagIds: ['manual-1'] });
  });

  it('reconciles a lost assignment response before exposing retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('disconnected'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tags: [manual, automatic] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const saved = vi.fn();
    const view = render(InlineTagsCell, {
      props: {
        scope: 'catalog',
        kind: 'product',
        entityId: 'product-1',
        registry: [manual],
        selected: [],
        readonly: [automatic],
        onsaved: saved,
      },
    });

    await fireEvent.click(view.getByRole('button', { name: /add tag/i }));
    await fireEvent.click(view.getByRole('button', { name: /^manual$/i }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith([manual]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(view.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('retries the attempted removal after a failed write confirms the original assignment', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tags: [manual] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tags: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const saved = vi.fn();
    const view = render(InlineTagsCell, {
      props: {
        scope: 'catalog',
        kind: 'product',
        entityId: 'product-1',
        registry: [manual],
        selected: [manual],
        onsaved: saved,
      },
    });

    await fireEvent.click(view.getByRole('button', { name: /remove tag/i }));
    const retry = await view.findByRole('button', { name: /retry/i });
    expect(saved).toHaveBeenLastCalledWith([manual]);
    await fireEvent.click(retry);
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith([]));

    const putBodies = fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(putBodies).toEqual([{ tagIds: [] }, { tagIds: [] }]);
    expect(view.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});
