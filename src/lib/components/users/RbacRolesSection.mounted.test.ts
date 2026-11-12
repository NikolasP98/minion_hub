// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
const state = vi.hoisted(() => ({
  invalidate: vi.fn(),
  fetch: vi.fn(),
  permissions: [
    'roles:view',
    'roles:create',
    'roles:edit',
    'roles:delete',
    'users:manage',
  ] as string[],
  mode: undefined as { active: boolean; roleKey: string | null; generation: string } | undefined,
}));
const authority = vi.hoisted(() => ({
  prepare: vi.fn(),
  commit: vi.fn(),
  cancel: vi.fn(),
  unknown: vi.fn(),
  retry: vi.fn(),
  retired: false,
}));
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return {
        user: { id: 'actor' },
        activeOrgId: 'org',
        permissions: { permissions: state.permissions },
        roleSimulation: state.mode,
      };
    },
    url: new URL('http://localhost/en/settings/roles'),
  },
}));
vi.mock('$app/navigation', () => ({ invalidate: state.invalidate }));
vi.mock('$lib/state/ui/toast.svelte', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('$lib/services/role-simulation-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/services/role-simulation-client')>()),
  prepareAuthorityChange: authority.prepare,
}));
import RbacRolesSection from './RbacRolesSection.svelte';
import RbacActionsFixture from './rbac-role-actions.fixture.svelte';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
import { RoleSimulationClientError } from '$lib/services/role-simulation-client';
import * as m from '$lib/paraglide/messages';
const initial = 'a'.repeat(64),
  saved = 'b'.repeat(64),
  child = 'c'.repeat(64),
  savedChild = 'd'.repeat(64);
