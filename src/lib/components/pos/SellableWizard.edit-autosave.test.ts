// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: SellableWizard } = await import('./SellableWizard.svelte');
const { createSaveStatus } = await import('$lib/records/save-status.svelte');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const editing = {
  productId: 'prod-1',
  code: 'ABC1',
  name: 'Widget',
  category: null,
  unitPrice: 10,
  active: true,
  kind: 'product' as const,
  tags: [],
};

function baseProps(saveStatus: ReturnType<typeof createSaveStatus>) {
  return {
    presentation: 'page' as const,
    open: true,
    stockEnabled: false,
    stockItems: [],
    consumption: [],
    categories: [],
    takenCodes: [],
    editing,
    onSaved: vi.fn(),
    saveStatus,
  };
}

function okResponse() {
  return { ok: true, json: async () => ({}) };
}

describe('SellableWizard edit-mode autosave', () => {
  it('renders no Save/Cancel buttons — every field autosaves', () => {
    render(SellableWizard, { props: baseProps(createSaveStatus()) });
    expect(screen.queryByRole('button', { name: /^Save$|^Guardar$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cancel$|^Cancelar$/i })).toBeNull();
  });

  it('blur on Price triggers one PATCH with only {unitPrice}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(SellableWizard, { props: baseProps(createSaveStatus()) });

    const price = screen.getByLabelText(/^Price$|^Precio$/i) as HTMLInputElement;
    await fireEvent.input(price, { target: { value: '42' } });
    await fireEvent.change(price, { target: { value: '42' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/pos/sellables/prod-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ unitPrice: 42 });
  });

  it('two quick blurs on the same field serialize (never race)', async () => {
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(() => resolve(okResponse()));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(SellableWizard, { props: baseProps(createSaveStatus()) });

    const price = screen.getByLabelText(/^Price$|^Precio$/i) as HTMLInputElement;
    await fireEvent.input(price, { target: { value: '42' } });
    await fireEvent.change(price, { target: { value: '42' } });
    await fireEvent.input(price, { target: { value: '43' } });
    await fireEvent.change(price, { target: { value: '43' } });

    // The second PATCH must not have fired yet — it waits behind the first.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releases[0]();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      unitPrice: 42,
    });
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({
      unitPrice: 43,
    });
    releases[1]();
  });

  it('a 0 usage row rides along in the consumption PATCH; a blank one is dropped', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(SellableWizard, {
      props: {
        ...baseProps(createSaveStatus()),
        stockEnabled: true,
        stockItems: [
          { id: 'i1', code: 'DYS', name: 'Dysport', uom: 'UN' },
          { id: 'i2', code: 'INK', name: 'Ink', uom: 'UN' },
        ],
        consumption: [
          { finProductId: 'prod-1', itemId: 'i1', qtyPerUnit: 0 },
          { finProductId: 'prod-1', itemId: 'i2', qtyPerUnit: 2 },
        ],
      },
    });

    const qty = container.querySelectorAll<HTMLInputElement>(
      '.consumption-row input[type="number"]',
    );
    expect(qty[0].value).toBe('0');
    await fireEvent.input(qty[1], { target: { value: '' } });
    await fireEvent.change(qty[1], { target: { value: '' } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      consumption: [{ itemId: 'i1', qtyPerUnit: 0, note: null }],
    });
  });
});
