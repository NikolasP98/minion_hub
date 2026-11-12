// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
const calls = vi.hoisted(() => ({
  fetch: vi.fn(),
  commit: vi.fn(),
  permissions: new Set<string>(),
}));
vi.mock('$lib/state/features/permissions.svelte', () => ({
  can: (key: string) => calls.permissions.has(key),
}));
vi.mock('$lib/services/actions/context', () => ({ tryUseActions: () => null }));
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/settings/roles'),
    data: { user: { id: 'user-1' }, activeOrgId: 'org-1' },
  },
}));
vi.mock('$lib/services/role-simulation-client', () => ({
  prepareAuthorityChange: async () => ({
    fetch: calls.fetch,
    commit: calls.commit,
    isCurrent: () => true,
    cancel: vi.fn(),
    unknown: vi.fn(),
  }),
  RoleSimulationClientError: class extends Error {},
}));
import RbacRolesSection from './RbacRolesSection.svelte';

const props = () => ({
  roles: [
    {
      key: 'custom-administrator',
      name: 'Administrator',
      rank: 80,
      description: null,
      isSystem: false,
      memberCount: 2,
      modules: [],
    },
  ],
  roleSettings: {
    roleModel: 'organization' as const,
    defaultRoleKey: 'custom-administrator',
    revision: 'a'.repeat(64),
    templates: [
      { id: 'staff' as const, name: 'Staff', rank: 40, version: 1, description: 'Staff template' },
    ],
  },
  actions: ['view', 'create', 'edit', 'delete', 'export', 'manage'],
  businessModules: [],
  adminModules: [],
});
beforeEach(() => {
  calls.permissions.clear();
  for (const key of ['roles:view', 'roles:create', 'roles:edit', 'roles:delete', 'users:manage'])
    calls.permissions.add(key);
  calls.fetch
    .mockReset()
    .mockResolvedValue(new Response(JSON.stringify({ key: 'custom-marketing' }), { status: 201 }));
  calls.commit.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(cleanup);

describe('organization roles and templates', () => {
  it('does not expose role CRUD to a read-only role viewer with Team management', () => {
    calls.permissions.clear();
    calls.permissions.add('roles:view');
    calls.permissions.add('users:manage');
    render(RbacRolesSection, props());
    expect(screen.queryByText('Role templates')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate as custom role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete custom role' })).toBeNull();
  });
  it('allows Manager role CRUD controls without Team management or default changes', () => {
    calls.permissions.delete('users:manage');
    const data = props();
    data.roleSettings.defaultRoleKey = 'custom-other';
    render(RbacRolesSection, data);
    expect(screen.getByText('Role templates')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename role' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use as the default for new members' })).toBeNull();
  });
  it('keeps templates separate from the active-role selector and explains additive assignments', () => {
    render(RbacRolesSection, props());
    const activePicker = screen.getByRole('combobox', { name: 'Select role' }) as HTMLSelectElement;
    expect([...activePicker.options].map((option) => option.textContent)).toEqual([
      'Administrator',
    ]);
    expect(screen.getByText(/New members receive Administrator/)).toBeTruthy();
    expect(screen.getByText(/Adding a restricted role alongside Administrator/)).toBeTruthy();
  });
  it('creates an independent versioned template copy without assigning members', async () => {
    render(RbacRolesSection, props());
    await fireEvent.click(screen.getByText('Role templates'));
    await fireEvent.click(screen.getByRole('button', { name: 'Create from Staff' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Role name' }), {
      target: { value: 'Marketing' },
    });
    expect(screen.getByText('New roles start without members.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
    await waitFor(() => expect(calls.fetch).toHaveBeenCalledTimes(1));
    expect(calls.fetch.mock.calls[0][0]).toBe('/api/roles');
    expect(JSON.parse(calls.fetch.mock.calls[0][1].body)).toEqual({
      source: 'template',
      templateId: 'staff',
      templateVersion: 1,
      name: 'Marketing',
    });
    await waitFor(() => expect(calls.commit).toHaveBeenCalled());
  });
  it('keeps the role name and dialog available when the catalog write conflicts', async () => {
    calls.fetch.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    render(RbacRolesSection, props());
    await fireEvent.click(screen.getByText('Role templates'));
    await fireEvent.click(screen.getByRole('button', { name: 'Create an empty role' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Role name' }), {
      target: { value: 'Marketing' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect((screen.getByRole('textbox', { name: 'Role name' }) as HTMLInputElement).value).toBe(
      'Marketing',
    );
    expect(calls.commit).not.toHaveBeenCalled();
  });
  it('renames using the stable key and current settings revision', async () => {
    calls.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: 'custom-administrator', name: 'Owners', revision: 'b'.repeat(64) }),
        { status: 200 },
      ),
    );
    render(RbacRolesSection, props());
    await fireEvent.click(screen.getByRole('button', { name: 'Rename role' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Role name' }), {
      target: { value: 'Owners' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(calls.fetch).toHaveBeenCalledTimes(1));
    expect(calls.fetch.mock.calls[0][0]).toBe('/api/roles/custom-administrator');
    expect(JSON.parse(calls.fetch.mock.calls[0][1].body)).toEqual({
      name: 'Owners',
      revision: 'a'.repeat(64),
    });
  });
});
