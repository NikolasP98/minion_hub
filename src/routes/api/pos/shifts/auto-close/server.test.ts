import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'sekret' } }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
const list = vi.fn(async () => ['org-a', 'org-b']);
const close = vi.fn(async () => ({ closed: 1, failed: 0 }));
vi.mock('$server/services/pos-auto-close.service', () => ({
  listAutoShiftOrgs: () => list(),
  autoCloseOrgShifts: (...a: unknown[]) => close(...(a as [])),
}));

import { GET } from './+server';

const call = (auth?: string) =>
  GET!({
    request: new Request('http://localhost/api/pos/shifts/auto-close', {
      headers: auth ? { authorization: auth } : {},
    }),
  } as never);

describe('GET /api/pos/shifts/auto-close', () => {
  it('refuses without the cron secret', async () => {
    await expect(call()).rejects.toMatchObject({ status: 401 });
    await expect(call('Bearer nope')).rejects.toMatchObject({ status: 401 });
    expect(list).not.toHaveBeenCalled();
  });

  it('closes every automatic org and sums the result', async () => {
    const res = (await call('Bearer sekret')) as Response;
    expect(await res.json()).toEqual({ ok: true, orgs: 2, closed: 2, failed: 0 });
    expect(close).toHaveBeenCalledTimes(2);
  });
});
