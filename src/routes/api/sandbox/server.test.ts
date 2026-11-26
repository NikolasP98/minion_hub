/**
 * Sandbox API routes, exercised THROUGH the real service and query compiler
 * with only the database and the RBAC resolver mocked — the negative controls
 * SC-002 asks for (403 without the capability, 400 on an unknown column, the
 * limit clamp, the admin gate on element writes) are service behaviour, so
 * stubbing the service would have made them vacuous.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const mocks = vi.hoisted(() => ({
  hasOrgCapability: vi.fn(),
  resolveOwnerScope: vi.fn(),
  shouldMaskSensitive: vi.fn(),
  requireCoreCtx: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('$server/services/rbac.service', async () => ({
  hasOrgCapability: mocks.hasOrgCapability,
  // Mirrors the real guard's contract: 401 without a user, platform admins pass,
  // otherwise the org capability decides (the test personas carry no org roles).
  requireOrgCapability: async (locals: { user?: { role?: string } }) => {
    const { error } = await import('@sveltejs/kit');
    if (!locals.user) throw error(401, 'Authentication required');
    if (locals.user.role === 'admin') return;
    throw error(403, "Your role does not permit 'manage' on settings.");
  },
  resolveOwnerScope: mocks.resolveOwnerScope,
  shouldMaskSensitive: mocks.shouldMaskSensitive,
}));

vi.mock('$server/auth/core-ctx', () => ({
  requireCoreCtx: mocks.requireCoreCtx,
}));

vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_scope: unknown, fn: (tx: unknown) => unknown) => fn({ execute: mocks.execute }),
}));

import { POST as queryPost } from './query/+server';
import { GET as datasetsGet } from './datasets/+server';
import { GET as elementsGet, POST as elementsPost } from './elements/+server';
import { PATCH as elementPatch, DELETE as elementDelete } from './elements/[id]/+server';

const dialect = new PgDialect();
const ADMIN = { user: { role: 'admin', supabaseId: 'profile-1' } } as never;
const MEMBER = { user: { role: 'user', supabaseId: 'profile-2' } } as never;

function post(
  locals: unknown,
  body: unknown,
  pathname = '/api/sandbox/query',
  params: Record<string, string> = {},
) {
  return {
    locals,
    request: new Request(`https://hub.example.test${pathname}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    url: new URL(`https://hub.example.test${pathname}`),
    params,
  } as never;
}

/** The statements the (mocked) transaction received, rendered to text + params. */
function statements() {
  return mocks.execute.mock.calls.map((call) => dialect.sqlToQuery(call[0] as SQL));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasOrgCapability.mockResolvedValue(true);
  mocks.resolveOwnerScope.mockResolvedValue({ scoped: false, column: null, profileId: null });
  mocks.shouldMaskSensitive.mockResolvedValue(false);
  mocks.requireCoreCtx.mockResolvedValue({ db: {}, tenantId: 'org-1', profileId: 'profile-1' });
  mocks.execute.mockResolvedValue([]);
});

