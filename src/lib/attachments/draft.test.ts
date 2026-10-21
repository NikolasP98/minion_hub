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
