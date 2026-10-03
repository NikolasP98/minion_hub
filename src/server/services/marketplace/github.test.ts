import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeGitHubFile, githubJson, mapGitHubPage, safeDirectory } from './github';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const encoded = (text: string, path = 'agents/example/SOUL.md') => ({
  type: 'file',
  encoding: 'base64',
  path,
  content: Buffer.from(text).toString('base64'),
});
describe('bounded marketplace GitHub transport', () => {
  it('accepts empty and multilingual strict UTF-8 documents with their exact path', () => {
    for (const text of ['', 'Perú 日本語'])
      expect(decodeGitHubFile(encoded(text), 'agents/example/SOUL.md', 100)).toBe(text);
  });
  it.each([
    { type: 'symlink' },
    { encoding: 'utf8' },
    { path: 'agents/elsewhere/SOUL.md' },
    { content: 'YQ' },
    { content: 'YR==' },
    { content: 'YQ== garbage' },
    { content: '/w==' },
  ])('rejects malformed file envelopes or encodings %j', (overrides) => {
    expect(() =>
      decodeGitHubFile({ ...encoded('a'), ...overrides }, 'agents/example/SOUL.md', 100),
    ).toThrow(/invalid_document/);
  });
  it('enforces decoded byte size and rejects path traversal before any provider call', async () => {
    expect(() => decodeGitHubFile(encoded('abc'), 'agents/example/SOUL.md', 2)).toThrow(
      /document_too_large/,
    );
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const path of ['agents/../file', 'agents/%2f/file', 'elsewhere/file', 'agents//file'])
      await expect(githubJson(path, 20)).rejects.toThrow(/invalid_document/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(safeDirectory('.')).toBe(false);
    expect(safeDirectory('a'.repeat(129))).toBe(false);
  });
  it.each([
    [404, 'not_found'],
    [403, 'provider_denied'],
    [429, 'rate_limited'],
    [503, 'provider_unavailable'],
  ])('classifies HTTP %s without disclosing the response body', async (status, code) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('private-provider-sentinel', { status: Number(status) })),
    );
    await expect(githubJson('agents', 100)).rejects.toThrow(String(code));
    await expect(githubJson('agents', 100)).rejects.not.toThrow('private-provider-sentinel');
  });
  it('stops reading oversized streamed bodies even without Content-Length', async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(11));
      },
      cancel: cancelled,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    await expect(githubJson('agents', 10)).rejects.toThrow('document_too_large');
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('rejects malformed JSON, uses fixed origin, and disables redirect credential forwarding', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('not-json'));
    vi.stubGlobal('fetch', fetcher);
    await expect(githubJson('agents', 100)).rejects.toThrow('invalid_document');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.github.com/repos/NikolasP98/minions/contents/agents',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
  });
  it('honors an already-expired total deadline without starting another network request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(githubJson('agents', 100, controller.signal)).rejects.toThrow('deadline');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds page concurrency at four and does not start queued HTTP after abort', async () => {
    const controller = new AbortController();
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const task = vi.fn(async (value: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return value;
    });
    const pending = mapGitHubPage([0, 1, 2, 3, 4, 5, 6, 7], controller.signal, task);
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(4);
    expect(peak).toBe(4);
    controller.abort();
    releases.forEach((release) => release());
    const results = await pending;
    expect(task).toHaveBeenCalledTimes(4);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(4);
  });
});
