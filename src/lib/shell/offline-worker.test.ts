import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

type WorkerEvent = {
  request?: { url: string; method: string; mode: string };
  respondWith?: (promise: Promise<Response>) => void;
  waitUntil?: (promise: Promise<unknown>) => void;
};
function worker(version: string, store = new Map<string, Map<string, Response>>()) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const key = (request: string | { url: string }) =>
    typeof request === 'string' ? request : new URL(request.url).pathname;
  const fetch = vi.fn(async () => new Response('network', { status: 200 }));
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      return {
        put: async (request: string | { url: string }, response: Response) => {
          store.get(name)!.set(key(request), response);
        },
        match: async (request: string | { url: string }) =>
          store.get(name)!.get(key(request))?.clone(),
      };
    },
  };
  const source = readFileSync(new URL('../../service-worker.ts', import.meta.url), 'utf8').replace(
    /import \{ build, version \} from '\$service-worker';/,
    `const version = ${JSON.stringify(version)}; const build = ['/_app/immutable/a.js','/_app/version.json','/api/me','/index.html'];`,
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  runInNewContext(js, {
    self: {
      location: { origin: 'https://hub.test' },
      addEventListener: (type: string, callback: (event: WorkerEvent) => void) =>
        listeners.set(type, callback),
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    },
    caches,
    fetch,
    URL,
    Response,
  });
  return {
    fetch,
    store,
    async lifecycle(type: 'install' | 'activate') {
      let task: Promise<unknown> | undefined;
      listeners.get(type)!({ waitUntil: (promise) => (task = promise) });
      await task;
    },
    async request(path: string, mode = 'cors', method = 'GET') {
      let response: Promise<Response> | undefined;
      listeners.get('fetch')!({
        request: { url: `https://hub.test${path}`, method, mode },
        respondWith: (promise) => (response = promise),
      });
      return response;
    },
  };
}

describe('actual offline service worker', () => {
  it('uses the network for every navigation and never stores authenticated HTML', async () => {
    const sw = worker('first');
    await sw.lifecycle('install');
    sw.fetch.mockResolvedValueOnce(new Response('private HTML'));
    expect(await (await sw.request('/crm?customer=private', 'navigate'))?.text()).toBe(
      'private HTML',
    );
    expect([...sw.store.values()][0].has('/crm')).toBe(false);
    sw.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await (await sw.request('/crm?customer=private', 'navigate'))?.text()).toBe('network');
  });
  it('never intercepts APIs, writes, version metadata, route data or unknown assets', async () => {
    const sw = worker('first');
    for (const path of [
      '/api/me',
      '/_app/version.json',
      '/crm/__data.json',
      '/logo.png',
      '/_app/immutable/a.js?x=1',
    ])
      expect(await sw.request(path)).toBeUndefined();
    expect(await sw.request('/_app/immutable/a.js', 'cors', 'POST')).toBeUndefined();
    expect(sw.fetch).not.toHaveBeenCalled();
  });
  it('caches only current immutable assets and retires its own old build on update', async () => {
    const first = worker('first');
    await first.lifecycle('install');
    await first.request('/_app/immutable/a.js');
    first.fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await (await first.request('/_app/immutable/a.js'))?.text()).toBe('network');
    first.store.set('another-app', new Map());
    const next = worker('next', first.store);
    await next.lifecycle('install');
    await next.lifecycle('activate');
    expect([...next.store.keys()]).toEqual(['another-app', 'minion-hub-offline-next']);
    next.fetch.mockResolvedValueOnce(new Response('new deployment'));
    expect(await (await next.request('/crm', 'navigate'))?.text()).toBe('new deployment');
  });
  it('does not replace a real authorization failure with the offline screen', async () => {
    const sw = worker('first');
    await sw.lifecycle('install');
    sw.fetch.mockResolvedValueOnce(new Response('Denied', { status: 403 }));
    expect((await sw.request('/private', 'navigate'))?.status).toBe(403);
  });
});
