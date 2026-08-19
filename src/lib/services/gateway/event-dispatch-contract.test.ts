// Contract probe for the SHIPPED @minion-stack/shared GatewayClient's event
// dispatch. It pins the three invariants hub's `onEventError` posture rests on
// (see docs/2026-08-19-gateway-onevent-error-hook-s1-adoption-record.md):
//
//   1. a failing `onEvent` handler never reaches connection health — no
//      onClose, no reconnect schedule, socket stays open;
//   2. dispatch is not awaited, buffered or reordered — the frames after a
//      failing one still arrive, in order;
//   3. an async handler rejection is contained by the client rather than
//      escaping as an unhandled rejection.
//
// These hold on the currently-pinned 0.9.0 (which discards handler failures
// outright) and must keep holding once the release carrying `onEventError`
// lands and hub bumps onto it. Deliberately NOT asserted: whether the client
// contains a *synchronous* throw. 0.9.0 lets it escape the socket's message
// listener; the onEventError build contains it. Asserting either way would turn
// this file into a snapshot of one version instead of a bump-survivable gate.
import { describe, expect, it } from 'vitest';
import { GatewayClient } from '@minion-stack/shared';
import type { EventFrame } from '@minion-stack/shared';

type Listener = (ev: unknown) => void;

/**
 * Minimal browser-shaped WebSocket double (hub runs the browser arm of
 * GatewayClient.wireEvents, i.e. addEventListener, not Node `ws`.on).
 *
 * A real EventTarget isolates a listener's exception — it surfaces as an
 * uncaught error and the socket keeps working — so `dispatch` records the throw
 * instead of letting it escape. Without that, a synchronous handler throw would
 * unwind into the test body and we would be measuring vitest, not the client.
 */
class FakeSocket {
  static last: FakeSocket | null = null;

  readyState = 1;
  readonly sent: string[] = [];
  readonly listenerErrors: unknown[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  addEventListener(ev: string, fn: Listener): void {
    const list = this.listeners.get(ev) ?? [];
    list.push(fn);
    this.listeners.set(ev, list);
  }

  send(raw: string): void {
    this.sent.push(raw);
  }

  close(code = 1000, reason = 'fake close'): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatch('close', { code, reason });
  }

  dispatch(ev: string, detail: unknown): void {
    for (const fn of this.listeners.get(ev) ?? []) {
      try {
        fn(detail);
      } catch (err) {
        this.listenerErrors.push(err);
      }
    }
  }

  /** Feed one gateway frame in over the wire. */
  deliver(frame: Record<string, unknown>): void {
    this.dispatch('message', { data: JSON.stringify(frame) });
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const eventFrame = (seq: number): Record<string, unknown> => ({
  type: 'event',
  event: 'agent',
  seq,
  payload: { agentId: `a-${seq}` },
});

interface Harness {
  client: GatewayClient;
  socket: FakeSocket;
  /** Every frame the client handed to onEvent, in dispatch order. */
  seen: EventFrame[];
  closes: Array<{ code: number; reason: string }>;
  reconnectDelays: number[];
}

/**
 * Build a client on a fake socket and complete the real challenge handshake, so
 * the probe runs against a connected client rather than one still mid-connect
 * (whose 10s connect timeout would leak a timer into the next test).
 */
async function connectHarness(onEvent: (frame: EventFrame) => void | Promise<void>) {
  const seen: EventFrame[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const reconnectDelays: number[] = [];

  const client = new GatewayClient({
    url: 'wss://gateway.test',
    // autoReconnect on is hub's real configuration (gateway.svelte.ts
    // buildGatewayClient) — it is what makes "no reconnect was scheduled" a
    // meaningful assertion rather than a vacuous one.
    autoReconnect: true,
    WebSocketImpl: FakeSocket,
    onChallenge: async () => ({ minProtocol: 3, maxProtocol: 3 }),
    onEvent: (frame) => {
      seen.push(frame);
      return onEvent(frame);
    },
    onClose: (code, reason) => {
      closes.push({ code, reason });
    },
    onReconnectScheduled: (delayMs) => {
      reconnectDelays.push(delayMs);
    },
  });

  const hello = client.connect();
  const socket = FakeSocket.last;
  if (!socket) throw new Error('FakeSocket was never constructed');

  socket.dispatch('open', {});
  socket.deliver({ type: 'event', event: 'connect.challenge', payload: { nonce: 'nonce-1' } });
  await flush();

  const req = JSON.parse(socket.sent[0]) as { id: string; method: string };
  expect(req.method).toBe('connect');
  socket.deliver({ type: 'res', id: req.id, ok: true, payload: { protocol: 3 } });
  await hello;

  return { client, socket, seen, closes, reconnectDelays } satisfies Harness;
}

describe('shipped GatewayClient event dispatch', () => {
  it('keeps the socket healthy when the event handler throws', async () => {
    const h = await connectHarness(() => {
      throw new Error('handleEvent boom');
    });

    h.socket.deliver(eventFrame(1));
    await flush();

    expect(h.seen).toHaveLength(1);
    // Invariant 5 of the adoption spec: a handler failure is not a disconnect.
    expect(h.closes).toEqual([]);
    expect(h.reconnectDelays).toEqual([]);
    expect(h.socket.readyState).toBe(1);

    h.client.close();
  });

  it('still delivers later frames, in order, after a handler fails', async () => {
    const h = await connectHarness((frame) => {
      throw new Error(`handleEvent boom on seq ${frame.seq}`);
    });

    h.socket.deliver(eventFrame(1));
    h.socket.deliver(eventFrame(2));
    h.socket.deliver(eventFrame(3));
    await flush();

    // Invariant 2: onEventError is a reporting hook, not a delivery-semantics
    // change — a failing handler must not drop or reorder its successors.
    expect(h.seen.map((f) => f.seq)).toEqual([1, 2, 3]);
    expect(h.closes).toEqual([]);
    expect(h.reconnectDelays).toEqual([]);

    h.client.close();
  });

  it('contains an async handler rejection instead of leaking it', async () => {
    const leaked: unknown[] = [];
    const onUnhandled = (reason: unknown) => leaked.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const h = await connectHarness(async () => {
        await Promise.resolve();
        throw new Error('async handleEvent boom');
      });

      h.socket.deliver(eventFrame(1));
      h.socket.deliver(eventFrame(2));
      // Two macrotask turns: one for the handler's own await, one for Node to
      // have flagged the rejection as unhandled had the client not caught it.
      await flush();
      await flush();

      expect(h.seen.map((f) => f.seq)).toEqual([1, 2]);
      expect(leaked).toEqual([]);
      expect(h.closes).toEqual([]);
      expect(h.socket.readyState).toBe(1);

      h.client.close();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
