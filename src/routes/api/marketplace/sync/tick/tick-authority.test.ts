import { SYSTEM_AUTOMATIONS } from '$lib/automations/system-automations';
import { readFileSync } from 'node:fs';
import { isCronAuthPath } from '$lib/server/cron-auth-path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { RequestHandler } from '@sveltejs/kit';
const boundary = vi.hoisted(() => ({
  env: { CRON_SECRET: 'synthetic-cron-secret' } as Record<string, string>,
  db: vi.fn(),
  sync: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: boundary.env }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: boundary.db }));
vi.mock('$server/services/marketplace.service', () => ({ syncMarketplaceAgents: boundary.sync }));
import { GET } from './+server';
const event = (authorization?: string) =>
  ({
    request: new Request('http://fixture.invalid/api/marketplace/sync/tick', {
      headers: authorization ? { authorization } : {},
    }),
    locals: { user: { id: 'fixture', role: 'admin' } },
  }) as unknown as Parameters<RequestHandler>[0];
beforeEach(() => {
  vi.clearAllMocks();
  boundary.env.CRON_SECRET = 'synthetic-cron-secret';
  boundary.db.mockReturnValue({});
  boundary.sync.mockResolvedValue({
    synced: 0,
    failed: 0,
    errors: [],
    status: 'not_due',
    continuation: false,
  });
});
it.each([
  undefined,
  'Bearer wrong-secret',
  'Bearer synthetic-cron-secret-extra',
  'bearer synthetic-cron-secret',
])('rejects cron request without the exact secret (%s) before database work', async (header) => {
  await expect(GET(event(header))).rejects.toMatchObject({ status: 401 });
  expect(boundary.db).not.toHaveBeenCalled();
  expect(boundary.sync).not.toHaveBeenCalled();
});
it('does not allow a configured administrator session when CRON_SECRET is missing', async () => {
  delete boundary.env.CRON_SECRET;
  await expect(GET(event('Bearer '))).rejects.toMatchObject({ status: 401 });
  expect(boundary.db).not.toHaveBeenCalled();
});
it('advances only due scheduler work and exposes an explicit no-op response', async () => {
  const response = await GET(event('Bearer synthetic-cron-secret'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'not_due' });
  expect(boundary.sync).toHaveBeenCalledWith({}, false);
});

it('schedules the exact handler behind the hook cron-auth dispatch', () => {
  const manifest = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const scheduled = manifest.crons.filter((row) => row.path.startsWith('/api/marketplace/'));
  expect(scheduled).toEqual([{ path: '/api/marketplace/sync/tick', schedule: '* * * * *' }]);
  expect(isCronAuthPath(scheduled[0].path)).toBe(true);
  expect(SYSTEM_AUTOMATIONS.filter((row) => row.path.startsWith('/api/marketplace/'))).toEqual([
    {
      path: '/api/marketplace/sync/tick',
      key: 'marketplace_sync',
      cadence: 'minute',
      wiring: 'vercel',
    },
  ]);
  expect(isCronAuthPath('/api/marketplace/sync')).toBe(false);
  expect(isCronAuthPath('/api/marketplace/sync/tick/extra')).toBe(false);
});
