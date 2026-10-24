import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => ({
  get browser() {
    return env.browser;
  },
}));

import { resolveAliasPath, setInstanceMap } from './alias-reroute';
import type { NavConfig } from './custom-sections';

const config: NavConfig = {
  version: 1,
  sections: [
    {
      id: 'sec001',
      slug: 'staff',
      label: 'Staff',
      pages: [{ id: 'k3x9q2', slug: 'till', label: 'Till', kind: 'link', target: '/pos/sell' }],
    },
  ],
  builtinSections: {},
  builtin: {},
} as unknown as NavConfig;

const reply = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  env.browser = true;
  setInstanceMap(undefined);
});

describe('resolveAliasPath', () => {
  it.each(['/pos/sell', '/staff', '/staff/sell', '/favicon.ico', '/', '/x/y.png'])(
    '%s is never consulted',
    async (p) => {
      const f = reply(200);
      expect(await resolveAliasPath(p, f as never)).toBeUndefined();
      expect(f).not.toHaveBeenCalled();
    },
  );

  it('serves a seeded instance without a fetch', async () => {
    setInstanceMap(config);
    const f = reply(200);
    expect(await resolveAliasPath('/staff/till~k3x9q2/t/1', f as never)).toBe('/pos/sell/t/1');
    expect(f).not.toHaveBeenCalled();
  });

  it('cold: one fetch, then the cached id (stale slug too)', async () => {
    const f = reply(200, { prefix: '/staff/sell~k3x9q2', target: '/pos/sell', id: 'k3x9q2' });
    expect(await resolveAliasPath('/staff/sell~k3x9q2/t/1', f as never)).toBe('/pos/sell/t/1');
    expect(f).toHaveBeenCalledExactlyOnceWith(
      '/api/nav/resolve?path=%2Fstaff%2Fsell~k3x9q2%2Ft%2F1',
    );
    expect(await resolveAliasPath('/staff/sell~k3x9q2/other', f as never)).toBe('/pos/sell/other');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('404 and thrown errors are undefined; a 404 is cached as a miss', async () => {
    const f = reply(404);
    expect(await resolveAliasPath('/staff/a~zzzzzz', f as never)).toBeUndefined();
    expect(await resolveAliasPath('/staff/a~zzzzzz', f as never)).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
    const boom = vi.fn(async () => {
      throw new Error('net');
    });
    expect(await resolveAliasPath('/staff/a~yyyyyy', boom as never)).toBeUndefined();
  });

  it('the server always fetches', async () => {
    env.browser = false;
    const f = reply(200, { target: '/pos/sell' });
    await resolveAliasPath('/staff/s~k3x9q2', f as never);
    await resolveAliasPath('/staff/s~k3x9q2', f as never);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('setInstanceMap(undefined) clears', async () => {
    setInstanceMap(config);
    setInstanceMap(undefined);
    const f = reply(404);
    expect(await resolveAliasPath('/staff/till~k3x9q2', f as never)).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
