// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import type { SellableLike } from './SellableWizard.svelte';

/**
 * The operator half of Slice 1 of
 * `2026-08-20-handoff-minion-hub-902723699-spec`: an untracked SERVICE can be
 * switched to stock-tracked from the catalog editor, and the PATCH the wizard
 * sends carries the fields `updateSellable` needs.
 *
 * This mounts the SHIPPED component and reads the real `fetch` body. It is
 * deliberately NOT the `ChannelSetupWizard.test.ts` pattern (which re-declares
 * the component's async functions in the test file): a copy of `submit()` here
 * would keep passing after the component stopped sending the fields, which is
 * exactly the regression this file exists to catch.
 */
// `$lib/components/ui`'s barrel transitively reaches `access/can.svelte.ts`,
// which reads SvelteKit's `page` state — unresolvable under vitest (same reason
// `$env/*` is stubbed in vitest.config.ts). Same mock `can.svelte.test.ts` uses.
vi.mock('$app/state', () => ({
  page: { data: {}, url: new URL('http://localhost/pos/catalog'), params: {}, route: { id: null } },
}));

vi.mock('$lib/state/ui/toast.svelte', () => ({
  // The real `toastAsync` awaits the promise and renders outcome toasts; the
  // wizard's control flow only depends on the awaiting part.
  toastAsync: async (promise: Promise<unknown>) => promise,
}));

const { default: SellableWizard } = await import('./SellableWizard.svelte');

const untrackedService: SellableLike = {
  productId: 'fp-20',
  code: 'CONS',
  name: 'Consulta',
  category: null,
  unitPrice: null,
  active: true,
  kind: 'service' as const,
  itemId: null,
};

function mountEditor(editing: SellableLike) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const rendered = render(SellableWizard, {
    props: {
      presentation: 'page',
      stockEnabled: true,
      stockItems: [],
      categories: [],
      consumption: [],
      editing,
      onSaved: () => {},
    },
  });
  return { ...rendered, fetchMock };
}

/** The body of the single request the wizard issued. */
function patchBody(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method, body: JSON.parse(String(init.body)) };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SellableWizard edit mode — the service→tracked transition', () => {
  it('offers the stock switch on an untracked service and PATCHes trackStock + uom', async () => {
    const { getByRole, getByLabelText, fetchMock } = mountEditor(untrackedService);

    // The control exists at all — the half of the DoD that used to be a
    // "creation-only" caption.
    const trackedOption = getByRole('button', { name: 'New tracked item' });
    await fireEvent.click(trackedOption);

    // The uom field only appears once tracking is selected.
    const uomInput = await waitFor(() => getByLabelText('Unit of measure'));
    await fireEvent.input(uomInput, { target: { value: '  Unidad  ' } });

    await fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const { url, method, body } = patchBody(fetchMock);
    expect(method).toBe('PATCH');
    expect(url).toBe('/api/pos/sellables/fp-20');
    // Trimmed — the PATCH schema refuses whitespace-only, and an untrimmed
    // "  Unidad  " would be stored verbatim as the item's unit.
    expect(body).toMatchObject({ trackStock: true, uom: 'Unidad' });
    // `kind` stays out of the body on purpose: it is derived from the item
    // link, and the service judges a submitted `kind` against the
    // post-transition state.
    expect(body).not.toHaveProperty('kind');
  });

  it('leaves trackStock out when the operator does not switch it on', async () => {
    const { getByRole, fetchMock } = mountEditor(untrackedService);

    await fireEvent.click(getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const { body } = patchBody(fetchMock);
    // An unchanged resubmit must stay a plain name/price save — sending
    // `trackStock: false` would hit the service's `stock_tracking_immutable`
    // refusal on a sellable the operator never touched.
    expect(body).not.toHaveProperty('trackStock');
    expect(body).not.toHaveProperty('uom');
    expect(body).toMatchObject({ name: 'Consulta', code: 'CONS' });
  });

  it('does NOT offer the switch on an already-tracked product — the service refuses true→false', async () => {
    const { queryByRole, getByText } = mountEditor({
      ...untrackedService,
      kind: 'product',
      itemId: 'item-20',
    });

    expect(queryByRole('button', { name: 'New tracked item' })).toBeNull();
    // The unreachable cases keep the honest caption instead of a control that
    // would 400.
    expect(getByText('Type and stock tracking are set at creation')).toBeTruthy();
  });
});
