import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayClient } from '@minion-stack/shared';
import { createPendingSubmissions } from './pending-submission';
import { sendAssistantTurn, abortChat } from '$lib/services/gateway/chat-rpc';
import { agentChat, ensureAgentChat } from '$lib/state/chat/chat.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
import { getClient, sendRequest } from '$lib/services/gateway-rpc';
vi.mock('$lib/services/gateway-rpc', () => ({
  getClient: vi.fn(() => ({
    beginRequest: (...args: Parameters<typeof sendRequest>) => sendRequest(...args),
  })),
  sendRequest: vi.fn(() => new Promise(() => {})),
  gwTrace: vi.fn(),
}));
const scope = { actorId: 'actor', orgId: 'org', agentId: 'agent', sessionKey: 'agent:agent:main' };
beforeEach(() => {
  vi.useFakeTimers();
  conn.connected = true;
  const chat = ensureAgentChat('agent');
  chat.sending = false;
  chat.runId = null;
  chat.sessionKey = scope.sessionKey;
  chat.messages.splice(0);
  vi.mocked(getClient).mockReturnValue({
    beginRequest: (...args: Parameters<typeof sendRequest>) => sendRequest(...args),
  } as unknown as ReturnType<typeof getClient>);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe('pending submission transport integration', () => {
  it.each(['cancel', 'scope', 'context'] as const)(
    'fences deferred preparation on %s',
    async (change) => {
      const manager = createPendingSubmissions();
      manager.setScope(scope);
      const turn = manager.begin(1, 1);
      let release!: () => void;
      const wait = new Promise<void>((done) => {
        release = done;
      });
      const flow = (async () => {
        await wait;
        return manager.commit(turn, change === 'context' ? 2 : 1, () =>
          sendAssistantTurn(turn.agentId, 'hello', '', turn.sessionKey, {
            runId: turn.submissionId,
          }),
        );
      })();
      if (change === 'cancel') manager.cancel();
      if (change === 'scope') {
        manager.setScope({ ...scope, sessionKey: 'B' });
        manager.setScope(scope);
      }
      release();
      expect(await flow).toBe(false);
      expect(sendRequest).not.toHaveBeenCalled();
    },
  );
  it.each(['busy', 'disconnected', 'missing-client'] as const)(
    'returns explicit rejection on %s before touching the draft or transcript',
    (reason) => {
      const chat = ensureAgentChat('agent');
      chat.inputText = 'retained';
      if (reason === 'busy') chat.sending = true;
      if (reason === 'disconnected') conn.connected = false;
      if (reason === 'missing-client') vi.mocked(getClient).mockReturnValue(null);
      expect(
        sendAssistantTurn('agent', 'hello', '', scope.sessionKey, { runId: 'frozen' }),
      ).toEqual({ status: 'rejected', runId: 'frozen' });
      expect(chat.inputText).toBe('retained');
      expect(chat.messages).toHaveLength(0);
      expect(sendRequest).not.toHaveBeenCalled();
    },
  );
  it('a real closed SDK client rejects synchronously despite stale connected UI state', () => {
    const client = new GatewayClient({
      url: 'ws://fixture.invalid',
      onChallenge: async () => ({}),
    });
    vi.mocked(getClient).mockReturnValue(client);
    const chat = ensureAgentChat('agent');
    chat.inputText = 'retained';
    expect(sendAssistantTurn('agent', 'hello', '', scope.sessionKey, { runId: 'closed' })).toEqual({
      status: 'rejected',
      runId: 'closed',
    });
    expect(chat.messages).toHaveLength(0);
    expect(chat.inputText).toBe('retained');
    expect(chat.runId).toBeNull();
  });
  it('rejects unsupported SDK capability without a transport fallback', () => {
    vi.mocked(getClient).mockReturnValue({ request: vi.fn() } as unknown as GatewayClient);
    expect(
      sendAssistantTurn('agent', 'hello', '', scope.sessionKey, { runId: 'unsupported' }).status,
    ).toBe('rejected');
    expect(sendRequest).not.toHaveBeenCalled();
  });
  it.each(['ack', 'guard'] as const)(
    'late %s recovery history cannot overwrite a newer run in the same session',
    async (source) => {
      let rejectSend!: (error: Error) => void;
      let resolveHistory!: (value: unknown) => void;
      vi.mocked(sendRequest).mockImplementation((method) => {
        if (method === 'chat.history')
          return new Promise((done) => {
            resolveHistory = done;
          });
        return new Promise((_done, reject) => {
          rejectSend = reject;
        });
      });
      sendAssistantTurn('agent', 'turn A', '', scope.sessionKey, { runId: 'A' });
      if (source === 'ack') {
        rejectSend(new Error('ack lost'));
        await Promise.resolve();
      } else await vi.advanceTimersByTimeAsync(120_000);
      expect(resolveHistory).toBeTypeOf('function');
      expect(
        sendAssistantTurn('agent', 'turn B', '', scope.sessionKey, { runId: 'B' }).status,
      ).toBe('submitted');
      resolveHistory({ messages: [{ role: 'assistant', content: 'old history A' }] });
      await Promise.resolve();
      await Promise.resolve();
      const chat = ensureAgentChat('agent');
      expect(chat.runId).toBe('B');
      expect(JSON.stringify(chat.messages)).toContain('turn B');
      expect(JSON.stringify(chat.messages)).not.toContain('old history A');
    },
  );
  it.each(['before-recovery', 'during-history'] as const)(
    'replacing chat state %s fences old recovery without recreating or overwriting it',
    async (point) => {
      let rejectSend!: (error: Error) => void;
      let resolveHistory!: (value: unknown) => void;
      vi.mocked(sendRequest).mockImplementation((method) =>
        method === 'chat.history'
          ? new Promise((done) => {
              resolveHistory = done;
            })
          : new Promise((_done, reject) => {
              rejectSend = reject;
            }),
      );
      sendAssistantTurn('agent', 'old A', '', scope.sessionKey, { runId: 'A' });
      if (point === 'before-recovery') {
        delete agentChat.agent;
        rejectSend(new Error('old connection closed'));
        await Promise.resolve();
        expect(agentChat.agent).toBeUndefined();
        expect(
          vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.history'),
        ).toHaveLength(0);
      } else {
        rejectSend(new Error('ack lost'));
        await Promise.resolve();
        delete agentChat.agent;
        const replacement = ensureAgentChat('agent');
        replacement.runId = 'replacement';
        resolveHistory({ messages: [{ role: 'assistant', content: 'detached old history' }] });
        await Promise.resolve();
        await Promise.resolve();
        expect(agentChat.agent).toBe(replacement);
        expect(replacement.messages).toHaveLength(0);
      }
    },
  );
  it('a replaced client cannot start recovery even when chat state was retained', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(sendRequest).mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    sendAssistantTurn('agent', 'retained transcript', '', scope.sessionKey, { runId: 'A' });
    vi.mocked(getClient).mockReturnValue(null);
    reject(new Error('old socket closed'));
    await Promise.resolve();
    expect(
      vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.history'),
    ).toHaveLength(0);
    expect(ensureAgentChat('agent').runId).toBe('A');
  });
  it('late history cannot cross owner A → B → A after preparation has finished', async () => {
    const manager = createPendingSubmissions();
    manager.setScope(scope);
    const turn = manager.begin(1, 1);
    let rejectSend!: (error: Error) => void;
    let resolveHistory!: (value: unknown) => void;
    vi.mocked(sendRequest).mockImplementation((method) =>
      method === 'chat.history'
        ? new Promise((done) => {
            resolveHistory = done;
          })
        : new Promise((_done, reject) => {
            rejectSend = reject;
          }),
    );
    manager.commit(turn, 1, () =>
      sendAssistantTurn('agent', 'retained A', '', scope.sessionKey, {
        runId: turn.submissionId,
        current: () => manager.ownsScope(turn),
      }),
    );
    manager.finish(turn);
    rejectSend(new Error('ack lost'));
    await Promise.resolve();
    manager.setScope({ ...scope, actorId: 'other' });
    manager.setScope(scope);
    resolveHistory({ messages: [{ role: 'assistant', content: 'stale owner result' }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.stringify(ensureAgentChat('agent').messages)).toContain('retained A');
    expect(JSON.stringify(ensureAgentChat('agent').messages)).not.toContain('stale owner result');
  });
  it('retains submitted identity on lost acknowledgement and fences stale errors from newer runs', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(sendRequest).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    expect(
      sendAssistantTurn('agent', 'hello', '', scope.sessionKey, { runId: 'captured' }),
    ).toEqual({ status: 'submitted', runId: 'captured' });
    reject(new Error('ack lost'));
    await Promise.resolve();
    expect(ensureAgentChat('agent').runId).toBe('captured');
    expect(
      vi.mocked(sendRequest).mock.calls.filter(([method]) => method === 'chat.send'),
    ).toHaveLength(1);
    ensureAgentChat('agent').runId = 'newer';
    vi.mocked(sendRequest).mockResolvedValueOnce({});
    await abortChat('agent', scope.sessionKey, 'captured');
    expect(sendRequest).toHaveBeenLastCalledWith('chat.abort', {
      sessionKey: scope.sessionKey,
      runId: 'captured',
    });
    expect(ensureAgentChat('agent').runId).toBe('newer');
  });
});
