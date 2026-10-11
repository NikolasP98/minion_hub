import type { RequestHandler } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  env: { CRON_SECRET: 'synthetic-cron-secret' } as Record<string, string>,
  upsertRelease: vi.fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: boundary.env }));
vi.mock('$server/services/releases/releases.service', () => ({
  upsertRelease: boundary.upsertRelease,
}));

const { POST } = await import('./+server');

const DRAFT = {
  version: 'hub-v2026.10.11',
  releasedAt: '2026-10-11T00:00:00.000Z',
  sections: { Nuevo: { pos: ['did a thing'] } },
  prs: [{ number: 1, title: 'feat(pos): did a thing (#1)', url: 'https://x.invalid/pull/1' }],
};

function event(body: unknown, authorization: string | null = 'Bearer synthetic-cron-secret') {
  return {
    request: new Request('http://fixture.invalid/api/releases', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  } as unknown as Parameters<RequestHandler>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.env.CRON_SECRET = 'synthetic-cron-secret';
  delete boundary.env.RELEASES_SECRET;
});

describe('POST /api/releases', () => {
  it.each([null, 'Bearer wrong-secret', 'bearer synthetic-cron-secret'])(
    'rejects without the exact cron secret (%s)',
    async (authorization) => {
      await expect(POST!(event(DRAFT, authorization))).rejects.toMatchObject({ status: 401 });
      expect(boundary.upsertRelease).not.toHaveBeenCalled();
    },
  );

  it('prefers RELEASES_SECRET when set and no longer accepts the cron secret', async () => {
    boundary.env.RELEASES_SECRET = 'synthetic-releases-secret';
    boundary.upsertRelease.mockResolvedValue({ releaseId: 'rel-1', notificationId: 'notif-1' });
    await expect(POST!(event(DRAFT))).rejects.toMatchObject({ status: 401 });
    const res = await POST!(event(DRAFT, 'Bearer synthetic-releases-secret'));
    expect(res.status).toBe(200);
  });

  it('rejects a body missing version or releasedAt', async () => {
    await expect(POST!(event({ version: 'hub-v2026.10.11' }))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('upserts the release and returns its id + the single notification id', async () => {
    boundary.upsertRelease.mockResolvedValue({ releaseId: 'rel-1', notificationId: 'notif-1' });
    const res = await POST!(event(DRAFT));
    expect(await res.json()).toEqual({ releaseId: 'rel-1', notificationId: 'notif-1' });
    expect(boundary.upsertRelease).toHaveBeenCalledWith(DRAFT);
  });

  it('is idempotent: posting the same version twice resolves to the same notification id', async () => {
    boundary.upsertRelease.mockResolvedValue({ releaseId: 'rel-1', notificationId: 'notif-1' });
    const first = await POST!(event(DRAFT));
    const second = await POST!(event(DRAFT));
    expect(await first.json()).toEqual(await second.json());
    expect(boundary.upsertRelease).toHaveBeenCalledTimes(2);
  });
});
