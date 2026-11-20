import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
  datasetCatalog: vi.fn(),
  listElements: vi.fn(),
  listPages: vi.fn(),
  removeElement: vi.fn(),
  upsertElement: vi.fn(),
}));
vi.mock('$server/sandbox/sandbox.service', () => ({ ...svc, LIBRARY_PAGE: 'library' }));

import { SandboxQueryError } from '$server/sandbox/query-compiler';
import { ToolFailure } from './protocol';
import { sandboxFailure, sandboxTools } from './sandbox-tools';

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
  it('exposes exactly the ten named tools', () => {
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
