import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { loadCustomPropertyBundle } from '$server/services/custom-property-bundle.service';
import {
  CUSTOM_PROPERTY_QUERY_RECORDS_MAX,
  CUSTOM_PROPERTY_TABLE_IDS,
} from '$lib/tables/custom-properties';
import { propertyApiError, requireActor } from '../../api';

const querySchema = z
  .object({
    tableId: z.enum(CUSTOM_PROPERTY_TABLE_IDS),
    recordIds: z.array(z.string().min(1).max(500)).max(CUSTOM_PROPERTY_QUERY_RECORDS_MAX),
  })
  .strict();
export const POST: RequestHandler = async ({ locals, request }) => {
  try {
    const ctx = await requireCoreCtx(locals);
    requireActor(ctx);
    const body = await parseBody(request, querySchema);
    return json(await loadCustomPropertyBundle(locals, ctx, body.tableId, body.recordIds));
  } catch (e) {
    return propertyApiError(e);
  }
};
