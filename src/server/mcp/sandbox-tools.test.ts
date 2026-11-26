import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
  datasetCatalog: vi.fn(),
  listDatasets: vi.fn(),
  runQuery: vi.fn(),
  listElements: vi.fn(),
  listPages: vi.fn(),
  removeElement: vi.fn(),
  upsertElement: vi.fn(),
  setListens: vi.fn(),
}));
vi.mock('$server/sandbox/sandbox.service', () => ({ ...svc, LIBRARY_PAGE: 'library' }));
const auth = vi.hoisted(() => ({ can: vi.fn(), caps: vi.fn(), orgs: vi.fn() }));
vi.mock('$server/services/rbac.service', () => ({
  hasOrgCapability: auth.can,
  resolveCapabilities: auth.caps,
}));
vi.mock('$server/services/canonical-directory.service', () => ({
  loadCanonicalMemberships: auth.orgs,
}));

import { SandboxQueryError } from '$server/sandbox/query-compiler';
import { ToolFailure } from './protocol';
import { sandboxFailure, sandboxTools, sandboxToolsFor } from './sandbox-tools';

const context = { ctx: { tenantId: 'org-1', db: {} }, keyId: 'key-1' } as never;
const tool = (name: string) => sandboxTools.find((t) => t.name === name)!;
const call = (name: string, args: Record<string, unknown> = {}) => tool(name).call(args, context);
const stored = {
  id: 'e1',
  page: 'ventas',
  title: 'T',
  html: '',
  css: '',
  js: '',
  w: 2,
  h: 2,
  position: 0,
  updatedAt: 'x',
  createdBy: null,
  published: false,
  mine: false,
};

beforeEach(() => vi.clearAllMocks());

