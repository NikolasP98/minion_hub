import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ close: vi.fn(), lookup: vi.fn(), create: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: { CACHE_BACKEND: 'noop', NODE_ENV: 'production' } }));
vi.mock('$server/services/gateway.pg.service', () => ({
  getSystemGatewayCredentials: state.lookup,
}));
vi.mock('$lib/server/performance-context', () => ({ recordCacheEvent: vi.fn() }));
vi.mock('$lib/server/cache-backend-instrumentation', () => ({
  instrumentCacheBackend: (value: unknown) => value,
}));
vi.mock('@minion-stack/cache', () => ({
  configureCache: vi.fn(),
  createBackend: state.create,
  createBackendAsync: state.create,
  HttpBroadcaster: class {},
  NoopBroadcaster: class {},
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.create.mockReturnValue({ close: state.close });
  state.close.mockResolvedValue(undefined);
});
it('does not initialize an unused cache during shutdown', async () => {
  const { closeCache } = await import('./cache');
  await closeCache();
  expect(state.create).not.toHaveBeenCalled();
});
it('waits for boot discovery before gracefully closing the backend', async () => {
  let finish!: () => void;
  state.lookup.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const cache = await import('./cache');
  const boot = cache.initCache();
  await vi.waitFor(() => expect(state.lookup).toHaveBeenCalledOnce());
  const closing = cache.closeCache();
  await Promise.resolve();
  expect(state.close).not.toHaveBeenCalled();
  finish();
  await Promise.all([boot, closing]);
  expect(state.close).toHaveBeenCalledExactlyOnceWith();
});
