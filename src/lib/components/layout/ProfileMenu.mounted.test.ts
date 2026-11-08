// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { inactiveSimulation } from '$lib/role-simulation';

const harness = vi.hoisted(() => ({ data: {} as Record<string, unknown>, transition: vi.fn() }));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return harness.data;
    },
    url: new URL('http://localhost/en/account/home'),
  },
}));
vi.mock('$lib/services/role-simulation-client', async (load) => ({
  ...(await load<typeof import('$lib/services/role-simulation-client')>()),
  transitionRoleSimulation: harness.transition,
}));
vi.mock('$lib/state/features/user.svelte', () => ({
  isAdmin: { value: false },
  userState: {
    user: { id: 'actor', email: 'actor@example.test', displayName: 'Actor' },
    role: 'user',
  },
  logout: vi.fn(),
}));
vi.mock('$lib/services/gateway.svelte', () => ({ wsConnect: vi.fn(), wsDisconnect: vi.fn() }));
vi.mock('$lib/state/ui/toast.svelte', () => ({ toastError: vi.fn() }));
import ProfileMenu from './ProfileMenu.svelte';

beforeEach(() => {
  harness.data = { hosts: { servers: [], channels: [] } };
  harness.transition.mockReset().mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(cleanup);

describe('avatar simulation interaction', () => {
  it('opens the single role tray from one menu item', async () => {
    harness.data.roleSimulation = {
      ...inactiveSimulation(),
      eligible: true,
      orgId: 'org-a',
      roles: [{ key: 'viewer', name: 'Viewer', selectable: true }],
    };
    render(ProfileMenu);
    await fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    const choose = await screen.findByRole('menuitem', { name: 'Simulate a role…' });
    await fireEvent.pointerDown(choose, { pointerType: 'mouse' });
    await fireEvent.pointerUp(choose, { pointerType: 'mouse' });
    await fireEvent.click(choose);
    expect(await screen.findByRole('dialog', { name: 'Simulate a role' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Viewer' })).toBeTruthy();
    expect(harness.transition).not.toHaveBeenCalled();
  });
  it('finishes directly from the highlighted avatar item without opening role selection', async () => {
    harness.data.roleSimulation = {
      ...inactiveSimulation(),
      active: true,
      invalid: true,
      eligible: false,
      orgId: 'org-a',
      roleKey: 'viewer',
      roleName: 'Viewer',
    };
    render(ProfileMenu);
    await fireEvent.click(screen.getByRole('button', { name: /Account menu · Simulating Viewer/ }));
    const finish = await screen.findByRole('menuitem', { name: /Finish simulation/ });
    expect(finish.querySelector('.simulation-finish')).toBeTruthy();
    await fireEvent.pointerDown(finish, { pointerType: 'mouse' });
    await fireEvent.pointerUp(finish, { pointerType: 'mouse' });
    await fireEvent.click(finish);
    await waitFor(() => expect(harness.transition).toHaveBeenCalledTimes(1));
    expect(harness.transition.mock.calls[0][0]).not.toHaveProperty('roleKey');
    expect(screen.queryByRole('dialog', { name: 'Simulate a role' })).toBeNull();
  });
});
