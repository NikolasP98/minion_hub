// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import type { PageData } from './$types';

const invalidate = vi.fn().mockResolvedValue(undefined);
vi.mock('$app/navigation', () => ({ invalidate }));
vi.mock('$lib/access/can.svelte', () => ({ canAct: () => true }));

const { default: SettingsPage } = await import('./+page.svelte');

const baseSettings = {
  methods: [
    {
      id: 'cash',
      label: 'Cash',
      enabled: true,
      takesTendered: true,
      drawsOnCredit: false,
      requiresCreditDecision: false,
      sunat: true,
      documentDefault: null,
    },
  ],
  currency: 'JPY',
  currencyIssue: 'unsupported_pos_currency' as const,
  supportedCurrencies: ['PEN', 'USD'] as const,
  paymentPolicyRevision: 'a'.repeat(64),
  requireCustomer: false,
  allowPriceOverride: true,
  emission: { mode: 'off' as const, docTypeDefault: '03' as const },
  requirements: { identityDocument: 'off' as const, phone: 'off' as const },
};

beforeEach(() => invalidate.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('POS settings currency policy', () => {
  it('shows an unsupported legacy currency and requires a server-supported replacement', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: { ...baseSettings, currency: 'PEN', currencyIssue: null },
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const data = { settings: baseSettings, series: [] } as unknown as PageData;
    const view = render(SettingsPage, { props: { data } });
    const currency = view.getByRole('combobox', { name: 'POS currency' }) as HTMLSelectElement;
    const save = view.getAllByRole('button', { name: 'Save methods' })[0] as HTMLButtonElement;

    expect(currency.value).toBe('JPY');
    expect(view.getByText(/Choose a supported two-decimal currency/)).toBeTruthy();
    expect(save.disabled).toBe(true);

    await fireEvent.change(currency, { target: { value: 'PEN' } });
    await waitFor(() => expect(save.disabled).toBe(false));
    await fireEvent.click(save);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ currency: 'PEN' });
  });

  it('retains an unresolved legacy credit decision and writes an explicit resolution', async () => {
    const unresolved = {
      ...baseSettings,
      currency: 'PEN',
      currencyIssue: null,
      methods: [
        {
          ...baseSettings.methods[0],
          takesTendered: false,
          drawsOnCredit: null,
          requiresCreditDecision: true,
        },
      ],
    };
    const saved = {
      ...unresolved,
      methods: [
        {
          ...unresolved.methods[0],
          drawsOnCredit: false,
          requiresCreditDecision: false,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ settings: saved }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const view = render(SettingsPage, {
      props: { data: { settings: unresolved, series: [] } as unknown as PageData },
    });
    const methodsSave = view.getAllByRole('button', {
      name: 'Save methods',
    })[0] as HTMLButtonElement;
    const credit = view.getByRole('combobox', { name: 'Stored value' }) as HTMLSelectElement;

    expect(credit.value).toBe('');
    expect(methodsSave.disabled).toBe(true);
    expect(credit.getAttribute('aria-invalid')).toBe('true');
    expect(credit.getAttribute('aria-describedby')).toBeTruthy();

    await fireEvent.change(credit, { target: { value: 'external' } });
    await waitFor(() => expect(methodsSave.disabled).toBe(false));
    await fireEvent.click(methodsSave);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.methods[0]).toMatchObject({ id: 'cash', drawsOnCredit: false });
  });

  it('omits methods from unrelated policy saves even while a credit decision is unresolved', async () => {
    const unresolved = {
      ...baseSettings,
      methods: [
        {
          ...baseSettings.methods[0],
          drawsOnCredit: null,
          requiresCreditDecision: true,
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ settings: unresolved }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const view = render(SettingsPage, {
      props: { data: { settings: unresolved, series: [] } as unknown as PageData },
    });
    const saves = view.getAllByRole('button', { name: 'Save methods' });

    await fireEvent.click(saves[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).not.toHaveProperty('methods');
    expect(body).not.toHaveProperty('currency');
    expect(body).toHaveProperty('requirements');
    expect(body).toHaveProperty('emission');
  });

  it('blocks a wallet-credit method that also accepts tendered cash', async () => {
    const data = {
      settings: { ...baseSettings, currency: 'PEN', currencyIssue: null },
      series: [],
    } as unknown as PageData;
    const view = render(SettingsPage, { props: { data } });
    const credit = view.getByRole('combobox', { name: 'Stored value' });
    const methodsSave = view.getAllByRole('button', {
      name: 'Save methods',
    })[0] as HTMLButtonElement;

    await fireEvent.change(credit, { target: { value: 'wallet' } });
    expect(methodsSave.disabled).toBe(true);
    expect(credit.getAttribute('aria-invalid')).toBe('true');
    expect(credit.getAttribute('aria-describedby')).toBeTruthy();
  });
});
