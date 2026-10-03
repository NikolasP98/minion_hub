// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { QueryClient } from '@tanstack/svelte-query';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CatalogHarness from './__fixtures__/CatalogHarness.svelte';

vi.mock('$app/environment', () => ({ browser: true, building: false, dev: true }));
vi.mock('$app/state', () => ({
  page: {
    params: { slug: 'agent-a' },
    url: new URL('http://fixture.invalid/marketplace/agents/agent-a'),
    data: {},
  },
}));
vi.mock('$lib/services/gateway-rpc', () => ({ sendInstall: vi.fn() }));
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});
const agent = (id: string) => ({
  id,
  name: `Synthetic ${id}`,
  role: 'Synthetic role',
  category: 'engineering',
  tags: '[]',
  description: 'Synthetic description',
  catchphrase: null,
  version: '1',
  model: 'claude',
  archetype: 'copilot',
  avatarSeed: id,
  githubPath: `agents/${id}`,
  installCount: 5,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  syncedAt: '2026-10-01T00:00:00Z',
  documentState: 'ready',
});
async function mount(detail = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const owned = vi.fn();
  const view = render(CatalogHarness, { props: { client, owned, detail } });
  await tick();
  expect(owned).toHaveBeenCalledOnce();
  return view;
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

describe('mounted marketplace catalog queries', () => {
  it('pages the full population and resets offset before issuing a changed category query', async () => {
    const params: URLSearchParams[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const query = new URL(input, 'http://fixture.invalid').searchParams;
        params.push(query);
        const offset = Number(query.get('offset'));
        return Response.json({
          agents: [agent(`offset-${offset}`)],
          total: 140,
          offset,
          limit: 50,
        });
      }),
    );
    const view = await mount();
    await view.findByText('Synthetic offset-0');
    await fireEvent.click(view.getByRole('button', { name: 'Next page' }));
    await view.findByText('Synthetic offset-50');
    await fireEvent.click(view.getByRole('button', { name: /^Engineering$/ }));
    await waitFor(() => expect(params.at(-1)?.get('category')).toBe('engineering'));
    expect(params.at(-1)?.get('offset')).toBe('0');
    expect(
      params.some(
        (query) => query.get('category') === 'engineering' && query.get('offset') === '50',
      ),
    ).toBe(false);
    // A -> B -> A must retire A's old page rather than resurrect offset 50.
    await fireEvent.click(view.getByRole('button', { name: /^All$/ }));
    await view.findByText('Synthetic offset-0');
    expect(view.queryByText('Synthetic offset-50')).toBeNull();
    expect(params.at(-1)?.get('offset')).toBe('0');
    await fireEvent.click(view.getByRole('button', { name: /^Engineering$/ }));
    await waitFor(() => expect(params.at(-1)?.get('category')).toBe('engineering'));
    await fireEvent.click(view.getByRole('button', { name: /Featured/i }));
    await waitFor(() => expect(params.at(-1)?.get('featured')).toBe('true'));
    expect(params.at(-1)?.get('category')).toBe('engineering');
    await fireEvent.change(view.getByRole('combobox', { name: 'Model' }), {
      target: { value: 'claude' },
    });
    await waitFor(() => expect(params.at(-1)?.get('model')).toBe('claude'));
    await fireEvent.change(view.getByRole('combobox', { name: 'Sort agents by' }), {
      target: { value: 'name' },
    });
    await waitFor(() => expect(params.at(-1)?.get('sort')).toBe('name'));
    await fireEvent.input(view.getByRole('searchbox'), { target: { value: 'quant' } });
    await waitFor(() => expect(params.at(-1)?.get('search')).toBe('quant'));
    expect(Object.fromEntries(params.at(-1)!)).toMatchObject({
      category: 'engineering',
      featured: 'true',
      model: 'claude',
      sort: 'name',
      search: 'quant',
      offset: '0',
      limit: '50',
    });
  });
  it('does not render an older reply after the active filter changes even when transport ignores abort', async () => {
    const first = deferred();
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        const query = new URL(input, 'http://fixture.invalid').searchParams;
        if (!query.has('category')) {
          signal = init?.signal ?? undefined;
          return first.promise;
        }
        return Promise.resolve(
          Response.json({ agents: [agent('current')], total: 1, offset: 0, limit: 50 }),
        );
      }),
    );
    const view = await mount();
    await waitFor(() => expect(signal).toBeDefined());
    await fireEvent.click(view.getByRole('button', { name: /^Engineering$/ }));
    await view.findByText('Synthetic current');
    expect(signal?.aborted).toBe(true);
    first.resolve(Response.json({ agents: [agent('obsolete')], total: 999, offset: 0, limit: 50 }));
    await tick();
    await Promise.resolve();
    expect(view.queryByText('Synthetic obsolete')).toBeNull();
    expect(view.getByText('Synthetic current')).toBeTruthy();
  });
  it('shows retryable list errors and recovers using the same real query', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ message: 'Catalog temporarily unavailable' }, { status: 503 }),
        )
        .mockResolvedValueOnce(
          Response.json({ agents: [agent('recovered')], total: 1, offset: 0, limit: 50 }),
        ),
    );
    const view = await mount();
    expect((await view.findByRole('alert')).textContent).toContain(
      'Catalog temporarily unavailable',
    );
    await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    await view.findByText('Synthetic recovered');
    expect(view.queryByRole('alert')).toBeNull();
  });
  it('renders detail provider failure as retryable error rather than not found', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ message: 'Agent documents unavailable' }, { status: 503 }),
        )
        .mockResolvedValueOnce(
          Response.json({ agent: { ...agent('agent-a'), soulMd: 'Verified content' } }),
        ),
    );
    const view = await mount(true);
    expect((await view.findByRole('alert')).textContent).toContain('temporarily unavailable');
    expect(view.queryByText('Agent not found')).toBeNull();
    await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    await view.findByRole('heading', { name: 'Synthetic agent-a', level: 1 });
  });
  it('shows a stale-document warning and blocks hiring until documents are ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          agent: { ...agent('agent-a'), documentState: 'stale', soulMd: 'Old verified content' },
        }),
      ),
    );
    const view = await mount(true);
    await view.findByText(/older verified version/);
    expect(
      view.getByRole('button', { name: /Hire Synthetic agent-a/i }).hasAttribute('disabled'),
    ).toBe(true);
    expect(view.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
