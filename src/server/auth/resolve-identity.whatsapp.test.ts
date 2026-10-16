import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createMockDb } from '$server/test-utils/mock-db';
const mocks = vi.hoisted(() => ({ core: vi.fn(), legacy: vi.fn(), admission: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: mocks.core }));
vi.mock('$server/db/client', () => ({ getDb: mocks.legacy }));
vi.mock('$server/services/whatsapp-assistant.service', () => ({
  assertWhatsAppAdmission: mocks.admission,
}));
import { resolveCanonicalGatewayTokenAuth, resolveIdentity } from './resolve-identity';
const gateway = {
  id: 'gateway-1',
  legacyServerId: 'legacy-1',
  orgId: 'org-1',
  token: 'current-secret',
  tokenIv: null,
};
const id = '11111111-1111-4111-8111-111111111111';
const delegated = () =>
  `wa1.${id}.${createHmac('sha256', 'current-secret').update(`wa1:${id}`).digest('hex')}`;
function fixture(rows = [gateway]) {
  const db = createMockDb();
  db.resolve(rows);
  mocks.core.mockReturnValue(db.db);
  return db;
}
function event(path: string, token = delegated(), header?: string) {
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    'x-minion-server-id': gateway.id,
  });
  if (header !== undefined) headers.set('x-minion-whatsapp-admission', header);
  return {
    url: new URL(`https://hub.test${path}`),
    request: new Request('https://hub.test', { headers }),
  } as Parameters<typeof resolveIdentity>[0];
}
beforeEach(() => {
  vi.resetAllMocks();
  fixture();
  mocks.legacy.mockReturnValue({});
  mocks.admission.mockResolvedValue({
    principalId: 'profile-1',
    orgId: 'org-1',
    agentId: 'personal-1',
  });
});
describe('current canonical machine authority', () => {
  it('rejects rotated credentials immediately without legacy fallback', async () => {
    await expect(
      resolveCanonicalGatewayTokenAuth('Bearer current-secret', gateway.id),
    ).resolves.toEqual({ tenantId: 'org-1', serverId: gateway.id });
    fixture([{ ...gateway, token: 'rotated-secret' }]);
    await expect(
      resolveCanonicalGatewayTokenAuth('Bearer current-secret', gateway.id),
    ).resolves.toBeNull();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('rejects ambiguous gateways, missing hints, and registry outages', async () => {
    fixture([gateway, { ...gateway, id: 'another' }]);
    await expect(
      resolveCanonicalGatewayTokenAuth('Bearer current-secret', gateway.id),
    ).resolves.toBeNull();
    await expect(
      resolveCanonicalGatewayTokenAuth('Bearer current-secret', null),
    ).resolves.toBeNull();
    mocks.core.mockImplementation(() => {
      throw new Error('private-db');
    });
    await expect(
      resolveCanonicalGatewayTokenAuth('Bearer current-secret', gateway.id),
    ).rejects.toMatchObject({ status: 503, body: { message: 'Gateway authority unavailable' } });
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('does not downgrade a signed admission by omitting its header', async () => {
    const result = await resolveIdentity(event('/api/agent-memories/recall'));
    expect(result.locals.whatsappAdmissionId).toBe(id);
    expect(mocks.admission).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: gateway.id }),
      id,
    );
  });
  it('resolves a missing gateway hint only through the persisted signed admission', async () => {
    const db = fixture();
    Object.assign(db.db, { execute: vi.fn().mockResolvedValue([{ gateway_id: gateway.id }]) });
    const request = event('/api/gateway/query/finance');
    request.request.headers.delete('x-minion-server-id');
    const result = await resolveIdentity(request);
    expect(result.locals.serverId).toBe(gateway.id);
    expect(result.locals.whatsappAdmissionId).toBe(id);
    expect(mocks.admission).toHaveBeenCalledOnce();
  });
  it('rejects mismatched admission headers and modified signatures', async () => {
    await expect(
      resolveIdentity(
        event('/api/gateway/query/finance', delegated(), '22222222-2222-4222-8222-222222222222'),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      resolveIdentity(event('/api/gateway/query/finance', `wa1.${id}.${'0'.repeat(64)}`)),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('cannot use a delegated token for control-plane or unrelated endpoints', async () => {
    for (const path of [
      '/api/gateway/whatsapp/lease',
      '/api/internal/channels/resolved',
      '/api/users',
    ]) {
      await expect(resolveIdentity(event(path))).rejects.toMatchObject({ status: 403 });
    }
    expect(mocks.admission).not.toHaveBeenCalled();
  });
  it('denies revoked admissions on every request including memory reads', async () => {
    mocks.admission.mockRejectedValue({ status: 403 });
    await expect(resolveIdentity(event('/api/agent-memories/recall'))).rejects.toMatchObject({
      status: 403,
    });
  });
  it('rejects absent machine credentials even with an internal endpoint', async () => {
    await expect(
      resolveIdentity(event('/api/gateway/whatsapp/lease', 'old-secret')),
    ).rejects.toMatchObject({ status: 401 });
  });
});
