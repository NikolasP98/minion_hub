import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gateway-rpc', () => ({
  sendRequest: vi.fn(async () => ({ messages: [] })),
  gwTrace: vi.fn(),
  getClient: vi.fn(),
  requestReconnect: vi.fn(),
}));

import { sendAssistantTurn } from './chat-rpc';
import { getClient, requestReconnect, sendRequest } from '../gateway-rpc';
import { conn } from '$lib/state/gateway/connection.svelte';
import { ensureAgentChat } from '$lib/state/chat/chat.svelte';
import * as m from '$lib/paraglide/messages';
import { createPendingSubmissions } from '$lib/assistant/pending-submission';
import {
  createAcceptedSurface,
  getAcceptedRun,
  observeRunTransport,
  resetAcceptedRuns,
} from '$lib/assistant/accepted-runs';
import { getPageContextRevision } from '$lib/assistant/page-context';

const scope = { actorId: 'actor', orgId: 'org', agentId: 'agent', sessionKey: 'agent:agent:main' };

afterEach(() => {
  resetAcceptedRuns();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function send(rejectWith: unknown) {
  conn.connected = true;
  vi.mocked(getClient).mockReturnValue({
    beginRequest: vi.fn(() => Promise.reject(rejectWith)),
  } as never);
  const surface = createAcceptedSurface({ readScope: () => scope, followUp: async () => true });
  const pending = createPendingSubmissions();
  pending.setScope(scope);
  const turn = pending.begin(0, getPageContextRevision());
  const chat = ensureAgentChat('agent');
  chat.sending = false;
  chat.lastError = null;
  const res = sendAssistantTurn('agent', 'hola', '', scope.sessionKey, {
    runId: turn.submissionId,
    binding: { pending: turn, surface },
  });
  return { res, chat };
}

describe('sendAssistantTurn — lost acknowledgement', () => {
  it('keeps the run pending, shows the localized status line and asks for a reconnect', async () => {
    const { res, chat } = send(
      Object.assign(new Error("request 'chat.send' timed out after 15000ms"), { code: 'TIMEOUT' }),
    );
    expect(res.status).toBe('submitted');
    await vi.waitFor(() => expect(requestReconnect).toHaveBeenCalledTimes(1));
    expect(chat.lastError).toBe(m.floatingAssistant_connectionLost());
    expect(chat.sending).toBe(false);
    const binding = getAcceptedRun(res.runId, scope.sessionKey);
    expect(binding?.transport).toBe('unknown');
    expect(binding?.state).toBe('unclaimed');
  });

  it('the 120 s guard stays armed and gives up on a lost-ack run, socket or no socket', async () => {
    vi.useFakeTimers();
    const { res, chat } = send(Object.assign(new Error('timed out'), { code: 'TIMEOUT' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(chat.lastError).toBe(m.floatingAssistant_connectionLost());
    // The forced reconnect replaced the socket client and may not be up yet;
    // the backstop must care about neither.
    vi.mocked(getClient).mockReturnValue({ beginRequest: vi.fn() } as never);
    conn.connected = false;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(chat.lastError).toBe(m.floatingAssistant_replyLost());
    expect(chat.runId).toBeNull();
    expect(getAcceptedRun(res.runId, scope.sessionKey)?.state).toBe('invalidated');
  });

  it('the 120 s guard leaves an acknowledged run alone (a long turn is still pending here)', async () => {
    vi.useFakeTimers();
    const { res, chat } = send(Object.assign(new Error('timed out'), { code: 'TIMEOUT' }));
    await vi.advanceTimersByTimeAsync(0);
    const binding = getAcceptedRun(res.runId, scope.sessionKey)!;
    observeRunTransport(binding, 'accepted'); // the ack did arrive after all
    await vi.advanceTimersByTimeAsync(120_000);
    expect(binding.state).toBe('unclaimed');
    expect(chat.lastError).toBe(m.floatingAssistant_connectionLost());
  });

  it('any other rejection still surfaces the raw error and does not reconnect', async () => {
    const { chat } = send(new Error('boom'));
    await vi.waitFor(() =>
      expect(sendRequest).toHaveBeenCalledWith('chat.history', expect.anything()),
    );
    expect(chat.lastError).toBe('Error: boom');
    expect(requestReconnect).not.toHaveBeenCalled();
  });
});
