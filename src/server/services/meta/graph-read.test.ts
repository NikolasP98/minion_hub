import { describe, it, expect, vi } from 'vitest';
import {
  exchangeCodeForToken,
  extendUserToken,
  listPagesWithTokens,
  listAdAccounts,
  listPagePosts,
  postInsights,
  listIgMedia,
  igMediaInsights,
  adInsights,
  listConversations,
  fetchNextPage,
} from './graph-read';

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

function mockFetch(response: Response | ((url: string) => Response)) {
  const fn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    typeof response === 'function' ? response(String(input)) : response,
  );
  return fn as unknown as typeof fetch & { mock: typeof fn.mock };
}

describe('exchangeCodeForToken', () => {
  it('returns the token on success', async () => {
    const fetchImpl = mockFetch(jsonResponse({ access_token: 'short-lived', token_type: 'bearer', expires_in: 3600 }));
    const res = await exchangeCodeForToken(
      { appId: 'app1', appSecret: 'secret1', code: 'code1', redirectUri: 'https://hub/cb' },
      { fetchImpl },
    );
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.data?.access_token).toBe('short-lived');
    const calledUrl = (fetchImpl.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toContain('/v23.0/oauth/access_token');
    expect(calledUrl).toContain('client_secret=secret1');
  });
});

describe('extendUserToken', () => {
  it('exchanges a short token for a long-lived one', async () => {
    const fetchImpl = mockFetch(jsonResponse({ access_token: 'long-lived', expires_in: 5_184_000 }));
    const res = await extendUserToken({ appId: 'app1', appSecret: 'secret1', shortToken: 'short' }, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data?.access_token).toBe('long-lived');
    const calledUrl = (fetchImpl.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toContain('grant_type=fb_exchange_token');
    expect(calledUrl).toContain('fb_exchange_token=short');
  });
});

describe('appsecret_proof', () => {
  it('appends HMAC-SHA256(access_token, appSecret) when appSecret is set', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [] }));
    await listPagesWithTokens('the-user-token', { fetchImpl, appSecret: 'the-app-secret' });
    const url = new URL((fetchImpl.mock.calls[0]?.[0] as string) ?? '');
    // Precomputed: crypto.createHmac('sha256','the-app-secret').update('the-user-token').digest('hex')
    const { createHmac } = await import('node:crypto');
    const expected = createHmac('sha256', 'the-app-secret').update('the-user-token').digest('hex');
    expect(url.searchParams.get('appsecret_proof')).toBe(expected);
  });

  it('omits appsecret_proof when appSecret is not provided', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [] }));
    await listPagesWithTokens('tok', { fetchImpl });
    const url = new URL((fetchImpl.mock.calls[0]?.[0] as string) ?? '');
    expect(url.searchParams.get('appsecret_proof')).toBeNull();
  });
});

describe('listPagesWithTokens', () => {
  it('returns pages and surfaces the next cursor', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({
        data: [{ id: 'page1', name: 'FACES', access_token: 'ptok', instagram_business_account: { id: 'ig1' } }],
        paging: { next: 'https://graph.facebook.com/v23.0/me/accounts?after=xyz&access_token=utok' },
      }),
    );
    const res = await listPagesWithTokens('utok', { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.data?.[0]?.id).toBe('page1');
    expect(res.nextCursor).toContain('after=xyz');
  });

  it('classifies an expired-token error (code 190) as token_expired', async () => {
    const fetchImpl = mockFetch(
      jsonResponse(
        { error: { message: 'Error validating access token', code: 190, error_subcode: 463 } },
        { ok: false, status: 401 },
      ),
    );
    const res = await listPagesWithTokens('stale-token', { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('token_expired');
    expect(res.status).toBe(401);
  });

  it('tolerates a non-JSON error response body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: false,
          status: 500,
          headers: { get: () => null },
          json: async () => {
            throw new SyntaxError('not json');
          },
        }) as unknown as Response,
    );
    const res = await listPagesWithTokens('utok', { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(res.error).toBe('graph request failed');
  });

  it('never surfaces the access token in an error message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down while fetching https://graph.facebook.com/v23.0/me/accounts?access_token=SECRET');
    });
    const res = await listPagesWithTokens('SECRET', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('SECRET');
  });
});

describe('listAdAccounts', () => {
  it('returns the ad account list', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [{ id: 'act_1', name: 'FACES Ads', currency: 'USD' }] }));
    const res = await listAdAccounts('utok', { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.currency).toBe('USD');
  });
});

describe('listPagePosts', () => {
  it('returns posts with pagination', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({
        data: [{ id: 'post1', message: 'hello', created_time: '2026-07-01T00:00:00+0000' }],
        paging: { next: 'https://graph.facebook.com/v23.0/page1/posts?after=abc' },
      }),
    );
    const res = await listPagePosts('page1', 'ptok', { since: '2026-01-01' }, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.id).toBe('post1');
    expect(res.nextCursor).toContain('after=abc');
  });
});