describe('sandbox tools', () => {
  it('exposes exactly the eleven named tools', () => {
    expect(sandboxTools.map((t) => t.name)).toEqual([
      'sandbox_datasets',
      'sandbox_pages',
      'sandbox_elements',
      'sandbox_element_write',
      'sandbox_element_remove',
      'sandbox_blocks',
      'sandbox_block_kpi',
      'sandbox_block_chart',
      'sandbox_block_table',
      'sandbox_block_list',
      'sandbox_block_filter',
    ]);
  });

  it('the catalogue lists kinds, presets and one example per kind', async () => {
    const r = (await call('sandbox_blocks')) as {
      kinds: string[];
      examples: Record<string, unknown>;
    };
    expect(r.kinds).toEqual(['kpi', 'chart', 'table', 'list']);
    expect(Object.keys(r.examples)).toEqual(r.kinds);
  });

  const kpi = {
    title: 'Sales this month',
    source: { dataset: 'pos.tickets', metric: { fn: 'sum', col: 'total' } },
    format: 'money',
  };

  it('a block is stored as a validated spec on the chosen page, with the key id', async () => {
    svc.upsertElement.mockResolvedValue(stored);
    await call('sandbox_block_kpi', { ...kpi, page: 'ventas' });
    const input = svc.upsertElement.mock.lastCall![1];
    expect(input).toMatchObject({ page: 'ventas', title: kpi.title, writtenByKey: 'key-1' });
    expect(input.spec).toMatchObject({ v: 1, type: 'kpi', source: kpi.source });
    expect(input).not.toHaveProperty('html');
  });

  it('a block change by id carries no page', async () => {
    svc.upsertElement.mockResolvedValue(stored);
    await call('sandbox_block_kpi', { ...kpi, id: 'e1', page: 'ventas' });
    const input = svc.upsertElement.mock.lastCall![1];
    expect(input.id).toBe('e1');
    expect(input).not.toHaveProperty('page');
  });

  it('refuses a bad shape, an unknown column and the library page; nothing is written', async () => {
    await expect(call('sandbox_block_kpi', { title: 'x' })).rejects.toBeInstanceOf(ToolFailure);
    await expect(
      call('sandbox_block_kpi', {
        ...kpi,
        source: { dataset: 'pos.tickets', metric: { fn: 'sum', col: 'nope' } },
      }),
    ).rejects.toBeInstanceOf(SandboxQueryError);
    await expect(call('sandbox_block_kpi', { ...kpi, page: 'library' })).rejects.toBeInstanceOf(
      ToolFailure,
    );
    expect(svc.upsertElement).not.toHaveBeenCalled();
  });

  it('datasets and pages return schema and counts', async () => {
    svc.datasetCatalog.mockReturnValue([{ id: 'crm.contacts', columns: [] }]);
    svc.listPages.mockResolvedValue([{ page: 'ventas', elements: 2 }]);
    expect(await call('sandbox_datasets')).toEqual({
      datasets: [{ id: 'crm.contacts', columns: [] }],
    });
    expect(await call('sandbox_pages')).toEqual({ pages: [{ page: 'ventas', elements: 2 }] });
  });

  it('elements defaults the page, refuses the library and bad names', async () => {
    svc.listElements.mockResolvedValue([stored]);
    const r = (await call('sandbox_elements')) as { elements: Record<string, unknown>[] };
    expect(svc.listElements).toHaveBeenCalledWith(expect.anything(), 'default');
    expect(r.elements[0]).not.toHaveProperty('createdBy');
    for (const page of ['library', 'Ventas', '1a', 'a b', 'x'.repeat(33), 7])
      await expect(call('sandbox_elements', { page })).rejects.toBeInstanceOf(ToolFailure);
  });

  it('write creates with the key id, and changes by id without a page', async () => {
    svc.upsertElement.mockResolvedValue(stored);
    await call('sandbox_element_write', { page: 'ventas', title: 'T', html: '<p>', w: 3 });
    expect(svc.upsertElement).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        page: 'ventas',
        title: 'T',
        html: '<p>',
        w: 3,
        writtenByKey: 'key-1',
      }),
    );
    await call('sandbox_element_write', { id: 'e1', title: 'New', page: 'library' });
    const input = svc.upsertElement.mock.calls.at(-1)![1];
    expect(input).toMatchObject({ id: 'e1', title: 'New', writtenByKey: 'key-1' });
    expect(input).not.toHaveProperty('page');
  });

  it('a filter is stored as a validated filter spec with the key id and no grid size', async () => {
    svc.upsertElement.mockResolvedValue(stored);
    await call('sandbox_block_filter', {
      title: 'Period',
      var: 'period',
      control: 'date_range',
      page: 'ventas',
    });
    const input = svc.upsertElement.mock.lastCall![1];
    expect(input).toMatchObject({ page: 'ventas', title: 'Period', writtenByKey: 'key-1' });
    expect(input.spec).toEqual({ v: 1, type: 'filter', var: 'period', control: 'date_range' });
    expect(input).not.toHaveProperty('w');
    await expect(
      call('sandbox_block_filter', { title: 'x', var: 'Bad', control: 'date_range' }),
    ).rejects.toBeInstanceOf(ToolFailure);
    await expect(
      call('sandbox_block_filter', {
        title: 'x',
        var: 'who',
        control: 'select',
        options: { dataset: 'pos.tickets', col: 'customer_name' },
      }),
    ).rejects.toBeInstanceOf(SandboxQueryError);
  });

  it('a block accepts listens and the catalogue teaches filters and one wired page', async () => {
    svc.upsertElement.mockResolvedValue(stored);
    const kpi = {
      title: 'S',
      source: { dataset: 'pos.tickets', metric: { fn: 'count', col: '*' } },
      listens: [{ var: 'period', col: 'submitted_at' }],
      page: 'ventas',
    };
    await call('sandbox_block_kpi', kpi);
    expect(svc.upsertElement.mock.lastCall![1].spec.listens).toEqual(kpi.listens);
    const catalogue = (await call('sandbox_blocks')) as Record<string, unknown>;
    expect(catalogue).toHaveProperty('filter');
    expect(catalogue).toHaveProperty('wiredPage');
  });

  it('write with listens replaces only the connections through the locked write, with the key id', async () => {
    const listens = [{ var: 'period', col: 'submitted_at' }];
    svc.setListens.mockResolvedValue(stored);
    await call('sandbox_element_write', { id: 'e1', listens });
    expect(svc.setListens).toHaveBeenCalledWith(expect.anything(), 'e1', listens, 'key-1');
    expect(svc.upsertElement).not.toHaveBeenCalled();

    svc.upsertElement.mockResolvedValue(stored);
    await call('sandbox_element_write', { id: 'e1', title: 'New', listens });
    // fields + connections travel in ONE service call (one transaction)
    expect(svc.upsertElement).toHaveBeenCalledTimes(1);
    expect(svc.upsertElement.mock.lastCall![1]).toMatchObject({ id: 'e1', title: 'New', listens });
    expect(svc.setListens).toHaveBeenCalledTimes(1);

    await expect(call('sandbox_element_write', { listens })).rejects.toBeInstanceOf(ToolFailure);
    await expect(
      call('sandbox_element_write', { id: 'e1', listens: [{ var: 'Bad', col: 'x' }] }),
    ).rejects.toBeInstanceOf(ToolFailure);
  });

  it('elements returns the wiring report with every connection problem', async () => {
    svc.listElements.mockResolvedValue([
      { ...stored, id: 'f1', spec: { v: 1, type: 'filter', var: 'period', control: 'date_range' } },
      {
        ...stored,
        id: 'k1',
        position: 1,
        spec: {
          v: 1,
          type: 'kpi',
          source: { dataset: 'pos.tickets', metric: { fn: 'count', col: '*' } },
          listens: [
            { var: 'period', col: 'status' },
            { var: 'gone', col: 'status' },
          ],
        },
      },
    ]);
    const r = (await call('sandbox_elements')) as {
      wiring: { blocks: Record<string, { problems: Array<{ code: string }> }> };
    };
    expect(r.wiring.blocks.k1.problems.map((p) => p.code)).toEqual([
      'kind_mismatch',
      'no_publisher',
    ]);
  });

  it('write refuses bad arguments before the service', async () => {
    for (const args of [
      { page: 'library', title: 'x' },
      { title: 5 },
      { title: 'x', w: 5 },
      { title: 'x', h: 1.5 },
      { title: 'x', position: -1 },
      { id: 7, title: 'x' },
    ])
      await expect(call('sandbox_element_write', args)).rejects.toBeInstanceOf(ToolFailure);
    expect(svc.upsertElement).not.toHaveBeenCalled();
  });

  it('remove says not found for an element of another org (service finds nothing)', async () => {
    svc.removeElement.mockResolvedValue(false);
    await expect(call('sandbox_element_remove', { id: 'e9' })).rejects.toThrow(
      'Element not found.',
    );
    svc.removeElement.mockResolvedValue(true);
    expect(await call('sandbox_element_remove', { id: 'e1' })).toEqual({ removed: true });
    await expect(call('sandbox_element_remove')).rejects.toBeInstanceOf(ToolFailure);
  });

  it('maps service refusals to plain sentences and leaves other errors alone', () => {
    expect(sandboxFailure(new SandboxQueryError('element not found', 'id', 400))).toBe(
      'Element not found.',
    );
    expect(
      sandboxFailure(new SandboxQueryError('element code is 9 bytes; the limit is 8', 'html')),
    ).toContain('the limit is');
    expect(sandboxFailure(new Error('db down'))).toBeNull();
  });
});

