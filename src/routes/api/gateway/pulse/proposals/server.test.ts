import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Db } from '$server/db/client';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  coreDb: {} as CoreCtx['db'],
  tenantDb: {} as Db,
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => mocks.coreDb }));
vi.mock('$server/services/pulse.service', () => ({ upsertProposals: mocks.upsert }));

import { POST } from './+server';

const validCard = {
  source: 'daily_briefing',
  kind: 'digest',
  title: 'Today',
  dedupKey: 'daily:1',
};

function req(body: unknown) {
  return new Request('http://fixture.test/api/gateway/pulse/proposals', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function event(locals: Partial<App.Locals>, body: unknown) {
  return { locals, request: req(body) } as Parameters<typeof POST>[0];
}

async function response(locals: Partial<App.Locals>, body: unknown): Promise<Response> {
  return (await POST(event(locals, body))) as Response;
}

describe('POST /api/gateway/pulse/proposals', () => {
  beforeEach(() => {
    mocks.upsert.mockReset().mockResolvedValue({ inserted: 1, skipped: 0 });
  });

  it.each([
    {},
    { serverId: 'server-a' },
    { tenantCtx: { tenantId: 'org-a', db: mocks.tenantDb } },
    { serverId: ' ', tenantCtx: { tenantId: 'org-a', db: mocks.tenantDb } },
  ])('requires a complete nonempty machine identity', async (locals) => {
    const result = await response(locals as Partial<App.Locals>, { proposals: [validCard] });
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toEqual({ ok: false, error: 'machine_identity_required' });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects a legacy tenant mismatch before validating its proposal batch', async () => {
    const result = await response(
      { serverId: 'server-a', tenantCtx: { tenantId: 'org-a', db: mocks.tenantDb } },
      { orgId: 'org-b', proposals: [{ title: 'partial' }] },
    );
    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toEqual({ ok: false, error: 'tenant_mismatch' });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each([{ proposals: [validCard] }, { orgId: 'org-a', proposals: [validCard] }])(
    'writes only under the credential tenant for new and same-org legacy bodies',
    async (body) => {
      const result = await response(
        { serverId: 'server-a', tenantCtx: { tenantId: 'org-a', db: mocks.tenantDb } },
        body,
      );
      expect(result.status).toBe(201);
      await expect(result.json()).resolves.toEqual({ ok: true, inserted: 1, skipped: 0 });
      expect(mocks.upsert).toHaveBeenCalledWith({ db: mocks.coreDb, tenantId: 'org-a' }, [
        validCard,
      ]);
    },
  );

  it('rejects a mixed valid/invalid batch without calling storage', async () => {
    const result = await response(
      { serverId: 'server-a', tenantCtx: { tenantId: 'org-a', db: mocks.tenantDb } },
      { proposals: [validCard, { ...validCard, dedupKey: '' }] },
    );
    expect(result.status).toBe(400);
    await expect(result.json()).resolves.toEqual({ ok: false, error: 'invalid_proposals' });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('returns a bounded storage error without exposing the driver error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.upsert.mockRejectedValueOnce(new Error('secret database detail'));
    const result = await response(
      { serverId: 'server-a', tenantCtx: { tenantId: 'org-a', db: mocks.tenantDb } },
      { proposals: [validCard] },
    );
    expect(result.status).toBe(500);
    expect(JSON.stringify(await result.json())).not.toContain('secret');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    log.mockRestore();
  });
});
