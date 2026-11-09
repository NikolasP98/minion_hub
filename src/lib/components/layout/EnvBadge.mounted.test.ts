// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { inactiveSimulation } from '$lib/role-simulation';

const harness = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return harness.data;
    },
  },
}));
import EnvBadge from './EnvBadge.svelte';

beforeEach(() => {
  harness.data = { env: { backend: 'dev', local: true }, user: { id: 'owner' } };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) }),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('local QA account tools', () => {
  it('opens account switching from DEV, with an explicit account-change description', async () => {
    render(EnvBadge);
    await fireEvent.click(screen.getByRole('button', { name: /Local QA tools/ }));
    const change = await screen.findByRole('menuitem', { name: 'Switch QA account…' });
    await fireEvent.pointerDown(change, { pointerType: 'mouse' });
    await fireEvent.pointerUp(change, { pointerType: 'mouse' });
    await fireEvent.click(change);
    expect(await screen.findByRole('dialog', { name: 'Switch QA account' })).toBeTruthy();
    expect(screen.getByText('Changes your signed-in test account.')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/dev/users');
  });

  it.each(['production', 'anonymous', 'simulation'])(
    'does not offer QA switching for %s',
    (state) => {
      if (state === 'production') harness.data.env = { backend: 'prd', local: true };
      if (state === 'anonymous') harness.data.user = null;
      if (state === 'simulation')
        harness.data.roleSimulation = { ...inactiveSimulation(), active: true };
      render(EnvBadge);
      expect(screen.queryByRole('button', { name: /Local QA tools/ })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Switch QA account…' })).toBeNull();
    },
  );
});
