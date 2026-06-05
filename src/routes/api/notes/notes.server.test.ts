import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetNotesCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/notes-ctx', () => ({
  getNotesCtx: (locals: unknown) => mockGetNotesCtx(locals),
}));

function makeLocals(user = true): App.Locals {
  return {
    user: user ? { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' } : undefined,
    orgId: 'org-1',
  } as App.Locals;
}

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  tenantId: 'org-1',
  userId: 'user-1',
  kind: 'note',
  title: 'A',
  color: 'default',
  pinned: false,
  data: '{}',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('GET /api/notes', () => {
  it('lists the caller notes', async () => {
    const { db, resolve } = createMockDb();
    resolve([ROW(), ROW({ id: 'n2', pinned: true })]);
    mockGetNotesCtx.mockResolvedValue({ db, tenantId: 'org-1', userId: 'user-1' });
    const { GET } = await import('./+server');
    const res = await GET({ locals: makeLocals() } as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.notes).toHaveLength(2);
    expect(body.notes[0].id).toBe('n2'); // pinned first
  });

  it('401s when unauthenticated', async () => {
    const { GET } = await import('./+server');
    let status = 0;
    try {
      await GET({ locals: makeLocals(false) } as Parameters<typeof GET>[0]);
    } catch (e) {
      status = (e as { status?: number }).status ?? 0;
    }
    expect(status).toBe(401);
  });
});

describe('POST /api/notes', () => {
  it('creates a todo and returns 201', async () => {
    const { db } = createMockDb();
    mockGetNotesCtx.mockResolvedValue({ db, tenantId: 'org-1', userId: 'user-1' });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: new Request('http://x/api/notes', {
        method: 'POST',
        body: JSON.stringify({ kind: 'todo', title: 'Groceries' }),
      }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.note).toMatchObject({ kind: 'todo', title: 'Groceries' });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

describe('PUT /api/notes/[id]', () => {
  it('updates an owned note', async () => {
    const { db, resolve } = createMockDb();
    resolve([ROW()]);
    mockGetNotesCtx.mockResolvedValue({ db, tenantId: 'org-1', userId: 'user-1' });
    const { PUT } = await import('./[id]/+server');
    const res = await PUT({
      locals: makeLocals(),
      params: { id: 'n1' },
      request: new Request('http://x/api/notes/n1', {
        method: 'PUT',
        body: JSON.stringify({ pinned: true }),
      }),
    } as Parameters<typeof PUT>[0]);
    const body = await res.json();
    expect(body.note.pinned).toBe(true);
  });

  it('404s for a missing/foreign note', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    mockGetNotesCtx.mockResolvedValue({ db, tenantId: 'org-1', userId: 'user-1' });
    const { PUT } = await import('./[id]/+server');
    let status = 0;
    try {
      await PUT({
        locals: makeLocals(),
        params: { id: 'nope' },
        request: new Request('http://x', { method: 'PUT', body: '{}' }),
      } as Parameters<typeof PUT>[0]);
    } catch (e) {
      status = (e as { status?: number }).status ?? 0;
    }
    expect(status).toBe(404);
  });
});

describe('DELETE /api/notes/[id]', () => {
  it('deletes an owned note', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'n1' }]);
    mockGetNotesCtx.mockResolvedValue({ db, tenantId: 'org-1', userId: 'user-1' });
    const { DELETE } = await import('./[id]/+server');
    const res = await DELETE({
      locals: makeLocals(),
      params: { id: 'n1' },
    } as Parameters<typeof DELETE>[0]);
    expect((await res.json()).ok).toBe(true);
  });
});
