import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinMessage, readJoinRequestBody } from './request-input';

afterEach(() => vi.useRealTimers());
describe('bounded access request input', () => {
  it('accepts an absent message and trims the exact maximum length', async () => {
    expect(joinMessage(undefined)).toBeUndefined();
    expect(joinMessage('  ')).toBeUndefined();
    expect(joinMessage('x'.repeat(500))).toHaveLength(500);
    expect(await readJoinRequestBody(new Request('http://localhost', { method: 'POST' }))).toEqual(
      {},
    );
  });
  it.each([new Blob(['file']), 5, 'x'.repeat(501)])(
    'rejects nontext or oversized form messages',
    (value) => {
      expect(() => joinMessage(value)).toThrow();
    },
  );
  it('counts received bytes even when the advertised size is false and cancels oversized input', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel,
    });
    const request = { body, headers: new Headers({ 'content-length': '1' }) } as Request;
    await expect(readJoinRequestBody(request)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('times out a stalled stream without waiting for cancellation acknowledgement', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const request = { body: new ReadableStream<Uint8Array>({ cancel }) } as Request;
    const observed = readJoinRequestBody(request).then(
      () => 'unexpected success',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(await observed).toMatchObject({ status: 408 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects malformed UTF-8 instead of replacing its bytes', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b, 0xff, 0x7d]));
        controller.close();
      },
    });
    await expect(readJoinRequestBody({ body } as Request)).rejects.toMatchObject({ status: 400 });
  });
});
