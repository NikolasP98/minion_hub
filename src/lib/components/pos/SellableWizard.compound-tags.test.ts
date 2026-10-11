// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: SellableWizard } = await import('./SellableWizard.svelte');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SellableWizard compound entity and tag save', () => {
  it('keeps a tag repair after 503 and retries only the acknowledged product follow-up', async () => {
    let tagAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/pos/sellables') {
        return new Response(JSON.stringify({ sellable: { productId: 'product-1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/tags/product/product-1') {
        tagAttempts += 1;
        return tagAttempts === 1
          ? new Response(JSON.stringify({ error: 'Tag service unavailable' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            })
          : new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    render(SellableWizard, {
      props: {
        presentation: 'page',
        open: true,
        stockEnabled: false,
        stockItems: [],
        consumption: [],
        categories: [],
        editing: null,
        onSaved,
        // One picked tag: an empty tag set no longer PUTs on create (nothing
        // to write), so the repair path needs a real selection.
        allTags: [{ id: 'tag-1', name: 'Promo', color: null }],
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: /Add tag|Agregar etiqueta/i }));
    await fireEvent.click(await screen.findByRole('option', { name: /Promo/ }));

    await fireEvent.input(screen.getByLabelText(/^Name$|^Nombre$/i), {
      target: { value: 'Repairable product' },
    });
    await fireEvent.input(screen.getByLabelText(/^Code$|^Código$/i), {
      target: { value: 'REPR' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /^Save$|^Guardar$/i }));

    const retry = await screen.findByRole('button', { name: /^Retry$|^Reintentar$/i });
    // The product IS committed: the host refresh runs even though the tag
    // follow-up failed (owner 2026-10-10 — a created row must be visible at
    // once); the partial outcome and the Retry stay.
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/pos/sellables'),
    ).toHaveLength(1);

    await vi.waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    await fireEvent.click(retry);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/pos/sellables'),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/api/tags/product/product-1'),
    ).toHaveLength(2);
  });
});
