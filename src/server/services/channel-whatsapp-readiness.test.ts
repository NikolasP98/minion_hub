import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerCtx } from '$server/auth/core-ctx';
const mocks = vi.hoisted(() => ({
  ready: vi.fn(),
  pg: vi.fn(),
  current: {
    type: 'whatsapp',
    enabled: false,
    replies: 'bound',
    assistantMode: 'internal' as string | null,
  },
  execute: vi.fn(),
  write: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('./whatsapp-readiness.service', () => ({ requireWhatsAppAccountReady: mocks.ready }));
vi.mock('$server/db/pg-pool', () => ({ getPgClient: () => mocks.pg }));
vi.mock('./org-config-sync.service', () => ({ reconcileOrgConfigSafe: mocks.reconcile }));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_ctx: unknown, callback: (tx: unknown) => unknown) =>
    callback({
      select: () => ({ from: () => ({ where: async () => [mocks.current] }) }),
      execute: mocks.execute,
      insert: () => ({ values: mocks.write }),
      update: () => ({ set: () => ({ where: mocks.write }) }),
    }),
}));
import { createChannel, updateChannel } from './channel.service';
const ctx = { tenantId: 'org', gatewayId: 'gateway', serverId: 'server', db: {} } as ServerCtx;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current = { type: 'whatsapp', enabled: false, replies: 'bound', assistantMode: 'internal' };
  mocks.pg.mockImplementation(async () => [
    { ...mocks.current, settings: { assistantMode: mocks.current.assistantMode } },
  ]);
  mocks.ready.mockResolvedValue(undefined);
  mocks.execute.mockResolvedValue([{ id: 'channel' }]);
});
describe('WhatsApp account runtime activation gate', () => {
  it('gates enabled-only and replies-only activation using effective current state', async () => {
    await updateChannel(ctx, 'channel', { enabled: true });
    expect(mocks.ready).toHaveBeenCalledWith({
      orgId: 'org',
      gatewayId: 'gateway',
      channelId: 'channel',
    });
    mocks.current.enabled = true;
    mocks.current.replies = 'none';
    await updateChannel(ctx, 'channel', { replies: 'bound' });
    expect(mocks.ready).toHaveBeenCalledTimes(2);
  });
  it('never writes activation when the runtime is unavailable', async () => {
    mocks.ready.mockRejectedValue(Error('unqualified'));
    await expect(updateChannel(ctx, 'channel', { enabled: true })).rejects.toThrow('unqualified');
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('allows disabling and legacy channels without runtime connectivity', async () => {
    mocks.ready.mockRejectedValue(Error('offline'));
    mocks.current.enabled = true;
    await updateChannel(ctx, 'channel', { enabled: false });
    await updateChannel(ctx, 'channel', { replies: 'none' });
    await updateChannel(ctx, 'channel', { assistantMode: 'off' });
    mocks.current.type = 'telegram';
    await updateChannel(ctx, 'channel', { enabled: true });
    expect(mocks.ready).not.toHaveBeenCalled();
  });
  it('rejects concurrent configuration changes after the preflight snapshot', async () => {
    mocks.pg.mockResolvedValue([
      { type: 'whatsapp', enabled: false, replies: 'bound', settings: { assistantMode: 'off' } },
    ]);
    await expect(updateChannel(ctx, 'channel', { enabled: true })).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('qualifies new enabled internal accounts but leaves off accounts available for setup', async () => {
    const input = {
      type: 'whatsapp' as const,
      label: 'team',
      assistantMode: 'internal' as const,
      providerAccountId: '19995550101',
      authRef: 'whatsapp/team',
      replies: 'bound' as const,
    };
    await createChannel(ctx, { ...input, enabled: false });
    expect(mocks.ready).not.toHaveBeenCalled();
    await createChannel(ctx, { ...input, enabled: true });
    expect(mocks.ready).toHaveBeenCalledWith({ orgId: 'org', gatewayId: 'gateway' });
  });
});
