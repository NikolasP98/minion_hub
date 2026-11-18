import { json } from '@sveltejs/kit';
import { CorrectionError } from '$server/services/stock-corrections.logic';

/** Shared HTTP mapping for the correction routes (underscore = not a route module). Refusals carry `{ error, code, outcome: 'not_applied' }`. */
export function correctionResponse(e: unknown): Response {
  if (e instanceof CorrectionError)
    return json(
      {
        error: e.message,
        code: e.code,
        outcome: 'not_applied',
        ...(e.detail ? { items: e.detail } : {}),
      },
      { status: e.status, headers: { 'cache-control': 'no-store' } },
    );
  throw e;
}
export const noStore = { headers: { 'cache-control': 'no-store' } } as const;
