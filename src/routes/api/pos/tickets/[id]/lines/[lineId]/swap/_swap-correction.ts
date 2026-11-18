import { error, json } from '@sveltejs/kit';
import { CorrectionError, type PreviewRequest } from '$server/services/stock-corrections.logic';
import { PosError } from '$server/services/pos/errors';
import { handlePosError } from '../../../../../_errors';
import { correctionResponse } from '../../../../../../stock/_corrections-http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The path binds the sale line; a malformed id is a plain 404 like every other unknown line. */
export function swapRequest(
  lineId: string,
  body: { productId: string; expectedProductId: string },
): PreviewRequest {
  if (!UUID.test(lineId)) throw error(404);
  return {
    mode: 'variant_swap',
    sourceType: 'pos_ticket_line',
    sourceId: lineId,
    expectedProductId: body.expectedProductId,
    replacement: { productId: body.productId },
  };
}

/** Refusals keep the legacy till wire codes (the page maps them); the rest use the closed correction body. */
export async function swapRefusal(e: unknown): Promise<Response> {
  if (e instanceof CorrectionError && e.posCode) {
    const legacy = handlePosError(
      new PosError(e.message, e.posCode, e.detail as ConstructorParameters<typeof PosError>[2]),
    );
    // A thrown CorrectionError rolled its whole transaction back: say so, as the closed body does.
    return json(
      { ...(await legacy.json()), outcome: 'not_applied' },
      { status: legacy.status, headers: { 'cache-control': 'no-store' } },
    );
  }
  return correctionResponse(e);
}

export const refreshRequired = () =>
  json(
    {
      error: 'reload the sale and confirm the change with a reason',
      code: 'refresh_required',
      outcome: 'not_applied',
    },
    { status: 422, headers: { 'cache-control': 'no-store' } },
  );