describe('signed-in callers (spec 143)', () => {
  const locals = {
    user: { supabaseId: 'u1', email: 'a@b.test', displayName: 'Ada', role: 'user' },
    tenantCtx: { tenantId: 'org-1' },
  };
  const person = { ctx: { tenantId: 'org-1', db: {}, profileId: 'u1' }, locals } as never;
  const run = (name: string, args: Record<string, unknown> = {}) =>
    sandboxToolsFor('user')
      .find((t) => t.name === name)!
      .call(args, person);

  it('offers whoami and sandbox_query to a person and neither to a key', () => {
    const user = sandboxToolsFor('user').map((t) => t.name);
    expect(user[0]).toBe('whoami');
    expect(user.at(-1)).toBe('sandbox_query');
    expect(user).toHaveLength(13);
    expect(sandboxToolsFor('key').map((t) => t.name)).not.toContain('whoami');
    expect(sandboxToolsFor('key').map((t) => t.name)).not.toContain('sandbox_query');
  });

  it('lists only whoami for a person who may not use the Sandbox (P16)', () => {
    expect(sandboxToolsFor('user', false).map((t) => t.name)).toEqual(['whoami']);
  });

  it('an organization whose Sandbox is unavailable is refused by every sandbox tool, whoami reports it (P10)', async () => {
    auth.can.mockResolvedValue(true);
    const blocked = { ...(person as object), sandboxBlocked: true } as never;
    const tools = sandboxToolsFor('user');
    for (const name of ['sandbox_pages', 'sandbox_element_write', 'sandbox_query'])
      await expect(
        tools.find((t) => t.name === name)!.call({ dataset: 's', title: 'T' }, blocked),
      ).rejects.toThrow('The Sandbox is not available for this organization.');
    auth.caps.mockResolvedValue({ roles: [] });
    auth.orgs.mockResolvedValue([]);
    svc.listDatasets.mockResolvedValue([]);
    expect(await tools.find((t) => t.name === 'whoami')!.call({}, blocked)).toMatchObject({
      canManageSandbox: false,
    });
    expect(svc.upsertElement).not.toHaveBeenCalled();
  });

  it('a member who may manage the Sandbox writes, recorded under their profile and no key', async () => {
    auth.can.mockResolvedValue(true);
    svc.upsertElement.mockResolvedValue(stored);
    await run('sandbox_element_write', { page: 'ventas', title: 'T' });
    expect(auth.can).toHaveBeenCalledWith(locals, 'settings', 'manage');
    const [ctx, input] = svc.upsertElement.mock.calls[0]!;
    expect(ctx.profileId).toBe('u1');
    expect(input.writtenByKey).toBeUndefined();
  });

  it.each([
    'sandbox_datasets',
    'sandbox_pages',
    'sandbox_elements',
    'sandbox_element_write',
    'sandbox_element_remove',
    'sandbox_blocks',
    'sandbox_block_kpi',
    'sandbox_query',
  ])('a member without the permission is refused by %s and nothing changes', async (name) => {
    auth.can.mockResolvedValue(false);
    await expect(run(name, { dataset: 'sales', title: 'T', id: 'x' })).rejects.toThrow(
      new ToolFailure('Your role does not permit managing the Sandbox.'),
    );
    expect(svc.upsertElement).not.toHaveBeenCalled();
    expect(svc.removeElement).not.toHaveBeenCalled();
    expect(svc.runQuery).not.toHaveBeenCalled();
    expect(svc.listDatasets).not.toHaveBeenCalled();
  });

  it('sandbox_query passes the spec to the role-checked service and surfaces its refusal', async () => {
    auth.can.mockResolvedValue(true);
    svc.runQuery.mockResolvedValueOnce({ dataset: 'sales', rows: [] });
    expect(await run('sandbox_query', { dataset: 'sales', limit: 5 })).toEqual({
      dataset: 'sales',
      rows: [],
    });
    expect(svc.runQuery).toHaveBeenCalledWith(locals, { dataset: 'sales', limit: 5 });
    const refusal = new SandboxQueryError(
      "Your role does not permit 'view' on finances.",
      'dataset',
      403,
    );
    svc.runQuery.mockRejectedValueOnce(refusal);
    await expect(run('sandbox_query', { dataset: 'invoices' })).rejects.toBe(refusal);
    expect(sandboxFailure(refusal)).toBe("Your role does not permit 'view' on finances.");
  });

  it('sandbox_query rejects malformed shapes before the service', async () => {
    auth.can.mockResolvedValue(true);
    await expect(run('sandbox_query', {})).rejects.toBeInstanceOf(ToolFailure);
    await expect(run('sandbox_query', { dataset: 's', where: 'x' })).rejects.toBeInstanceOf(
      ToolFailure,
    );
    expect(svc.runQuery).not.toHaveBeenCalled();
  });

  it('sandbox_datasets lists only what the role may view', async () => {
    auth.can.mockResolvedValue(true);
    svc.listDatasets.mockResolvedValue([{ id: 'sales' }]);
    expect(await run('sandbox_datasets')).toEqual({ datasets: [{ id: 'sales' }] });
    expect(svc.datasetCatalog).not.toHaveBeenCalled();
  });

  it('whoami names the person, organization, roles, permission and datasets', async () => {
    auth.can.mockResolvedValue(true);
    auth.caps.mockResolvedValue({ roles: ['manager'] });
    auth.orgs.mockResolvedValue([{ id: 'org-1', name: 'FACES' }]);
    svc.listDatasets.mockResolvedValue([{ id: 'sales' }]);
    expect(await run('whoami')).toEqual({
      user: { email: 'a@b.test', displayName: 'Ada' },
      organization: { id: 'org-1', name: 'FACES' },
      roles: ['manager'],
      canManageSandbox: true,
      datasets: ['sales'],
    });
  });

  it('whoami works without the Sandbox permission', async () => {
    auth.can.mockResolvedValue(false);
    auth.caps.mockResolvedValue({ roles: [] });
    auth.orgs.mockResolvedValue([]);
    svc.listDatasets.mockResolvedValue([]);
    expect(await run('whoami')).toMatchObject({ canManageSandbox: false, datasets: [] });
  });
});
