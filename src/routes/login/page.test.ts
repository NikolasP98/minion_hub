// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  page: {
    data: { qaLoginAvailable: false, env: { backend: 'prd' as 'dev' | 'prd' } },
    url: new URL('http://localhost:5199/login'),
  },
}));

vi.mock('$app/state', () => ({ page: state.page }));
vi.mock('$lib/navigation', () => ({ goto: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_AUTH_PROVIDER: 'supabase' } }));
vi.mock('$lib/state/features/hosts.svelte', () => ({
  loadHosts: vi.fn(),
  hostsState: { activeHostId: null },
}));
vi.mock('$lib/services/gateway.svelte', () => ({ wsConnect: vi.fn() }));
vi.mock('$lib/supabase/client', () => ({ supabaseBrowser: vi.fn() }));
vi.mock('posthog-js', () => ({ default: { identify: vi.fn(), capture: vi.fn() } }));

const { default: LoginPage, normalizeLoginRedirect } = await import('./+page.svelte');

const qaUsers = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'owner@qa.minion.test',
    displayName: 'QA Owner',
    orgs: [{ orgName: 'QA Studio', roleKey: 'owner' }],
  },
];

beforeEach(() => {
  state.page.data = { qaLoginAvailable: false, env: { backend: 'prd' } };
  state.page.url = new URL('http://localhost:5199/login');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('development QA login', () => {
  it('is absent when the trusted server flag is false', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(LoginPage);

    expect(screen.queryByRole('button', { name: /QA profile|perfil de QA/i })).toBeNull();
    expect(screen.getByLabelText(/Email or username|Correo.*usuario/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads profiles lazily and signs in only after the explicit submit', async () => {
    state.page.data = { qaLoginAvailable: true, env: { backend: 'dev' } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ users: qaUsers, truncated: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    render(LoginPage);

    expect(fetchMock).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: /Use a QA profile|Usar un perfil/i }));
    const select = await screen.findByLabelText(/^QA profile$|^Perfil de QA$/i);
    expect(screen.queryByLabelText(/Email or username|Correo.*usuario/i)).toBeNull();
    expect(screen.getByText(/first available|primeros perfiles/i)).toBeTruthy();
    await fireEvent.change(select, { target: { value: qaUsers[0].id } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fireEvent.click(
      screen.getByRole('button', { name: /Sign in with QA profile|Iniciar sesión con perfil/i }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ userId: qaUsers[0].id }),
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not|No se pudo/i);
    expect((select as HTMLSelectElement).value).toBe(qaUsers[0].id);
  });

  it('shows a retryable profile-load failure', async () => {
    state.page.data = { qaLoginAvailable: true, env: { backend: 'dev' } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ users: qaUsers, truncated: false }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(LoginPage);

    await fireEvent.click(screen.getByRole('button', { name: /Use a QA profile|Usar un perfil/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /could not be loaded|No se pudieron/i,
    );
    await fireEvent.click(screen.getByRole('button', { name: /Retry|Reintentar/i }));
    expect(await screen.findByLabelText(/^QA profile$|^Perfil de QA$/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('normalizes only same-origin relative redirects', () => {
    expect(normalizeLoginRedirect('/en/pos?tab=sell#top', 'http://localhost:5199')).toBe(
      '/en/pos?tab=sell#top',
    );
    expect(normalizeLoginRedirect('//evil.test/path', 'http://localhost:5199')).toBeNull();
    expect(normalizeLoginRedirect('/\\evil.test/path', 'http://localhost:5199')).toBeNull();
    expect(normalizeLoginRedirect('https://evil.test/path', 'http://localhost:5199')).toBeNull();
  });
});
