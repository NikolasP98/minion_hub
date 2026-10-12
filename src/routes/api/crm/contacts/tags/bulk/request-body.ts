import { CRM_TAG_BULK_MAX_BYTES } from '$lib/tags/crm-bulk-contract';

export class PayloadTooLargeError extends Error {}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > CRM_TAG_BULK_MAX_BYTES) {
    throw new PayloadTooLargeError();
  }
  if (!request.body) return JSON.parse('');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CRM_TAG_BULK_MAX_BYTES) {
        try {
          await reader.cancel('payload_too_large');
        } catch {
          // Preserve the admission outcome even if the producer rejects cancellation.
        }
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Releasing is cleanup only and must not replace the admission outcome.
    }
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}
