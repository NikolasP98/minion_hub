import { describe, it, expect, vi, beforeEach } from 'vitest';

// ssrf-guard is NOT mocked: `fetchImageSafely` now lives there and calls
// `assertSafeUrl` internally (same module — a vi.mock override on
// assertSafeUrl would not reach that internal call). The real assertSafeUrl
// is deterministic and network-free for literal IP hosts (no DNS lookup), so
// tests below use a literal public IP instead of a hostname like
// example.com, keeping them offline-safe while exercising the real guard.
const uploadFile = vi.fn<() => Promise<string>>();
vi.mock('$server/services/file.service', () => ({
  uploadFile: () => uploadFile(),
}));

vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: () => Promise.resolve({ db: {}, tenantId: 'org-1' }),
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
    const res = await call('https://93.184.216.34/cat.png');
    expect(await res.json()).toEqual({ fileId: 'file-123', w: 0, h: 0 });
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it('rejects an SSRF-blocked host with 400', async () => {
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
    expect(await statusOf(call('https://93.184.216.34/page'))).toBe(415);
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
    expect(await statusOf(call('https://93.184.216.34/huge.jpg'))).toBe(413);
  });

  it('400s when url is missing', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await statusOf(call(undefined))).toBe(400);
  });
});
