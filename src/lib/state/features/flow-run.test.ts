import { describe, it, expect } from 'vitest';
import { readSseStream, type FlowRunEvent } from './flow-run';

function streamFrom(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      // emit in two chunks to exercise buffering across boundaries
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
}

describe('readSseStream', () => {
  it('parses data events in order and stops at done', async () => {
    const sse =
      'data: {"level":"info","message":"Starting flow run…"}\n\n' +
      'data: {"level":"info","message":"Hello there"}\n\n' +
      'event: done\ndata: {}\n\n';

    const events: FlowRunEvent[] = [];
    for await (const e of readSseStream(streamFrom(sse))) {
      events.push(e);
    }

    expect(events).toEqual([
      { level: 'info', message: 'Starting flow run…' },
      { level: 'info', message: 'Hello there' },
    ]);
  });

  it('ignores malformed data lines', async () => {
    const sse = 'data: not-json\n\ndata: {"level":"warn","message":"ok"}\n\nevent: done\ndata: {}\n\n';
    const events: FlowRunEvent[] = [];
    for await (const e of readSseStream(streamFrom(sse))) events.push(e);
    expect(events).toEqual([{ level: 'warn', message: 'ok' }]);
  });
});
