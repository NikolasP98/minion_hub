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
    expect(update.sql).toContain('where org_id = $10 and id = $11::uuid');
    // null for every omitted field => coalesce keeps the stored value; the
    // viewer id appears for the creator-only `published` guard, the library
    // write guard and the `mine` column (spec 014).
    expect(update.params).toEqual([
      'Renamed',
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
});
