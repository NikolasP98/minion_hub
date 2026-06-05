/**
 * Vitest stub for SvelteKit's `$app/server` (remote functions runtime).
 *
 * The real `$app/server` is only provided by the SvelteKit Vite plugin, which
 * isn't active under vitest. State modules now transitively import
 * `$lib/remote/*.remote.ts`, which import `query`/`command`/etc. from here at
 * module-load time. This stub lets those modules LOAD; the returned remote
 * resources throw if a test actually invokes them (mock via `vi.mock` instead).
 *
 * Mirrors the `$env/*` stub approach (see vitest.config.ts alias block).
 */
type AnyFn = (...args: unknown[]) => unknown;

interface RemoteResource {
  (...args: unknown[]): never;
  refresh(): Promise<void>;
  set(value: unknown): void;
  reconnect(): void;
  withOverride(fn: AnyFn): RemoteResource;
}

function makeRemote(): RemoteResource {
  const fn = ((..._args: unknown[]): never => {
    throw new Error('remote function invoked in a test — mock it via vi.mock()');
  }) as RemoteResource;
  fn.refresh = () => Promise.resolve();
  fn.set = () => {};
  fn.reconnect = () => {};
  fn.withOverride = () => fn;
  return fn;
}

export const query = Object.assign((..._args: unknown[]) => makeRemote(), {
  batch: (..._args: unknown[]) => makeRemote(),
  live: (..._args: unknown[]) => makeRemote(),
});

export const command = (..._args: unknown[]) => makeRemote();
export const form = (..._args: unknown[]) => makeRemote();
export const prerender = (..._args: unknown[]) => makeRemote();

export function getRequestEvent() {
  return {
    locals: {},
    url: new URL('http://localhost/'),
    request: new Request('http://localhost/'),
  };
}
