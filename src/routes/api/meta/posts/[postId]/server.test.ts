import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapIgMediaDetail, mapFbAttachments } from './+server';

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

const igMediaDetailMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const fbPostAttachmentsMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const fbPostFullPictureMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('$server/services/meta/graph-read', () => ({
  igMediaDetail: (...args: unknown[]) => igMediaDetailMock(...args),
  fbPostAttachments: (...args: unknown[]) => fbPostAttachmentsMock(...args),
  fbPostFullPicture: (...args: unknown[]) => fbPostFullPictureMock(...args),
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

describe('mapIgMediaDetail', () => {
  it('maps a carousel to one item per child', () => {
    const items = mapIgMediaDetail({
      media_type: 'CAROUSEL_ALBUM',
      children: {
        data: [
          { media_type: 'IMAGE', media_url: 'a.jpg' },
          { media_type: 'VIDEO', media_url: 'b.mp4', thumbnail_url: 'b-thumb.jpg' },
        ],
      },
    });
    expect(items).toEqual([
      { type: 'image', url: 'a.jpg' },
      { type: 'video', url: 'b.mp4', poster: 'b-thumb.jpg' },
    ]);
  });

  it('maps a single VIDEO with its poster thumbnail', () => {
    expect(mapIgMediaDetail({ media_type: 'VIDEO', media_url: 'v.mp4', thumbnail_url: 't.jpg' })).toEqual([
      { type: 'video', url: 'v.mp4', poster: 't.jpg' },
    ]);
  });

  it('maps a single IMAGE', () => {
    expect(mapIgMediaDetail({ media_type: 'IMAGE', media_url: 'i.jpg' })).toEqual([{ type: 'image', url: 'i.jpg' }]);
  });

  it('returns empty for a media node with no usable url', () => {
    expect(mapIgMediaDetail({ media_type: 'IMAGE' })).toEqual([]);
  });
});

describe('mapFbAttachments', () => {
  it('maps a single photo attachment', () => {
    const items = mapFbAttachments({ attachments: { data: [{ media_type: 'photo', media: { image: { src: 'p.jpg' } } }] } });
    expect(items).toEqual([{ type: 'image', url: 'p.jpg' }]);
  });

  it('maps a video attachment with its poster image', () => {
    const items = mapFbAttachments({
      attachments: { data: [{ media_type: 'video', media: { source: 'v.mp4', image: { src: 'poster.jpg' } } }] },
    });
    expect(items).toEqual([{ type: 'video', url: 'v.mp4', poster: 'poster.jpg' }]);
  });

  it('expands an album into one item per subattachment', () => {
    const items = mapFbAttachments({
      attachments: {
        data: [
          {
            media_type: 'album',
            subattachments: {
              data: [
                { media_type: 'photo', media: { image: { src: 'a.jpg' } } },
                { media_type: 'photo', media: { image: { src: 'b.jpg' } } },
              ],
            },
          },
        ],
      },
    });
    expect(items).toEqual([
      { type: 'image', url: 'a.jpg' },
      { type: 'image', url: 'b.jpg' },
    ]);
  });

  it('returns empty for no attachments', () => {
    expect(mapFbAttachments({})).toEqual([]);
  });
});

describe('GET /api/meta/posts/[postId]', () => {
  it('returns empty items when the post has no resolvable token (missing/unsynced)', async () => {
    mockRow = null;
    const res = await call('post-1');
    expect(await res.json()).toEqual({ items: [] });
  });

  it('resolves IG media via the connection token and returns mapped items', async () => {
    mockRow = { platform: 'ig', page_token_ciphertext: null, page_token_iv: null, conn_token_ciphertext: 'ig-cipher', conn_token_iv: 'iv' };
    igMediaDetailMock.mockResolvedValue({ ok: true, data: { media_type: 'IMAGE', media_url: 'fresh.jpg' } });
    const res = await call('ig-post-1');
    expect(await res.json()).toEqual({ items: [{ type: 'image', url: 'fresh.jpg' }] });
    expect(igMediaDetailMock).toHaveBeenCalledWith('ig-post-1', 'ig-cipher');
  });

  it('FB: falls back to full_picture when the attachments edge is denied', async () => {
    mockRow = { platform: 'fb', page_token_ciphertext: 'fb-cipher', page_token_iv: 'iv', conn_token_ciphertext: null, conn_token_iv: null };
    fbPostAttachmentsMock.mockResolvedValue({ ok: false, status: 400, error: 'denied' });
    fbPostFullPictureMock.mockResolvedValue({ ok: true, data: { full_picture: 'https://cdn/full.jpg' } });
    const res = await call('123_456');
    expect(await res.json()).toEqual({ items: [{ type: 'image', url: 'https://cdn/full.jpg' }] });
  });

  it('degrades to empty items when the graph call throws', async () => {
    mockRow = { platform: 'ig', page_token_ciphertext: null, page_token_iv: null, conn_token_ciphertext: 'ig-cipher', conn_token_iv: 'iv' };
    igMediaDetailMock.mockRejectedValue(new Error('boom'));
    const res = await call('ig-post-1');
    expect(await res.json()).toEqual({ items: [] });
  });
});
