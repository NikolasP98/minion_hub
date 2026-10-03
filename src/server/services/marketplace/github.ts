import { env } from '$env/dynamic/private';

export const GITHUB_REPO = 'NikolasP98/minions';
const API = `https://api.github.com/repos/${GITHUB_REPO}/contents/`;
export type GitHubFailureCode =
  | 'not_found'
  | 'rate_limited'
  | 'provider_denied'
  | 'provider_unavailable'
  | 'invalid_document'
  | 'document_too_large'
  | 'deadline';
export class MarketplaceGitHubError extends Error {
  constructor(readonly code: GitHubFailureCode) {
    super(`Marketplace provider: ${code}`);
  }
}
function fail(code: GitHubFailureCode): never {
  throw new MarketplaceGitHubError(code);
}
export const safeDirectory = (name: string) =>
  /^[A-Za-z0-9._-]{1,128}$/.test(name) && name !== '.' && name !== '..';

/** Fixed-origin bounded read. Neither redirects nor provider-returned URLs carry credentials. */
export async function githubJson(
  path: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const segments = path.split('/');
  if (segments[0] !== 'agents' || segments.some((part) => !safeDirectory(part)))
    fail('invalid_document');
  const timeout = AbortSignal.timeout(10_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    combined.throwIfAborted();
    response = await fetch(`${API}${segments.map(encodeURIComponent).join('/')}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'minion-hub',
        ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      },
      redirect: 'error',
      signal: combined,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) fail('not_found');
      if (response.status === 429) fail('rate_limited');
      if (response.status === 401 || response.status === 403) fail('provider_denied');
      fail('provider_unavailable');
    }
    const length = response.headers.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > maximumBytes) {
      await response.body?.cancel();
      fail('document_too_large');
    }
    if (!response.body) fail('invalid_document');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        combined.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maximumBytes) {
          await reader.cancel();
          fail('document_too_large');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
      fail('invalid_document');
    }
  } catch (cause) {
    if (cause instanceof MarketplaceGitHubError) throw cause;
    if (combined.aborted) fail('deadline');
    fail('provider_unavailable');
  }
}

export function decodeGitHubFile(
  value: unknown,
  expectedPath: string,
  maximumDecodedBytes: number,
): string {
  if (!value || typeof value !== 'object') return fail('invalid_document');
  const file = value as Record<string, unknown>;
  if (
    file.type !== 'file' ||
    file.encoding !== 'base64' ||
    file.path !== expectedPath ||
    typeof file.content !== 'string'
  )
    fail('invalid_document');
  const content = file.content.replace(/\n/g, '');
  if (content.length > Math.ceil(maximumDecodedBytes / 3) * 4) fail('document_too_large');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content))
    fail('invalid_document');
  const buffer = Buffer.from(content, 'base64');
  if (buffer.length > maximumDecodedBytes) fail('document_too_large');
  // Buffer's base64 decoder accepts noncanonical pad bits; reject ambiguous bytes.
  if (buffer.toString('base64') !== content) fail('invalid_document');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return fail('invalid_document');
  }
}

/** Ordered results with a hard concurrency ceiling; aborted work starts no new request. */
export async function mapGitHubPage<T, R>(
  items: readonly T[],
  signal: AbortSignal,
  map: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  let next = 0;
  const results = new Array<PromiseSettledResult<R>>(items.length);
  await Promise.all(
    Array.from({ length: Math.min(4, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        try {
          signal.throwIfAborted();
          results[index] = { status: 'fulfilled', value: await map(items[index], index) };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return results;
}
