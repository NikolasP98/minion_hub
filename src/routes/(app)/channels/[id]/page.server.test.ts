import { describe, expect, it, vi } from 'vitest';

const control = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('$lib/server/plugin-control-center', () => ({ loadPluginControlCenter: control }));

import { load } from './+page.server';

const run = (entitlements?: { plan: string; features: string[] }) =>
  load({
    params: { id: 'whatsapp' },
    url: new URL('https://hub.test/channels/whatsapp'),
    locals: { entitlements },
  } as never);

describe('/channels/[id] and the plan (spec 043, R8)', () => {
  it('404s without ai: the control center needs the shared gateway token', async () => {
    await expect(run({ plan: 'base', features: [] })).rejects.toMatchObject({ status: 404 });
    expect(control).not.toHaveBeenCalled();
  });
  it('loads with ai, and when the guard did not resolve entitlements (unchanged)', async () => {
    await expect(run({ plan: 'premium', features: ['ai'] })).resolves.toEqual({ ok: true });
    await expect(run(undefined)).resolves.toEqual({ ok: true });
  });
});
