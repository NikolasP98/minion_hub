import { describe, expect, it, vi } from 'vitest';
import { fileDraftContext } from './draft';
vi.mock('$lib/api/fetch-json', () => ({ fetchJson: vi.fn() }));
import { fetchJson } from '$lib/api/fetch-json';
describe('assistant attachment draft', () => {
  it('resolves the saved file at send time and sanitizes its display marker', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      file: { url: 'https://storage.test/file?expires=123' },
    });
    expect(await fileDraftContext([{ id: 'file-id', name: 'note\n[context].txt', size: 1 }])).toBe(
      '[Attached file: note__context_.txt]\nhttps://storage.test/file?expires=123',
    );
    expect(fetchJson).toHaveBeenCalledWith('/api/files/file-id');
  });
  it('forwards cancellation without deleting the uploaded file', async () => {
    const controller = new AbortController();
    vi.mocked(fetchJson).mockResolvedValue({ file: { url: 'https://storage.test/file' } });
    await fileDraftContext([{ id: 'saved', name: 'x', size: 1 }], { signal: controller.signal });
    expect(fetchJson).toHaveBeenLastCalledWith('/api/files/saved', { signal: controller.signal });
    controller.abort();
    await expect(fileDraftContext([], { signal: controller.signal })).rejects.toThrow();
  });
  it('aborts in-flight signing and leaves the durable upload untouched', async () => {
    const controller = new AbortController();
    vi.mocked(fetchJson).mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('canceled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const pending = fileDraftContext([{ id: 'already-uploaded', name: 'x', size: 1 }], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow('canceled');
    expect(fetchJson).toHaveBeenLastCalledWith('/api/files/already-uploaded', {
      signal: controller.signal,
    });
  });
  it('rejects unsafe download schemes and supports the isolated QA transport', async () => {
    vi.mocked(fetchJson).mockResolvedValue({ file: { url: 'javascript:alert(1)' } });
    await expect(fileDraftContext([{ id: 'one', name: 'x', size: 1 }])).rejects.toThrow(
      'Invalid file URL',
    );
    vi.mocked(fetchJson).mockResolvedValue({ file: { url: 'http://127.0.0.1:54421/file' } });
    expect(await fileDraftContext([{ id: 'one', name: 'x', size: 1 }])).toContain(
      'http://127.0.0.1:54421/file',
    );
  });
});
