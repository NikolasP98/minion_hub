import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/workforce-fetch', () => ({
  baseUrl: () => 'http://workforce.test',
  authHeaders: () => ({ 'x-hub-identity': 'signed-token' }),
}));

import { PATCH } from './+server';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workforce proxy pipeline gate mutation', () => {
  it('forwards the typed terminal decision body without rewriting it to generic Done', async () => {
    const upstreamFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'done' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', upstreamFetch);
    const payload = {
      status: 'done',
      pipelineOutcome: 'failed',
      pipelineSummary: 'Regression coverage is incomplete.',
      evalScore: 6,
    };
    const url = new URL('http://hub.test/api/workforce/issues/child-1');

    const response = await PATCH({
      request: new Request(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      params: { path: 'issues/child-1' },
      locals: { workforceIdentity: { token: 'token' } },
      url,
    } as never);

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [target, init] = upstreamFetch.mock.calls[0];
    expect(target).toBe('http://workforce.test/api/issues/child-1');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['x-hub-identity']).toBe('signed-token');
    expect(JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer))).toEqual(payload);
  });
});
