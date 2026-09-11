import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { OPENROUTER_API_KEY: 'test-key' } }));
vi.mock('$server/ai-usage', () => ({ recordAiUsage: vi.fn() }));

import { embedTexts, prepareEmbeddingRequest, executeEmbeddingRequest } from './embeddings';
import { recordAiUsage } from '$server/ai-usage';

const embedding = (value: number) => Array.from({ length: 1536 }, () => value);

describe('embedTexts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(recordAiUsage).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('retries transient provider failures and preserves provider index order', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { index: 1, embedding: embedding(0.3) },
            { index: 0, embedding: embedding(0.1) },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const pending = embedTexts(['first', 'second']);
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toEqual([embedding(0.1), embedding(0.3)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries rejected network requests with exponential backoff', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: embedding(0.5) }] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = embedTexts(['recover']);
    await vi.advanceTimersByTimeAsync(1_500);

    await expect(pending).resolves.toEqual([embedding(0.5)]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient provider error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('invalid request', {
        status: 400,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(embedTexts(['bad input'])).rejects.toThrow(
      'Embeddings failed (400): invalid request',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed successful responses after bounded retries', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        Response.json({ data: [{ index: 0, embedding: [Number.NaN] }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const rejection = expect(embedTexts(['invalid vector'])).rejects.toThrow(
      'invalid 1536-dimension vector',
    );
    await vi.advanceTimersByTimeAsync(1_500);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('pins the normalized request and rejects forged prepared handles', async () => {
    const inputs = ['a'.repeat(8100)];
    const request = prepareEmbeddingRequest(inputs);
    inputs[0] = 'changed';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [{ index: 0, embedding: embedding(0.1) }] }));
    vi.stubGlobal('fetch', fetchMock);
    await executeEmbeddingRequest(request, { attemptPolicy: 'single' });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'openai/text-embedding-3-small',
      input: ['a'.repeat(8000)],
    });
    await expect(
      executeEmbeddingRequest({ ...request }, { attemptPolicy: 'single' }),
    ).rejects.toThrow(/prepared/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['network', '429', '503', 'malformed', 'invalid'])(
    'single attempt does not retry %s',
    async (kind) => {
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
        if (kind === 'network') throw new TypeError('offline');
        if (kind === '429' || kind === '503')
          return new Response('retry', { status: Number(kind) });
        if (kind === 'malformed') return new Response('{');
        return Response.json({ data: [{ index: 0, embedding: [1] }] });
      });
      vi.stubGlobal('fetch', fetchMock);
      await expect(embedTexts(['one'], { attemptPolicy: 'single' })).rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('sends nothing when already aborted and cancels a retry wait', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(embedTexts(['one'], { signal: controller.signal })).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
    const second = new AbortController();
    const result = expect(embedTexts(['one'], { signal: second.signal })).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    second.abort();
    await result;
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds an uncooperative fetch by caller cancellation', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const result = expect(
      embedTexts(['one'], { signal: controller.signal, attemptPolicy: 'single' }),
    ).rejects.toBeDefined();
    await Promise.resolve();
    controller.abort();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a single uncooperative attempt by the request timeout', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const result = expect(embedTexts(['one'], { attemptPolicy: 'single' })).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await vi.advanceTimersByTimeAsync(45000);
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not record or accept a body that arrives after cancellation', async () => {
    let resolve!: (value: unknown) => void;
    const body = new Promise<unknown>((yes) => {
      resolve = yes;
    });
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => body } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const result = expect(
      embedTexts(['one'], { signal: controller.signal, attemptPolicy: 'single' }),
    ).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await result;
    resolve({ data: [{ index: 0, embedding: embedding(0.1) }] });
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(recordAiUsage).not.toHaveBeenCalled();
  });
});
