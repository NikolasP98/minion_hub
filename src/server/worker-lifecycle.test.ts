import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
vi.mock('$server/services/bg-runtime', () => ({ quiesceJobs: vi.fn(), drainJobs: vi.fn() }));
vi.mock('$server/db/pg-pool', () => ({ closePgPools: vi.fn() }));
vi.mock('$lib/server/cache', () => ({ closeCache: vi.fn() }));
import { installWorkerLifecycle } from './worker-lifecycle';

it('quiesces immediately but closes resources once only after HTTP and callbacks drain', async () => {
  const events = new EventEmitter();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const resources = {
    quiesce: vi.fn(),
    drain: vi.fn(() => pending),
    closeCache: vi.fn(async () => {
      order.push('cache');
    }),
    closePools: vi.fn(async () => {
      order.push('pools');
    }),
    failed: vi.fn(),
  };
  installWorkerLifecycle(events, resources);
  events.emit('SIGTERM');
  expect(resources.quiesce).toHaveBeenCalledOnce();
  expect(resources.drain).not.toHaveBeenCalled();
  events.emit('sveltekit:shutdown');
  events.emit('sveltekit:shutdown');
  await Promise.resolve();
  expect(order).toEqual([]);
  release();
  await vi.waitFor(() => expect(order).toEqual(['cache', 'pools']));
  expect(resources.drain).toHaveBeenCalledOnce();
  expect(resources.failed).not.toHaveBeenCalled();
});

it('reports drain failure without closing pools or terminating the process', async () => {
  const events = new EventEmitter();
  const resources = {
    quiesce: vi.fn(),
    drain: vi.fn().mockRejectedValue(new Error('fixture failure')),
    closeCache: vi.fn(),
    closePools: vi.fn(),
    failed: vi.fn(),
  };
  const exit = vi.spyOn(process, 'exit');
  installWorkerLifecycle(events, resources);
  events.emit('sveltekit:shutdown');
  await vi.waitFor(() => expect(resources.failed).toHaveBeenCalledOnce());
  expect(resources.closeCache).not.toHaveBeenCalled();
  expect(resources.closePools).not.toHaveBeenCalled();
  expect(exit).not.toHaveBeenCalled();
  exit.mockRestore();
});
