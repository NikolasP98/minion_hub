import { json } from '@sveltejs/kit';
import type { CoreCtx } from '$server/auth/core-ctx';
import { CorrectionError, parsePreviewRequest } from '$server/services/stock-corrections.logic';
import { logLockEvent, personActor } from '$server/services/record-locks.service';
import type { LockHit } from '$lib/types/record-locks';

/** The hits a lock refusal carries (`{ locks }`), or null for any other detail. */
function lockHits(e: CorrectionError): LockHit[] | null {
  if (e.code !== 'period_locked' && e.code !== 'record_locked') return null;
  const d = e.detail as { locks?: unknown } | undefined;
  return d && Array.isArray(d.locks) ? (d.locks as LockHit[]) : null;
}

/** Shared HTTP mapping for the correction routes (underscore = not a route module). Refusals carry `{ error, code, outcome: 'not_applied' }`. */
export function correctionResponse(e: unknown): Response {
  if (e instanceof CorrectionError) {
    const locks = lockHits(e);
    return json(
      {
        error: e.message,
        code: e.code,
        outcome: 'not_applied',
        // Lock refusals name every rule that applies and who can lift it (spec 140).
        ...(locks ? { locks, unlockBy: 'owner' } : e.detail ? { items: e.detail } : {}),
      },
      { status: e.status, headers: { 'cache-control': 'no-store' } },
    );
  }
  throw e;
}
export const noStore = { headers: { 'cache-control': 'no-store' } } as const;

/**
 * Audit a refused correction (spec 140, R8). The refused transaction is read-only or rolled back, so
 * the `refused` event goes in its own short transaction. Best effort: a failed log never changes the
 * refusal the caller gets.
 */
export async function logLockRefusal(
  ctx: CoreCtx,
  actorName: string | null,
  e: unknown,
  rawRequest: unknown,
): Promise<void> {
  if (!(e instanceof CorrectionError)) return;
  const locks = lockHits(e);
  if (!locks) return;
  try {
    const request = parsePreviewRequest(rawRequest);
    if (request.mode !== 'receipt_replace') return;
    await logLockEvent(
      ctx,
      {
        action: 'refused',
        recordType: 'stock_receipt',
        recordId: request.sourceId,
        rules: locks,
        actor: personActor(ctx, actorName),
        detail: { code: e.code },
      },
      // Preview and apply are callable in a loop: one refusal row per actor, record and code per 10 minutes.
      { dedupeMs: 10 * 60_000 },
    );
  } catch (err) {
    console.error('[record-locks] could not log a refused correction', (err as Error).name);
  }
}
