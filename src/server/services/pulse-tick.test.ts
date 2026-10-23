import { describe, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({
  env: { CRON_SECRET: 'disposable-cron-secret' },
  pool: vi.fn(() => {
    throw new Error('Disabled tick must not open a database');
  }),
}));
vi.mock('$env/dynamic/private', () => ({ env: boundary.env }));
vi.mock('$server/db/pg-pool', () => ({
  getPgClient: boundary.pool,
  getRlsPgClient: boundary.pool,
  getCriticalPgClient: boundary.pool,
  resetAllPgPools: vi.fn(),
}));
import { GET } from '../../routes/api/pulse/tick/+server';
import { isCronAuthPath } from '$lib/server/cron-auth-path';
import { readPulseWorkerConfig } from './pulse-worker-config';
function event(token?: string, query = '') {
  const url = new URL('http://hub.invalid/api/pulse/tick' + query);
  return {
    url,
    request: new Request(url, { headers: token ? { authorization: token } : {} }),
  } as Parameters<typeof GET>[0];
}
describe('trusted Pulse tick admission', () => {
  it('is on the existing cron auth path, rejects unauthenticated and caller-scoped requests', async () => {
    expect(isCronAuthPath('/api/pulse/tick')).toBe(true);
    await expect(GET(event())).rejects.toMatchObject({ status: 401 });
    await expect(GET(event('Bearer wrong'))).rejects.toMatchObject({ status: 401 });
    await expect(
      GET(event('Bearer disposable-cron-secret', '?org=caller-chosen')),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('defaults to disabled without opening storage or installing a schedule', async () => {
    delete process.env.MINION_PULSE_WORKER_CONFIG;
    const result = await GET(event('Bearer disposable-cron-secret'));
    expect(await result.json()).toEqual({ advanced: 0, skipped: 'disabled' });
    expect(boundary.pool).not.toHaveBeenCalled();
    for (const raw of ['{}', '{"enabled":true,"commit":"short"}', 'invalid-json']) {
      process.env.MINION_PULSE_WORKER_CONFIG = raw;
      expect(readPulseWorkerConfig()).toBeNull();
    }
    delete process.env.MINION_PULSE_WORKER_CONFIG;
  });
});