describe('POST /api/sandbox/query', () => {
  it('401s an unauthenticated caller before anything else runs', async () => {
    await expect(queryPost(post({}, { dataset: 'crm.contacts' }))).rejects.toMatchObject({
      status: 401,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("403s with the role-readable message when the dataset's module is not viewable", async () => {
    mocks.hasOrgCapability.mockResolvedValue(false);
    const response = await queryPost(post(MEMBER, { dataset: 'crm.contacts' }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Your role does not permit 'view' on crm.",
      field: 'dataset',
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('400s on an unknown column, naming the field and the dataset, with no SQL executed', async () => {
    const response = await queryPost(post(MEMBER, { dataset: 'crm.contacts', select: ['salary'] }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'unknown column "salary" for dataset "crm.contacts"',
      field: 'select',
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('400s on an unknown dataset', async () => {
    const response = await queryPost(post(MEMBER, { dataset: 'crm.salaries' }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'unknown dataset',
      field: 'dataset',
    });
  });

  it('400s on an unknown op (rejected by the body schema, same error shape)', async () => {
    const response = await queryPost(
      post(MEMBER, { dataset: 'crm.contacts', where: [{ col: 'display_name', op: 'regex' }] }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { field: string };
    expect(body.field).toBe('where.0.op');
  });

  it('400s on a malformed JSON body', async () => {
    const response = await queryPost(post(MEMBER, 'not json'));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid JSON body', field: 'body' });
  });

  it('clamps an over-large limit to 1000 in the SQL it binds', async () => {
    const response = await queryPost(post(MEMBER, { dataset: 'pos.tickets', limit: 50_000 }));
    expect(response.status).toBe(200);
    const [timeout, query] = statements();
    expect(timeout.sql).toContain('statement_timeout');
    expect(timeout.params).toEqual(['5000']);
    expect(query.sql).toContain('limit $2');
    expect(query.params).toEqual(['org-1', 1000]);
    await expect(response.json()).resolves.toMatchObject({ dataset: 'pos.tickets', rows: [] });
  });

  it('always binds the org id and runs the filtered query the spec asked for', async () => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ display_name: 'Sara' }]);
    const response = await queryPost(
      post(MEMBER, {
        dataset: 'crm.contacts',
        select: ['display_name'],
        where: [
          { col: 'display_name', op: 'startsWith', value: 'S' },
          { col: 'created_at', op: 'gte', value: '2000-01-01' },
        ],
        limit: 50,
      }),
    );
    const [, query] = statements();
    expect(query.params).toEqual(['org-1', 'S%', '2000-01-01', 50]);
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ display_name: 'Sara' }],
      limited: false,
    });
  });

  it('fails closed when an owner-scoped role queries a dataset without an owner column', async () => {
    mocks.resolveOwnerScope.mockResolvedValue({
      scoped: true,
      column: 'created_by',
      profileId: 'profile-2',
    });
    // pos.tickets has no registry ownerColumn — the query must be refused, not widened.
    const res = await queryPost(post(MEMBER, { dataset: 'pos.tickets', select: ['total'] }));
    expect(res.status).toBe(403);
    expect(statements()).toHaveLength(0);
  });

  it('adds the owner predicate for an owner-scoped role', async () => {
    mocks.resolveOwnerScope.mockResolvedValue({
      scoped: true,
      column: 'owner_id',
      profileId: 'profile-2',
    });
    await queryPost(post(MEMBER, { dataset: 'crm.contacts', select: ['display_name'] }));
    const [, query] = statements();
    expect(query.sql).toContain('t.owner_id = $2');
    expect(query.params).toEqual(['org-1', 'profile-2', 100]);
  });

  it('masks PII columns when the field level is below sensitive', async () => {
    mocks.shouldMaskSensitive.mockResolvedValue(true);
    mocks.execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ customer_name: 'Eva Rojas', total: 120, voided_at: null }]);
    const response = await queryPost(
      post(MEMBER, { dataset: 'pos.tickets', select: ['customer_name', 'total'] }),
    );
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ customer_name: '***', total: 120, voided_at: null }],
    });
  });

  it('lets a bucket spec through to the compiler (trend / time-series blocks)', async () => {
    const response = await queryPost(
      post(MEMBER, {
        dataset: 'pos.tickets',
        bucket: { col: 'submitted_at', unit: 'day' },
        aggregate: [{ fn: 'sum', col: 'total', as: 'value' }],
        orderBy: [{ col: 'submitted_at', dir: 'asc' }],
      }),
    );
    expect(response.status).toBe(200);
    const [, query] = statements();
    expect(query.sql).toContain('date_trunc($1, t.submitted_at) as "submitted_at"');
    expect(query.params).toContain('day');
  });

  it('400s a value that does not fit its column, naming where.<i>.value, before any SQL', async () => {
    const response = await queryPost(
      post(MEMBER, {
        dataset: 'pos.tickets',
        where: [{ col: 'total', op: 'gt', value: 'abc' }],
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: 'where.0.value' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('reports limited:true when the row count reaches the limit', async () => {
    mocks.execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 1 }, { total: 2 }]);
    const response = await queryPost(
      post(MEMBER, { dataset: 'pos.tickets', select: ['total'], limit: 2 }),
    );
    await expect(response.json()).resolves.toMatchObject({ limited: true });
  });
});

describe('GET /api/sandbox/datasets', () => {
  it('returns only the datasets whose module the caller may view', async () => {
    mocks.hasOrgCapability.mockImplementation(
      async (_locals: unknown, module: string) => module === 'pos',
    );
    const response = await datasetsGet({ locals: MEMBER } as never);
    const body = (await response.json()) as { datasets: Array<{ id: string }> };
    expect(body.datasets.map((d) => d.id)).toEqual([
      'pos.tickets',
      'pos.ticket_lines',
      'pos.payments',
    ]);
  });

  it('describes columns with type, meaning and the pii flag', async () => {
    const response = await datasetsGet({ locals: ADMIN } as never);
    const body = (await response.json()) as {
      datasets: Array<{ id: string; columns: Array<Record<string, unknown>> }>;
    };
    expect(body.datasets).toHaveLength(8);
    const tickets = body.datasets.find((d) => d.id === 'pos.tickets')!;
    expect(tickets.columns).toContainEqual({
      name: 'customer_name',
      type: 'text',
      meaning: 'Customer name typed at the till',
      pii: true,
    });
  });

  it('401s an unauthenticated caller', async () => {
    await expect(datasetsGet({ locals: {} } as never)).rejects.toMatchObject({ status: 401 });
  });
});

describe('element writes are admin-only', () => {
  const body = { title: 'Margin', html: '<div></div>', js: '' };

  it('403s a non-admin on POST, PATCH and DELETE, and 403s the list too', async () => {
    await expect(elementsPost(post(MEMBER, body, '/api/sandbox/elements'))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      elementPatch(post(MEMBER, body, '/api/sandbox/elements/x', { id: 'x' })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      elementDelete({ locals: MEMBER, params: { id: 'x' } } as never),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      elementsGet({ locals: MEMBER, url: new URL('https://h.test/api/sandbox/elements') } as never),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('401s an unauthenticated caller', async () => {
    await expect(elementsPost(post({}, body, '/api/sandbox/elements'))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('inserts for an admin, stamping created_by and the next position', async () => {
    mocks.execute.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        page: 'default',
        title: 'Margin',
        html: '<div></div>',
        css: '',
        js: '',
        w: 2,
        h: 2,
        position: 0,
        createdBy: 'profile-1',
        updatedAt: '2026-10-16T00:00:00.000Z',
      },
    ]);
    const response = await elementsPost(post(ADMIN, body, '/api/sandbox/elements'));
    expect(response.status).toBe(201);
    const [insert] = statements();
    expect(insert.sql).toContain('insert into sandbox_elements');
    expect(insert.sql).toContain('coalesce(max(position), -1) + 1');
    expect(insert.params).toContain('profile-1');
    expect(insert.params).toContain('org-1');
    await expect(response.json()).resolves.toMatchObject({
      element: { id: '11111111-1111-4111-8111-111111111111', title: 'Margin' },
    });
  });

  it('patches only the provided fields, org-scoped', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    mocks.execute.mockResolvedValue([
      {
        id,
        page: 'default',
        title: 'Renamed',
        html: '',
        css: '',
        js: '',
        w: 3,
        h: 2,
        position: 0,
        createdBy: 'profile-1',
        updatedAt: '2026-10-16T00:00:00.000Z',
      },
    ]);
    const response = await elementPatch(
      post(ADMIN, { title: 'Renamed', w: 3 }, `/api/sandbox/elements/${id}`, { id }),
    );
    expect(response.status).toBe(200);
    const [update] = statements();
    expect(update.sql).toContain('update sandbox_elements set');
    expect(update.sql).toContain('where org_id = $11 and id = $12::uuid');
    // a person's change clears the key that wrote the element before (spec 143 FR-010)
    expect(update.sql).toContain('written_by_key = null');
    // null for every omitted field => coalesce keeps the stored value; the
    // viewer id appears for the creator-only `published` guard, the library
    // write guard and the `mine` column (spec 014).
    expect(update.params).toEqual([
      'Renamed',
      null,
      null,
      null,
      null,
      3,
      null,
      null,
      'profile-1',
      null,
      'org-1',
      id,
      'library',
      'profile-1',
      'profile-1',
    ]);
  });

  it('400s a non-uuid element id before any SQL runs', async () => {
    const response = await elementPatch(
      post(ADMIN, { title: 'x' }, '/api/sandbox/elements/nope', { id: 'nope' }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid element id', field: 'id' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('400s element code over 64 KB', async () => {
    const response = await elementsPost(
      post(ADMIN, { title: 'Huge', js: 'x'.repeat(64 * 1024 + 1) }, '/api/sandbox/elements'),
    );
    expect(response.status).toBe(400);
    const parsed = (await response.json()) as { error: string };
    expect(parsed.error).toMatch(/the limit is 65536/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('stores a valid block spec as jsonb and 400s one that names an unknown column (spec 049)', async () => {
    const spec = {
      v: 1,
      type: 'kpi',
      source: {
        dataset: 'pos.tickets',
        metric: { fn: 'sum', col: 'total' },
        period: { col: 'submitted_at', range: 'this_month' },
      },
      format: 'money',
    };
    mocks.execute.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        page: 'default',
        title: 'Sales',
        html: '',
        css: '',
        js: '',
        spec: { ...spec, tone: 'accent' },
        w: 1,
        h: 1,
        position: 0,
        createdBy: 'profile-1',
        updatedAt: '2026-11-08T00:00:00.000Z',
      },
    ]);
    const ok = await elementsPost(post(ADMIN, { title: 'Sales', spec }, '/api/sandbox/elements'));
    expect(ok.status).toBe(201);
    const [insert] = statements();
    expect(insert.sql).toContain('::jsonb');
    const stored = insert.params.find((p) => typeof p === 'string' && p.includes('"type":"kpi"'));
    expect(JSON.parse(stored as string)).toMatchObject({
      type: 'kpi',
      tone: 'accent',
      format: 'money',
    });
    await expect(ok.json()).resolves.toMatchObject({ element: { spec: { type: 'kpi' } } });

    mocks.execute.mockClear();
    const bad = await elementsPost(
      post(
        ADMIN,
        {
          title: 'Bad',
          spec: { ...spec, source: { ...spec.source, metric: { fn: 'sum', col: 'totl' } } },
        },
        '/api/sandbox/elements',
      ),
    );
    expect(bad.status).toBe(400);
    await expect(bad.json()).resolves.toEqual({
      error: 'unknown column "totl" on pos.tickets',
      field: 'spec.source.metric.col',
    });
    const typed = await elementsPost(
      post(
        ADMIN,
        {
          title: 'Bad',
          spec: { ...spec, source: { ...spec.source, metric: { fn: 'sum', col: 'status' } } },
        },
        '/api/sandbox/elements',
      ),
    );
    await expect(typed.json()).resolves.toMatchObject({ field: 'spec.source.metric.col' });
    const shape = await elementsPost(
      post(ADMIN, { title: 'Bad', spec: { ...spec, format: 'euros' } }, '/api/sandbox/elements'),
    );
    expect(shape.status).toBe(400);
    await expect(shape.json()).resolves.toMatchObject({ field: 'spec.format' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('404s a delete that matched no row in this org', async () => {
    mocks.execute.mockResolvedValue([]);
    await expect(
      elementDelete({
        locals: ADMIN,
        params: { id: '11111111-1111-4111-8111-111111111111' },
      } as never),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lists elements ordered by position for the requested page', async () => {
    mocks.execute.mockResolvedValue([]);
    await elementsGet({
      locals: ADMIN,
      url: new URL('https://h.test/api/sandbox/elements?page=default'),
    } as never);
    const [select] = statements();
    expect(select.sql).toContain('order by position asc, id asc');
    // viewer id (mine column), org, page, page vs library page, viewer id (library visibility)
    expect(select.params).toEqual([
      'profile-1',
      'org-1',
      'default',
      'default',
      'library',
      'profile-1',
    ]);
  });

  it('returns the wiring report with the list, computed from the full registry (spec 150)', async () => {
    const id = (n: number) => `11111111-1111-4111-8111-11111111111${n}`;
    const row = (n: number, position: number, spec: unknown) => ({
      id: id(n),
      page: 'default',
      title: `E${n}`,
      html: '',
      css: '',
      js: '',
      spec,
      w: 1,
      h: 1,
      position,
      createdBy: 'profile-1',
      updatedAt: '2026-11-25T00:00:00.000Z',
    });
    mocks.execute.mockResolvedValue([
      row(1, 0, { v: 1, type: 'filter', var: 'period', control: 'date_range' }),
      row(2, 1, {
        v: 1,
        type: 'kpi',
        source: { dataset: 'pos.tickets', metric: { fn: 'count', col: '*' } },
        format: 'number',
        tone: 'accent',
        listens: [
          { var: 'period', col: 'submitted_at' },
          { var: 'gone', col: 'status' },
        ],
      }),
    ]);
    const response = await elementsGet({
      locals: ADMIN,
      url: new URL('https://h.test/api/sandbox/elements'),
    } as never);
    const body = (await response.json()) as {
      elements: unknown[];
      wiring: { publishers: unknown[]; blocks: Record<string, unknown> };
    };
    expect(body.elements).toHaveLength(2);
    expect(body.wiring.publishers).toHaveLength(1);
    expect(body.wiring.blocks[id(2)]).toMatchObject({
      bindings: [{ var: 'period', col: 'submitted_at' }],
      problems: [{ var: 'gone', code: 'no_publisher' }],
    });
  });
});

describe('connections write (spec 150 FR-009)', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const kpiSpec = {
    v: 1,
    type: 'kpi',
    source: {
      dataset: 'pos.tickets',
      metric: { fn: 'sum', col: 'total' },
      period: { col: 'submitted_at', range: 'this_month' },
    },
    format: 'money',
    tone: 'accent',
  };
  const stored = (spec: unknown) => ({ spec });
  const row = (spec: unknown) => ({
    id,
    page: 'default',
    title: 'Sales',
    html: '',
    css: '',
    js: '',
    spec,
    w: 1,
    h: 1,
    position: 0,
    createdBy: 'profile-1',
    updatedAt: '2026-11-25T00:00:00.000Z',
  });
  const patch = (body: unknown) =>
    elementPatch(post(ADMIN, body, `/api/sandbox/elements/${id}`, { id }));
  const listens = [{ var: 'period', col: 'submitted_at' }];

  it('locks the row, validates the merged spec and writes only listens with updated_at', async () => {
    mocks.execute
      .mockResolvedValueOnce([stored(kpiSpec)])
      .mockResolvedValueOnce([row({ ...kpiSpec, listens })]);
    const response = await patch({ listens });
    expect(response.status).toBe(200);
    const [select, update] = statements();
    expect(select.sql).toContain('select spec from sandbox_elements');
    expect(select.sql).toContain('for update');
    expect(update.sql).toContain("jsonb_set(spec, '{listens}'");
    expect(update.sql).toContain('updated_at = now()');
    expect(update.sql).toContain('written_by_key = null');
    expect(update.params).toContain(JSON.stringify(listens));
    await expect(response.json()).resolves.toMatchObject({
      element: { spec: { listens } },
    });
  });

  it('clears connections with an empty list', async () => {
    mocks.execute
      .mockResolvedValueOnce([stored({ ...kpiSpec, listens })])
      .mockResolvedValueOnce([row(kpiSpec)]);
    await patch({ listens: [] });
    expect(statements()[1].sql).toContain("spec - 'listens'");
  });

  it('400s a missing row, a custom element and a filter, naming listens, without writing', async () => {
    mocks.execute.mockResolvedValueOnce([]);
    const missing = await patch({ listens });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({ error: 'element not found', field: 'id' });

    mocks.execute.mockReset().mockResolvedValueOnce([stored(null)]);
    const custom = await patch({ listens });
    expect(custom.status).toBe(400);
    await expect(custom.json()).resolves.toMatchObject({ field: 'listens' });

    mocks.execute
      .mockReset()
      .mockResolvedValueOnce([
        stored({ v: 1, type: 'filter', var: 'period', control: 'date_range' }),
      ]);
    const filter = await patch({ listens });
    await expect(filter.json()).resolves.toMatchObject({ field: 'listens' });
    expect(statements().every((s) => !s.sql.includes('update sandbox_elements'))).toBe(true);
  });

  it('refuses a stale or personal-data connection naming spec.listens.<i>.col', async () => {
    mocks.execute.mockResolvedValueOnce([stored(kpiSpec)]);
    const stale = await patch({ listens: [{ var: 'period', col: 'gone' }] });
    await expect(stale.json()).resolves.toMatchObject({ field: 'spec.listens.0.col' });
    mocks.execute.mockResolvedValueOnce([stored(kpiSpec)]);
    const pii = await patch({ listens: [{ var: 'who', col: 'customer_name' }] });
    await expect(pii.json()).resolves.toMatchObject({ field: 'spec.listens.0.col' });
  });

  it('changing the look without mentioning listens keeps the stored connections', async () => {
    const chart = {
      v: 1,
      type: 'chart',
      preset: 'line',
      source: {
        dataset: 'pos.tickets',
        time: { col: 'submitted_at', bucket: 'day' },
        measures: [{ fn: 'sum', col: 'total' }],
      },
    };
    mocks.execute
      .mockResolvedValueOnce([stored({ ...chart, preset: 'bar', listens })])
      .mockResolvedValueOnce([row({ ...chart, listens })]);
    const response = await patch({ spec: chart });
    expect(response.status).toBe(200);
    const [select, update] = statements();
    expect(select.sql).toContain('for update');
    const written = update.params.find(
      (p) => typeof p === 'string' && p.includes('"preset":"line"'),
    );
    expect(JSON.parse(written as string)).toMatchObject({ preset: 'line', listens });
  });

  it('changing the dataset refuses a connection that no longer fits', async () => {
    mocks.execute.mockResolvedValueOnce([stored({ ...kpiSpec, listens })]);
    const response = await patch({
      spec: {
        v: 1,
        type: 'kpi',
        source: { dataset: 'crm.contacts', metric: { fn: 'count', col: '*' } },
      },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: 'spec.listens.0.col' });
    expect(statements().every((s) => !s.sql.includes('update sandbox_elements'))).toBe(true);
  });

  it('an explicit listens in the spec replaces the stored ones; the body listens overrides both', async () => {
    mocks.execute.mockResolvedValue([row(kpiSpec)]);
    await patch({ spec: { ...kpiSpec, listens: [{ var: 'a', col: 'status' }] }, listens });
    const [update] = statements();
    const written = update.params.find((p) => typeof p === 'string' && p.includes('"type":"kpi"'));
    expect(JSON.parse(written as string).listens).toEqual(listens);
    expect(update.sql).not.toContain('for update');
  });

  it('refuses listens together with a filter spec', async () => {
    const response = await patch({
      spec: { v: 1, type: 'filter', var: 'period', control: 'date_range' },
      listens,
    });
    await expect(response.json()).resolves.toMatchObject({ field: 'listens' });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("a patch with neither spec nor listens keeps today's SQL (no lock, no extra select)", async () => {
    mocks.execute.mockResolvedValue([row(kpiSpec)]);
    await patch({ title: 'Renamed' });
    expect(statements()).toHaveLength(1);
    expect(statements()[0].sql).not.toContain('for update');
  });

  it('refuses a bad value name on create naming the field', async () => {
    const response = await elementsPost(
      post(
        ADMIN,
        { title: 'x', spec: { ...kpiSpec, listens: [{ var: 'Bad', col: 'status' }] } },
        '/api/sandbox/elements',
      ),
    );
    await expect(response.json()).resolves.toMatchObject({ field: 'spec.listens.0.var' });
  });

  it('fields + listens are ONE transaction: a custom element refuses before any write', async () => {
    mocks.execute.mockResolvedValueOnce([stored(null)]);
    const response = await patch({ title: 'Renamed', html: '<p>x</p>', listens });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: 'listens' });
    expect(statements().every((s) => !s.sql.includes('update sandbox_elements'))).toBe(true);
  });

  it('fields + listens: one locked select then ONE update carrying both', async () => {
    mocks.execute
      .mockResolvedValueOnce([stored(kpiSpec)])
      .mockResolvedValueOnce([row({ ...kpiSpec, listens })]);
    const response = await patch({ title: 'Renamed', listens });
    expect(response.status).toBe(200);
    const all = statements();
    expect(all).toHaveLength(2);
    expect(all[0].sql).toContain('for update');
    expect(all[1].sql).toContain('update sandbox_elements set');
    expect(all[1].params).toContain('Renamed');
    expect(all[1].params.some((p) => typeof p === 'string' && p.includes('"listens"'))).toBe(true);
  });

  it('fields + listens: an oversized field refuses before anything is written', async () => {
    const response = await patch({ js: 'x'.repeat(64 * 1024 + 1), listens });
    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('a stale connection with other fields writes nothing', async () => {
    mocks.execute.mockResolvedValueOnce([stored(kpiSpec)]);
    const response = await patch({ title: 'T', listens: [{ var: 'a', col: 'gone' }] });
    await expect(response.json()).resolves.toMatchObject({ field: 'spec.listens.0.col' });
    expect(statements().every((s) => !s.sql.includes('update sandbox_elements'))).toBe(true);
  });
});
