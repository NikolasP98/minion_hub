import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import * as transport from '@minion-stack/workforce-client';

const fixtures = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  mint: vi.fn(async () => 'minted-jwt'),
}));
vi.mock('$env/dynamic/private', () => ({ env: fixtures.env }));
vi.mock('./workforce-identity', () => ({ mintWorkforceIdentity: fixtures.mint }));

vi.mock('$server/config/urls', () => ({
  hubBaseUrl: () => 'https://hub.example.test:8443/base',
}));

import {
  trustedWorkforceMutationHeaders,
  workforceServerClient,
  workforceRawFetch,
  workforceClientForOrg,
} from './workforce-fetch';

const candidate = process.env.MINION_QC_WORKFORCE_MODE === 'candidate';
function event(signal?: AbortSignal, token = 'jwt-secret'): RequestEvent {
  return {
    request: new Request('https://hub.example.test/workforce', { signal }),
    locals: { workforceIdentity: { token } },
  } as unknown as RequestEvent;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(() => {
  for (const key of Object.keys(fixtures.env)) delete fixtures.env[key];
  fixtures.env.WORKFORCE_INTERNAL_URL = 'http://workforce.test';
  fixtures.mint.mockReset().mockResolvedValue('minted-jwt');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected synthetic fetch');
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('trustedWorkforceMutationHeaders', () => {
  it('derives the mutation boundary from canonical server config', () => {
    expect(trustedWorkforceMutationHeaders()).toEqual({
      origin: 'https://hub.example.test:8443',
      referer: 'https://hub.example.test:8443/',
      'x-forwarded-host': 'hub.example.test:8443',
      'x-forwarded-proto': 'https',
    });
  });
});

describe(`Workforce helper ${candidate ? 'candidate' : 'installed'} transport`, () => {
  it.each(['jwt-secret', 'pcli_board-secret'])(
    'preserves auth for %s and invokes dynamic namespace request',
    async (token) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{"ok":true}'));
      vi.stubGlobal('fetch', fetch);
      const client = workforceServerClient(event(undefined, token));
      const spy = vi.spyOn(client, 'request');
      await expect(client.health.get()).resolves.toEqual({ ok: true });
      expect(spy).toHaveBeenCalledOnce();
      const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(headers.get(token.startsWith('pcli_') ? 'authorization' : 'x-hub-identity')).toBe(
        token.startsWith('pcli_') ? `Bearer ${token}` : token,
      );
    },
  );

  it.each(['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'])(
    'raw adapter restores actual %s and RequestInit fields',
    async (method) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('42'));
      vi.stubGlobal('fetch', fetch);
      await expect(
        workforceRawFetch(event(), '/api/custom?q=a%2Bb&q=c', {
          method,
          redirect: 'manual',
          credentials: 'omit',
          cache: 'no-store',
        }),
      ).resolves.toBe(42);
      expect(fetch).toHaveBeenCalledOnce();
      expect(String(fetch.mock.calls[0]?.[0])).toBe('http://workforce.test/api/custom?q=a%2Bb&q=c');
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({
        method,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
      });
      expect(fetch.mock.calls[0]?.[1]?.body).toBeUndefined();
    },
  );

  it.each([' { "n":9007199254740993, "x":1, "x":2 } ', '', null, undefined])(
    'preserves raw body %j without parse or serialization',
    async (body) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
      vi.stubGlobal('fetch', fetch);
      await workforceRawFetch(event(), '/api/custom', { method: 'POST', body });
      expect(fetch.mock.calls[0]?.[1]?.body).toBe(body);
    },
  );

  it.each(['record', 'tuples', 'Headers'])(
    'normalizes %s headers with deliberate caller precedence',
    async (kind) => {
      const values = {
        'X-HUB-IDENTITY': 'trusted-override',
        'Content-Type': 'application/custom+json',
        ...trustedWorkforceMutationHeaders(),
      };
      const headers: HeadersInit =
        kind === 'record'
          ? values
          : kind === 'tuples'
            ? Object.entries(values)
            : new Headers(values);
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
      vi.stubGlobal('fetch', fetch);
      await workforceRawFetch(event(), '/api/custom', { method: 'POST', body: '{}', headers });
      const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
      expect(sent.get('x-hub-identity')).toBe('trusted-override');
      expect(sent.get('content-type')).toBe('application/custom+json');
      expect(sent.get('origin')).toBe('https://hub.example.test:8443');
      expect(sent.get('x-forwarded-host')).toBe('hub.example.test:8443');
    },
  );

  it.each([400, 404, 409, 500, 503])(
    'retains actual completed HTTP %i while dropping body/cause',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof globalThis.fetch>(
          async () => new Response('{"secret":"BODY-CANARY"}', { status }),
        ),
      );
      for (const run of [
        () => workforceRawFetch(event(), '/secret-path'),
        () => workforceServerClient(event()).health.get(),
      ]) {
        const error = await run().catch((cause: unknown) => cause);
        expect(error).toMatchObject({ name: 'WorkforceHttpError', code: 'http_error', status });
        expect(error).not.toHaveProperty('body');
        expect(error).not.toHaveProperty('cause');
        expect(String(error)).not.toContain('secret-path');
        expect(JSON.stringify(error)).not.toContain('BODY-CANARY');
      }
    },
  );

  it('does not trust forged native error codes/status and never copies their cause', async () => {
    const forged = Object.assign(new Error('NATIVE-CANARY', { cause: 'CAUSE-CANARY' }), {
      name: 'WorkforceRequestError',
      code: 'deadline_exceeded',
      status: 404,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw forged;
      }),
    );
    const error = await workforceServerClient(event())
      .health.get()
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ code: 'transport_error', status: 502 });
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain('CANARY');
  });

  it('sanitizes setup and mint failures, preserving mint authority and fallback precedence', async () => {
    fixtures.mint.mockRejectedValueOnce(new Error('MINT-CANARY'));
    await expect(
      workforceClientForOrg('org', { id: 'actor', name: 'Name', email: 'actor@test' }),
    ).rejects.toMatchObject({ code: 'transport_error', status: 502 });
    expect(fixtures.mint).toHaveBeenCalledWith({
      userId: 'actor',
      name: 'Name',
      email: 'actor@test',
      companyId: 'org',
      roleKeys: [],
    });
    fixtures.env.HUB_PAPERCLIP_BOARD_KEY = ' pcli_compat ';
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await (await workforceClientForOrg('org')).health.get();
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer pcli_compat',
    );
    expect(fixtures.mint).toHaveBeenCalledOnce();
    expect(() => workforceServerClient({ locals: {} } as RequestEvent)).toThrow(
      'workforce transport_error',
    );
  });

  it('keeps simultaneous raw request payloads isolated', async () => {
    const first = deferred<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>((input: RequestInfo | URL) =>
      String(input).endsWith('/a') ? first.promise : Promise.resolve(new Response('2')),
    );
    vi.stubGlobal('fetch', fetch);
    const a = workforceRawFetch(event(), '/a', { method: 'POST', body: '1' });
    const b = workforceRawFetch(event(), '/b', { method: 'PUT', body: '2' });
    await expect(b).resolves.toBe(2);
    first.resolve(new Response('1'));
    await expect(a).resolves.toBe(1);
    expect(fetch.mock.calls.map((call) => call[1]?.body)).toEqual(['1', '2']);
  });

  if (candidate) {
    it('selected bounded candidate exports its real policy constructor', () => {
      expect(Reflect.get(transport, 'WorkforceRequestError')).toBeTypeOf('function');
    });
    it.each(['event', 'init'])(
      'raw %s cancellation retains OR authority and no invented status',
      async (which) => {
        const parent = new AbortController(),
          child = new AbortController();
        const pending = deferred<Response>();
        const fetch = vi.fn<typeof globalThis.fetch>(() => pending.promise);
        vi.stubGlobal('fetch', fetch);
        const outcome = workforceRawFetch(event(parent.signal), '/x', {
          signal: child.signal,
        }).catch((error: unknown) => error);
        await flush();
        (which === 'event' ? parent : child).abort('REASON-CANARY');
        const error = await outcome;
        expect(error).toMatchObject({ code: 'request_aborted' });
        expect(error).not.toHaveProperty('status');
        expect(JSON.stringify(error)).not.toContain('CANARY');
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        pending.resolve(new Response('{}'));
        await flush();
      },
    );
    it('typed domain call uses event cancellation before fetch', async () => {
      const owner = new AbortController();
      owner.abort();
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(workforceServerClient(event(owner.signal)).health.get()).rejects.toMatchObject({
        code: 'request_aborted',
      });
      expect(fetch).not.toHaveBeenCalled();
    });
    it('maps a total deadline to504 and releases a stalled native body', async () => {
      vi.useFakeTimers();
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel });
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof globalThis.fetch>(async () => new Response(body)),
      );
      const outcome = workforceServerClient(event())
        .health.get()
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await outcome).toMatchObject({ code: 'deadline_exceeded', status: 504 });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
    it('maps oversize and malformed successful JSON to safe502; empty204 resolves null', async () => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('x'.repeat(4 * 1024 * 1024 + 1)))
        .mockResolvedValueOnce(new Response('<html>BODY-CANARY</html>'))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetch);
      await expect(workforceRawFetch(event(), '/x')).rejects.toMatchObject({
        code: 'response_too_large',
        status: 502,
      });
      await expect(workforceServerClient(event()).health.get()).rejects.toMatchObject({
        code: 'invalid_json',
        status: 502,
        upstreamStatus: 200,
      });
      await expect(workforceRawFetch(event(), '/x')).resolves.toBeNull();
    });
  } else {
    it('installed raw adapter retains the original init.signal despite lacking candidate signal composition', async () => {
      const owner = new AbortController();
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
      vi.stubGlobal('fetch', fetch);
      await workforceRawFetch(event(), '/x', { signal: owner.signal });
      expect(fetch.mock.calls[0]?.[1]?.signal).toBe(owner.signal);
    });
    it('installed negative control: parent abort is not transported by the old package', async () => {
      expect(Reflect.get(transport, 'WorkforceRequestError')).toBeUndefined();
      const owner = new AbortController();
      owner.abort();
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
      vi.stubGlobal('fetch', fetch);
      await expect(workforceServerClient(event(owner.signal)).health.get()).resolves.toEqual({});
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]?.[1]?.signal).toBeUndefined();
    });
    it('installed negative control: package lacks the candidate response-byte cap', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response('"' + 'x'.repeat(4 * 1024 * 1024) + '"'),
      );
      vi.stubGlobal('fetch', fetch);
      const result = await workforceServerClient(event()).request<string>({
        method: 'GET',
        path: '/',
      });
      expect(result.length).toBe(4 * 1024 * 1024);
    });
  }
});
