// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { PageData } from './$types';

vi.mock('$app/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/environment')>();
  return { ...actual, browser: true };
});

const { default: GatewaysPage } = await import('./+page.svelte');
const emptyData = { tursoHosts: [], pgGateways: [] } as unknown as PageData;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('gateway add compound write', () => {
  it('retains credentials after a known second-stage rejection and retries only that stage', async () => {
    let gatewayAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/gateway/update') return new Response(null, { status: 403 });
      if (url === '/api/servers') return new Response(null, { status: 201 });
      if (url === '/api/gateways') {
        gatewayAttempts += 1;
        return gatewayAttempts === 1
          ? new Response(JSON.stringify({ error: 'Gateway registry unavailable' }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            })
          : new Response(null, { status: 201 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(GatewaysPage, { props: { data: emptyData } });

    const name = screen.getByPlaceholderText('Server name') as HTMLInputElement;
    const url = screen.getByPlaceholderText('ws://host:port') as HTMLInputElement;
    const token = screen.getByPlaceholderText('Optional') as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Office' } });
    await fireEvent.input(url, { target: { value: 'ws://office.test' } });
    await fireEvent.input(token, { target: { value: 'secret' } });
    await fireEvent.click(screen.getByRole('button', { name: /add server/i }));

    const retry = await screen.findByRole('button', { name: /^retry$/i });
    expect(name.value).toBe('Office');
    expect(url.value).toBe('ws://office.test');
    expect(token.value).toBe('secret');
    expect(name.disabled).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request) === '/api/servers'),
    ).toHaveLength(1);

    await vi.waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false));
    await fireEvent.click(retry);
    await vi.waitFor(() => expect(name.value).toBe(''));
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request) === '/api/servers'),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request) === '/api/gateways'),
    ).toHaveLength(2);
  });

  it('blocks blind retry after an unknown second POST and offers authoritative reload', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/gateway/update') return new Response(null, { status: 403 });
      if (url === '/api/servers') return new Response(null, { status: 201 });
      if (url === '/api/gateways') throw new TypeError('connection lost');
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(GatewaysPage, { props: { data: emptyData } });

    await fireEvent.input(screen.getByPlaceholderText('Server name'), {
      target: { value: 'Office' },
    });
    await fireEvent.input(screen.getByPlaceholderText('ws://host:port'), {
      target: { value: 'ws://office.test' },
    });
    await fireEvent.input(screen.getByPlaceholderText('Optional'), {
      target: { value: 'secret' },
    });
    await fireEvent.click(screen.getByRole('button', { name: /add server/i }));

    await screen.findByRole('button', { name: /reload current data/i });
    expect(screen.getByRole('button', { name: /^retry$/i }).hasAttribute('disabled')).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request) === '/api/servers'),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([request]) => String(request) === '/api/gateways'),
    ).toHaveLength(1);
  });
});
