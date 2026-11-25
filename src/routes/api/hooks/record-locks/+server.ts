import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { hookRefusal, resolveLocksCaller } from '$server/locks/caller';
import { HookError, parseHookBody } from '$server/services/record-locks.logic';
import { applyExternalLock } from '$server/services/record-locks.service';

/**
 * POST /api/hooks/record-locks (spec 140 S4): an outside system (accounting, audit) locks past
 * records up to a date or by id, or lifts what it locked. Authenticated by an org API key with
 * the `locks` scope (`/api/hooks` is in `API_HANDLER_AUTH_PATHS`: no session, no tenant). The key
 * can only lock and lift webhook locks; it cannot read data or unlock records.
 */
// 200 ids is about 8 KB. The cap counts BYTES (a multibyte body is not under it by character count)
// and is enforced while streaming, so an oversized body is never read to the end.
const MAX_BODY_BYTES = 64 * 1024;

/** The body as text, or null as soon as it exceeds `max` bytes (the rest of the stream is cancelled). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export const POST: RequestHandler = async (event) => {
  const caller = await resolveLocksCaller(event);
  if (caller instanceof Response) return caller;
  const text = await readCapped(event.request, MAX_BODY_BYTES);
  if (text === null)
    return json(
      {
        error: 'The request body is too large.',
        code: 'too_large',
        next: 'Send at most 200 ids per call.',
      },
      { status: 413, headers: { 'cache-control': 'no-store' } },
    );
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HookError('invalid_request', 'body must be JSON');
    }
    const result = await applyExternalLock(caller.ctx, caller.key, parseHookBody(raw));
    return json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof HookError) return hookRefusal(e);
    throw e;
  }
};
