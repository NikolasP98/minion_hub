import { describe, it, expect, vi } from 'vitest';
import { readBuildStream, type BuildProgress } from './read-build-stream';

/** Build a Response whose body streams `chunks` (split however we like). */
function streamResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body);
}

describe('readBuildStream', () => {
  it('emits progress in order and returns the terminal artifact', async () => {
    const res = streamResponse([
      '{"phase":"generating","attempt":1,"max":3}\n',
      '{"phase":"repairing","attempt":2,"max":3}\n',
      '{"done":true,"artifact":{"id":"a1"}}\n',
    ]);
    const seen: BuildProgress[] = [];
    const out = await readBuildStream<{ id: string }>(res, (p) => seen.push(p));
    expect(seen.map((p) => p.phase)).toEqual(['generating', 'repairing']);
    expect(out.id).toBe('a1');
  });

  it('reassembles lines split across chunks', async () => {
    const res = streamResponse(['{"phase":"gen', 'erating","attempt":1,"max":3}\n{"done":true,', '"artifact":1}\n']);
    const seen: BuildProgress[] = [];
    const out = await readBuildStream<number>(res, (p) => seen.push(p));
    expect(seen).toHaveLength(1);
    expect(out).toBe(1);
  });

  it('throws on the terminal error line', async () => {
    const res = streamResponse(['{"done":true,"error":"generation failed"}\n']);
    await expect(readBuildStream(res, vi.fn())).rejects.toThrow('generation failed');
  });

  it('throws when the stream ends without a terminal line', async () => {
    const res = streamResponse(['{"phase":"generating","attempt":1,"max":3}\n']);
    await expect(readBuildStream(res, vi.fn())).rejects.toThrow(/without a result/);
  });
});
