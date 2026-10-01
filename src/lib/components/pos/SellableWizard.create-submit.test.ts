// @vitest-environment happy-dom
//
// Regression for the 2026-09-30 owner report: /pos/catalog/new "freezes" on
// Save and the item is never created. Root cause: the Price field binds a
// `type="number"` input — Svelte coerces the bound `unitPrice` state to a
// `number` once edited (see SellableWizard.edit-autosave.test.ts, which
// already asserts this for the edit-mode autosave path). The create-mode
// `submit()` called `unitPrice.trim()` directly, which throws
// `TypeError: unitPrice.trim is not a function` on a number. That throw
// happened before `submit()`'s own try/catch (payload was built outside it),
// so the rejection was unhandled (`void submit()` in the form's `onsubmit`)
// and `busy` — set to `true` moments earlier — never reset. Since `canSubmit`
// requires `!busy`, Save became permanently disabled with no request ever
// sent: indistinguishable from a frozen page.
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

function createProps(onSaved: () => void) {
  return {
    presentation: 'page' as const,
    open: true,
    stockEnabled: false,
    stockItems: [],
    consumption: [],
    categories: [],
    takenCodes: [],
    editing: null,
    onSaved,
  };
}

function okResponse(body: unknown = {}) {
  return { ok: true, json: async () => body };
}

describe('SellableWizard create-mode submit', () => {
  it('typing a Price then Save sends the create POST with a numeric unitPrice — does not throw or stall', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).endsWith('/api/pos/sellables')) {
        return Promise.resolve(okResponse({ sellable: { productId: 'new-1' } }));
      }
      return Promise.resolve(okResponse());
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    render(SellableWizard, { props: createProps(onSaved) });

    const name = screen.getByLabelText(/^Name$|^Nombre$/i) as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Control' } });

    const code = screen.getByLabelText(/^Code$|^Código$/i) as HTMLInputElement;
    await fireEvent.input(code, { target: { value: 'CONT' } });

    const price = screen.getByLabelText(/^Price$|^Precio$/i) as HTMLInputElement;
    // happy-dom's `type="number"` input coerces `.value` assignment the same
    // way a browser does, reproducing the same bound-value coercion.
    await fireEvent.input(price, { target: { value: '0' } });

    const saveBtn = screen.getByRole('button', { name: /^Save$|^Guardar$/i });
    expect(saveBtn.hasAttribute('disabled')).toBe(false);
    await fireEvent.click(saveBtn);

    // Before the fix: this never resolves within the wait window — submit()
    // throws synchronously building the payload, before any fetch is issued,
    // and `busy` never resets so a second click would no-op too.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/pos/sellables');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('Control');
    expect(body.unitPrice).toBe(0);

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });
});
