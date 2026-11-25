import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertMessagesDetailed = vi.fn();
const applyRoutingPatches = vi.fn();
const advanceBrainCorpusJobNow = vi.fn();
const waitUntil = vi.fn();
const handleInboundForReminders = vi.fn();

vi.mock('$server/services/messages.service', () => ({
  insertMessagesDetailed,
  applyRoutingPatches,
}));
vi.mock('$server/services/brain-corpus-jobs.service', () => ({ advanceBrainCorpusJobNow }));
vi.mock('@vercel/functions', () => ({ waitUntil }));
const CTX = { db: {}, tenantId: 'org-1' };
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: async () => CTX }));
vi.mock('$server/services/reminder-reply-trigger.service', () => ({ handleInboundForReminders }));

const { POST } = await import('./+server');

beforeEach(() => {
  vi.clearAllMocks();
  insertMessagesDetailed.mockResolvedValue({
    accepted: 1,
    acceptedClientIds: ['client-1'],
    brainJobId: 'brain-job-1',
  });
  applyRoutingPatches.mockResolvedValue(undefined);
  advanceBrainCorpusJobNow.mockResolvedValue(undefined);
  handleInboundForReminders.mockResolvedValue(undefined);
  delete process.env.VERCEL;
});

describe('POST /api/messages/ingest', () => {
  it('returns exact row and patch client acknowledgements', async () => {
    const rows = [{ clientId: 'client-1' }];
    const patches = [{ clientId: 'patch-1', agentId: 'agent-1', sessionKey: 'session-1' }];
    const response = (await POST!({
      locals: {
        tenantCtx: { tenantId: 'org-1' },
        serverId: 'gateway-1',
      },
      request: new Request('http://localhost/api/messages/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows, patches }),
      }),
    } as never)) as Response;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      accepted: 1,
      acceptedClientIds: ['client-1'],
      patched: 1,
      patchedClientIds: ['patch-1'],
    });
    expect(insertMessagesDetailed).toHaveBeenCalledWith('org-1', 'gateway-1', rows);
    expect(applyRoutingPatches).toHaveBeenCalledWith('org-1', patches);
    expect(advanceBrainCorpusJobNow).not.toHaveBeenCalled();
  });

  it('rejects a session-only caller (tenantCtx without serverId) with 401', async () => {
    await expect(
      POST!({
        locals: { tenantCtx: { tenantId: 'org-1' } },
        request: new Request('http://localhost/api/messages/ingest', {
          method: 'POST',
          body: JSON.stringify({ rows: [{ clientId: 'c' }], patches: [{ clientId: 'p' }] }),
        }),
      } as never),
    ).rejects.toMatchObject({ status: 401 });
    expect(insertMessagesDetailed).not.toHaveBeenCalled();
    expect(applyRoutingPatches).not.toHaveBeenCalled();
  });

  it('starts queued brain work through Vercel waitUntil without awaiting it', async () => {
    process.env.VERCEL = '1';
    const response = (await POST!({
      locals: { tenantCtx: { tenantId: 'org-1' }, serverId: 'gateway-1' },
      request: new Request('http://localhost/api/messages/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: [{ clientId: 'client-1' }] }),
      }),
    } as never)) as Response;

    expect(response.status).toBe(200);
    expect(advanceBrainCorpusJobNow).toHaveBeenCalledWith('brain-job-1');
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  describe('reply-driven reminder scan (spec 139)', () => {
    const inbound = (over: Record<string, unknown> = {}) => ({
      clientId: 'client-1',
      direction: 'inbound',
      channel: 'whatsapp',
      isGroup: false,
      senderId: '51999000111@s.whatsapp.net',
      ...over,
    });
    const post = (rows: unknown[]) =>
      POST!({
        locals: { tenantCtx: { tenantId: 'org-1' }, serverId: 'gateway-1' },
        request: new Request('http://localhost/api/messages/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rows }),
        }),
      } as never) as Promise<Response>;
    beforeEach(() => {
      process.env.VERCEL = '1';
      insertMessagesDetailed.mockResolvedValue({
        accepted: 1,
        acceptedClientIds: ['client-1'],
        brainJobId: null,
      });
    });

    it('hands an accepted one-to-one inbound WhatsApp sender to the reply scan once, via waitUntil', async () => {
      const response = await post([inbound()]);
      expect(response.status).toBe(200);
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await waitUntil.mock.calls[0]![0];
      expect(handleInboundForReminders).toHaveBeenCalledTimes(1);
      expect(handleInboundForReminders).toHaveBeenCalledWith(CTX, ['51999000111@s.whatsapp.net']);
    });

    it('triggers nothing for outbound, group, other-channel, unaccepted or sender-less rows', async () => {
      await post([
        inbound({ direction: 'outbound' }),
        inbound({ isGroup: true }),
        inbound({ channel: 'telegram' }),
        inbound({ clientId: 'not-accepted' }),
        inbound({ senderId: null }),
      ]);
      expect(handleInboundForReminders).not.toHaveBeenCalled();
      expect(waitUntil).not.toHaveBeenCalled();
    });

    it('does not fail the ingest response when the scan rejects or throws', async () => {
      handleInboundForReminders.mockRejectedValueOnce(new Error('scan boom'));
      const failed = await post([inbound()]);
      expect(failed.status).toBe(200);
      await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined(); // caught inside
      handleInboundForReminders.mockImplementationOnce(() => {
        throw new Error('sync boom');
      });
      const threw = await post([inbound()]);
      expect(threw.status).toBe(200);
      expect(await threw.json()).toMatchObject({ ok: true, accepted: 1 });
    });

    it('stays off outside Vercel (the reminders tick is the fallback)', async () => {
      delete process.env.VERCEL;
      await post([inbound()]);
      expect(handleInboundForReminders).not.toHaveBeenCalled();
    });
  });
});
