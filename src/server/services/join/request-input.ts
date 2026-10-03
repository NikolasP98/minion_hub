import { error } from '@sveltejs/kit';

export function joinMessage(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || value.length > 500)
    throw error(400, 'Message must be at most 500 characters.');
  return value.trim() || undefined;
}

/** Read a small request even when Content-Length is absent or inaccurate. */
async function readBoundedJoinBytes(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 5_000);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (timedOut) throw error(408, 'Access request timed out.');
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        void reader.cancel().catch(() => undefined);
        throw error(413, 'Access request is too large.');
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJoinRequestForm(request: Request): Promise<FormData> {
  const bytes = await readBoundedJoinBytes(request);
  try {
    return await new Request('http://join-form.invalid', {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
      body: bytes,
    }).formData();
  } catch {
    throw error(400, 'Invalid access request form.');
  }
}

export async function readJoinRequestBody(request: Request): Promise<{ message?: string }> {
  const bytes = await readBoundedJoinBytes(request);
  if (!bytes.length) return {};
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw error(400, 'Invalid access request.');
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'message')
  ) {
    throw error(400, 'Invalid access request.');
  }
  return { message: joinMessage((body as Record<string, unknown>).message) };
}
