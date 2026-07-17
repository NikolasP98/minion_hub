import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapIgComments, mapFbComments } from './comment-mapping';

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));
vi.mock('$server/services/rbac.service', () => ({
  requireOrgCapability: () => Promise.resolve(null),
}));
vi.mock('$server/auth/crypto', () => ({
  decrypt: (ciphertext: string) => ciphertext,
}));

let mockRow: Record<string, unknown> | null = null;
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({ execute: () => Promise.resolve(mockRow ? [mockRow] : []) }),
}));

const igMediaCommentsMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const fbPostCommentsMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('$server/services/meta/graph-read', () => ({
  igMediaComments: (...args: unknown[]) => igMediaCommentsMock(...args),
  fbPostComments: (...args: unknown[]) => fbPostCommentsMock(...args),
}));

function makeLocals(): App.Locals {
  return { user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' } } as App.Locals;
}

async function call(postId: string) {
  const { GET } = await import('./+server');
  return GET({ locals: makeLocals(), params: { postId } } as unknown as Parameters<typeof GET>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRow = null;
});

describe('mapIgComments', () => {
  it('maps text/username/timestamp/like_count and one level of replies', () => {
    const items = mapIgComments([
      {
        id: 'c1',
        text: 'Nice post!',
        username: 'alice',
        timestamp: '2026-07-01T00:00:00+0000',
        like_count: 3,
        replies: { data: [{ id: 'r1', text: 'Thanks', username: 'bob', timestamp: '2026-07-01T01:00:00+0000', like_count: 0 }] },
      },
    ]);
    expect(items).toEqual([
      {
        id: 'c1',
        username: 'alice',
        text: 'Nice post!',
        timestamp: '2026-07-01T00:00:00+0000',
        likeCount: 3,
        replies: [{ id: 'r1', username: 'bob', text: 'Thanks', timestamp: '2026-07-01T01:00:00+0000', likeCount: 0, replies: [] }],
      },
    ]);
  });

  it('defaults missing fields (no username/text/replies)', () => {
    expect(mapIgComments([{ id: 'c1' }])).toEqual([{ id: 'c1', username: '', text: '', timestamp: null, likeCount: 0, replies: [] }]);
  });

  it('prefers from.username (third-party commenter) over the empty top-level username', () => {
    const items = mapIgComments([{ id: 'c1', text: 'Info', from: { id: '42', username: 'lau_baldeon' } }]);
    expect(items[0].username).toBe('lau_baldeon');
  });
});

describe('mapFbComments', () => {
  it('maps from.name→username, message→text, created_time→timestamp, no replies', () => {
    const items = mapFbComments([{ id: 'c1', message: 'Great!', from: { name: 'Carol' }, created_time: '2026-07-01T00:00:00+0000', like_count: 2 }]);
    expect(items).toEqual([{ id: 'c1', username: 'Carol', text: 'Great!', timestamp: '2026-07-01T00:00:00+0000', likeCount: 2, replies: [] }]);
  });

  it('defaults missing from/message', () => {
    expect(mapFbComments([{ id: 'c1' }])).toEqual([{ id: 'c1', username: '', text: '', timestamp: null, likeCount: 0, replies: [] }]);
  });
});

describe('GET /api/meta/posts/[postId]/comments', () => {
  it('returns unavailable when the post has no resolvable token', async () => {
    mockRow = null;
    const res = await call('post-1');
    expect(await res.json()).toEqual({ available: false, comments: [] });
  });

  it('IG: returns available:true with mapped comments', async () => {
    mockRow = { platform: 'ig', page_token_ciphertext: null, page_token_iv: null, conn_token_ciphertext: 'ig-cipher', conn_token_iv: 'iv' };
    igMediaCommentsMock.mockResolvedValue({ ok: true, data: [{ id: 'c1', text: 'hi', username: 'a', like_count: 0 }] });
    const res = await call('ig-post-1');
    expect(await res.json()).toEqual({ available: true, comments: [{ id: 'c1', username: 'a', text: 'hi', timestamp: null, likeCount: 0, replies: [] }] });
    expect(igMediaCommentsMock).toHaveBeenCalledWith('ig-post-1', 'ig-cipher');
  });

  it('IG: zero comments still reports available:true', async () => {
    mockRow = { platform: 'ig', page_token_ciphertext: null, page_token_iv: null, conn_token_ciphertext: 'ig-cipher', conn_token_iv: 'iv' };
    igMediaCommentsMock.mockResolvedValue({ ok: true, data: [] });
    const res = await call('ig-post-1');
    expect(await res.json()).toEqual({ available: true, comments: [] });
  });

  it('FB: permission denial degrades to available:false', async () => {
    mockRow = { platform: 'fb', page_token_ciphertext: 'fb-cipher', page_token_iv: 'iv', conn_token_ciphertext: null, conn_token_iv: null };
    fbPostCommentsMock.mockResolvedValue({ ok: false, status: 400, error: 'denied' });
    const res = await call('123_456');
    expect(await res.json()).toEqual({ available: false, comments: [] });
  });

  it('FB: success maps comments', async () => {
    mockRow = { platform: 'fb', page_token_ciphertext: 'fb-cipher', page_token_iv: 'iv', conn_token_ciphertext: null, conn_token_iv: null };
    fbPostCommentsMock.mockResolvedValue({ ok: true, data: [{ id: 'c1', message: 'hey', from: { name: 'Dan' }, like_count: 1 }] });
    const res = await call('123_456');
    expect(await res.json()).toEqual({ available: true, comments: [{ id: 'c1', username: 'Dan', text: 'hey', timestamp: null, likeCount: 1, replies: [] }] });
  });

  it('degrades to unavailable when the graph call throws', async () => {
    mockRow = { platform: 'ig', page_token_ciphertext: null, page_token_iv: null, conn_token_ciphertext: 'ig-cipher', conn_token_iv: 'iv' };
    igMediaCommentsMock.mockRejectedValue(new Error('boom'));
    const res = await call('ig-post-1');
    expect(await res.json()).toEqual({ available: false, comments: [] });
  });
});
