import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationWorkerUnavailable } from '../worker-failure';
import { NotificationCoordinatorBusy, retryCoordinatorContention } from './contention';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

it('retries a settled lock rollback then returns the actual transaction receipt', async () => {
  const receipt = { generation: '8' };
  const operation = vi
    .fn()
    .mockRejectedValueOnce(new NotificationWorkerUnavailable('lock_timeout'))
    .mockResolvedValue(receipt);
  const pending = retryCoordinatorContention(operation);
  await vi.advanceTimersByTimeAsync(24);
  expect(operation).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(receipt);
  expect(operation).toHaveBeenCalledTimes(2);
});

it.each(['database_unavailable', 'statement_timeout'] as const)(
  'never retries %s or an ambiguous commit',
  async (reason) => {
    const error = new NotificationWorkerUnavailable(reason);
    const operation = vi.fn().mockRejectedValue(error);
    await expect(retryCoordinatorContention(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  },
);

it('caps persistent lock contention at sixteen settled attempts', async () => {
  const operation = vi.fn().mockRejectedValue(new NotificationWorkerUnavailable('lock_timeout'));
  const assertion = expect(retryCoordinatorContention(operation)).rejects.toBeInstanceOf(
    NotificationCoordinatorBusy,
  );
  await vi.runAllTimersAsync();
  await assertion;
  expect(operation).toHaveBeenCalledTimes(16);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not abandon a pending transaction when the retry admission budget expires', async () => {
  let resolve!: (value: boolean) => void;
  const operation = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  let settled = false;
  const pending = retryCoordinatorContention(operation).then((value) => {
    settled = true;
    return value;
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(settled).toBe(false);
  expect(operation).toHaveBeenCalledOnce();
  resolve(true);
  expect(await pending).toBe(true);
});

it('admits no new transaction after the monotonic retry deadline', async () => {
  const operation = vi.fn(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 2500));
    throw new NotificationWorkerUnavailable('lock_timeout');
  });
  const assertion = expect(retryCoordinatorContention(operation)).rejects.toBeInstanceOf(
    NotificationCoordinatorBusy,
  );
  await vi.runAllTimersAsync();
  await assertion;
  expect(operation).toHaveBeenCalledTimes(2);
});
