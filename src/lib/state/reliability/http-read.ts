export const RELIABILITY_HTTP_MAX_BYTES = 8 * 1024 * 1024;
export const RELIABILITY_HTTP_TIMEOUT_MS = 15_000;

export class ReliabilityHttpReadError extends Error {
  constructor(
    readonly kind: 'http' | 'timeout' | 'transport' | 'oversize' | 'decode',
    readonly status?: number,
  ) {
    super('Reliability data could not be refreshed.');
    this.name = 'ReliabilityHttpReadError';
  }
}

function combineSignals(
  first: AbortSignal,
  second: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) controller.abort();
  else {
    first.addEventListener('abort', abort, { once: true });
    second.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      first.removeEventListener('abort', abort);
      second.removeEventListener('abort', abort);
    },
  };
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      await response.body?.cancel();
      throw new ReliabilityHttpReadError('oversize');
    }
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ReliabilityHttpReadError('decode');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ReliabilityHttpReadError('oversize');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

/** Fetch, enforce a decoded-body byte cap, then decode JSON exactly once. */
export async function fetchReliabilityJson(
  url: string,
  ownerSignal: AbortSignal,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  const timeout = new AbortController();
  const timeoutMs = options.timeoutMs ?? RELIABILITY_HTTP_TIMEOUT_MS;
  const timeoutId = setTimeout(() => timeout.abort(), timeoutMs);
  const combined = combineSignals(ownerSignal, timeout.signal);
  const signal = combined.signal;
  try {
    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        signal,
      });
    } catch {
      throw new ReliabilityHttpReadError(timeout.signal.aborted ? 'timeout' : 'transport');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ReliabilityHttpReadError('http', response.status);
    }
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(response, options.maxBytes ?? RELIABILITY_HTTP_MAX_BYTES);
    } catch (error) {
      if (error instanceof ReliabilityHttpReadError) throw error;
      throw new ReliabilityHttpReadError(timeout.signal.aborted ? 'timeout' : 'transport');
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new ReliabilityHttpReadError('decode');
    }
  } finally {
    clearTimeout(timeoutId);
    combined.dispose();
  }
}
