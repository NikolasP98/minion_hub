import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { OPENROUTER_API_KEY: 'test-key' } }));

import { embedTexts } from './embeddings';

const embedding = (value: number) => Array.from({ length: 1536 }, () => value);

describe('embedTexts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
});
