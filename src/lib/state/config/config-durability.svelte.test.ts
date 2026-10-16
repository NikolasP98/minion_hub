import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('$lib/services/gateway-rpc', () => ({ sendRequest: mocks.send }));
vi.mock('$lib/state/features/user.svelte', () => ({ isAdmin: { value: true } }));
vi.mock('$lib/state/ui/toast.svelte', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
import { configState, loadConfig, save } from './config.svelte';
import { createSaveStatus } from '$lib/records/save-status.svelte';
beforeEach(() => {
  mocks.send.mockReset();
  configState.original = { name: 'old' };
  configState.current = { name: 'new' };
  configState.baseHash = 'hash-a';
  configState.lastSavedAt = null;
  configState.loadError = null;
});
describe('gateway autosave acknowledgement', () => {
  it('repairs only config reads after a committed patch and failed refresh', async () => {
    let fail = true;
    mocks.send.mockImplementation(async (method: string) => {
      if (method === 'config.patch') return {};
      if (method === 'config.get') {
        if (fail) throw new Error('offline');
        return { config: { name: 'new' }, hash: 'hash-b' };
      }
      return { schema: {}, uiHints: {} };
    });
    const status = createSaveStatus();
    await expect(status.run(() => save({ silent: true, isCurrent: () => true }))).rejects.toThrow(
      'offline',
    );
    expect(status.status).toBe('committed-refreshing');
    fail = false;
    await status.retry();
    expect(status.status).toBe('saved');
    expect(mocks.send.mock.calls.filter(([method]) => method === 'config.patch')).toHaveLength(1);
    expect(configState.baseHash).toBe('hash-b');
  });
  it('does not refresh or adopt a patch response after its owner changes', async () => {
    let finish!: () => void;
    let current = true;
    mocks.send.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = save({ silent: true, isCurrent: () => current });
    current = false;
    finish();
    await expect(pending).rejects.toThrow('Editing context changed');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(configState.lastSavedAt).toBeNull();
    expect(configState.saving).toBe(false);
  });
  it('keeps the busy flag for a newer save when an older one settles first', async () => {
    const finishers: Array<() => void> = [];
    mocks.send.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishers.push(resolve);
        }),
    );
    let firstCurrent = true;
    const first = save({ silent: true, isCurrent: () => firstCurrent });
    configState.current = { name: 'newer' };
    const second = save({ silent: true, isCurrent: () => true });
    firstCurrent = false;
    finishers[0]();
    await expect(first).rejects.toThrow('Editing context changed');
    expect(configState.saving).toBe(true);
    mocks.send.mockResolvedValue({
      config: { name: 'newer' },
      hash: 'hash-c',
      schema: {},
      uiHints: {},
    });
    finishers[1]();
    await second;
    expect(configState.saving).toBe(false);
  });
  it('clears the loading flag when a read owner retires before its response', async () => {
    const finishers: Array<() => void> = [];
    mocks.send.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishers.push(resolve);
        }),
    );
    let current = true;
    const pending = loadConfig(() => current);
    expect(configState.loading).toBe(true);
    current = false;
    for (const finish of finishers) finish();
    await pending;
    expect(configState.loading).toBe(false);
  });
});
