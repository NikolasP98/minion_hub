// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { EMPTY_NAV_CONFIG } from '$lib/nav/custom-sections';
const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  path: '/en/crm/customers',
}));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return state.data;
    },
    get url() {
      return new URL('http://localhost' + state.path);
    },
  },
}));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn() }));
import PageHeader from './PageHeader.svelte';
beforeEach(() => {
  state.data = {
    user: { id: 'actor' },
    activeOrgId: 'org',
    permissions: { permissions: ['users:manage'] },
    navConfig: EMPTY_NAV_CONFIG,
  };
  state.path = '/en/crm/customers';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('main-page access action', () => {
  it('uses the canonical module target without requiring Settings access', async () => {
    render(PageHeader, { props: { title: 'Customers' } });
    const button = await screen.findByRole('button', { name: 'Manage access: Customers' });
    await fireEvent.click(button);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/nav/access?target=crm', undefined),
    );
  });
  it('does not appear on a record header or an explicitly disabled header', async () => {
    state.path = '/en/crm/person-123';
    render(PageHeader, { props: { title: 'Person' } });
    await waitFor(() => expect(document.querySelector('[data-page-header]')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Manage access: Person' })).toBeNull();
    cleanup();
    state.path = '/en/crm/customers';
    render(PageHeader, { props: { title: 'Customers', accessTarget: null } });
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('does not insert a main-page action into a dialog header', async () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    render(PageHeader, { target: dialog, props: { title: 'Customers' } });
    await waitFor(() => expect(dialog.querySelector('[data-page-header]')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Manage access: Customers' })).toBeNull();
    dialog.close();
    dialog.remove();
  });
  it('does not render policy controls for a denied role', async () => {
    state.data = { ...state.data, permissions: { permissions: [] } };
    render(PageHeader, { props: { title: 'Customers' } });
    await waitFor(() => expect(document.querySelector('[data-page-header]')).toBeTruthy());
    expect(screen.queryByRole('button')).toBeNull();
  });
});
