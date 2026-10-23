// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';

it('actual fixture provider requests preserve prior conversation and expose compaction', async () => {
  vi.stubGlobal('__evalBootstrap', {
    episodeId: 'independent-history',
    arm: 'full',
    seed: 7,
    persona: 'owner',
    initialState: 'empty',
    locale: 'en',
    model: { requestedModel: 'fixture/main', boundDescriptor: 'utf8-bytes-v1' },
  });
  const { installEval } = await import('../../fixtures/critical-journeys/eval-transport.ts');
  const { fixtureBridge, FixtureSocket } =
    await import('../../fixtures/critical-journeys/gateway-transport.ts');
  const previousFetch = globalThis.fetch,
    previousSocket = globalThis.WebSocket;
  installEval();
  const socket = new FixtureSocket('ws://critical.invalid');
  const bridge = (
    window as unknown as {
      __eval: {
        takeProviders: () => Array<{ messages: Array<{ role: string; content: string }> }>;
      };
    }
  ).__eval;
  try {
    fixtureBridge.record(
      { message: 'My favorite color is blue.' },
      { role: 'assistant', content: [{ type: 'text', text: 'I will remember blue.' }] },
    );
    fixtureBridge.main!(
      {
        runId: crypto.randomUUID(),
        sessionKey: 'agent:fixture-agent:main',
        message: 'Which color did I name?',
      },
      socket,
      () => {},
      () => {},
    );
    const second = bridge.takeProviders()[0];

    expect.soft(second.messages).toEqual([
      { role: 'user', content: 'My favorite color is blue.' },
      { role: 'assistant', content: 'I will remember blue.' },
      { role: 'user', content: 'Which color did I name?' },
    ]);
    fixtureBridge.record(
      { message: 'Which color did I name?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Blue.' }] },
    );
    fixtureBridge.compact();
    fixtureBridge.main!(
      {
        runId: crypto.randomUUID(),
        sessionKey: 'agent:fixture-agent:main',
        message: 'Continue after compaction.',
      },
      socket,
      () => {},
      () => {},
    );
    const after = bridge.takeProviders()[0];

    expect
      .soft(after.messages[0])
      .toEqual({ role: 'system', content: 'Disposable server history compaction fixture.' });
    expect
      .soft(after.messages.at(-1))
      .toEqual({ role: 'user', content: 'Continue after compaction.' });
    const raw = '[In-app assistant context — exact bytes]\n  keep  spacing\n';
    fixtureBridge.record(
      { sessionKey: 'agent:fixture-agent:other', message: raw },
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'a',
            name: 'chat_artifact',
            arguments: { buttons: [{ text: 'Next', callback_data: 'next' }] },
          },
        ],
      },
    );
    fixtureBridge.main!(
      { runId: crypto.randomUUID(), sessionKey: 'agent:fixture-agent:other', message: 'next' },
      socket,
      () => {},
      () => {},
    );
    const other = bridge.takeProviders()[0];
    expect(other.messages).toHaveLength(3);
    expect(other.messages[0]).toEqual({ role: 'user', content: raw });
    expect(other.messages[1].content).toContain('chat_artifact');
    expect(other.messages[1].content).toContain('callback_data');
    expect(other.messages[2]).toEqual({ role: 'user', content: 'next' });
  } finally {
    socket.close();
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: previousSocket });
    vi.unstubAllGlobals();
  }
}, 15000);