describe('postInsights', () => {
  it('returns the batched metrics on success', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ data: [{ name: 'post_impressions', values: [{ value: 42 }] }] }),
    );
    const res = await postInsights('post1', 'ptok', { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.name).toBe('post_impressions');
    expect(res.failedMetrics).toBeUndefined();
  });

  it('degrades per-metric when the batch rejects an unsupported metric (code 100)', async () => {
    const fetchImpl = mockFetch((url: string) => {
      const metric = new URL(url).searchParams.get('metric') ?? '';
      if (metric.includes(',')) {
        return jsonResponse({ error: { message: 'Unsupported get request', code: 100 } }, { ok: false, status: 400 });
      }
      if (metric === 'bad_metric') {
        return jsonResponse({ error: { message: 'Unsupported get request', code: 100 } }, { ok: false, status: 400 });
      }
      return jsonResponse({ data: [{ name: metric, values: [{ value: 1 }] }] });
    });
    const res = await postInsights('post1', 'ptok', { metrics: ['post_impressions', 'bad_metric'], fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data?.map((m) => m.name)).toEqual(['post_impressions']);
    expect(res.failedMetrics).toEqual(['bad_metric']);
  });

  it('fails when every metric fails individually too', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ error: { message: 'Unsupported get request', code: 100 } }, { ok: false, status: 400 }),
    );
    const res = await postInsights('post1', 'ptok', { metrics: ['a', 'b'], fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.failedMetrics).toEqual(['a', 'b']);
  });

  it('does not retry per-metric on a token error', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ error: { message: 'invalid token', code: 190 } }, { ok: false, status: 401 }),
    );
    const res = await postInsights('post1', 'ptok', { metrics: ['a', 'b'], fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('token_expired');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('listIgMedia', () => {
  it('returns media items', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [{ id: 'media1', media_type: 'IMAGE' }] }));
    const res = await listIgMedia('ig1', 'ptok', {}, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.media_type).toBe('IMAGE');
  });
});

describe('igMediaInsights', () => {
  it('uses the VIDEO metric set (includes views)', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [{ name: 'views', values: [{ value: 10 }] }] }));
    await igMediaInsights('media1', 'ptok', 'VIDEO', { fetchImpl });
    const calledUrl = (fetchImpl.mock.calls[0]?.[0] as string) ?? '';
    expect(decodeURIComponent(calledUrl)).toContain('views');
  });

  it('uses the IMAGE metric set (no views) by default for unknown types', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [] }));
    await igMediaInsights('media1', 'ptok', 'unknown_type', { fetchImpl });
    const calledUrl = decodeURIComponent((fetchImpl.mock.calls[0]?.[0] as string) ?? '');
    expect(calledUrl).not.toContain('views');
  });
});

describe('adInsights', () => {
  it('builds act_ prefixed URL with time_range and returns rows', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ data: [{ ad_id: 'ad1', spend: '12.34', campaign_name: 'Summer' }] }),
    );
    const res = await adInsights('123', 'utok', { since: '2026-06-01', until: '2026-06-30' }, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.ad_id).toBe('ad1');
    const calledUrl = decodeURIComponent((fetchImpl.mock.calls[0]?.[0] as string) ?? '');
    expect(calledUrl).toContain('/act_123/insights');
    expect(calledUrl).toContain('"since":"2026-06-01"');
  });

  it('does not double-prefix an already act_-prefixed id', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [] }));
    await adInsights('act_123', 'utok', { since: '2026-06-01', until: '2026-06-30' }, { fetchImpl });
    const calledUrl = (fetchImpl.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toContain('/act_123/insights');
    expect(calledUrl).not.toContain('act_act_123');
  });
});

describe('listConversations', () => {
  it('returns conversations for the given platform', async () => {
    const fetchImpl = mockFetch(
      jsonResponse({ data: [{ id: 'conv1', updated_time: '2026-07-01T00:00:00+0000' }] }),
    );
    const res = await listConversations('page1', 'ptok', { platform: 'instagram' }, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.id).toBe('conv1');
    const calledUrl = (fetchImpl.mock.calls[0]?.[0] as string) ?? '';
    expect(calledUrl).toContain('platform=instagram');
  });
});

describe('fetchNextPage', () => {
  it('resumes pagination from a raw paging.next URL', async () => {
    const fetchImpl = mockFetch(jsonResponse({ data: [{ id: 'page2' }] }));
    const res = await fetchNextPage('https://graph.facebook.com/v23.0/me/accounts?after=xyz', { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual([{ id: 'page2' }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/me/accounts?after=xyz',
      expect.anything(),
    );
  });
});

describe('timeout handling', () => {
  it('surfaces an abort as a network error, not a throw', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')));
      });
    });
    const res = await listAdAccounts('utok', { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1 });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(0);
  });
});
