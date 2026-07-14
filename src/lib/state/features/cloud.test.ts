import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => ({
  listShells: vi.fn(),
  getQuota: vi.fn(),
}));

vi.mock('$lib/services/shells-rpc', () => rpc);

import { cloudState, refreshCloud, setCloudOrg } from './cloud.svelte';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function shell(shellId: string) {
  return { shellId, displayName: shellId } as never;
}

describe('cloud inventory refresh', () => {
  beforeEach(() => {
    rpc.listShells.mockReset();
    rpc.getQuota.mockReset();
  });

  it('shares an organization refresh and promotes a background poll to visible progress', async () => {
    const shells = deferred<never[]>();
    const quota = deferred<never>();
    rpc.listShells.mockReturnValueOnce(shells.promise);
    rpc.getQuota.mockReturnValueOnce(quota.promise);
    setCloudOrg('refresh-dedupe');

    const background = refreshCloud({ background: true });
    expect(cloudState.refreshing).toBe(false);
    const visible = refreshCloud();

    expect(visible).toBe(background);
    expect(cloudState.refreshing).toBe(true);
    expect(rpc.listShells).toHaveBeenCalledOnce();
    expect(rpc.getQuota).toHaveBeenCalledOnce();

    shells.resolve([shell('shell-dedupe')]);
    quota.resolve({} as never);
    await visible;

    expect(cloudState.shells[0]?.shellId).toBe('shell-dedupe');
    expect(cloudState.refreshing).toBe(false);
  });

  it('does not let a stale organization response overwrite the active organization', async () => {
    const oldShells = deferred<never[]>();
    const oldQuota = deferred<never>();
    const nextShells = deferred<never[]>();
    const nextQuota = deferred<never>();
    rpc.listShells.mockReturnValueOnce(oldShells.promise).mockReturnValueOnce(nextShells.promise);
    rpc.getQuota.mockReturnValueOnce(oldQuota.promise).mockReturnValueOnce(nextQuota.promise);

    setCloudOrg('stale-org');
    const stale = refreshCloud();
    setCloudOrg('active-org');
    const active = refreshCloud();

    nextShells.resolve([shell('active-shell')]);
    nextQuota.resolve({} as never);
    await active;
    oldShells.resolve([shell('stale-shell')]);
    oldQuota.resolve({} as never);
    await stale;

    expect(cloudState.shells.map((entry) => entry.shellId)).toEqual(['active-shell']);
    expect(cloudState.error).toBeNull();
  });
});
