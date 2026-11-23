import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolveGatewayId: vi.fn(), gatewayBelongsToOrg: vi.fn() }));
vi.mock('$server/services/gateway.pg.service', () => mocks);

import { serverScope } from './server-scope';

function ctx(rows: Array<{ tenantId: string }>) {
  return {
    tenantId: 'org-a',
    db: { select: () => ({ from: () => ({ where: () => Promise.resolve(rows) }) }) },
  } as never;
}

describe('serverScope', () => {
  beforeEach(() => {
    mocks.resolveGatewayId.mockReset().mockResolvedValue(null);
    mocks.gatewayBelongsToOrg.mockReset();
  });

  test('legacy row in the same tenant is own, another tenant foreign, missing none', async () => {
    expect(await serverScope(ctx([{ tenantId: 'org-a' }]), 's')).toBe('own');
    expect(await serverScope(ctx([{ tenantId: 'org-b' }]), 's')).toBe('foreign');
    expect(await serverScope(ctx([]), 's')).toBe('none');
  });

  test('a bridged gateway is decided by the gateway registry, not the legacy row', async () => {
    mocks.resolveGatewayId.mockResolvedValue('gw-1');
    mocks.gatewayBelongsToOrg.mockResolvedValue(false);
    expect(await serverScope(ctx([{ tenantId: 'org-a' }]), 's')).toBe('foreign');
    mocks.gatewayBelongsToOrg.mockResolvedValue(true);
    expect(await serverScope(ctx([]), 's')).toBe('own');
  });

  test('a gateway token may only act on its own server', async () => {
    expect(await serverScope(ctx([{ tenantId: 'org-a' }]), 's', 'other')).toBe('foreign');
    expect(await serverScope(ctx([{ tenantId: 'org-a' }]), 's', 's')).toBe('own');
  });
});
