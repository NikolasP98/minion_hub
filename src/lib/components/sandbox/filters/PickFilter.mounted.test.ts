// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import PickFilter from './PickFilter.svelte';

afterEach(cleanup);

const rows = [
  { status: 'submitted', n: 9 },
  { status: null, n: 4 },
  { status: 'void', n: 2 },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ columns: [], rows }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const options = { dataset: 'pos.tickets', col: 'status' };

describe('PickFilter', () => {
  it('asks for the most common values of the column through the query endpoint', async () => {
    render(PickFilter, {
      props: {
        id: 'f',
        label: 'Status',
        control: 'multi_select',
        options,
        value: null,
        onchange: vi.fn(),
      },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sandbox/query');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      dataset: 'pos.tickets',
      groupBy: ['status'],
      orderBy: [{ col: 'n', dir: 'desc' }],
      limit: 201,
    });
  });

  it('multi: lists counts without the blank value, toggles values and clears with All', async () => {
    const onchange = vi.fn();
    const props = { id: 'f', label: 'Status', control: 'multi_select' as const, options, onchange };
    const view = render(PickFilter, { props: { ...props, value: null } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await fireEvent.click(screen.getByText('Status'));
    const submitted = await screen.findByRole('option', { name: /submitted/ });
    expect(screen.queryAllByRole('option').map((o) => o.textContent?.trim())).toEqual([
      'All',
      'submitted 9',
      'void 2',
    ]);
    await fireEvent.click(submitted);
    expect(onchange).toHaveBeenLastCalledWith({ kind: 'multi', values: ['submitted'] });
    view.unmount();

    const again = render(PickFilter, {
      props: { ...props, value: { kind: 'multi', values: ['submitted', 'void'] } },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await fireEvent.click(again.getByText('Status'));
    await fireEvent.click(await screen.findByRole('option', { name: /void/ }));
    expect(onchange).toHaveBeenLastCalledWith({ kind: 'multi', values: ['submitted'] });
    await fireEvent.click(screen.getByRole('option', { name: /All/ }));
    expect(onchange).toHaveBeenLastCalledWith(null);
  });

  it('single: picking a value emits a select value; the clear button emits null', async () => {
    const onchange = vi.fn();
    render(PickFilter, {
      props: {
        id: 'f',
        label: 'Status',
        control: 'select',
        options,
        value: { kind: 'select', value: 'void' },
        onchange,
      },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const input = await screen.findByRole('combobox');
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('void'));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear value' }));
    expect(onchange).toHaveBeenLastCalledWith(null);
  });

  it('shows a calm message when the choices cannot load', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    render(PickFilter, {
      props: {
        id: 'f',
        label: 'Status',
        control: 'select',
        options,
        value: null,
        onchange: vi.fn(),
      },
    });
    expect(await screen.findByText('Could not load the choices.')).toBeTruthy();
  });
});
