import { fetchJson } from '$lib/api/fetch-json';
export interface DraftFile {
  id: string;
  name: string;
  size: number;
}
/** Resolve short-lived downloads only when the user sends. The draft stores
 * durable file ids, never expired URLs; signing is read-only and repeatable. */
export async function fileDraftContext(
  files: readonly DraftFile[],
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  opts.signal?.throwIfAborted();
  const refs = await Promise.all(
    files.map(async (file) => {
      const result = await fetchJson<{ file: { url: string } }>(
        `/api/files/${encodeURIComponent(file.id)}`,
        ...(opts.signal ? [{ signal: opts.signal }] : []),
      );
      opts.signal?.throwIfAborted();
      const url = new URL(result.file.url);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
        throw new Error('Invalid file URL');
      const name = file.name.replace(/[\r\n\[\]]/g, '_');
      return `[Attached file: ${name}]\n${url.href}`;
    }),
  );
  return refs.join('\n\n');
}
