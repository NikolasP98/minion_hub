import { describe, it, expect, vi, beforeEach } from 'vitest';

// Real class so the route's `instanceof SsrfBlockedError` matches.
class SsrfBlockedError extends Error {}
const assertSafeUrl = vi.fn<(u: string, c?: string) => Promise<void>>();
vi.mock('$server/services/ssrf-guard', () => ({
  assertSafeUrl: (u: string, c?: string) => assertSafeUrl(u, c),
  SsrfBlockedError,
}));

const uploadFile = vi.fn<() => Promise<string>>();
vi.mock('$server/services/file.service', () => ({
  uploadFile: () => uploadFile(),
}));

vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
}));

function makeLocals(): App.Locals {
  return { user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' } } as App.Locals;
}

function call(url: unknown) {
  return import('./+server').then(({ POST }) =>
    POST({
      locals: makeLocals(),
      request: new Request('http://x/api/notes/fetch-image', {
        method: 'POST',
        body: JSON.stringify({ url }),
      }),
    } as Parameters<typeof POST>[0]),
  );
}

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  assertSafeUrl.mockResolvedValue(undefined);
  uploadFile.mockResolvedValue('file-123');
});

describe('POST /api/notes/fetch-image', () => {
  it('re-hosts a valid image and returns its fileId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '4' },
        }),
      ),
    );
    const res = await call('https://example.com/cat.png');
    expect(await res.json()).toEqual({ fileId: 'file-123', w: 0, h: 0 });
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it('rejects an SSRF-blocked host with 400', async () => {
    assertSafeUrl.mockRejectedValue(new SsrfBlockedError('blocked'));
    vi.stubGlobal('fetch', vi.fn());
    expect(await statusOf(call('http://169.254.169.254/'))).toBe(400);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a non-image content-type with 415', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
    );
    expect(await statusOf(call('https://example.com/page'))).toBe(415);
  });

  it('rejects an oversize image (declared) with 413', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'content-length': String(20 * 1024 * 1024) },
        }),
      ),
    );
    expect(await statusOf(call('https://example.com/huge.jpg'))).toBe(413);
  });

  it('400s when url is missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await statusOf(call(undefined))).toBe(400);
  });
});
