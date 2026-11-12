// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { SectionAccessSnapshot } from '$lib/nav/section-access';
const state = vi.hoisted(() => ({
  data: {
    user: { id: 'actor' },
    activeOrgId: 'org',
    roleSimulation: { generation: 'g1' },
  } as Record<string, unknown>,
}));
const navigation = vi.hoisted(() => ({ invalidate: vi.fn(async (_key: string) => {}) }));
const authority = vi.hoisted(() => ({
  prepare: vi.fn(),
  commit: vi.fn(),
  cancel: vi.fn(),
  unknown: vi.fn(),
  retry: vi.fn(),
  retired: false,
}));
vi.mock('$lib/services/role-simulation-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/services/role-simulation-client')>();
  return { ...actual, prepareAuthorityChange: authority.prepare };
});
vi.mock('$app/state', () => ({
  page: {
    get data() {
      return state.data;
    },
    url: new URL('http://localhost/en/crm/customers'),
  },
}));
vi.mock('$app/navigation', () => navigation);
import SectionAccessDialog from './SectionAccessDialog.svelte';
import { RoleSimulationClientError } from '$lib/services/role-simulation-client';
import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
import ActionsFixture from './section-access-actions.fixture.svelte';
const caps = (edit = false) => ({
  view: true,
  create: false,
  edit,
  delete: false,
  export: false,
  manage: false,
});
const snapshot = (): SectionAccessSnapshot => ({
  target: 'crm',
  label: 'CRM',
  kind: 'module',
  orgName: 'QA organization',
  ownerScopable: true,
  fieldScopable: true,
  roles: [
    {
      key: 'owner',
      name: 'Owner',
      protected: true,
      defaults: caps(true),
      effective: caps(true),
      effectiveIfOwner: false,
      effectiveFieldLevel: 1,
      inheritedIfOwner: false,
      inheritedFieldLevel: 1,
      explicit: null,
      revision: 'a'.repeat(64),
    },
    {
      key: 'viewer',
      name: 'Viewer',
      protected: false,
      defaults: caps(),
      effective: caps(),
      effectiveIfOwner: false,
      effectiveFieldLevel: 1,
      inheritedIfOwner: false,
      inheritedFieldLevel: 1,
      explicit: null,
      revision: 'b'.repeat(64),
    },
  ],
});
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let writes: Record<string, unknown>[];
let getCount: number;
let writeStatus: number;
beforeEach(() => {
  state.data = { user: { id: 'actor' }, activeOrgId: 'org', roleSimulation: { generation: 'g1' } };
  navigation.invalidate.mockReset();
  navigation.invalidate.mockResolvedValue(undefined);
  writes = [];
  authority.retired = false;
  authority.commit.mockReset();
  authority.cancel.mockReset();
  authority.unknown.mockReset();
  authority.retry.mockReset();
  authority.prepare.mockReset();
  authority.commit.mockImplementation(() => {
    authority.retired = true;
    return true;
  });
  authority.unknown.mockImplementation(() => {
    authority.retired = true;
    return true;
  });
  authority.retry.mockImplementation(() => true);
  authority.prepare.mockImplementation(async () => ({
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
    commit: authority.commit,
    cancel: authority.cancel,
    unknown: authority.unknown,
    retryNavigation: authority.retry,
    isCurrent: () => true,
  }));
  getCount = 0;
  writeStatus = 200;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method === 'PUT') {
      writes.push(JSON.parse(String(init.body)));
      return reply(
        writeStatus === 200 ? { ok: true, revision: 'c'.repeat(64) } : { message: 'conflict' },
        writeStatus,
      );
    }
    getCount++;
    return reply(snapshot());
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function edit() {
  render(SectionAccessDialog, { props: { open: true, target: 'crm' } });
  await screen.findByLabelText('Role');
  await fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'override' } });
  await fireEvent.click(screen.getByRole('switch', { name: 'Edit' }));
}
describe('shared section access editor', () => {
  it('loads once and requires named review before a real write, preserving omitted scopes', async () => {
    await edit();
    expect(getCount).toBe(1);
    expect(writes).toHaveLength(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByText('QA organization · Viewer · CRM')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      target: 'crm',
      roleKey: 'viewer',
      revision: 'b'.repeat(64),
      mode: 'override',
      caps: caps(true),
    });
    await waitFor(() => expect(authority.commit).toHaveBeenCalledWith('/en/crm/customers'));
    expect(authority.prepare).toHaveBeenCalledTimes(1);
    expect(navigation.invalidate).not.toHaveBeenCalled();
  });
  it('retains the draft on conflict and requires reviewing the current policy', async () => {
    writeStatus = 409;
    await edit();
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
    await screen.findByText(
      'This policy changed. Review the latest rules before applying your draft.',
    );
    expect(
      (screen.getByRole('button', { name: 'Apply access' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Review latest rules' }));
    const retained = await screen.findByRole('switch', { name: 'Edit' });
    expect(retained.getAttribute('aria-checked')).toBe('true');
    expect(writes).toHaveLength(1);
    expect(getCount).toBe(2);
    expect(authority.cancel).toHaveBeenCalledTimes(1);
    expect(authority.commit).not.toHaveBeenCalled();
  });
  it('retires before navigation and never replays a committed write if navigation fails', async () => {
    navigation.invalidate.mockRejectedValue(new Error('read failure'));
    authority.commit.mockImplementation(() => {
      authority.retired = true;
      throw new Error('navigation unavailable');
    });
    await edit();
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
    await screen.findByText('Access is saved. Refresh this view to continue.');
    expect(authority.retired).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply access' })).toBeNull();
    expect(navigation.invalidate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Refresh view' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh view' }));
    expect(authority.retry).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect(authority.cancel).not.toHaveBeenCalled();
  });
  it('prepares before starting its own tracked command, so admission cannot wait for itself', async () => {
    const runtime = createActionRuntime();
    try {
      const controller = {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          expect(runtime.foregroundPending).toBe(1);
          return fetch(input, init);
        },
        commit: authority.commit,
        cancel: authority.cancel,
        unknown: authority.unknown,
        retryNavigation: authority.retry,
        isCurrent: () => true,
      };
      authority.prepare.mockImplementation(async (actions) => {
        expect(actions).toBe(runtime);
        expect(runtime.foregroundPending).toBe(0);
        return controller;
      });
      render(ActionsFixture, { props: { runtime } });
      await screen.findByLabelText('Role');
      await fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'override' } });
      await fireEvent.click(screen.getByRole('switch', { name: 'Edit' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
      await waitFor(() => expect(authority.commit).toHaveBeenCalledTimes(1));
      expect(writes).toHaveLength(1);
      expect(runtime.foregroundPending).toBe(0);
    } finally {
      runtime.dispose();
    }
  });
  it('releases an unused preparation if the tracked command retires before dispatch', async () => {
    const runtime = createActionRuntime();
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === 'started' && event.action.definitionId === 'navigation.access')
        runtime.setScope('replaced');
    });
    try {
      render(ActionsFixture, { props: { runtime } });
      await screen.findByLabelText('Role');
      await fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'override' } });
      await fireEvent.click(screen.getByRole('switch', { name: 'Edit' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
      await screen.findByText('Access cannot be changed yet. Refresh this view and try again.');
      expect(writes).toHaveLength(0);
      expect(authority.cancel).toHaveBeenCalledTimes(1);
      expect(authority.commit).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      runtime.dispose();
    }
  });
  it('clears only its own known rejection from activity before a reviewed retry', async () => {
    const runtime = createActionRuntime();
    writeStatus = 409;
    try {
      render(ActionsFixture, { props: { runtime } });
      await screen.findByLabelText('Role');
      await fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'override' } });
      await fireEvent.click(screen.getByRole('switch', { name: 'Edit' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
      await screen.findByText(
        'This policy changed. Review the latest rules before applying your draft.',
      );
      await waitFor(() => expect(runtime.attentionRequired).toBe(0));
      await fireEvent.click(screen.getByRole('button', { name: 'Review latest rules' }));
      await screen.findByRole('switch', { name: 'Edit' });
      writeStatus = 200;
      await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
      await waitFor(() => expect(authority.commit).toHaveBeenCalledTimes(1));
      expect(writes).toHaveLength(2);
    } finally {
      runtime.dispose();
    }
  });
  it('checks external dirty work before any PUT and retains the reviewed draft', async () => {
    authority.prepare.mockRejectedValue(new RoleSimulationClientError('dirty'));
    await edit();
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
    await screen.findByText('Save or discard your pending changes before applying access.');
    expect(writes).toHaveLength(0);
    expect(authority.commit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply access' })).toBeTruthy();
  });
  it('retires an unknown outcome and offers navigation-only recovery', async () => {
    await edit();
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === 'PUT') {
        writes.push(JSON.parse(String(init.body)));
        throw new TypeError('connection lost');
      }
      return reply(snapshot());
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
    await screen.findByText(
      'The save result is unavailable. Check the current rules before trying another change.',
    );
    expect(authority.unknown).toHaveBeenCalledWith('/en/account/home');
    expect(screen.queryByRole('button', { name: 'Apply access' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Refresh view' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh view' }));
    expect(authority.retry).toHaveBeenCalledTimes(1);
    expect(authority.cancel).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
  });
  it('distinguishes an explicit deny from restoring inherited policy', async () => {
    const base = snapshot();
    base.roles[1].explicit = { caps: caps(true), ifOwner: false, fieldLevel: 1 };
    base.roles[1].effective = caps(true);
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === 'PUT') {
        writes.push(JSON.parse(String(init.body)));
        return reply({ ok: true, revision: 'c'.repeat(64) });
      }
      return reply(base);
    });
    render(SectionAccessDialog, { props: { open: true, target: 'crm' } });
    await screen.findByLabelText('Role');
    await fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'inherit' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].mode).toBe('inherit');
    expect(writes[0]).not.toHaveProperty('caps');
    cleanup();
    writes = [];
    render(SectionAccessDialog, { props: { open: true, target: 'crm' } });
    await screen.findByLabelText('Role');
    await fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'deny' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply access' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].mode).toBe('deny');
    expect(writes[0]).not.toHaveProperty('caps');
  });

  it('reviews scope and sensitive-field changes caused by restoring inherited access', async () => {
    const base = snapshot();
    base.roles[1].explicit = { caps: caps(), ifOwner: true, fieldLevel: 0 };
    base.roles[1].effectiveIfOwner = true;
    base.roles[1].effectiveFieldLevel = 0;
    base.roles[1].inheritedIfOwner = false;
    base.roles[1].inheritedFieldLevel = 1;
    vi.mocked(fetch).mockResolvedValue(reply(base));
    render(SectionAccessDialog, { props: { open: true, target: 'crm' } });
    await screen.findByLabelText('Role');
    await fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'inherit' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByText('Owned records only → All organization records')).toBeTruthy();
    expect(screen.getByText('0 → 1')).toBeTruthy();
    expect(screen.getByText('Sensitive-field level')).toBeTruthy();
    expect(writes).toHaveLength(0);
  });

  it('shows protected owner rules without an enabled Apply route', async () => {
    render(SectionAccessDialog, { props: { open: true, target: 'crm' } });
    await screen.findByLabelText('Role');
    await fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'owner' } });
    expect(
      screen.getByText('The owner role is protected. Its access cannot be changed.'),
    ).toBeTruthy();
    expect((screen.getByLabelText('Rule') as HTMLSelectElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Review changes' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(writes).toHaveLength(0);
  });
  it('rejects malformed policy responses as unavailable rather than an empty role list', async () => {
    vi.mocked(fetch).mockResolvedValue(reply({ target: 'crm', roles: [] }));
    render(SectionAccessDialog, { props: { open: true, target: 'crm' } });
    await screen.findByText('Access rules could not be loaded. Retry to view the current policy.');
    expect(screen.queryByText('No roles are available for this organization.')).toBeNull();
    expect(writes).toHaveLength(0);
  });
});