const caps = () => ({
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: false,
  manage: false,
});
function fixture() {
  return {
    roles: [
      {
        key: 'viewer',
        name: 'Viewer',
        rank: 20,
        description: null,
        isSystem: true,
        memberCount: 1,
        modules: [
          {
            module: 'crm',
            label: 'CRM',
            caps: caps(),
            overridden: false,
            revision: initial,
            ifOwner: false,
            ownerScopable: true,
            fieldLevel: 1,
            fieldScopable: true,
            subResources: [
              {
                key: 'crm.insights',
                label: 'Insights',
                caps: caps(),
                overridden: true,
                revision: child,
              },
            ],
          },
        ],
      },
    ],
    actions: ['view', 'edit'],
    businessModules: ['crm'],
    adminModules: [] as string[],
  };
}
function controller() {
  return {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
    commit: authority.commit,
    cancel: authority.cancel,
    unknown: authority.unknown,
    retryNavigation: authority.retry,
    isCurrent: () => true,
  };
}
async function editParent() {
  if (screen.queryAllByRole('checkbox', { name: 'edit' }).length === 0)
    await fireEvent.click(screen.getByTitle('Advanced (granular actions, scope, sections)'));
  await waitFor(() =>
    expect(
      (screen.getAllByRole('checkbox', { name: 'edit' })[0] as HTMLInputElement).disabled,
    ).toBe(false),
  );
  await fireEvent.click(screen.getAllByRole('checkbox', { name: 'edit' })[0]);
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  state.permissions = ['roles:view', 'roles:create', 'roles:edit', 'roles:delete', 'users:manage'];
  state.mode = undefined;
  state.invalidate.mockReset().mockResolvedValue(undefined);
  state.fetch.mockReset().mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        revision: saved,
        revisions: { crm: saved, 'crm.insights': savedChild },
      }),
    ),
  );
  authority.retired = false;
  authority.prepare.mockReset();
  authority.commit.mockReset();
  authority.cancel.mockReset();
  authority.unknown.mockReset();
  authority.retry.mockReset();
  authority.commit.mockImplementation(() => {
    authority.retired = true;
    return true;
  });
  authority.unknown.mockImplementation(() => {
    authority.retired = true;
    return true;
  });
  authority.retry.mockReturnValue(true);
  authority.prepare.mockImplementation(async () => controller());
  vi.stubGlobal('fetch', state.fetch);
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('Settings permission authority retirement', () => {
  it('shows read-only policy to a roles:view member with no catalog mutations', async () => {
    state.permissions = ['roles:view'];
    render(RbacRolesSection, fixture());
    await fireEvent.click(screen.getByTitle('Advanced (granular actions, scope, sections)'));
    expect(
      screen.getAllByRole('checkbox').every((input) => (input as HTMLInputElement).disabled),
    ).toBe(true);
    expect(screen.queryByTitle(m.roles_duplicate())).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it('sends one revision-checked parent/child batch then immediately retires without invalidation', async () => {
    const data = fixture();
    render(RbacRolesSection, data);
    await editParent();
    await waitFor(() => expect(authority.commit).toHaveBeenCalledWith('/en/settings/roles'));
    expect(state.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(state.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      module: 'crm',
      revision: initial,
      resetSubresources: [{ target: 'crm.insights', revision: child }],
    });
    expect(body.caps).toMatchObject({ view: true, edit: true });
    expect(data.roles[0].modules[0].revision).toBe(saved);
    expect(data.roles[0].modules[0].subResources[0].revision).toBe(savedChild);
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(authority.prepare).toHaveBeenCalledTimes(1);
    expect(
      (screen.getAllByRole('checkbox', { name: 'edit' })[0] as HTMLInputElement).disabled,
    ).toBe(true);
  });
  it('prepares before its own tracked command is pending', async () => {
    const runtime = createActionRuntime();
    try {
      authority.prepare.mockImplementation(async (actions) => {
        expect(actions).toBe(runtime);
        expect(runtime.foregroundPending).toBe(0);
        return {
          ...controller(),
          fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            expect(runtime.foregroundPending).toBe(1);
            return fetch(input, init);
          },
        };
      });
      render(RbacActionsFixture, { props: { runtime, sectionProps: fixture() } });
      await editParent();
      await waitFor(() => expect(authority.commit).toHaveBeenCalledTimes(1));
      expect(state.fetch).toHaveBeenCalledTimes(1);
    } finally {
      runtime.dispose();
    }
  });
  it('retains a definite conflict and reloads policy without replaying the mutation', async () => {
    state.fetch.mockResolvedValue(new Response('{}', { status: 409 }));
    render(RbacRolesSection, fixture());
    await editParent();
    await screen.findByText(/Access changed in another editor/);
    const edit = screen.getAllByRole('checkbox', { name: 'edit' })[0] as HTMLInputElement;
    expect(edit.checked).toBe(true);
    expect(edit.disabled).toBe(true);
    expect(authority.cancel).toHaveBeenCalledTimes(1);
    expect(authority.commit).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Reload policy' }));
    await waitFor(() => expect(state.invalidate).toHaveBeenCalledWith('settings:roles'));
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
  it('conceals committed old authority before a failed navigation and never retries the POST', async () => {
    state.invalidate.mockRejectedValue(new Error('old read repair unavailable'));
    authority.commit.mockImplementation(() => {
      authority.retired = true;
      throw new Error('navigation unavailable');
    });
    render(RbacRolesSection, fixture());
    await editParent();
    await screen.findByText('Access was saved. Reload to refresh the policy.');
    expect(authority.retired).toBe(true);
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(
      (screen.getAllByRole('checkbox', { name: 'edit' })[0] as HTMLInputElement).disabled,
    ).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh view' }));
    expect(authority.retry).toHaveBeenCalledTimes(1);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(authority.cancel).not.toHaveBeenCalled();
  });
  it('treats a lost acknowledgement as navigation-only recovery', async () => {
    state.fetch.mockRejectedValue(new TypeError('connection lost'));
    render(RbacRolesSection, fixture());
    await editParent();
    await screen.findByText(m.sectionAccess_unknown());
    expect(authority.unknown).toHaveBeenCalledWith('/en/account/home');
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh view' }));
    expect(authority.retry).toHaveBeenCalledTimes(1);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(authority.cancel).not.toHaveBeenCalled();
  });
  it('does not write when external dirty changes block admission', async () => {
    authority.prepare.mockRejectedValue(new RoleSimulationClientError('dirty'));
    render(RbacRolesSection, fixture());
    await editParent();
    await screen.findByText(m.sectionAccess_dirtyBeforeApply());
    expect(state.fetch).not.toHaveBeenCalled();
    expect((screen.getAllByRole('checkbox', { name: 'edit' })[0] as HTMLInputElement).checked).toBe(
      true,
    );
  });
  it('reverts all displayed overrides in one atomic registered-policy reset', async () => {
    const data = fixture();
    data.roles[0].modules.push({
      ...data.roles[0].modules[0],
      module: 'finance',
      label: 'Finance',
      overridden: true,
      revision: 'f'.repeat(64),
      subResources: [],
    });
    data.businessModules.push('finance');
    render(RbacRolesSection, data);
    await fireEvent.click(screen.getByRole('button', { name: 'Revert all' }));
    await waitFor(() => expect(authority.commit).toHaveBeenCalledTimes(1));
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][1].method).toBe('DELETE');
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({
      roleKey: 'viewer',
      resetRegisteredPolicies: [
        { target: 'crm.insights', revision: child },
        { target: 'finance', revision: 'f'.repeat(64) },
      ],
    });
  });
  it('retires to the account shell when removing the currently simulated unassigned role', async () => {
    const data = fixture();
    Object.assign(data.roles[0], {
      key: 'custom-preview',
      name: 'Preview',
      isSystem: false,
      memberCount: 0,
    });
    state.mode = { active: true, roleKey: 'custom-preview', generation: 'g1' };
    state.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    render(RbacRolesSection, data);
    await fireEvent.click(screen.getByTitle(m.roles_deleteCustom()));
    await waitFor(() => expect(authority.commit).toHaveBeenCalledWith('/en/account/home'));
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][0]).toBe('/api/roles/custom-preview');
    expect(state.invalidate).not.toHaveBeenCalled();
  });
});

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
describe('organization roles and templates', () => {
  beforeEach(() => {
    state.fetch.mockResolvedValue(
      new Response(JSON.stringify({ key: 'custom-marketing' }), { status: 201 }),
    );
  });
  it('does not expose role CRUD to a read-only role viewer with Team management', () => {
    state.permissions = [];
    state.permissions.push('roles:view');
    state.permissions.push('users:manage');
    render(RbacRolesSection, props());
    expect(screen.queryByText('Role templates')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duplicate as custom role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete custom role' })).toBeNull();
  });
  it('allows Manager role CRUD controls without Team management or default changes', () => {
    state.permissions = state.permissions.filter((permission) => permission !== 'users:manage');
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
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
    expect(state.fetch.mock.calls[0][0]).toBe('/api/roles');
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({
      source: 'template',
      templateId: 'staff',
      templateVersion: 1,
      name: 'Marketing',
    });
    await waitFor(() =>
      expect(authority.commit).toHaveBeenCalledWith('/en/settings/roles?role=custom-marketing'),
    );
    expect(authority.prepare).toHaveBeenCalledTimes(1);
    expect(state.invalidate).not.toHaveBeenCalled();
  });
  it('keeps the role name and dialog available when the catalog write conflicts', async () => {
    state.fetch.mockResolvedValueOnce(new Response('{}', { status: 409 }));
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
    expect(authority.commit).not.toHaveBeenCalled();
  });
  it('renames using the stable key and current settings revision', async () => {
    state.fetch.mockResolvedValueOnce(
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
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
    expect(state.fetch.mock.calls[0][0]).toBe('/api/roles/custom-administrator');
    expect(JSON.parse(state.fetch.mock.calls[0][1].body)).toEqual({
      name: 'Owners',
      revision: 'a'.repeat(64),
    });
  });
});
