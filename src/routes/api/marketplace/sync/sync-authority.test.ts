import { beforeEach, expect, it, vi } from 'vitest';
import type { RequestHandler } from '@sveltejs/kit';
const calls = vi.hoisted(() => ({ db: vi.fn(), sync: vi.fn(), stale: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: calls.db }));
vi.mock('$server/services/marketplace.service', () => ({
  syncMarketplaceAgents: calls.sync,
  isCatalogStale: calls.stale,
}));
import { POST } from './+server';
import { load } from '../../../(app)/marketplace/+layout.server';

beforeEach(() => {
  vi.clearAllMocks();
  calls.db.mockReturnValue({ fixture: true });
  calls.sync.mockResolvedValue({ synced: 1, errors: [] });
  calls.stale.mockResolvedValue(true);
});
const event = (role?: string) =>
  ({
    locals: { user: role ? { id: 'synthetic', role } : null },
  }) as unknown as Parameters<RequestHandler>[0];
it('rejects an anonymous global sync before database or provider work', async () => {
  await expect(POST(event())).rejects.toMatchObject({ status: 401 });
  expect(calls.db).not.toHaveBeenCalled();
  expect(calls.sync).not.toHaveBeenCalled();
});
it('rejects an ordinary member even though the marketplace is readable', async () => {
  await expect(POST(event('user'))).rejects.toMatchObject({ status: 403 });
  expect(calls.db).not.toHaveBeenCalled();
  expect(calls.sync).not.toHaveBeenCalled();
});
it('allows the platform administrator to request global synchronization', async () => {
  const response = await POST(event('admin'));
  expect(response.status).toBe(200);
  expect(calls.sync).toHaveBeenCalledOnce();
});
it('does not start global synchronization from a catalog page read', async () => {
  await load(event('admin') as never);
  await Promise.resolve();
  await Promise.resolve();
  expect(calls.sync).not.toHaveBeenCalled();
});

it('returns safe retryable failure without including database/provider diagnostics', async () => {
  calls.sync.mockRejectedValue(new Error('private-driver-sentinel'));
  await expect(POST(event('admin'))).rejects.toMatchObject({ status: 503, body: { message: 'Marketplace synchronization is temporarily unavailable' } });
});
it('returns 409 and Retry-After when an administrator cannot claim the lease', async () => {
  calls.sync.mockResolvedValue({ synced: 0, failed: 0, errors: [], status: 'busy', continuation: true, retryAfterSeconds: 17 });
  const response = await POST(event('admin'));
  expect(response.status).toBe(409); expect(response.headers.get('retry-after')).toBe('17');
});
