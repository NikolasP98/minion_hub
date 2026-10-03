import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchReliabilityJson, RELIABILITY_HTTP_MAX_BYTES } from './http-read';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { status: 200, headers },
  );
}

describe('bounded reliability HTTP reads', () => {
  it('parses a streamed body once without requiring Content-Length', async () => {
    const bytes = new TextEncoder().encode('{"value":7}');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamed([bytes.slice(0, 4), bytes.slice(4)])),
    );
    await expect(fetchReliabilityJson('/test', new AbortController().signal)).resolves.toEqual({
      value: 7,
    });
  });

  it('does not trust a lying Content-Length and cancels decoded overflow', async () => {
    const chunk = new Uint8Array(RELIABILITY_HTTP_MAX_BYTES + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamed([chunk], { 'content-length': '1' })),
    );
    await expect(fetchReliabilityJson('/test', new AbortController().signal)).rejects.toMatchObject(
      {
        kind: 'oversize',
      },
    );
  });

  it('rejects an oversized declared response before reading it', async () => {
    const cancel = vi.fn(async () => undefined);
    const response = {
      ok: true,
      headers: new Headers({ 'content-length': String(RELIABILITY_HTTP_MAX_BYTES + 1) }),
      body: { cancel },
    } as unknown as Response;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    await expect(fetchReliabilityJson('/test', new AbortController().signal)).rejects.toMatchObject(
      {
        kind: 'oversize',
      },
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('contains malformed JSON without exposing parser details', async () => {
    let captured: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        captured = init?.signal ?? undefined;
        return streamed([new TextEncoder().encode('{bad')]);
      }),
    );
    const owner = new AbortController();
    await expect(fetchReliabilityJson('/test', owner.signal)).rejects.toMatchObject({
      kind: 'decode',
    });
    expect(captured).toBeDefined();
  });

  it('uses the captured owner abort signal for an in-flight fetch', async () => {
    let captured: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            captured = init?.signal ?? undefined;
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const owner = new AbortController();
    const read = fetchReliabilityJson('/test', owner.signal);
    const rejected = expect(read).rejects.toMatchObject({ kind: 'transport' });
    owner.abort();
    expect(captured?.aborted).toBe(true);
    await rejected;
  });

  it('applies its own deadline to a transport that observes abort', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const read = fetchReliabilityJson('/test', new AbortController().signal, { timeoutMs: 10 });
    const rejected = expect(read).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
  });
});
