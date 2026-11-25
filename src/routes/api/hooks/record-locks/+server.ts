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
// 200 ids is about 8 KB; the cap is read as text (as /api/mcp does) before any JSON parsing.
const MAX_BODY_CHARS = 64 * 1024;

export const POST: RequestHandler = async (event) => {
  const caller = await resolveLocksCaller(event);
  if (caller instanceof Response) return caller;
  const text = await event.request.text();
  if (text.length > MAX_BODY_CHARS)
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
