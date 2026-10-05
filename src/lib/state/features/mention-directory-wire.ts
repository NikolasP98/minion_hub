import { validateAlias } from '$lib/utils/alias';

export const DIRECTORY_LIMIT = 10_000;
export const DIRECTORY_BYTES = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DirectoryOwner {
  readonly actorId: string;
  readonly organizationId: string;
}

export type DirectoryFailure = 'unavailable' | 'invalid-response' | 'too-large' | 'timeout';

export class DirectoryReadError extends Error {
  constructor(readonly reason: DirectoryFailure) {
    super(`Mention directory ${reason}`);
    this.name = 'DirectoryReadError';
  }
}

export function validDirectoryId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function directoryOwner(actorId: unknown, organizationId: unknown): DirectoryOwner | null {
  return validDirectoryId(actorId) && validDirectoryId(organizationId)
    ? Object.freeze({ actorId, organizationId })
    : null;
}

/** A type-only ReadonlyMap would still expose set/delete/clear at runtime. */
export function readonlyDirectory(
  entries: Iterable<readonly [string, string]>,
): ReadonlyMap<string, string> {
  const data = new Map(entries);
  const view: ReadonlyMap<string, string> = Object.freeze({
    size: data.size,
    get: (key: string) => data.get(key),
    has: (key: string) => data.has(key),
    keys: () => data.keys(),
    values: () => data.values(),
    entries: () => data.entries(),
    [Symbol.iterator]: () => data.entries(),
    forEach(
      callback: (value: string, key: string, map: ReadonlyMap<string, string>) => void,
      thisArg?: unknown,
    ) {
      data.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
  });
  return view;
}

export const EMPTY_DIRECTORY = readonlyDirectory([]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Server profileId→alias becomes the alias→profileId view consumed by mentions. */
export function decodeMentionDirectory(
  raw: unknown,
  owner: DirectoryOwner,
): ReadonlyMap<string, string> {
  if (
    !record(raw) ||
    Object.keys(raw).sort().join(',') !== 'actorId,aliases,organizationId' ||
    raw.actorId !== owner.actorId ||
    raw.organizationId !== owner.organizationId ||
    !record(raw.aliases)
  ) {
    throw new DirectoryReadError('invalid-response');
  }
  const rows = Object.entries(raw.aliases);
  if (rows.length > DIRECTORY_LIMIT) throw new DirectoryReadError('too-large');
  const entries = new Map<string, string>();
  for (const [profileId, alias] of rows) {
    if (
      !validDirectoryId(profileId) ||
      typeof alias !== 'string' ||
      !validateAlias(alias).ok ||
      entries.has(alias)
    ) {
      throw new DirectoryReadError('invalid-response');
    }
    entries.set(alias, profileId);
  }
  return readonlyDirectory(entries);
}

export async function readMentionDirectory(
  response: Response,
  owner: DirectoryOwner,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  if (!response.ok) {
    // Error bodies may be arbitrarily large; retire the stream without reading it.
    void response.body?.cancel().catch(() => {});
    throw new DirectoryReadError('unavailable');
  }
  if (!response.body) throw new DirectoryReadError('invalid-response');
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  let text = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      if (signal.aborted) throw new DirectoryReadError('unavailable');
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > DIRECTORY_BYTES) throw new DirectoryReadError('too-large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    if (signal.aborted) throw new DirectoryReadError('unavailable');
    text += decoder.decode();
    return decodeMentionDirectory(JSON.parse(text), owner);
  } catch (error) {
    cancel();
    throw error instanceof DirectoryReadError ? error : new DirectoryReadError('invalid-response');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
