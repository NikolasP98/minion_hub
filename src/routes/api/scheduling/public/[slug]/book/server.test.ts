import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  publicBook: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('$server/services/scheduling-public.service', () => ({
  publicBook: mocks.publicBook,
}));

vi.mock('$server/auth/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST } from './+server';

const VALID_BODY = {
  eventTypeId: 'et-1',
  start: '2026-01-01T10:00:00.000Z',
  name: 'Jane Doe',
};

function makeEvent(opts: { slug?: string; body?: unknown; ip?: string }) {
  const url = new URL('https://hub.test/api/scheduling/public/faces-sculptors/book');
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts.body ?? VALID_BODY),
  });
  return {
    params: { slug: opts.slug ?? 'faces-sculptors' },
    request,
    getClientAddress: () => opts.ip ?? '203.0.113.1',
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/scheduling/public/[slug]/book', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue(true);
    mocks.publicBook.mockResolvedValue({ uid: 'bk-1', status: 'confirmed' });
  });

  it('429s with a readable message when rate-limited, before touching publicBook', async () => {
    mocks.checkRateLimit.mockReturnValueOnce(false);
    await expect(POST(makeEvent({}))).rejects.toMatchObject({
      status: 429,
      body: { message: expect.stringMatching(/too many/i) },
    });
    expect(mocks.publicBook).not.toHaveBeenCalled();
  });

  it('keys the limiter on IP + slug, not IP alone', async () => {
    await POST(makeEvent({ slug: 'link-a', ip: '203.0.113.1' }));
    expect(mocks.checkRateLimit).toHaveBeenCalledWith('public-book:203.0.113.1:link-a', 10);
  });

  it('happy path calls through to publicBook once under the limit', async () => {
    const res = await POST(makeEvent({}));
    const body = await res.json();
    expect(body).toEqual({ ok: true, uid: 'bk-1', status: 'confirmed' });
  });
});
