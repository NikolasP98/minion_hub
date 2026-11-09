// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { inactiveSimulation, type RoleSimulationState } from '$lib/role-simulation';

const calls = vi.hoisted(() => ({ transition: vi.fn() }));
vi.mock('$lib/services/role-simulation-client', async (load) => {
  const actual = await load<typeof import('$lib/services/role-simulation-client')>();
  return { ...actual, transitionRoleSimulation: calls.transition };
});
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/en/crm?view=cards') } }));
import RoleSimulationDialog from './RoleSimulationDialog.svelte';

function state(): RoleSimulationState {
  return {
    ...inactiveSimulation(),
    eligible: true,
    orgId: 'org-a',
    orgName: 'Organization A',
    roles: [
      { key: 'staff', name: 'Staff', selectable: true },
      { key: 'custom-finance', name: 'Finance operator', selectable: true },
      { key: 'owner', name: 'Owner', selectable: false, reason: 'owner' },
    ],
  };
}
beforeEach(() => {
  calls.transition.mockReset().mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(cleanup);

describe('single-screen role tray', () => {
  it('searches and selects on one screen; only Apply changes the role', async () => {
    render(RoleSimulationDialog, { open: true, state: state() });
    expect(await screen.findByRole('dialog', { name: 'Simulate a role' })).toBeTruthy();
    expect(screen.getByText('Actions affect real data.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));
    expect(screen.getByRole('button', { name: 'Apply role' }).hasAttribute('disabled')).toBe(true);
    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'Finance' } });
    expect(screen.queryByRole('radio', { name: 'Staff' })).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: 'Finance operator' }));
    expect(calls.transition).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /next|back|review/i })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply role' }));
    await waitFor(() => expect(calls.transition).toHaveBeenCalledTimes(1));
    expect(calls.transition.mock.calls[0][0]).toMatchObject({
      roleKey: 'custom-finance',
      returnTo: '/en/crm?view=cards',
    });
  });

  it('shows a reason for unavailable owner selection and Cancel does not write', async () => {
    render(RoleSimulationDialog, { open: true, state: state() });
    expect((await screen.findByRole('radio', { name: 'Owner' })).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByText('Only an owner can simulate this role')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.transition).not.toHaveBeenCalled();
  });

  it('keeps the selected role and error after a definitive rejection', async () => {
    const { RoleSimulationClientError } = await import('$lib/services/role-simulation-client');
    calls.transition.mockRejectedValue(new RoleSimulationClientError('rejected'));
    render(RoleSimulationDialog, { open: true, state: state() });
    const staff = await screen.findByRole('radio', { name: 'Staff' });
    await fireEvent.click(staff);
    await fireEvent.click(screen.getByRole('button', { name: 'Apply role' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((staff as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Simulate a role' })).toBeTruthy();
  });

  it('offers read-only refresh rather than repeating an uncertain transition', async () => {
    const { RoleSimulationClientError } = await import('$lib/services/role-simulation-client');
    calls.transition.mockRejectedValue(new RoleSimulationClientError('unknown'));
    render(RoleSimulationDialog, { open: true, state: state() });
    await fireEvent.click(await screen.findByRole('radio', { name: 'Staff' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply role' }));
    await screen.findByRole('button', { name: 'Refresh page' });
    expect(screen.queryByRole('button', { name: 'Apply role' })).toBeNull();
    expect(calls.transition).toHaveBeenCalledTimes(1);
  });

  it('cancels editing while retaining the current simulated role', async () => {
    const active = { ...state(), active: true, roleKey: 'staff', roleName: 'Staff' };
    render(RoleSimulationDialog, { open: true, state: active });
    expect(await screen.findByRole('dialog', { name: 'Change simulated role' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Staff' }) as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(screen.getByRole('radio', { name: 'Finance operator' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls.transition).not.toHaveBeenCalled();
    expect(active.roleKey).toBe('staff');
  });
});
